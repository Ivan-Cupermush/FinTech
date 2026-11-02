/*
 * kusok — командная строка. коды выхода: 0 ок, 1 ошибка, 2 вызов, 3 fsck
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "cdc.h" /* chunks показывает работу нарезчика напрямую */
#include "kusok/kusok.h"
#include "serve.h"
#include "sha256.h"

static const char *prog = "kusok";

static _Noreturn void usage(void)
{
	fprintf(
	    stderr,
	    "использование:\n"
	    "  %s [опции] КАТАЛОГ put ФАЙЛ...|-\n"
	    "  %s [опции] КАТАЛОГ get ID [ВЫХОД]\n"
	    "  %s [опции] КАТАЛОГ cat ID СМЕЩЕНИЕ ДЛИНА\n"
	    "  %s [опции] КАТАЛОГ ref ID | rm ID\n"
	    "  %s [опции] КАТАЛОГ ls | stat | fsck | checkpoint\n"
	    "  %s [опции] КАТАЛОГ gc [ДОЛЯ_МУСОРА]\n"
	    "  %s [опции] КАТАЛОГ serve [АДРЕС:]ПОРТ\n"
	    "  %s [опции] КАТАЛОГ ids | export ВЫХОД|- [ЕСТЬ] | import ВХОД|-\n"
	    "  %s chunks ФАЙЛ\n"
	    "опции: --no-sync --no-compress --read-only --salvage --json\n"
	    "       --min N --avg N --max N --pack-limit N\n"
	    "       --level 1..12 --threads N --cache N\n",
	    prog, prog, prog, prog, prog, prog, prog, prog, prog);
	exit(2);
}

static int fail(const char *what, int rc)
{
	fprintf(stderr, "%s: %s: %s", prog, what, kusok_strerror(rc));
	if (rc == KUSOK_EIO && errno)
		fprintf(stderr, " (%s)", strerror(errno));
	fputc('\n', stderr);
	return 1;
}

static int parse_u32(const char *s, uint32_t *out)
{
	char *end;
	errno = 0;
	unsigned long long v = strtoull(s, &end, 10);
	if (errno || *end || v > UINT32_MAX)
		return -1;
	*out = (uint32_t)v;
	return 0;
}

static int parse_u64(const char *s, uint64_t *out)
{
	char *end;
	errno = 0;
	unsigned long long v = strtoull(s, &end, 10);
	if (errno || *end || s[0] == '-')
		return -1;
	*out = v;
	return 0;
}

static int json = 0;

/* --------------------------------------------------------- команды */

static int cmd_put(kusok *ks, int argc, char **argv)
{
	if (argc < 1)
		usage();
	for (int i = 0; i < argc; i++) {
		int fd = strcmp(argv[i], "-") == 0
			     ? 0
			     : open(argv[i], O_RDONLY | O_CLOEXEC);
		if (fd < 0) {
			fprintf(stderr, "%s: %s: %s\n", prog, argv[i],
				strerror(errno));
			return 1;
		}
		kusok_id id;
		int rc = kusok_put_fd(ks, fd, &id);
		if (fd)
			close(fd);
		if (rc)
			return fail(argv[i], rc);
		char hex[KUSOK_HEX_LEN + 1];
		uint64_t size = 0;
		kusok_id_hex(&id, hex);
		kusok_size(ks, &id, &size);
		if (json)
			printf("{\"id\":\"%s\",\"size\":%" PRIu64
			       ",\"new_bytes\":%" PRIu64 "}\n",
			       hex, size, kusok_last_put_new_bytes(ks));
		else
			printf("%s  %" PRIu64 " байт, новых %" PRIu64 "  %s\n",
			       hex, size, kusok_last_put_new_bytes(ks),
			       argv[i]);
	}
	return 0;
}

static int get_id(const char *s, kusok_id *id)
{
	if (kusok_id_parse(s, id)) {
		fprintf(stderr, "%s: плохой id: %s\n", prog, s);
		exit(2);
	}
	return 0;
}

