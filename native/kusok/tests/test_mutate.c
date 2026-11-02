/*
 * модельный тест и порча случайных байт
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "kusok/kusok.h"
#include "lz.h"
#include "manifest.h"
#include "tt.h"

enum { MAXF = 40, BASE = 120000 };

struct model {
	int est;
	int64_t refs;
	size_t n;
	uint64_t seed;
	int text;
	kusok_id id;
};

/* данные файла i — из seed, держать их в памяти не нужно */
static uint8_t *dannye(const struct model *m)
{
	uint8_t *d = malloc(m->n ? m->n : 1);
	if (m->text)
		tt_fill_text(d, m->n, m->seed);
	else
		tt_fill(d, m->n, m->seed);
	return d;
}

TT_TEST(model_based)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	static struct model m[MAXF];
	memset(m, 0, sizeof(m));
	uint64_t s = 20261102;
	size_t bad = 0, ops = 0;
	int kol_gc = 0, kol_reopen = 0;
	for (int op = 0; op < 1500; op++, ops++) {
		int i = (int)(tt_rand(&s) % MAXF);
		unsigned what = (unsigned)(tt_rand(&s) % 100);
		if (what < 35) {
			/* иногда новая версия соседа */
			struct model nm;
			nm.n = (size_t)(tt_rand(&s) % BASE);
			nm.seed = (tt_rand(&s) % 4 == 0)
				      ? (uint64_t)((i + 1) % MAXF)
				      : tt_rand(&s);
			nm.text = (int)(tt_rand(&s) & 1);
			uint8_t *d = dannye(&nm);
			kusok_id id = tt_put(ks, d, nm.n);
			free(d);
			/* если такой файл уже есть в модели — это +1 ссылка ему */
			int found = -1;
			for (int k = 0; k < MAXF; k++)
				if (m[k].est && !memcmp(m[k].id.b, id.b, 32))
					found = k;
			if (found >= 0) {
				m[found].refs++;
			} else if (!m[i].est) {
				m[i] = nm;
				m[i].est = 1;
				m[i].refs = 1;
				m[i].id = id;
			} else {
				kusok_unref(ks,
					    &id); /* место занято — отпускаем */
			}
		} else if (what < 50) {
			if (m[i].est) {
				bad += kusok_ref(ks, &m[i].id) != KUSOK_OK;
				m[i].refs++;
			}
		} else if (what < 70) {
			if (m[i].est) {
				bad += kusok_unref(ks, &m[i].id) != KUSOK_OK;
				if (--m[i].refs == 0)
					m[i].est = 0;
			}
		} else if (what < 88) {
			if (m[i].est && m[i].n) {
				uint8_t *d = dannye(&m[i]);
				uint64_t off = tt_rand(&s) % m[i].n;
				size_t len = (size_t)(tt_rand(&s) % 20000);
				uint8_t *buf = malloc(len ? len : 1);
				size_t got;
				int rc = kusok_read(ks, &m[i].id, off, buf, len,
						    &got);
				size_t want =
				    off + len <= m[i].n ? len : m[i].n - off;
				bad += rc || got != want ||
				       memcmp(buf, d + off, got);
				free(buf);
				free(d);
			}
		} else if (what < 93) {
			bad += kusok_gc(ks, (double)(tt_rand(&s) % 60) / 100.0,
					NULL) != 0;
			kol_gc++;
		} else if (what < 96) {
			bad += kusok_checkpoint(ks) != 0;
		} else {
			ks = tt_reopen(ks, dir);
			kol_reopen++;
		}
	}
	/* финальная сверка всего */
	ks = tt_reopen(ks, dir);
	uint64_t logical = 0, files = 0;
	for (int k = 0; k < MAXF; k++) {
		if (!m[k].est)
			continue;
		uint8_t *d = dannye(&m[k]);
		bad += !tt_same(ks, &m[k].id, d, m[k].n);
		int64_t r;
		kusok_refs(ks, &m[k].id, &r);
		bad += r != m[k].refs;
		logical += m[k].n * (uint64_t)m[k].refs;
		files++;
		free(d);
	}
	kusok_stat st;
	kusok_stat_get(ks, &st);
	TT_EQU(st.files, files);
	TT_EQU(st.logical_bytes, logical);
	kusok_fsck_report f;
	TT_OK(kusok_fsck(ks, &f));
	TT_EQU(f.bad_records + f.broken_files + f.missing_manifests, 0);
	printf("    операций %zu, gc %d, переоткрытий %d, живых файлов %llu\n",
	       ops, kol_gc, kol_reopen, (unsigned long long)files);
	TT_EQU(bad, 0);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(lz_mutations_never_crash)
{
	uint8_t src[8000], z[9000], out[8000];
	size_t zn, n;
	uint64_t s = 1;
	tt_fill_text(src, sizeof(src), 3);
	TT_OK(ks_lz_compress(src, sizeof(src), z, sizeof(z), &zn));
	size_t ok = 0;
	for (int k = 0; k < 20000; k++) {
		uint8_t bad[9000];
		memcpy(bad, z, zn);
		int flips = 1 + (int)(tt_rand(&s) % 4);
		for (int f = 0; f < flips; f++)
			bad[tt_rand(&s) % zn] = (uint8_t)tt_rand(&s);
		size_t len = zn - (size_t)(tt_rand(&s) % 3);
		if (ks_lz_decompress(bad, len, out, sizeof(out), &n) ==
		    KUSOK_OK) {
			ok++;
			TT_CHECK(n <= sizeof(out));
		}
	}
	printf("    испорченных потоков, которые всё равно разобрались: %zu\n",
	       ok);
}

