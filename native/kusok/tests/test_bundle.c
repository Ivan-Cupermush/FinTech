/*
 * перенос между хранилищами: export / import
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#include "kusok/kusok.h"
#include "tt.h"

enum { NF = 8, RAZMER = 60000 };

static void dannye(uint8_t *d, int i)
{
	tt_fill_text(d, RAZMER, (uint64_t)i / 2 + 1);
	/* соседние файлы — почти одинаковые версии */
	if (i & 1)
		memset(d + 20000, 'v', 300);
}

struct istochnik {
	char *dir;
	kusok_id ids[NF];
	kusok_id mertvyi;
};

static void sozdat(struct istochnik *s)
{
	s->dir = tt_tmpdir();
	kusok *ks = tt_open(s->dir);
	uint8_t *d = malloc(RAZMER);
	for (int i = 0; i < NF; i++) {
		dannye(d, i);
		s->ids[i] = tt_put(ks, d, RAZMER);
	}
	kusok_ref(ks, &s->ids[3]); /* у одного 2 ссылки */
	s->mertvyi = tt_put(ks, "dead file", 9);
	kusok_unref(ks, &s->mertvyi);
	free(d);
	kusok_close(ks);
}

static void ubrat(struct istochnik *s)
{
	tt_rmdir(s->dir);
	free(s->dir);
}

static char *put_k(const char *dir, const char *name)
{
	char *p = malloc(4300);
	snprintf(p, 4300, "%s/%s", dir, name);
	return p;
}

/* экспорт в файл; known — что уже есть у получателя */
static int eksport(const char *src, const char *file, const kusok_id *known,
		   size_t n, kusok_bundle_report *r)
{
	kusok_opts o = tt_opts();
	o.read_only = 1;
	kusok *ks = tt_open_with(src, &o);
	int fd = open(file, O_WRONLY | O_CREAT | O_TRUNC, 0644);
	int rc = kusok_export(ks, fd, known, n, r);
	close(fd);
	kusok_close(ks);
	return rc;
}

static int import_v(kusok *ks, const char *file, kusok_bundle_report *r)
{
	int fd = open(file, O_RDONLY);
	int rc = kusok_import(ks, fd, r);
	close(fd);
	return rc;
}

static int vse_est(kusok *ks, const struct istochnik *s)
{
	uint8_t *d = malloc(RAZMER);
	int ok = 1;
	for (int i = 0; i < NF; i++) {
		dannye(d, i);
		ok &= tt_same(ks, &s->ids[i], d, RAZMER);
	}
	free(d);
	return ok;
}

static int chist(kusok *ks)
{
	kusok_fsck_report f;
	return kusok_fsck(ks, &f) == 0 && !f.bad_records && !f.broken_files &&
	       !f.missing_manifests;
}

TT_TEST(full_roundtrip)
{
	struct istochnik s;
	sozdat(&s);
	char *file = put_k(s.dir, "b.kbundle");
	kusok_bundle_report r;
	TT_OK(eksport(s.dir, file, NULL, 0, &r));
	TT_EQU(r.files, NF);
	TT_CHECK(r.skipped > 0); /* общие куски версий — один раз */
	char *dst = tt_tmpdir();
	kusok *ks = tt_open(dst);
	TT_OK(import_v(ks, file, &r));
	TT_EQU(r.files, NF);
	TT_CHECK(vse_est(ks, &s));
	int64_t refs;
	TT_OK(kusok_refs(ks, &s.ids[3], &refs));
	TT_EQ(refs, 1); /* «хотя бы одна», а не копия счётчика */
	uint64_t size;
	TT_EQ(kusok_size(ks, &s.mertvyi, &size), KUSOK_ENOTFOUND);
	TT_CHECK(chist(ks));
	/* второй раз — ничего нового, ссылки те же */
	TT_OK(import_v(ks, file, &r));
	TT_EQU(r.files, 0);
	TT_EQU(r.chunks, 0);
	TT_OK(kusok_refs(ks, &s.ids[0], &refs));
	TT_EQ(refs, 1);
	ks = tt_reopen(ks, dst);
	TT_CHECK(vse_est(ks, &s));
	kusok_close(ks);
	free(file);
	tt_rmdir(dst);
	free(dst);
	ubrat(&s);
}

