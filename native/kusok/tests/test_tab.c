/*
 * хеш-таблица против простой модели
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "bytes.h"
#include "kusok/kusok.h"
#include "tab.h"
#include "tt.h"

typedef struct {
	uint8_t key[32];
	uint64_t val;
} el;

static void key_of(uint64_t x, uint8_t k[32])
{
	uint64_t s = x * 0x9E3779B97F4A7C15ull + 1;
	for (int i = 0; i < 4; i++) {
		uint64_t r = tt_rand(&s);
		memcpy(k + 8 * i, &r, 8);
	}
}

TT_TEST(put_get_basic)
{
	ks_tab t;
	TT_OK(ks_tab_init(&t, sizeof(el), 0));
	uint8_t k[32];
	key_of(1, k);
	TT_CHECK(ks_tab_get(&t, k) == NULL);
	void *slot;
	int fresh;
	TT_OK(ks_tab_put(&t, k, &slot, &fresh));
	TT_EQ(fresh, 1);
	((el *)slot)->val = 42;
	TT_OK(ks_tab_put(&t, k, &slot, &fresh));
	TT_EQ(fresh, 0);
	TT_EQU(((el *)slot)->val, 42);
	TT_EQU(t.n, 1);
	TT_EQ(ks_tab_del(&t, k), 1);
	TT_EQ(ks_tab_del(&t, k), 0);
	TT_CHECK(ks_tab_get(&t, k) == NULL);
	ks_tab_free(&t);
}

TT_TEST(rejects_small_elements)
{
	ks_tab t;
	TT_EQ(ks_tab_init(&t, 16, 0), KUSOK_EINVAL);
}

TT_TEST(grows_and_keeps_everything)
{
	ks_tab t;
	TT_OK(ks_tab_init(&t, sizeof(el), 0));
	enum { N = 50000 };
	for (uint64_t i = 0; i < N; i++) {
		uint8_t k[32];
		void *slot;
		key_of(i, k);
		TT_OK(ks_tab_put(&t, k, &slot, NULL));
		((el *)slot)->val = i;
	}
	TT_EQU(t.n, N);
	TT_CHECK(t.n * 10 <= t.cap * 7); /* заполненность держится */
	size_t bad = 0;
	for (uint64_t i = 0; i < N; i++) {
		uint8_t k[32];
		key_of(i, k);
		el *e = ks_tab_get(&t, k);
		bad += !e || e->val != i;
	}
	TT_EQU(bad, 0);
	printf("    cap %zu, самая длинная цепочка %zu\n", t.cap,
	       ks_tab_max_probe(&t));
	TT_CHECK(ks_tab_max_probe(&t) < 64);
	ks_tab_free(&t);
}

TT_TEST(model_random_ops)
{
	/* модель: массив флагов «ключ i есть» + значение */
	enum { KEYS = 3000, OPS = 200000 };
	static uint8_t est[KEYS];
	static uint64_t val[KEYS];
	memset(est, 0, sizeof(est));
	ks_tab t;
	TT_OK(ks_tab_init(&t, sizeof(el), 0));
	uint64_t s = 2026;
	size_t oshibki = 0, n = 0;
	for (int op = 0; op < OPS; op++) {
		uint64_t i = tt_rand(&s) % KEYS;
		uint8_t k[32];
		key_of(i, k);
		switch (tt_rand(&s) % 3) {
		case 0: {
			void *slot;
			int fresh;
			ks_tab_put(&t, k, &slot, &fresh);
			oshibki += fresh != !est[i];
			if (fresh)
				n++;
			est[i] = 1;
			val[i] = tt_rand(&s);
			((el *)slot)->val = val[i];
			break;
		}
		case 1: {
			int d = ks_tab_del(&t, k);
			oshibki += d != est[i];
			if (d)
				n--;
			est[i] = 0;
			break;
		}
		default: {
			el *e = ks_tab_get(&t, k);
			oshibki += (e != NULL) != est[i];
			if (e && est[i])
				oshibki += e->val != val[i];
		}
		}
	}
	TT_EQU(oshibki, 0);
	TT_EQU(t.n, n);
	/* обход видит ровно n элементов */
	size_t kol = 0;
	for (size_t i = ks_tab_next(&t, 0); i < t.cap;
	     i = ks_tab_next(&t, i + 1))
		kol++;
	TT_EQU(kol, n);
	ks_tab_free(&t);
}

TT_TEST(backward_shift_with_collisions)
{
	/* одна длинная цепочка */
	ks_tab t;
	TT_OK(ks_tab_init(&t, sizeof(el), 64));
	enum { N = 40 };
	uint8_t keys[N][32];
	for (int i = 0; i < N; i++) {
		key_of((uint64_t)i + 100, keys[i]);
		memset(keys[i], 0x5A, 8);
		void *slot;
		ks_tab_put(&t, keys[i], &slot, NULL);
		((el *)slot)->val = (uint64_t)i;
	}
	for (int i = 0; i < N; i += 3)
		TT_EQ(ks_tab_del(&t, keys[i]), 1);
	for (int i = 0; i < N; i++) {
		el *e = ks_tab_get(&t, keys[i]);
		if (i % 3 == 0)
			TT_CHECK(e == NULL);
		else
			TT_CHECK(e && e->val == (uint64_t)i);
	}
	ks_tab_free(&t);
}

TT_TEST(wraparound_chain)
{
	/* цепочка, которая переходит через конец массива в начало */
	ks_tab t;
	TT_OK(ks_tab_init(&t, sizeof(el), 0)); /* cap 16 */
	size_t cap = t.cap;
	uint8_t keys[6][32];
	for (int i = 0; i < 6; i++) {
		key_of((uint64_t)i + 7, keys[i]);
		/* домашняя ячейка = cap - 2 */
		st64(keys[i], (uint64_t)(cap - 2));
		void *slot;
		ks_tab_put(&t, keys[i], &slot, NULL);
		((el *)slot)->val = (uint64_t)i;
	}
	TT_EQU(t.cap, cap); /* не выросла, проверка честная */
	TT_EQ(ks_tab_del(&t, keys[0]), 1);
	TT_EQ(ks_tab_del(&t, keys[3]), 1);
	for (int i = 0; i < 6; i++) {
		el *e = ks_tab_get(&t, keys[i]);
		TT_CHECK((i == 0 || i == 3) ? e == NULL
					    : (e && e->val == (uint64_t)i));
	}
	ks_tab_free(&t);
}

TT_TEST(clear)
{
	ks_tab t;
	TT_OK(ks_tab_init(&t, sizeof(el), 0));
	for (uint64_t i = 0; i < 100; i++) {
		uint8_t k[32];
		void *slot;
		key_of(i, k);
		ks_tab_put(&t, k, &slot, NULL);
	}
	ks_tab_clear(&t);
	TT_EQU(t.n, 0);
	uint8_t k[32];
	key_of(5, k);
	TT_CHECK(ks_tab_get(&t, k) == NULL);
	ks_tab_free(&t);
}

int main(void)
{
	TT_RUN(put_get_basic);
	TT_RUN(rejects_small_elements);
	TT_RUN(grows_and_keeps_everything);
	TT_RUN(model_random_ops);
	TT_RUN(backward_shift_with_collisions);
	TT_RUN(wraparound_chain);
	TT_RUN(clear);
	return tt_done();
}