TT_TEST(manifest_mutations)
{
	ks_manifest m, d;
	ks_mf_init(&m);
	ks_mf_init(&d);
	for (uint32_t i = 0; i < 20; i++) {
		uint8_t id[32];
		memset(id, (int)i, 32);
		ks_mf_push(&m, id, 100 + i);
	}
	size_t n = ks_mf_encoded_size(&m);
	uint8_t *buf = malloc(n), *bad = malloc(n);
	ks_mf_encode(&m, buf);
	uint64_t s = 5;
	size_t prinyato = 0;
	for (int k = 0; k < 20000; k++) {
		memcpy(bad, buf, n);
		bad[tt_rand(&s) % n] = (uint8_t)tt_rand(&s);
		size_t len = n - (size_t)(tt_rand(&s) % 2);
		if (ks_mf_decode(bad, len, 65536, &d) == KUSOK_OK) {
			prinyato++;
			/* принятый манифест всё равно внутренне согласован */
			uint64_t sum = 0;
			for (uint32_t i = 0; i < d.n; i++)
				sum += d.lens[i];
			TT_EQU(sum, d.size);
		}
	}
	printf("    принято испорченных манифестов (поменялся id куска): %zu\n",
	       prinyato);
	free(buf);
	free(bad);
	ks_mf_free(&m);
	ks_mf_free(&d);
}

TT_TEST(pack_mutations_open_with_salvage)
{
	char *dir = tt_tmpdir();
	char src[4200];
	snprintf(src, sizeof(src), "%s/src", dir);
	kusok_opts o = tt_opts();
	o.pack_limit = 1u << 30;
	kusok *ks = tt_open_with(src, &o);
	uint8_t d[30000];
	tt_fill_text(d, sizeof(d), 7);
	tt_put(ks, d, sizeof(d));
	tt_put(ks, d, 12345);
	kusok_close(ks);
	char pack[4300];
	snprintf(pack, sizeof(pack), "%s/packs/00000001.pack", src);
	int fd = open(pack, O_RDWR);
	off_t len = lseek(fd, 0, SEEK_END);
	uint8_t *orig = malloc((size_t)len);
	tt_pread(fd, orig, (size_t)len, 0);
	uint64_t s = 11;
	size_t otkryto = 0;
	for (int k = 0; k < 300; k++) {
		tt_pwrite(fd, orig, (size_t)len, 0);
		for (int f = 0; f < 3; f++) {
			uint8_t x = (uint8_t)tt_rand(&s);
			tt_pwrite(fd, &x, 1,
				  (long long)(tt_rand(&s) % (uint64_t)len));
		}
		kusok_opts ro = o;
		ro.read_only = 1;
		ro.salvage = 1;
		if (kusok_open(src, &ro, &ks) == KUSOK_OK) {
			otkryto++;
			kusok_fsck_report f;
			kusok_fsck(ks, &f);
			kusok_stat st;
			kusok_stat_get(ks, &st);
			kusok_close(ks);
		}
	}
	printf("    открылось после порчи: %zu из 300\n", otkryto);
	close(fd);
	free(orig);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(model_based);
	TT_RUN(lz_mutations_never_crash);
	TT_RUN(manifest_mutations);
	TT_RUN(pack_mutations_open_with_salvage);
	return tt_done();
}
