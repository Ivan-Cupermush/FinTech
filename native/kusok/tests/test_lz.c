/*
 * lz4-блок
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "kusok/kusok.h"
#include "lz.h"
#include "tt.h"

static int tuda_obratno(const uint8_t *d, size_t n, size_t *zsize)
{
	size_t cap = ks_lz_bound(n);
	uint8_t *z = malloc(cap);
	uint8_t *back = malloc(n ? n : 1);
	size_t zn, bn;
	int ok = 0;
	if (ks_lz_compress(d, n, z, cap, &zn) == KUSOK_OK &&
	    ks_lz_decompress(z, zn, back, n, &bn) == KUSOK_OK && bn == n &&
	    memcmp(back, d, n) == 0)
		ok = 1;
	if (zsize)
		*zsize = zn;
	free(z);
	free(back);
	return ok;
}

TT_TEST(roundtrip_small_sizes)
{
	uint8_t d[300];
	for (size_t n = 0; n < sizeof(d); n++) {
		tt_fill_text(d, n, n);
		TT_CHECK(tuda_obratno(d, n, NULL));
		tt_fill(d, n, n);
		TT_CHECK(tuda_obratno(d, n, NULL));
	}
}

TT_TEST(roundtrip_big)
{
	enum { N = 3 << 20 };
	uint8_t *d = malloc(N);
	size_t z;
	tt_fill_text(d, N, 77);
	TT_CHECK(tuda_obratno(d, N, &z));
	printf("    текст: %d -> %zu байт (%.1f%%)\n", N, z,
	       100.0 * (double)z / N);
	TT_CHECK(z < N / 2);
	tt_fill(d, N, 78);
	TT_CHECK(tuda_obratno(d, N, &z));
	TT_CHECK(z <= ks_lz_bound(N));
	memset(d, 0, N);
	TT_CHECK(tuda_obratno(d, N, &z));
	TT_CHECK(z < N / 200);
	free(d);
}

TT_TEST(overlapping_matches)
{
	/* повтор с периодом 1..7 — совпадение перекрывает само себя */
	uint8_t d[5000];
	for (size_t per = 1; per < 8; per++) {
		for (size_t i = 0; i < sizeof(d); i++)
			d[i] = (uint8_t)('a' + i % per);
		size_t z;
		TT_CHECK(tuda_obratno(d, sizeof(d), &z));
		TT_CHECK(z < 100);
	}
}

TT_TEST(reference_streams)
{
	/* сжато настоящим lz4 (python lz4.block.compress, store_size=False) */
	static const uint8_t aaa[] = {31, 97, 1, 0, 75, 80, 97, 97, 97, 97, 97};
	static const uint8_t kus[] = {104, 107, 117, 115, 111, 107, 32,
				      6,   0,	176, 111, 102, 102, 105,
				      120, 32,	107, 117, 115, 111, 107};
	uint8_t out[128], want[100];
	size_t n;
	memset(want, 'a', 100);
	TT_EQ(ks_lz_decompress(aaa, sizeof(aaa), out, 100, &n), KUSOK_OK);
	TT_EQU(n, 100);
	TT_MEMEQ(out, want, 100);
	const char *s = "kusok kusok kusok offix kusok";
	TT_EQ(ks_lz_decompress(kus, sizeof(kus), out, sizeof(out), &n),
	      KUSOK_OK);
	TT_EQU(n, strlen(s));
	TT_MEMEQ(out, s, n);
}

TT_TEST(hand_made_streams)
{
	uint8_t out[64];
	size_t n;
	/* только литералы */
	static const uint8_t lit[] = {0x50, 'h', 'e', 'l', 'l', 'o'};
	TT_EQ(ks_lz_decompress(lit, sizeof(lit), out, sizeof(out), &n),
	      KUSOK_OK);
	TT_EQU(n, 5);
	TT_MEMEQ(out, "hello", 5);
	/* "ab" и совпадение со смещением 2 длиной 10, потом пустой хвост */
	static const uint8_t ab[] = {0x26, 'a', 'b', 2, 0, 0x00};
	TT_EQ(ks_lz_decompress(ab, sizeof(ab), out, sizeof(out), &n), KUSOK_OK);
	TT_EQU(n, 12);
	TT_MEMEQ(out, "abababababab", 12);
	/* длина литералов через байты продолжения: 15 + 255 + 3 = 273 */
	uint8_t dlin[3 + 273];
	dlin[0] = 0xF0;
	dlin[1] = 255;
	dlin[2] = 3;
	memset(dlin + 3, 'z', 273);
	uint8_t big[300];
	TT_EQ(ks_lz_decompress(dlin, sizeof(dlin), big, sizeof(big), &n),
	      KUSOK_OK);
	TT_EQU(n, 273);
}