struct sbor {
	kusok_id *a;
	size_t n, cap;
};

static int sobrat(const kusok_id *id, void *ctx)
{
	struct sbor *s = ctx;
	if (s->n == s->cap) {
		s->cap = s->cap ? s->cap * 2 : 256;
		s->a = realloc(s->a, s->cap * sizeof(*s->a));
	}
	s->a[s->n++] = *id;
	return 0;
}

TT_TEST(incremental)
{
	struct istochnik s;
	sozdat(&s);
	char *file = put_k(s.dir, "b1");
	kusok_bundle_report r1, r2;
	TT_OK(eksport(s.dir, file, NULL, 0, &r1));
	char *dst = tt_tmpdir();
	kusok *ks = tt_open(dst);
	TT_OK(import_v(ks, file, &r1));
	/* у источника новая версия файла 0 */
	kusok *src = tt_open(s.dir);
	uint8_t *d = malloc(RAZMER);
	dannye(d, 0);
	memcpy(d + 100, "NEW VERSION", 11);
	kusok_id nov = tt_put(src, d, RAZMER);
	kusok_close(src);
	/* получатель говорит, что у него есть */
	struct sbor est = {NULL, 0, 0};
	TT_OK(kusok_list_ids(ks, sobrat, &est));
	TT_OK(eksport(s.dir, file, est.a, est.n, &r2));
	printf("    полный пакет %llu байт, добавка %llu байт\n",
	       (unsigned long long)r1.bytes, (unsigned long long)r2.bytes);
	TT_CHECK(r2.bytes * 10 < r1.bytes);
	TT_OK(import_v(ks, file, &r2));
	TT_EQU(r2.files, 1);
	TT_CHECK(tt_same(ks, &nov, d, RAZMER));
	TT_CHECK(vse_est(ks, &s));
	TT_CHECK(chist(ks));
	/* а если «есть» соврали — импорт отказывает и ссылок не даёт */
	char *dst2 = tt_tmpdir();
	kusok *ks2 = tt_open(dst2);
	TT_EQ(import_v(ks2, file, &r2), KUSOK_ECORRUPT);
	kusok_stat st;
	kusok_stat_get(ks2, &st);
	TT_EQU(st.files, 0);
	TT_CHECK(chist(ks2));
	kusok_close(ks2);
	tt_rmdir(dst2);
	free(dst2);
	free(est.a);
	free(d);
	kusok_close(ks);
	free(file);
	tt_rmdir(dst);
	free(dst);
	ubrat(&s);
}

TT_TEST(damaged_bundle)
{
	struct istochnik s;
	sozdat(&s);
	char *file = put_k(s.dir, "b");
	kusok_bundle_report r;
	TT_OK(eksport(s.dir, file, NULL, 0, &r));
	int fd = open(file, O_RDONLY);
	size_t n = (size_t)lseek(fd, 0, SEEK_END);
	uint8_t *orig = malloc(n);
	tt_pread(fd, orig, n, 0);
	close(fd);
	char *bad = put_k(s.dir, "bad");
	char *dst = tt_tmpdir();
	kusok *ks = tt_open(dst);
	uint64_t x = 5;
	size_t prinyal = 0, ploho = 0;
	for (int k = 0; k < 200; k++) {
		fd = open(bad, O_WRONLY | O_CREAT | O_TRUNC, 0644);
		size_t len = n;
		if (k % 3 == 2) {
			len = (size_t)(tt_rand(&x) % n); /* оборван */
			tt_write(fd, orig, len);
		} else {
			tt_write(fd, orig, n);
			size_t gde = (size_t)(tt_rand(&x) % n);
			uint8_t b =
			    orig[gde] ^ (uint8_t)(1 + tt_rand(&x) % 255);
			tt_pwrite(fd, &b, 1, (long long)gde);
		}
		close(fd);
		if (import_v(ks, bad, &r) == KUSOK_OK)
			prinyal++;
		kusok_stat st;
		kusok_stat_get(ks, &st);
		ploho += st.files != 0;
	}
	TT_EQU(prinyal, 0);
	TT_EQU(ploho, 0);
	TT_CHECK(chist(ks));
	/* а целый после всего этого принимается */
	TT_OK(import_v(ks, file, &r));
	TT_CHECK(vse_est(ks, &s));
	kusok_close(ks);
	free(orig);
	free(bad);
	free(file);
	tt_rmdir(dst);
	free(dst);
	ubrat(&s);
}

