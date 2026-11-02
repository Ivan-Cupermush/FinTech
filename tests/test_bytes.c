/*
 * числа little/big-endian
 *
 * SPDX-License-Identifier: MIT
 */
#include "bytes.h"
#include "tt.h"

TT_TEST(store_load_le)
{
	uint8_t b[8];
	st16(b, 0xBEEF);
	TT_EQU(b[0], 0xEF);
	TT_EQU(b[1], 0xBE);
	TT_EQU(ld16(b), 0xBEEF);
	st32(b, 0x01020304u);
	TT_EQU(b[0], 4);
	TT_EQU(b[3], 1);
	TT_EQU(ld32(b), 0x01020304u);
	st64(b, 0x0102030405060708ull);
	TT_EQU(b[0], 8);
	TT_EQU(b[7], 1);
	TT_EQU(ld64(b), 0x0102030405060708ull);
}

TT_TEST(store_load_be)
{
	uint8_t b[4];
	st32be(b, 0xA1B2C3D4u);
	TT_EQU(b[0], 0xA1);
	TT_EQU(b[3], 0xD4);
	TT_EQU(ld32be(b), 0xA1B2C3D4u);
}

TT_TEST(extremes)
{
	uint8_t b[8];
	st64(b, UINT64_MAX);
	TT_EQU(ld64(b), UINT64_MAX);
	st64(b, 0);
	TT_EQU(ld64(b), 0);
	st32(b, UINT32_MAX);
	TT_EQU(ld32(b), UINT32_MAX);
}

TT_TEST(unaligned)
{
	uint8_t b[16] = {0};
	for (int sdvig = 0; sdvig < 8; sdvig++) {
		st64(b + sdvig, 0x1122334455667788ull);
		TT_EQU(ld64(b + sdvig), 0x1122334455667788ull);
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
		/* peek читает в порядке машины: на LE совпадает с ld */
		TT_EQU(peek64(b + sdvig), ld64(b + sdvig));
		TT_EQU(peek32(b + sdvig), ld32(b + sdvig));
#endif
	}
}

int main(void)
{
	TT_RUN(store_load_le);
	TT_RUN(store_load_be);
	TT_RUN(extremes);
	TT_RUN(unaligned);
	return tt_done();
}