TT_TEST(rejects_garbage)
{
	uint8_t out[64];
	size_t n;
	/* пустой вход — нет даже токена */
	TT_EQ(ks_lz_decompress((const uint8_t *)"", 0, out, sizeof(out), &n),
	      KUSOK_ECORRUPT);
	/* литералов обещано 5, а дано 3 */
	static const uint8_t short_lit[] = {0x50, 'a', 'b', 'c'};
	TT_EQ(ks_lz_decompress(short_lit, sizeof(short_lit), out, sizeof(out),
			       &n),
	      KUSOK_ECORRUPT);
	/* смещение 0 */
	static const uint8_t off0[] = {0x14, 'a', 0, 0, 0x00};
	TT_EQ(ks_lz_decompress(off0, sizeof(off0), out, sizeof(out), &n),
	      KUSOK_ECORRUPT);
	/* смещение дальше начала выхода */
	static const uint8_t far[] = {0x14, 'a', 9, 0, 0x00};
	TT_EQ(ks_lz_decompress(far, sizeof(far), out, sizeof(out), &n),
	      KUSOK_ECORRUPT);
	/* оборванное смещение */
	static const uint8_t cut[] = {0x14, 'a', 1};
	TT_EQ(ks_lz_decompress(cut, sizeof(cut), out, sizeof(out), &n),
	      KUSOK_ECORRUPT);
	/* длина продолжается за конец входа */
	static const uint8_t len_eof[] = {0xF0, 255, 255};
	TT_EQ(ks_lz_decompress(len_eof, sizeof(len_eof), out, sizeof(out), &n),
	      KUSOK_ECORRUPT);
}

TT_TEST(rejects_small_output)
{
	uint8_t d[1000], z[2000], out[1000];
	size_t zn, n;
	tt_fill_text(d, sizeof(d), 4);
	TT_EQ(ks_lz_compress(d, sizeof(d), z, sizeof(z), &zn), KUSOK_OK);
	TT_EQ(ks_lz_decompress(z, zn, out, sizeof(d) - 1, &n), KUSOK_ECORRUPT);
	TT_EQ(ks_lz_decompress(z, zn, out, sizeof(d), &n), KUSOK_OK);
}

TT_TEST(every_prefix_is_rejected_or_shorter)
{
	uint8_t d[4000], z[5000], out[4000];
	size_t zn, n;
	tt_fill_text(d, sizeof(d), 9);
	TT_EQ(ks_lz_compress(d, sizeof(d), z, sizeof(z), &zn), KUSOK_OK);
	for (size_t k = 0; k < zn; k++) {
		uint8_t *pref = malloc(k ? k : 1);
		memcpy(pref, z, k);
		int rc = ks_lz_decompress(pref, k, out, sizeof(out), &n);
		TT_CHECK(rc != KUSOK_OK || n < sizeof(d));
		free(pref);
	}
}

TT_TEST(compress_reports_no_room)
{
	uint8_t d[4096], z[4096];
	size_t zn;
	tt_fill(d, sizeof(d), 5); /* случайные — не жмутся */
	TT_EQ(ks_lz_compress(d, sizeof(d), z, sizeof(d) / 2, &zn),
	      KUSOK_ETOOBIG);
	TT_EQ(ks_lz_compress(d, sizeof(d), z, 0, &zn), KUSOK_ETOOBIG);
}

TT_TEST(bound_is_enough)
{
	for (size_t n = 0; n < 70000; n = n * 3 + 1) {
		uint8_t *d = malloc(n ? n : 1);
		uint8_t *z = malloc(ks_lz_bound(n));
		size_t zn;
		tt_fill(d, n, n);
		TT_EQ(ks_lz_compress(d, n, z, ks_lz_bound(n), &zn), KUSOK_OK);
		TT_CHECK(zn <= ks_lz_bound(n));
		free(d);
		free(z);
	}
}

TT_TEST(last_bytes_are_literals)
{
	/* последние 5 байт — литералы */
	uint8_t d[100], z[200];
	size_t zn;
	memset(d, 'q', sizeof(d));
	TT_EQ(ks_lz_compress(d, sizeof(d), z, sizeof(z), &zn), KUSOK_OK);
	/* последний токен: только литералы, их >= 5 */
	/* разбираем поток до последней последовательности */
	size_t ip = 0, last_lit = 0;
	while (ip < zn) {
		uint8_t t = z[ip++];
		size_t lit = t >> 4;
		if (lit == 15) {
			uint8_t s;
			do {
				s = z[ip++];
				lit += s;
			} while (s == 255);
		}
		ip += lit;
		last_lit = lit;
		if (ip == zn)
			break;
		ip += 2;
		if ((t & 15) == 15) {
			uint8_t s;
			do
				s = z[ip++];
			while (s == 255);
		}
	}
	TT_CHECK(last_lit >= 5);
}

static int tuda_obratno_hc(const uint8_t *d, size_t n, int level, size_t *zsize)
{
	size_t cap = ks_lz_bound(n);
	uint8_t *z = malloc(cap);
	uint8_t *back = malloc(n ? n : 1);
	size_t zn = 0, bn;
	int ok = ks_lz_compress_hc(d, n, z, cap, &zn, level) == KUSOK_OK &&
		 ks_lz_decompress(z, zn, back, n, &bn) == KUSOK_OK && bn == n &&
		 memcmp(back, d, n) == 0;
	if (zsize)
		*zsize = zn;
	free(z);
	free(back);
	return ok;
}