static int cmd_get(kusok *ks, int argc, char **argv)
{
	kusok_id id;
	if (argc < 1 || argc > 2)
		usage();
	get_id(argv[0], &id);
	int fd = 1;
	if (argc == 2 && strcmp(argv[1], "-") != 0) {
		fd = open(argv[1], O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC,
			  0644);
		if (fd < 0) {
			fprintf(stderr, "%s: %s: %s\n", prog, argv[1],
				strerror(errno));
			return 1;
		}
	}
	int rc = kusok_get_fd(ks, &id, fd);
	if (fd != 1 && close(fd) && !rc)
		rc = KUSOK_EIO;
	return rc ? fail("get", rc) : 0;
}

static int cmd_cat(kusok *ks, int argc, char **argv)
{
	kusok_id id;
	uint64_t off, len;
	if (argc != 3 || parse_u64(argv[1], &off) || parse_u64(argv[2], &len))
		usage();
	get_id(argv[0], &id);
	uint8_t buf[65536];
	while (len) {
		size_t want = len < sizeof(buf) ? (size_t)len : sizeof(buf);
		size_t got;
		int rc = kusok_read(ks, &id, off, buf, want, &got);
		if (rc)
			return fail("cat", rc);
		if (got == 0)
			break;
		if (fwrite(buf, 1, got, stdout) != got)
			return 1;
		off += got;
		len -= got;
	}
	return 0;
}

static int cmd_ref(kusok *ks, int argc, char **argv, int plus)
{
	kusok_id id;
	int64_t refs = 0;
	if (argc != 1)
		usage();
	get_id(argv[0], &id);
	int rc = plus ? kusok_ref(ks, &id) : kusok_unref(ks, &id);
	if (rc)
		return fail(plus ? "ref" : "rm", rc);
	kusok_refs(ks, &id, &refs);
	printf("%s ссылок: %" PRId64 "\n", argv[0], refs);
	return 0;
}

static int print_one(const kusok_id *id, uint64_t size, int64_t refs, void *ctx)
{
	(void)ctx;
	char hex[KUSOK_HEX_LEN + 1];
	kusok_id_hex(id, hex);
	if (json)
		printf("{\"id\":\"%s\",\"size\":%" PRIu64 ",\"refs\":%" PRId64
		       "}\n",
		       hex, size, refs);
	else
		printf("%s  %12" PRIu64 "  x%" PRId64 "\n", hex, size, refs);
	return 0;
}

static int cmd_stat(kusok *ks)
{
	kusok_stat st;
	int rc = kusok_stat_get(ks, &st);
	if (rc)
		return fail("stat", rc);
	double ratio = st.stored_bytes
			   ? (double)st.logical_bytes / (double)st.stored_bytes
			   : 0.0;
	if (json) {
		printf("{\"files\":%" PRIu64 ",\"chunks\":%" PRIu64
		       ",\"logical_bytes\":%" PRIu64
		       ",\"unique_bytes\":%" PRIu64 ",\"stored_bytes\":%" PRIu64
		       ",\"packs\":%u,\"ratio\":%.3f}\n",
		       st.files, st.chunks, st.logical_bytes, st.unique_bytes,
		       st.stored_bytes, st.packs, ratio);
		return 0;
	}
	printf("файлов:          %" PRIu64 "\n", st.files);
	printf("кусков:          %" PRIu64 "\n", st.chunks);
	printf("без kusok:       %" PRIu64 " байт\n", st.logical_bytes);
	printf("уникальных:      %" PRIu64 " байт\n", st.unique_bytes);
	printf("на диске:        %" PRIu64 " байт в %u pack\n", st.stored_bytes,
	       st.packs);
	printf("экономия:        %.2fx\n", ratio);
	return 0;
}

