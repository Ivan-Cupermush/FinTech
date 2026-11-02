/*
 * FastCDC: границы, нормализация, сдвиг
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "cdc.h"
#include "kusok/kusok.h"
#include "sha256.h"
#include "tt.h"

TT_TEST(params_validation)
{
	ks_cdc c;
	TT_EQ(ks_cdc_init(&c, 2048, 8192, 65536), KUSOK_OK);
	TT_EQ(ks_cdc_init(&c, 2048, 8000, 65536), KUSOK_EINVAL); /* не 2^k */
	TT_EQ(ks_cdc_init(&c, 8192, 8192, 65536),
	      KUSOK_EINVAL);					/* min == avg */
	TT_EQ(ks_cdc_init(&c, 2048, 8192, 8192), KUSOK_EINVAL); /* max == avg */
	TT_EQ(ks_cdc_init(&c, 32, 8192, 65536), KUSOK_EINVAL);	/* min мал */
	TT_EQ(ks_cdc_init(&c, 2048, 8192, 1u << 23), KUSOK_EINVAL);
	TT_EQ(ks_cdc_init(&c, 2048, 0, 65536), KUSOK_EINVAL);
	TT_EQ(ks_cdc_init(&c, 64, 128, 256), KUSOK_OK);
}

TT_TEST(masks)
{
	TT_EQ(__builtin_popcountll(ks_cdc_mask(15)), 15);
	TT_EQ(__builtin_popcountll(ks_cdc_mask(11)), 11);
	TT_EQ(__builtin_popcountll(ks_cdc_mask(48)), 48);
	TT_EQ(__builtin_popcountll(ks_cdc_mask(60)), 48); /* больше не бывает */
	TT_EQU(ks_cdc_mask(0), 0);
	/* старший бит всегда в маске, младшие 16 — никогда */
	TT_CHECK(ks_cdc_mask(13) >> 63);
	TT_EQU(ks_cdc_mask(48) & 0xFFFF, 0);
	ks_cdc c;
	ks_cdc_init(&c, 2048, 8192, 65536);
	TT_EQ(__builtin_popcountll(c.mask_s), 15); /* 13 + 2 */
	TT_EQ(__builtin_popcountll(c.mask_l), 11); /* 13 - 2 */
}

TT_TEST(gear_table_is_pinned)
{
	/* таблица — часть формата */
	const uint64_t *g = ks_gear_table();
	TT_EQU(g[0], 0xb926ebd093a548d6ull);
	TT_EQU(g[255], 0xead202b1d996b235ull);
	/* таблица разная у разных байтов */
	int odinakovye = 0;
	for (int i = 0; i < 256; i++)
		for (int j = i + 1; j < 256; j++)
			odinakovye += g[i] == g[j];
	TT_EQ(odinakovye, 0);
	/* и примерно половина бит единицы */
	int bits = 0;
	for (int i = 0; i < 256; i++)
		bits += __builtin_popcountll(g[i]);
	TT_CHECK(bits > 256 * 28 && bits < 256 * 36);
}

TT_TEST(cut_bounds)
{
	ks_cdc c;
	ks_cdc_init(&c, 2048, 8192, 65536);
	enum { N = 1 << 20 };
	uint8_t *d = malloc(N);
	tt_fill(d, N, 1);
	for (size_t n = 0; n <= 3000; n += 100) {
		size_t cut = ks_cdc_cut(&c, d, n);
		if (n <= c.min)
			TT_EQU(cut, n);
		else
			TT_CHECK(cut > c.min && cut <= n);
	}
	size_t pos = 0;
	while (pos < N) {
		size_t cut = ks_cdc_cut(&c, d + pos, N - pos);
		TT_CHECK(cut >= 1 && cut <= c.max);
		if (N - pos > c.min)
			TT_CHECK(cut > c.min);
		pos += cut;
	}
	TT_EQU(pos, N);
	free(d);
}

struct sobr {
	size_t n;
	size_t lens[4096];
	uint8_t ids[4096][8];
	size_t total;
};

static int sobrat(const uint8_t *p, size_t n, void *ctx)
{
	struct sobr *s = ctx;
	uint8_t d[32];
	ks_sha256_buf(p, n, d);
	s->lens[s->n] = n;
	memcpy(s->ids[s->n], d, 8);
	s->n++;
	s->total += n;
	return 0;
}

static void narezat(const ks_cdc *c, const uint8_t *d, size_t n, size_t porc,
		    struct sobr *s)
{
	ks_chunker k;
	memset(s, 0, sizeof(*s));
	ks_chunker_init(&k, c);
	for (size_t i = 0; i < n; i += porc)
		ks_chunker_feed(&k, d + i, i + porc <= n ? porc : n - i, sobrat,
				s);
	ks_chunker_finish(&k, sobrat, s);
	ks_chunker_free(&k);
}

TT_TEST(streaming_equals_oneshot)
{
	ks_cdc c;
	ks_cdc_init(&c, 512, 2048, 8192);
	enum { N = 300000 };
	uint8_t *d = malloc(N);
	tt_fill_text(d, N, 3);
	/* эталон: режем весь буфер подряд */
	static struct sobr ref, s;
	memset(&ref, 0, sizeof(ref));
	for (size_t pos = 0; pos < N;) {
		size_t cut = ks_cdc_cut(&c, d + pos, N - pos);
		sobrat(d + pos, cut, &ref);
		pos += cut;
	}
	size_t porcii[] = {1, 7, 100, 511, 4096, 8191, 8192, 8193, 65536, N};
	for (size_t i = 0; i < sizeof(porcii) / sizeof(*porcii); i++) {
		narezat(&c, d, N, porcii[i], &s);
		TT_EQU(s.n, ref.n);
		TT_EQU(s.total, (size_t)N);
		TT_MEMEQ(s.lens, ref.lens, ref.n * sizeof(size_t));
	}
	free(d);
}

