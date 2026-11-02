/*
 * CRC32C: векторы RFC 3720, железо против таблиц
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "crc32c.h"
#include "tt.h"

TT_TEST(check_value)
{
	/* «check» из каталога CRC: crc от "123456789" */
	TT_EQU(ks_crc32c(0, "123456789", 9), 0xE3069283u);
	TT_EQU(ks_crc32c_sw(0, "123456789", 9), 0xE3069283u);
}

TT_TEST(rfc3720_vectors)
{
	uint8_t b[32];
	memset(b, 0, 32);
	TT_EQU(ks_crc32c(0, b, 32), 0x8A9136AAu);
	memset(b, 0xff, 32);
	TT_EQU(ks_crc32c(0, b, 32), 0x62A8AB43u);
	for (int i = 0; i < 32; i++)
		b[i] = (uint8_t)i;
	TT_EQU(ks_crc32c(0, b, 32), 0x46DD794Eu);
	for (int i = 0; i < 32; i++)
		b[i] = (uint8_t)(31 - i);
	TT_EQU(ks_crc32c(0, b, 32), 0x113FDB5Cu);
}

TT_TEST(empty_is_identity)
{
	TT_EQU(ks_crc32c(0, "", 0), 0);
	TT_EQU(ks_crc32c(0x12345678u, "", 0), 0x12345678u);
}

TT_TEST(incremental)
{
	enum { N = 4096 };
	uint8_t *d = malloc(N);
	tt_fill(d, N, 7);
	uint32_t whole = ks_crc32c(0, d, N);
	for (size_t cut = 0; cut <= N; cut += 61)
		TT_EQU(ks_crc32c(ks_crc32c(0, d, cut), d + cut, N - cut),
		       whole);
	free(d);
}

TT_TEST(hw_matches_sw)
{
	/* разные длины и сдвиги */
	enum { N = 1000 };
	uint8_t *d = malloc(N + 16);
	tt_fill(d, N + 16, 99);
	for (size_t sdvig = 0; sdvig < 9; sdvig++)
		for (size_t n = 0; n < N; n += 13)
			TT_EQU(ks_crc32c(0, d + sdvig, n),
			       ks_crc32c_sw(0, d + sdvig, n));
	printf("    (аппаратный crc32c: %s)\n", ks_crc32c_hw() ? "да" : "нет");
	free(d);
}

TT_TEST(detects_single_bit_flip)
{
	uint8_t d[256];
	tt_fill(d, sizeof(d), 5);
	uint32_t c = ks_crc32c(0, d, sizeof(d));
	for (size_t i = 0; i < sizeof(d); i++) {
		for (int bit = 0; bit < 8; bit++) {
			d[i] ^= (uint8_t)(1 << bit);
			TT_CHECK(ks_crc32c(0, d, sizeof(d)) != c);
			d[i] ^= (uint8_t)(1 << bit);
		}
	}
}

int main(void)
{
	TT_RUN(check_value);
	TT_RUN(rfc3720_vectors);
	TT_RUN(empty_is_identity);
	TT_RUN(incremental);
	TT_RUN(hw_matches_sw);
	TT_RUN(detects_single_bit_flip);
	return tt_done();
}