static int cmd_gc(kusok *ks, int argc, char **argv)
{
	double dolya = 0.3;
	if (argc > 1)
		usage();
	if (argc == 1) {
		char *end;
		dolya = strtod(argv[0], &end);
		if (*end || dolya < 0 || dolya > 1)
			usage();
	}
	kusok_gc_report r;
	int rc = kusok_gc(ks, dolya, &r);
	if (rc)
		return fail("gc", rc);
	printf("переписано pack: %u, выброшено записей: %" PRIu64
	       ", байт: %" PRIu64 " -> %" PRIu64 "\n",
	       r.packs_rewritten, r.records_dropped, r.bytes_before,
	       r.bytes_after);
	return 0;
}

static int cmd_fsck(kusok *ks)
{
	kusok_fsck_report r;
	int rc = kusok_fsck(ks, &r);
	if (rc)
		return fail("fsck", rc);
	printf("записей: %" PRIu64 ", битых: %" PRIu64 "\n", r.records,
	       r.bad_records);
	printf("файлов: %" PRIu64 ", повреждённых: %" PRIu64
	       ", без манифеста: %" PRIu64 "\n",
	       r.files, r.broken_files, r.missing_manifests);
	if (r.bad_records || r.broken_files || r.missing_manifests) {
		printf("НАЙДЕНЫ ПОВРЕЖДЕНИЯ\n");
		return 3;
	}
	printf("всё целое\n");
	return 0;
}

/* без хранилища: просто показать, как файл режется */
/* serve [АДРЕС:]ПОРТ, по умолчанию 127.0.0.1:8750 */
static int cmd_serve(kusok *ks, int argc, char **argv)
{
	char host[64] = "127.0.0.1";
	uint32_t port = 8750;
	if (argc > 1)
		usage();
	if (argc == 1) {
		const char *a = argv[0], *colon = strrchr(a, ':');
		if (colon) {
			size_t n = (size_t)(colon - a);
			if (n == 0 || n >= sizeof(host))
				usage();
			memcpy(host, a, n);
			host[n] = 0;
			a = colon + 1;
		}
		if (parse_u32(a, &port) || port > 65535)
			usage();
	}
	int rc = ks_serve(ks, host, (int)port);
	return rc ? fail("serve", rc) : 0;
}

static int print_id(const kusok_id *id, void *ctx)
{
	(void)ctx;
	char hex[KUSOK_HEX_LEN + 1];
	kusok_id_hex(id, hex);
	puts(hex);
	return 0;
}

/* список id из файла: по одному hex в строке (то, что печатает ids) */
static int read_ids(const char *path, kusok_id **out, size_t *n)
{
	FILE *f = fopen(path, "r");
	if (!f) {
		fprintf(stderr, "%s: %s: %s\n", prog, path, strerror(errno));
		return -1;
	}
	char line[128];
	size_t kol = 0, cap = 0;
	kusok_id *a = NULL;
	while (fgets(line, sizeof(line), f)) {
		line[strcspn(line, "\r\n")] = 0;
		if (!line[0])
			continue;
		if (kol == cap) {
			cap = cap ? cap * 2 : 1024;
			kusok_id *na = realloc(a, cap * sizeof(*a));
			if (!na)
				break;
			a = na;
		}
		get_id(line, &a[kol++]);
	}
	fclose(f);
	*out = a;
	*n = kol;
	return 0;
}

/* отчёт; если пакет идёт в stdout — в stderr, чтобы не испортить его */
static void print_bundle(const char *what, const kusok_bundle_report *r,
			 FILE *f)
{
	if (json)
		fprintf(f,
			"{\"files\":%" PRIu64 ",\"chunks\":%" PRIu64
			",\"skipped\":%" PRIu64 ",\"bytes\":%" PRIu64 "}\n",
			r->files, r->chunks, r->skipped, r->bytes);
	else
		fprintf(stderr,
			"%s: файлов %" PRIu64 ", кусков %" PRIu64
			", пропущено %" PRIu64 ", байт %" PRIu64 "\n",
			what, r->files, r->chunks, r->skipped, r->bytes);
}

