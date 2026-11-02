/*
 * SPDX-License-Identifier: MIT
 */
#include "crc32c.h"

#include <pthread.h>

#include "bytes.h"

#define POLY 0x82F63B78u

/* tab[k][b] — crc байта b и k нулей после */
static uint32_t tab[8][256];
static pthread_once_t tab_once = PTHREAD_ONCE_INIT;

static void tab_init(void)
{
	for (uint32_t b = 0; b < 256; b++) {
		uint32_t c = b;
		for (int i = 0; i < 8; i++)
			c = (c & 1) ? (c >> 1) ^ POLY : c >> 1;
		tab[0][b] = c;
	}
	for (uint32_t b = 0; b < 256; b++)
		for (int k = 1; k < 8; k++)
			tab[k][b] =
			    (tab[k - 1][b] >> 8) ^ tab[0][tab[k - 1][b] & 0xff];
}

static uint32_t sw_raw(uint32_t c, const uint8_t *p, size_t n)
{
	while (n && ((uintptr_t)p & 7)) {
		c = (c >> 8) ^ tab[0][(c ^ *p++) & 0xff];
		n--;
	}
	/* по 8 байт */
	while (n >= 8) {
		uint32_t lo = ld32(p) ^ c;
		uint32_t hi = ld32(p + 4);
		c = tab[7][lo & 0xff] ^ tab[6][(lo >> 8) & 0xff] ^
		    tab[5][(lo >> 16) & 0xff] ^ tab[4][lo >> 24] ^
		    tab[3][hi & 0xff] ^ tab[2][(hi >> 8) & 0xff] ^
		    tab[1][(hi >> 16) & 0xff] ^ tab[0][hi >> 24];
		p += 8;
		n -= 8;
	}
	while (n--)
		c = (c >> 8) ^ tab[0][(c ^ *p++) & 0xff];
	return c;
}

uint32_t ks_crc32c_sw(uint32_t crc, const void *data, size_t n)
{
	pthread_once(&tab_once, tab_init);
	return ~sw_raw(~crc, data, n);
}

#if defined(__x86_64__) && (defined(__GNUC__) || defined(__clang__))
#include <nmmintrin.h>

__attribute__((target("sse4.2"))) static uint32_t
hw_raw(uint32_t c, const uint8_t *p, size_t n)
{
	uint64_t c64 = c;
	while (n && ((uintptr_t)p & 7)) {
		c64 = _mm_crc32_u8((uint32_t)c64, *p++);
		n--;
	}
	while (n >= 8) {
		c64 = _mm_crc32_u64(c64, peek64(p));
		p += 8;
		n -= 8;
	}
	while (n--)
		c64 = _mm_crc32_u8((uint32_t)c64, *p++);
	return (uint32_t)c64;
}

static int hw_ok = -1;

static int have_hw(void)
{
	if (hw_ok < 0) {
		__builtin_cpu_init();
		hw_ok = __builtin_cpu_supports("sse4.2") ? 1 : 0;
	}
	return hw_ok;
}

int ks_crc32c_hw(void)
{
	return have_hw();
}

uint32_t ks_crc32c(uint32_t crc, const void *data, size_t n)
{
	if (have_hw())
		return ~hw_raw(~crc, data, n);
	return ks_crc32c_sw(crc, data, n);
}

#else

int ks_crc32c_hw(void)
{
	return 0;
}

uint32_t ks_crc32c(uint32_t crc, const void *data, size_t n)
{
	return ks_crc32c_sw(crc, data, n);
}

#endif