TT_TEST(through_pipe)
{
	/* как ssh сервер kusok export - | kusok import - */
	struct istochnik s;
	sozdat(&s);
	int p[2];
	TT_EQ(pipe(p), 0);
	pid_t pid = fork();
	if (pid == 0) {
		close(p[0]);
		kusok_opts o = tt_opts();
		o.read_only = 1;
		kusok *src;
		if (kusok_open(s.dir, &o, &src))
			_exit(1);
		int rc = kusok_export(src, p[1], NULL, 0, NULL);
		kusok_close(src);
		_exit(rc ? 1 : 0);
	}
	close(p[1]);
	char *dst = tt_tmpdir();
	kusok *ks = tt_open(dst);
	TT_OK(kusok_import(ks, p[0], NULL));
	close(p[0]);
	int st;
	waitpid(pid, &st, 0);
	TT_CHECK(WIFEXITED(st) && WEXITSTATUS(st) == 0);
	TT_CHECK(vse_est(ks, &s));
	kusok_close(ks);
	tt_rmdir(dst);
	free(dst);
	ubrat(&s);
}

TT_TEST(limits_and_args)
{
	struct istochnik s;
	sozdat(&s);
	char *file = put_k(s.dir, "b");
	TT_OK(eksport(s.dir, file, NULL, 0, NULL));
	char *dst = tt_tmpdir();
	/* у получателя куски мельче — не примет */
	kusok_opts o = tt_opts();
	o.min_chunk = 64;
	o.avg_chunk = 128;
	o.max_chunk = 256;
	kusok *ks = tt_open_with(dst, &o);
	TT_EQ(import_v(ks, file, NULL), KUSOK_ETOOBIG);
	kusok_close(ks);
	o = tt_opts();
	o.read_only = 1;
	ks = tt_open_with(dst, &o);
	TT_EQ(import_v(ks, file, NULL), KUSOK_ERDONLY);
	TT_EQ(kusok_import(ks, -1, NULL), KUSOK_EINVAL);
	TT_EQ(kusok_export(ks, 1, NULL, 3, NULL), KUSOK_EINVAL);
	TT_EQ(kusok_list_ids(ks, NULL, NULL), KUSOK_EINVAL);
	kusok_close(ks);
	free(file);
	tt_rmdir(dst);
	free(dst);
	ubrat(&s);
}

TT_TEST(one_chunk_file)
{
	/* у файла из одного куска id файла == id куска */
	char *src = tt_tmpdir(), *dst = tt_tmpdir();
	kusok *ks = tt_open(src);
	kusok_id id = tt_put(ks, "hi\n", 3);
	kusok_close(ks);
	char *file = put_k(src, "b");
	TT_OK(eksport(src, file, NULL, 0, NULL));
	ks = tt_open(dst);
	TT_OK(import_v(ks, file, NULL));
	TT_CHECK(tt_same(ks, &id, "hi\n", 3));
	kusok_close(ks);
	free(file);
	tt_rmdir(src);
	tt_rmdir(dst);
	free(src);
	free(dst);
}

int main(void)
{
	TT_RUN(full_roundtrip);
	TT_RUN(incremental);
	TT_RUN(damaged_bundle);
	TT_RUN(through_pipe);
	TT_RUN(limits_and_args);
	TT_RUN(one_chunk_file);
	return tt_done();
}