static int cmd_export(kusok *ks, int argc, char **argv)
{
	if (argc < 1 || argc > 2)
		usage();
	kusok_id *known = NULL;
	size_t nknown = 0;
	if (argc == 2 && read_ids(argv[1], &known, &nknown))
		return 1;
	int fd = 1;
	if (strcmp(argv[0], "-")) {
		fd = open(argv[0], O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC,
			  0644);
		if (fd < 0) {
			fprintf(stderr, "%s: %s: %s\n", prog, argv[0],
				strerror(errno));
			free(known);
			return 1;
		}
	}
	kusok_bundle_report r;
	int rc = kusok_export(ks, fd, known, nknown, &r);
	if (!rc && fd != 1 && fsync(fd))
		rc = KUSOK_EIO;
	if (fd != 1)
		close(fd);
	free(known);
	if (rc)
		return fail("export", rc);
	print_bundle("export", &r, fd == 1 ? stderr : stdout);
	return 0;
}

static int cmd_import(kusok *ks, int argc, char **argv)
{
	if (argc != 1)
		usage();
	int fd = 0;
	if (strcmp(argv[0], "-")) {
		fd = open(argv[0], O_RDONLY | O_CLOEXEC);
		if (fd < 0) {
			fprintf(stderr, "%s: %s: %s\n", prog, argv[0],
				strerror(errno));
			return 1;
		}
	}
	kusok_bundle_report r;
	int rc = kusok_import(ks, fd, &r);
	if (fd)
		close(fd);
	if (rc)
		return fail("import", rc);
	print_bundle("import", &r, stdout);
	return 0;
}

static int cmd_chunks(const kusok_opts *o, int argc, char **argv);

int main(int argc, char **argv)
{
	kusok_opts o;
	kusok_opts_default(&o);
	int i = 1;
	for (; i < argc && strncmp(argv[i], "--", 2) == 0; i++) {
		const char *a = argv[i];
		if (!strcmp(a, "--no-sync"))
			o.sync = 0;
		else if (!strcmp(a, "--no-compress"))
			o.compress = 0;
		else if (!strcmp(a, "--read-only"))
			o.read_only = 1;
		else if (!strcmp(a, "--salvage"))
			o.salvage = 1;
		else if (!strcmp(a, "--json"))
			json = 1;
		else if (i + 1 < argc && !strcmp(a, "--min")) {
			if (parse_u32(argv[++i], &o.min_chunk))
				usage();
		} else if (i + 1 < argc && !strcmp(a, "--avg")) {
			if (parse_u32(argv[++i], &o.avg_chunk))
				usage();
		} else if (i + 1 < argc && !strcmp(a, "--max")) {
			if (parse_u32(argv[++i], &o.max_chunk))
				usage();
		} else if (i + 1 < argc && !strcmp(a, "--pack-limit")) {
			if (parse_u32(argv[++i], &o.pack_limit))
				usage();
		} else if (i + 1 < argc && !strcmp(a, "--level")) {
			uint32_t v;
			if (parse_u32(argv[++i], &v) || v < 1 || v > 12)
				usage();
			o.compress = (int)v;
		} else if (i + 1 < argc && !strcmp(a, "--threads")) {
			uint32_t v;
			if (parse_u32(argv[++i], &v) || v > 64)
				usage();
			o.threads = (int)v;
		} else if (i + 1 < argc && !strcmp(a, "--cache")) {
			uint32_t v;
			if (parse_u32(argv[++i], &v) || v < 1 || v > 65536)
				usage();
			o.cache_chunks = (int)v;
		} else if (!strcmp(a, "--version")) {
			printf("kusok %s\n", KUSOK_VERSION_STRING);
			return 0;
		} else {
			usage();
		}
	}
	if (i < argc && !strcmp(argv[i], "chunks"))
		return cmd_chunks(&o, argc - i - 1, argv + i + 1);
	if (argc - i < 2)
		usage();
	const char *dir = argv[i];
	const char *cmd = argv[i + 1];
	int nargs = argc - i - 2;
	char **args = argv + i + 2;

	/* команды, которые только читают, открывают каталог на чтение */
	if (!strcmp(cmd, "get") || !strcmp(cmd, "cat") || !strcmp(cmd, "ls") ||
	    !strcmp(cmd, "stat") || !strcmp(cmd, "fsck") ||
	    !strcmp(cmd, "ids") || !strcmp(cmd, "export"))
		o.read_only = 1;

	kusok *ks;
	int rc = kusok_open(dir, &o, &ks);
	if (rc)
		return fail(dir, rc);
	int ret;
	if (!strcmp(cmd, "put"))
		ret = cmd_put(ks, nargs, args);
	else if (!strcmp(cmd, "get"))
		ret = cmd_get(ks, nargs, args);
	else if (!strcmp(cmd, "cat"))
		ret = cmd_cat(ks, nargs, args);
	else if (!strcmp(cmd, "ref"))
		ret = cmd_ref(ks, nargs, args, 1);
	else if (!strcmp(cmd, "rm"))
		ret = cmd_ref(ks, nargs, args, 0);
	else if (!strcmp(cmd, "ls"))
		ret =
		    (rc = kusok_list(ks, print_one, NULL)) ? fail("ls", rc) : 0;
	else if (!strcmp(cmd, "stat"))
		ret = cmd_stat(ks);
	else if (!strcmp(cmd, "gc"))
		ret = cmd_gc(ks, nargs, args);
	else if (!strcmp(cmd, "fsck"))
		ret = cmd_fsck(ks);
	else if (!strcmp(cmd, "ids"))
		ret = (rc = kusok_list_ids(ks, print_id, NULL))
			  ? fail("ids", rc)
			  : 0;
	else if (!strcmp(cmd, "export"))
		ret = cmd_export(ks, nargs, args);
	else if (!strcmp(cmd, "import"))
		ret = cmd_import(ks, nargs, args);
	else if (!strcmp(cmd, "serve"))
		ret = cmd_serve(ks, nargs, args);
	else if (!strcmp(cmd, "checkpoint"))
		ret = (rc = kusok_checkpoint(ks)) ? fail("checkpoint", rc) : 0;
	else {
		kusok_close(ks);
		usage();
		return 2;
	}
	rc = kusok_close(ks);
	if (rc && !ret)
		ret = fail("close", rc);
	return ret;
}