TT_TEST(average_is_near_target)
{
	ks_cdc c;
	ks_cdc_init(&c, 2048, 8192, 65536);
	enum { N = 8 << 20 };
	uint8_t *d = malloc(N);
	tt_fill(d, N, 11);
	size_t kol = 0, pos = 0, malo = 0, mnogo = 0;
	while (pos < N) {
		size_t cut = ks_cdc_cut(&c, d + pos, N - pos);
		pos += cut;
		kol++;
		malo += cut < 4096;
		mnogo += cut >= 32768;
	}
	double avg = (double)N / (double)kol;
	printf("    средний кусок %.0f байт, кусков %zu\n", avg, kol);
	/* средний около 8K */
	TT_CHECK(avg > 6000 && avg < 12000);
	TT_CHECK(malo * 10 < kol);
	TT_CHECK(mnogo * 50 < kol);
	free(d);
}

static size_t obshchih(const struct sobr *a, const struct sobr *b)
{
	size_t kol = 0;
	for (size_t i = 0; i < a->n; i++)
		for (size_t j = 0; j < b->n; j++)
			if (memcmp(a->ids[i], b->ids[j], 8) == 0) {
				kol++;
				break;
			}
	return kol;
}

TT_TEST(shift_resistance)
{
	/* вставка 3 байт в начало */
	ks_cdc c;
	ks_cdc_init(&c, 512, 2048, 8192);
	enum { N = 400000 };
	uint8_t *a = malloc(N), *b = malloc(N + 3);
	tt_fill(a, N, 21);
	memcpy(b, "abc", 3);
	memcpy(b + 3, a, N);
	static struct sobr sa, sb;
	narezat(&c, a, N, 4096, &sa);
	narezat(&c, b, N + 3, 4096, &sb);
	size_t obsh = obshchih(&sa, &sb);
	printf("    общих кусков после вставки: %zu из %zu\n", obsh, sa.n);
	TT_CHECK(obsh + 3 >= sa.n);
	free(a);
	free(b);
}

TT_TEST(edit_in_middle)
{
	/* правка в середине меняет только куски рядом с ней */
	ks_cdc c;
	ks_cdc_init(&c, 512, 2048, 8192);
	enum { N = 400000 };
	uint8_t *a = malloc(N), *b = malloc(N);
	tt_fill_text(a, N, 8);
	memcpy(b, a, N);
	memcpy(b + N / 2, "EDITED-BY-IVAN", 14);
	static struct sobr sa, sb;
	narezat(&c, a, N, 1000, &sa);
	narezat(&c, b, N, 1000, &sb);
	size_t obsh = obshchih(&sa, &sb);
	TT_CHECK(obsh + 3 >= sa.n);
	TT_CHECK(obsh < sa.n); /* но что-то всё же поменялось */
	free(a);
	free(b);
}

TT_TEST(deterministic)
{
	ks_cdc c;
	ks_cdc_init(&c, 2048, 8192, 65536);
	enum { N = 200000 };
	uint8_t *d = malloc(N);
	tt_fill(d, N, 1234);
	/* закреплённые границы */
	static const size_t want[] = {14626, 2297, 12008, 13942, 4712, 9334};
	size_t pos = 0;
	for (int k = 0; k < 6; k++) {
		size_t cut = ks_cdc_cut(&c, d + pos, N - pos);
		TT_EQU(cut, want[k]);
		pos += cut;
	}
	TT_EQU(c.mask_s, 0x9248924892480000ull);
	TT_EQU(c.mask_l, 0x8884442221100000ull);
	free(d);
}

TT_TEST(constant_data)
{
	/* одни нули — режем по max */
	ks_cdc c;
	ks_cdc_init(&c, 2048, 8192, 65536);
	enum { N = 1 << 20 };
	uint8_t *d = calloc(N, 1);
	size_t pos = 0, kol = 0;
	while (pos < N) {
		size_t cut = ks_cdc_cut(&c, d + pos, N - pos);
		TT_CHECK(cut >= 1);
		pos += cut;
		kol++;
	}
	TT_EQU(pos, N);
	TT_CHECK(kol <= N / c.min + 1);
	free(d);
}

static int stop_at_three(const uint8_t *p, size_t n, void *ctx)
{
	(void)p;
	(void)n;
	int *k = ctx;
	return ++*k == 3 ? KUSOK_EIO : 0;
}

TT_TEST(callback_error_stops)
{
	ks_cdc c;
	ks_cdc_init(&c, 64, 128, 256);
	ks_chunker k;
	ks_chunker_init(&k, &c);
	uint8_t d[10000];
	tt_fill(d, sizeof(d), 2);
	int kol = 0;
	TT_EQ(ks_chunker_feed(&k, d, sizeof(d), stop_at_three, &kol),
	      KUSOK_EIO);
	TT_EQ(kol, 3);
	ks_chunker_free(&k);
}

TT_TEST(empty_input)
{
	ks_cdc c;
	ks_cdc_init(&c, 64, 128, 256);
	static struct sobr s;
	narezat(&c, (const uint8_t *)"", 0, 1, &s);
	TT_EQU(s.n, 0);
}

int main(void)
{
	TT_RUN(params_validation);
	TT_RUN(masks);
	TT_RUN(gear_table_is_pinned);
	TT_RUN(cut_bounds);
	TT_RUN(streaming_equals_oneshot);
	TT_RUN(average_is_near_target);
	TT_RUN(shift_resistance);
	TT_RUN(edit_in_middle);
	TT_RUN(deterministic);
	TT_RUN(constant_data);
	TT_RUN(callback_error_stops);
	TT_RUN(empty_input);
	return tt_done();
}