TT_TEST(hc_roundtrip)
{
	uint8_t *d = malloc(200000);
	size_t bad = 0;
	for (int level = KS_LZ_HC_MIN; level <= KS_LZ_HC_MAX; level++) {
		for (size_t n = 0; n < 300; n += 7) {
			tt_fill_text(d, n, n + (size_t)level);
			bad += !tuda_obratno_hc(d, n, level, NULL);
		}
		tt_fill_text(d, 200000, 5);
		bad += !tuda_obratno_hc(d, 200000, level, NULL);
		tt_fill(d, 70000, 6);
		bad += !tuda_obratno_hc(d, 70000, level, NULL);
		memset(d, 'z', 100000);
		bad += !tuda_obratno_hc(d, 100000, level, NULL);
	}
	TT_EQU(bad, 0);
	free(d);
}

TT_TEST(hc_far_matches)
{
	/* повтор ровно на краю окна 64K и чуть дальше */
	enum { N = 3 * 65536 };
	uint8_t *d = malloc(N);
	tt_fill(d, N, 8);
	memcpy(d + 65535, d, 4000);
	memcpy(d + 2 * 65536 + 10, d + 5, 4000);
	size_t z;
	TT_CHECK(tuda_obratno_hc(d, N, 9, &z));
	TT_CHECK(z < N - 3000); /* первый повтор найден */
	free(d);
}

TT_TEST(hc_beats_fast)
{
	/* сильный режим жмёт не хуже быстрого — и на тексте заметно лучше */
	enum { N = 1 << 20 };
	uint8_t *d = malloc(N), *z = malloc(ks_lz_bound(N));
	size_t bystro = 0, silno = 0, k;
	tt_fill_text(d, N, 77);
	for (size_t off = 0; off < N; off += 8192) {
		TT_OK(ks_lz_compress(d + off, 8192, z, ks_lz_bound(8192), &k));
		bystro += k;
		TT_OK(ks_lz_compress_hc(d + off, 8192, z, ks_lz_bound(8192), &k,
					9));
		silno += k;
	}
	printf("    кусками по 8K: быстро %zu, сильно %zu (%.1f%%)\n", bystro,
	       silno, 100.0 * (double)silno / (double)bystro);
	TT_CHECK(silno < bystro);
	free(d);
	free(z);
}

TT_TEST(hc_errors)
{
	uint8_t d[4096], z[4096];
	size_t zn;
	tt_fill(d, sizeof(d), 5);
	TT_EQ(ks_lz_compress_hc(d, sizeof(d), z, sizeof(d) / 2, &zn, 9),
	      KUSOK_ETOOBIG);
	TT_EQ(ks_lz_compress_hc(d, sizeof(d), z, sizeof(z), &zn, 1),
	      KUSOK_EINVAL);
	TT_EQ(ks_lz_compress_hc(d, sizeof(d), z, sizeof(z), &zn, 13),
	      KUSOK_EINVAL);
}

TT_TEST(hc_in_store)
{
	char *dir = tt_tmpdir();
	enum { N = 400000 };
	uint8_t *d = malloc(N);
	tt_fill_text(d, N, 31);
	uint64_t razmer[2];
	for (int i = 0; i < 2; i++) {
		char sub[4200];
		snprintf(sub, sizeof(sub), "%s/%d", dir, i);
		kusok_opts o = tt_opts();
		o.compress = i ? 9 : 1;
		kusok *ks = tt_open_with(sub, &o);
		kusok_id id = tt_put(ks, d, N);
		TT_CHECK(tt_same(ks, &id, d, N));
		kusok_stat st;
		kusok_stat_get(ks, &st);
		razmer[i] = st.stored_bytes;
		kusok_close(ks);
	}
	TT_CHECK(razmer[1] < razmer[0]);
	kusok_opts o = tt_opts();
	o.compress = 13;
	kusok *ks;
	TT_EQ(kusok_open(dir, &o, &ks), KUSOK_EINVAL);
	free(d);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(roundtrip_small_sizes);
	TT_RUN(roundtrip_big);
	TT_RUN(overlapping_matches);
	TT_RUN(reference_streams);
	TT_RUN(hand_made_streams);
	TT_RUN(rejects_garbage);
	TT_RUN(rejects_small_output);
	TT_RUN(every_prefix_is_rejected_or_shorter);
	TT_RUN(compress_reports_no_room);
	TT_RUN(bound_is_enough);
	TT_RUN(last_bytes_are_literals);
	TT_RUN(hc_roundtrip);
	TT_RUN(hc_far_matches);
	TT_RUN(hc_beats_fast);
	TT_RUN(hc_errors);
	TT_RUN(hc_in_store);
	return tt_done();
}
