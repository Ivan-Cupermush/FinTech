/*
 * LRU-кэш кусков
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "cache.h"
#include "kusok/kusok.h"
#include "tt.h"

static void klyuch(uint8_t id[32], unsigned k)
{
	memset(id, 0, 32);
	memcpy(id, &k, sizeof(k));
	id[31] = (uint8_t)(k * 7);
}

static int polozhit(ks_cache *c, unsigned k, uint32_t len)
{
	uint8_t id[32], *b;
	klyuch(id, k);
	if (ks_cache_put(c, id, len, &b))
		return 0;
	memset(b, (int)(k & 0xff), len);
	return 1;
}

/* есть ли k и правильные ли в нём байты */
static int est(ks_cache *c, unsigned k)
{
	uint8_t id[32];
	uint32_t len;
	klyuch(id, k);
	const uint8_t *b = ks_cache_get(c, id, &len);
	if (!b)
		return 0;
	for (uint32_t i = 0; i < len; i++)
		if (b[i] != (uint8_t)(k & 0xff))
			return -1;
	return 1;
}

TT_TEST(evicts_oldest)
{
	ks_cache c;
	TT_OK(ks_cache_init(&c, 3));
	TT_CHECK(polozhit(&c, 1, 10) && polozhit(&c, 2, 10) &&
		 polozhit(&c, 3, 10));
	TT_EQ(est(&c, 1), 1); /* 1 стал свежим, старейший теперь 2 */
	TT_CHECK(polozhit(&c, 4, 10));
	TT_EQ(est(&c, 2), 0);
	TT_EQ(est(&c, 1), 1);
	TT_EQ(est(&c, 3), 1);
	TT_EQ(est(&c, 4), 1);
	TT_EQU(c.hits, 4);
	TT_EQU(c.misses, 1);
	ks_cache_free(&c);
}

TT_TEST(put_same_twice_and_drop)
{
	ks_cache c;
	TT_OK(ks_cache_init(&c, 2));
	TT_CHECK(polozhit(&c, 5, 100));
	TT_CHECK(polozhit(&c, 5, 3000)); /* тот же ключ, буфер больше */
	TT_CHECK(polozhit(&c, 6, 1));
	TT_EQ(est(&c, 5), 1);
	TT_EQ(est(&c, 6), 1);
	uint8_t id[32];
	klyuch(id, 5);
	ks_cache_drop(&c, id);
	ks_cache_drop(&c, id); /* второй раз — ничего */
	TT_EQ(est(&c, 5), 0);
	TT_CHECK(polozhit(&c, 7, 0)); /* пустой кусок тоже можно */
	TT_EQ(est(&c, 6), 1);
	TT_EQ(est(&c, 7), 1);
	ks_cache_clear(&c);
	TT_EQ(est(&c, 6), 0);
	TT_CHECK(polozhit(&c, 8, 50));
	TT_EQ(est(&c, 8), 1);
	ks_cache_free(&c);
	ks_cache_free(&c); /* повторно — безопасно */
}

TT_TEST(bad_init)
{
	ks_cache c;
	TT_EQ(ks_cache_init(&c, 0), KUSOK_EINVAL);
	TT_EQ(ks_cache_init(&c, (1u << 20) + 1), KUSOK_EINVAL);
}

/* сверка с простой моделью: массив «возраст» */
TT_TEST(against_model)
{
	enum { MAX = 8, KEYS = 20 };
	ks_cache c;
	TT_OK(ks_cache_init(&c, MAX));
	long vozrast[KEYS]; /* -1 — нет в кэше */
	for (int i = 0; i < KEYS; i++)
		vozrast[i] = -1;
	long t = 0;
	uint64_t s = 42;
	size_t bad = 0;
	for (int op = 0; op < 20000; op++) {
		unsigned k = (unsigned)(tt_rand(&s) % KEYS);
		unsigned what = (unsigned)(tt_rand(&s) % 10);
		if (what < 4) {
			int r = est(&c, k);
			bad += (r == 1) != (vozrast[k] >= 0) || r < 0;
			if (vozrast[k] >= 0)
				vozrast[k] = ++t;
		} else if (what < 9) {
			int skolko = 0, star = -1;
			for (int i = 0; i < KEYS; i++)
				if (vozrast[i] >= 0) {
					skolko++;
					if (star < 0 ||
					    vozrast[i] < vozrast[star])
						star = i;
				}
			if (vozrast[k] < 0 && skolko == MAX)
				vozrast[star] = -1;
			bad += !polozhit(&c, k,
					 1 + (uint32_t)(tt_rand(&s) % 5000));
			vozrast[k] = ++t;
		} else {
			uint8_t id[32];
			klyuch(id, k);
			ks_cache_drop(&c, id);
			vozrast[k] = -1;
		}
	}
	TT_EQU(bad, 0);
	ks_cache_free(&c);
}

TT_TEST(store_reads_same_with_any_cache)
{
	char *dir = tt_tmpdir();
	enum { N = 300000 };
	uint8_t *d = malloc(N);
	tt_fill_text(d, N, 12);
	kusok *ks = tt_open(dir);
	kusok_id id = tt_put(ks, d, N);
	kusok_close(ks);
	static const int razmer[] = {1, 2, 64, 5000};
	uint64_t hits[4];
	for (int r = 0; r < 4; r++) {
		kusok_opts o = tt_opts();
		o.cache_chunks = razmer[r];
		o.read_only = 1;
		ks = tt_open_with(dir, &o);
		uint64_t s = 1;
		size_t bad = 0;
		uint8_t buf[3000];
		for (int k = 0; k < 2000; k++) {
			/* как браузер с видео: прыжки, но рядом */
			uint64_t off = (tt_rand(&s) % 40) * 7000;
			size_t got;
			if (kusok_read(ks, &id, off, buf, sizeof(buf), &got) ||
			    memcmp(buf, d + off, got))
				bad++;
		}
		TT_EQU(bad, 0);
		kusok_stat st;
		kusok_stat_get(ks, &st);
		hits[r] = st.cache_hits;
		kusok_close(ks);
	}
	printf("    попаданий в кэш при 1/2/64/5000 кусков: %llu %llu %llu "
	       "%llu\n",
	       (unsigned long long)hits[0], (unsigned long long)hits[1],
	       (unsigned long long)hits[2], (unsigned long long)hits[3]);
	TT_CHECK(hits[2] > hits[0]);
	kusok_opts o = tt_opts();
	o.cache_chunks = 70000;
	TT_EQ(kusok_open(dir, &o, &ks), KUSOK_EINVAL);
	free(d);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(evicts_oldest);
	TT_RUN(put_same_twice_and_drop);
	TT_RUN(bad_init);
	TT_RUN(against_model);
	TT_RUN(store_reads_same_with_any_cache);
	return tt_done();
}