/* --------------------------------------------------------- chunks */

struct chunks_ctx {
	uint64_t pos;
	uint64_t kol;
};

static int show_chunk(const uint8_t *p, size_t n, void *ctx)
{
	struct chunks_ctx *c = ctx;
	uint8_t d[32];
	ks_sha256_buf(p, n, d);
	printf("%10" PRIu64 " %8zu  ", c->pos, n);
	for (int i = 0; i < 8; i++)
		printf("%02x", d[i]);
	putchar('\n');
	c->pos += n;
	c->kol++;
	return 0;
}

static int cmd_chunks(const kusok_opts *o, int argc, char **argv)
{
	if (argc != 1)
		usage();
	ks_cdc c;
	if (ks_cdc_init(&c, o->min_chunk, o->avg_chunk, o->max_chunk)) {
		fprintf(stderr, "%s: плохие размеры кусков\n", prog);
		return 2;
	}
	int fd = strcmp(argv[0], "-") == 0 ? 0 : open(argv[0], O_RDONLY);
	if (fd < 0) {
		fprintf(stderr, "%s: %s: %s\n", prog, argv[0], strerror(errno));
		return 1;
	}
	ks_chunker k;
	if (ks_chunker_init(&k, &c))
		return 1;
	struct chunks_ctx ctx = {0, 0};
	uint8_t buf[1 << 16];
	ssize_t r;
	printf("  смещение    длина  sha256[:8]\n");
	while ((r = read(fd, buf, sizeof(buf))) > 0)
		ks_chunker_feed(&k, buf, (size_t)r, show_chunk, &ctx);
	ks_chunker_finish(&k, show_chunk, &ctx);
	ks_chunker_free(&k);
	if (fd)
		close(fd);
	printf("кусков: %" PRIu64 ", средний размер: %.0f\n", ctx.kol,
	       ctx.kol ? (double)ctx.pos / (double)ctx.kol : 0.0);
	return r < 0 ? 1 : 0;
}
