/*
 * индекс pack на диске
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "idx.h"
#include "kusok/kusok.h"
#include "store_int.h"
#include "tt.h"

enum { NF = 12, RAZMER = 40000 };

/* хранилище на несколько pack; ids — что положили */
static char *napolnit(kusok_id ids[NF])
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	uint8_t *d = malloc(RAZMER);
	for (int i = 0; i < NF; i++) {
		tt_fill_text(d, RAZMER, (uint64_t)i + 100);
		ids[i] = tt_put(ks, d, RAZMER);
	}
	free(d);
	kusok_close(ks);
	return dir;
}

static int vse_na_meste(kusok *ks, const kusok_id ids[NF])
{
	uint8_t *d = malloc(RAZMER);
	int ok = 1;
	for (int i = 0; i < NF; i++) {
		tt_fill_text(d, RAZMER, (uint64_t)i + 100);
		ok &= tt_same(ks, &ids[i], d, RAZMER);
	}
	free(d);
	return ok;
}

static char *put_k(const char *dir, uint32_t id, const char *ext)
{
	char *p = malloc(4200);
	snprintf(p, 4200, "%s/packs/%08u.%s", dir, id, ext);
	return p;
}

static int est(const char *path)
{
	struct stat st;
	return stat(path, &st) == 0;
}

