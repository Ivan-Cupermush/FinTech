/*
 * манифест
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "bytes.h"
#include "kusok/kusok.h"
#include "manifest.h"
#include "tt.h"

static void sobrat(ks_manifest *m, const uint32_t *lens, uint32_t n)
{
	ks_mf_init(m);
	for (uint32_t i = 0; i < n; i++) {
		uint8_t id[32];
		memset(id, (int)i, 32);
		ks_mf_push(m, id, lens[i]);
	}
}

TT_TEST(roundtrip)
{
	static const uint32_t lens[] = {100, 2048, 1, 65536, 7};
	ks_manifest m, d;
	sobrat(&m, lens, 5);
	TT_EQU(m.size, 100 + 2048 + 1 + 65536 + 7);
	size_t n = ks_mf_encoded_size(&m);
	TT_EQU(n, KS_MF_HDR + 5 * KS_MF_ENT);
	uint8_t *buf = malloc(n);
	ks_mf_encode(&m, buf);
	ks_mf_init(&d);
	TT_OK(ks_mf_decode(buf, n, 65536, &d));
	TT_EQU(d.n, 5);
	TT_EQU(d.size, m.size);
	for (uint32_t i = 0; i < 5; i++) {
		TT_EQU(d.lens[i], lens[i]);
		TT_MEMEQ(d.ids[i], m.ids[i], 32);
		TT_EQU(d.end[i], m.end[i]);
	}
	uint64_t size;
	TT_OK(ks_mf_peek_size(buf, &size));
	TT_EQU(size, m.size);
	free(buf);
	ks_mf_free(&m);
	ks_mf_free(&d);
}

TT_TEST(empty_file)
{
	ks_manifest m, d;
	ks_mf_init(&m);
	ks_mf_init(&d);
	uint8_t buf[KS_MF_HDR];
	TT_EQU(ks_mf_encoded_size(&m), KS_MF_HDR);
	ks_mf_encode(&m, buf);
	TT_OK(ks_mf_decode(buf, sizeof(buf), 65536, &d));
	TT_EQU(d.n, 0);
	TT_EQU(d.size, 0);
	ks_mf_free(&m);
	ks_mf_free(&d);
}

TT_TEST(push_rejects_zero)
{
	ks_manifest m;
	uint8_t id[32] = {0};
	ks_mf_init(&m);
	TT_EQ(ks_mf_push(&m, id, 0), KUSOK_EINVAL);
	ks_mf_free(&m);
}

TT_TEST(find_every_offset)
{
	static const uint32_t lens[] = {3, 1, 5, 2, 10};
	ks_manifest m;
	sobrat(&m, lens, 5);
	/* для каждого байта файла — номер куска, где он лежит */
	uint32_t want = 0;
	uint64_t kon = lens[0];
	for (uint64_t off = 0; off < m.size; off++) {
		while (off >= kon)
			kon += lens[++want];
		TT_EQU(ks_mf_find(&m, off), want);
		TT_CHECK(ks_mf_start(&m, want) <= off);
	}
	TT_EQU(ks_mf_find(&m, m.size), 5); /* за концом — n */
	ks_mf_free(&m);
}

TT_TEST(find_large)
{
	ks_manifest m;
	ks_mf_init(&m);
	uint64_t s = 1;
	for (int i = 0; i < 100000; i++) {
		uint8_t id[32] = {0};
		ks_mf_push(&m, id, 1 + (uint32_t)(tt_rand(&s) % 9000));
	}
	size_t bad = 0;
	for (int k = 0; k < 20000; k++) {
		uint64_t off = tt_rand(&s) % m.size;
		uint32_t i = ks_mf_find(&m, off);
		bad += !(ks_mf_start(&m, i) <= off && off < m.end[i]);
	}
	TT_EQU(bad, 0);
	ks_mf_free(&m);
}

TT_TEST(decode_rejects)
{
	static const uint32_t lens[] = {10, 20, 30};
	ks_manifest m, d;
	sobrat(&m, lens, 3);
	size_t n = ks_mf_encoded_size(&m);
	uint8_t *buf = malloc(n), *bad = malloc(n);
	ks_mf_encode(&m, buf);
	ks_mf_init(&d);

	/* короче заголовка */
	TT_EQ(ks_mf_decode(buf, 10, 65536, &d), KUSOK_ECORRUPT);
	/* чужая магия */
	memcpy(bad, buf, n);
	bad[0] = 'X';
	TT_EQ(ks_mf_decode(bad, n, 65536, &d), KUSOK_ECORRUPT);
	/* n не сходится с длиной буфера */
	memcpy(bad, buf, n);
	st32(bad + 4, 4);
	TT_EQ(ks_mf_decode(bad, n, 65536, &d), KUSOK_ECORRUPT);
	/* лишний байт в хвосте */
	TT_EQ(ks_mf_decode(buf, n - 1, 65536, &d), KUSOK_ECORRUPT);
	/* размер файла не равен сумме кусков */
	memcpy(bad, buf, n);
	st64(bad + 8, 61);
	TT_EQ(ks_mf_decode(bad, n, 65536, &d), KUSOK_ECORRUPT);
	/* кусок нулевой длины */
	memcpy(bad, buf, n);
	st32(bad + KS_MF_HDR + 32, 0);
	st64(bad + 8, 50);
	TT_EQ(ks_mf_decode(bad, n, 65536, &d), KUSOK_ECORRUPT);
	/* кусок больше максимума */
	TT_EQ(ks_mf_decode(buf, n, 25, &d), KUSOK_ECORRUPT);
	/* и целый всё ещё разбирается */
	TT_OK(ks_mf_decode(buf, n, 65536, &d));

	free(buf);
	free(bad);
	ks_mf_free(&m);
	ks_mf_free(&d);
}

TT_TEST(decode_reuses_memory)
{
	/* один ks_manifest для разных манифестов подряд (так делает кэш) */
	static const uint32_t a[] = {5, 5, 5, 5, 5, 5, 5, 5};
	static const uint32_t b[] = {9};
	ks_manifest ma, mb, d;
	sobrat(&ma, a, 8);
	sobrat(&mb, b, 1);
	uint8_t ba[KS_MF_HDR + 8 * KS_MF_ENT], bb[KS_MF_HDR + KS_MF_ENT];
	ks_mf_encode(&ma, ba);
	ks_mf_encode(&mb, bb);
	ks_mf_init(&d);
	TT_OK(ks_mf_decode(ba, sizeof(ba), 100, &d));
	TT_EQU(d.n, 8);
	TT_OK(ks_mf_decode(bb, sizeof(bb), 100, &d));
	TT_EQU(d.n, 1);
	TT_EQU(d.size, 9);
	TT_OK(ks_mf_decode(ba, sizeof(ba), 100, &d));
	TT_EQU(d.size, 40);
	ks_mf_free(&ma);
	ks_mf_free(&mb);
	ks_mf_free(&d);
}

int main(void)
{
	TT_RUN(roundtrip);
	TT_RUN(empty_file);
	TT_RUN(push_rejects_zero);
	TT_RUN(find_every_offset);
	TT_RUN(find_large);
	TT_RUN(decode_rejects);
	TT_RUN(decode_reuses_memory);
	return tt_done();
}