TT_TEST(sealed_packs_get_index)
{
	kusok_id ids[NF];
	char *dir = napolnit(ids);
	kusok *ks = tt_open(dir);
	uint32_t n = (uint32_t)ks->npacks;
	TT_CHECK(n >= 4);
	/* у всех, кроме активного, есть индекс, и open им воспользовался */
	for (uint32_t i = 0; i + 1 < n; i++) {
		char *p = put_k(dir, ks->packs[i].id, "idx");
		TT_CHECK(est(p));
		free(p);
	}
	char *p = put_k(dir, ks->packs[n - 1].id, "idx");
	TT_CHECK(!est(p));
	free(p);
	TT_EQ(ks->idx_hits, n - 1);
	TT_CHECK(vse_na_meste(ks, ids));
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

/* stat и список: с индексом и без должны совпасть */
TT_TEST(same_state_with_and_without_index)
{
	kusok_id ids[NF];
	char *dir = napolnit(ids);
	kusok *ks = tt_open(dir);
	kusok_stat a, b;
	TT_OK(kusok_stat_get(ks, &a));
	uint32_t n = (uint32_t)ks->npacks;
	kusok_close(ks);
	for (uint32_t i = 1; i <= n; i++) {
		char *p = put_k(dir, i, "idx");
		unlink(p);
		free(p);
	}
	kusok_opts o = tt_opts();
	o.read_only = 1; /* ничего не пересоздаём */
	ks = tt_open_with(dir, &o);
	TT_EQ(ks->idx_hits, 0);
	TT_OK(kusok_stat_get(ks, &b));
	TT_MEMEQ(&a, &b, sizeof(a));
	TT_CHECK(vse_na_meste(ks, ids));
	kusok_close(ks);
	/* на запись — индексы снова появились */
	ks = tt_open(dir);
	kusok_close(ks);
	ks = tt_open(dir);
	TT_EQ(ks->idx_hits, n - 1);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

/* испортить индекс по-разному: open обходит pack и не теряет данных */
TT_TEST(broken_index_falls_back)
{
	kusok_id ids[NF];
	char *dir = napolnit(ids);
	char *p = put_k(dir, 2, "idx");
	int fd = open(p, O_RDWR);
	off_t len = lseek(fd, 0, SEEK_END);
	uint8_t *orig = malloc((size_t)len);
	tt_pread(fd, orig, (size_t)len, 0);
	close(fd);
	uint64_t s = 3;
	size_t bad = 0;
	for (int k = 0; k < 120; k++) {
		fd = open(p, O_RDWR | O_TRUNC);
		size_t n = (size_t)len;
		if (k % 4 == 3)
			n = (size_t)(tt_rand(&s) % (uint64_t)len); /* обрезан */
		tt_write(fd, orig, n);
		if (k % 4 != 3) {
			uint8_t x = (uint8_t)(tt_rand(&s) | 1);
			off_t gde = (off_t)(tt_rand(&s) % (uint64_t)len);
			uint8_t b;
			tt_pread(fd, &b, 1, gde);
			b ^= x;
			tt_pwrite(fd, &b, 1, gde);
		}
		close(fd);
		kusok_opts o = tt_opts();
		o.read_only = 1;
		kusok *ks;
		if (kusok_open(dir, &o, &ks)) {
			bad++;
			continue;
		}
		bad += !vse_na_meste(ks, ids);
		kusok_close(ks);
	}
	TT_EQU(bad, 0);
	/* на запись битый индекс пересобирается */
	kusok *ks = tt_open(dir);
	kusok_close(ks);
	fd = open(p, O_RDONLY);
	uint8_t *now = malloc((size_t)len);
	tt_pread(fd, now, (size_t)len, 0);
	close(fd);
	TT_MEMEQ(now, orig, (size_t)len);
	free(now);
	free(orig);
	free(p);
	tt_rmdir(dir);
	free(dir);
}

/* упали после индекса старого pack, но до создания нового:
 * старый снова активный, его индекс надо выкинуть */
TT_TEST(stale_index_of_reopened_pack)
{
	kusok_id ids[NF];
	char *dir = napolnit(ids);
	kusok *ks = tt_open(dir);
	uint32_t last = ks->packs[ks->npacks - 1].id;
	uint32_t prev = ks->packs[ks->npacks - 2].id;
	kusok_close(ks);
	/* файлы из последнего pack потеряем — это цена эксперимента */
	char *pl = put_k(dir, last, "pack");
	TT_EQ(unlink(pl), 0);
	char *pi = put_k(dir, prev, "idx");
	TT_CHECK(est(pi));
	kusok_opts big = tt_opts();
	big.pack_limit = 1u << 30; /* чтобы старый остался активным */
	ks = tt_open_with(dir, &big);
	TT_CHECK(!est(pi)); /* индекс активного убран */
	kusok_id nov = tt_put(ks, "after crash", 11);
	kusok_close(ks);
	/* теперь он переполнен: при открытии запечатается заново */
	ks = tt_open(dir);
	kusok_id nov2 = tt_put(ks, "and more", 8);
	kusok_close(ks);
	ks = tt_open(dir);
	TT_CHECK(ks->idx_hits > 0);
	TT_CHECK(tt_same(ks, &nov, "after crash", 11));
	TT_CHECK(tt_same(ks, &nov2, "and more", 8));
	kusok_close(ks);
	free(pl);
	free(pi);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(gc_removes_index)
{
	kusok_id ids[NF];
	char *dir = napolnit(ids);
	kusok *ks = tt_open(dir);
	for (int i = 0; i < NF - 1; i++)
		TT_OK(kusok_unref(ks, &ids[i]));
	kusok_gc_report r;
	TT_OK(kusok_gc(ks, 0.0, &r));
	TT_CHECK(r.packs_rewritten > 0);
	/* у каждого idx есть свой pack */
	size_t sirot = 0;
	for (uint32_t i = 1; i < 100; i++) {
		char *pi = put_k(dir, i, "idx");
		char *pp = put_k(dir, i, "pack");
		sirot += est(pi) && !est(pp);
		free(pi);
		free(pp);
	}
	TT_EQU(sirot, 0);
	ks = tt_reopen(ks, dir);
	uint8_t *d = malloc(RAZMER);
	tt_fill_text(d, RAZMER, NF - 1 + 100);
	TT_CHECK(tt_same(ks, &ids[NF - 1], d, RAZMER));
	free(d);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(names)
{
	char b[32];
	uint32_t id;
	ks_idx_name(42, b);
	TT_CHECK(!strcmp(b, "00000042.idx"));
	TT_EQ(ks_idx_parse_name(b, &id), 0);
	TT_EQU(id, 42);
	TT_EQ(ks_idx_parse_name("00000042.pack", &id), -1);
	TT_EQ(ks_idx_parse_name("42.idx", &id), -1);
	TT_EQ(ks_idx_parse_name("00000042.idx.tmp", &id), -1);
}

int main(void)
{
	TT_RUN(sealed_packs_get_index);
	TT_RUN(same_state_with_and_without_index);
	TT_RUN(broken_index_falls_back);
	TT_RUN(stale_index_of_reopened_pack);
	TT_RUN(gc_removes_index);
	TT_RUN(names);
	return tt_done();
}
