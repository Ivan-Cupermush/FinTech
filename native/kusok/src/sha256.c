/*
 * SPDX-License-Identifier: MIT
 */
#include "sha256.h"

#include <string.h>

#include "bytes.h"

static const uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

#define ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))
#define CH(x, y, z) (((x) & (y)) ^ (~(x) & (z)))
#define MAJ(x, y, z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define BSIG0(x) (ROTR(x, 2) ^ ROTR(x, 13) ^ ROTR(x, 22))
#define BSIG1(x) (ROTR(x, 6) ^ ROTR(x, 11) ^ ROTR(x, 25))
#define SSIG0(x) (ROTR(x, 7) ^ ROTR(x, 18) ^ ((x) >> 3))
#define SSIG1(x) (ROTR(x, 17) ^ ROTR(x, 19) ^ ((x) >> 10))

static void blok(uint32_t h[8], const uint8_t *p)
{
	uint32_t w[64];
	for (int i = 0; i < 16; i++)
		w[i] = ld32be(p + 4 * i);
	for (int i = 16; i < 64; i++)
		w[i] =
		    SSIG1(w[i - 2]) + w[i - 7] + SSIG0(w[i - 15]) + w[i - 16];

	uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
	uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];
	for (int i = 0; i < 64; i++) {
		uint32_t t1 = hh + BSIG1(e) + CH(e, f, g) + K[i] + w[i];
		uint32_t t2 = BSIG0(a) + MAJ(a, b, c);
		hh = g;
		g = f;
		f = e;
		e = d + t1;
		d = c;
		c = b;
		b = a;
		a = t1 + t2;
	}
	h[0] += a;
	h[1] += b;
	h[2] += c;
	h[3] += d;
	h[4] += e;
	h[5] += f;
	h[6] += g;
	h[7] += hh;
}

static void blocks_sw(uint32_t h[8], const uint8_t *p, size_t n)
{
	while (n--) {
		blok(h, p);
		p += 64;
	}
}

#if defined(__x86_64__) && (defined(__GNUC__) || defined(__clang__))
#include <cpuid.h>
#include <immintrin.h>

/* SHA-NI: rnds2 делает два раунда, состояние как ABEF/CDGH */
__attribute__((target("sha,sse4.1,ssse3"))) static void
blocks_ni(uint32_t h[8], const uint8_t *p, size_t n)
{
	const __m128i MASK =
	    _mm_set_epi64x(0x0c0d0e0f08090a0bULL, 0x0405060700010203ULL);
	__m128i tmp = _mm_loadu_si128((const __m128i *)&h[0]);
	__m128i st1 = _mm_loadu_si128((const __m128i *)&h[4]);
	tmp = _mm_shuffle_epi32(tmp, 0xB1);	    /* CDAB */
	st1 = _mm_shuffle_epi32(st1, 0x1B);	    /* EFGH */
	__m128i st0 = _mm_alignr_epi8(tmp, st1, 8); /* ABEF */
	st1 = _mm_blend_epi16(st1, tmp, 0xF0);	    /* CDGH */

	while (n--) {
		__m128i abef = st0, cdgh = st1;
		__m128i w[4];
		for (int i = 0; i < 16; i++) {
			__m128i m;
			if (i < 4) {
				m = _mm_shuffle_epi8(
				    _mm_loadu_si128(
					(const __m128i *)(p + 16 * i)),
				    MASK);
			} else {
				__m128i a = _mm_sha256msg1_epu32(
				    w[i & 3], w[(i + 1) & 3]);
				a = _mm_add_epi32(
				    a, _mm_alignr_epi8(w[(i + 3) & 3],
						       w[(i + 2) & 3], 4));
				m = _mm_sha256msg2_epu32(a, w[(i + 3) & 3]);
			}
			w[i & 3] = m;
			__m128i k = _mm_loadu_si128((const __m128i *)&K[4 * i]);
			__m128i x = _mm_add_epi32(m, k);
			st1 = _mm_sha256rnds2_epu32(st1, st0, x);
			x = _mm_shuffle_epi32(x, 0x0E);
			st0 = _mm_sha256rnds2_epu32(st0, st1, x);
		}
		st0 = _mm_add_epi32(st0, abef);
		st1 = _mm_add_epi32(st1, cdgh);
		p += 64;
	}

	tmp = _mm_shuffle_epi32(st0, 0x1B);    /* FEBA */
	st1 = _mm_shuffle_epi32(st1, 0xB1);    /* DCHG */
	st0 = _mm_blend_epi16(tmp, st1, 0xF0); /* DCBA */
	st1 = _mm_alignr_epi8(st1, tmp, 8);    /* ABEF -> HGFE */
	_mm_storeu_si128((__m128i *)&h[0], st0);
	_mm_storeu_si128((__m128i *)&h[4], st1);
}

static int hw_mode = -1;

static int have_ni(void)
{
	if (hw_mode < 0) {
		/* clang 18 не знает cpu_supports("sha") */
		unsigned a, b, c, d;
		int sse41 = __get_cpuid(1, &a, &b, &c, &d) && (c & bit_SSE4_1);
		int sha =
		    __get_cpuid_count(7, 0, &a, &b, &c, &d) && (b & (1u << 29));
		hw_mode = sse41 && sha;
	}
	return hw_mode;
}

int ks_sha256_hw(void)
{
	return have_ni();
}

void ks_sha256_use_hw(int on)
{
	hw_mode = -1;
	if (!on || !have_ni())
		hw_mode = 0;
}

static void blocks(uint32_t h[8], const uint8_t *p, size_t n)
{
	if (have_ni())
		blocks_ni(h, p, n);
	else
		blocks_sw(h, p, n);
}

#else

int ks_sha256_hw(void)
{
	return 0;
}

void ks_sha256_use_hw(int on)
{
	(void)on;
}

static void blocks(uint32_t h[8], const uint8_t *p, size_t n)
{
	blocks_sw(h, p, n);
}

#endif

void ks_sha256_init(ks_sha256 *s)
{
	static const uint32_t H0[8] = {
	    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
	    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	};
	memcpy(s->h, H0, sizeof(H0));
	s->len = 0;
	s->nb = 0;
}

void ks_sha256_update(ks_sha256 *s, const void *data, size_t n)
{
	const uint8_t *p = data;
	if (n == 0)
		return;
	s->len += n;
	if (s->nb) {
		size_t kol = 64 - s->nb;
		if (kol > n)
			kol = n;
		memcpy(s->buf + s->nb, p, kol);
		s->nb += kol;
		p += kol;
		n -= kol;
		if (s->nb < 64)
			return;
		blocks(s->h, s->buf, 1);
		s->nb = 0;
	}
	if (n >= 64) {
		blocks(s->h, p, n / 64);
		p += n / 64 * 64;
		n %= 64;
	}
	if (n) {
		memcpy(s->buf, p, n);
		s->nb = n;
	}
}

void ks_sha256_final(ks_sha256 *s, uint8_t out[KS_SHA256_LEN])
{
	uint64_t bits = s->len * 8;
	uint8_t pad[72];
	/* 0x80, нули, длина в битах */
	size_t kol = (s->nb < 56) ? 56 - s->nb : 120 - s->nb;
	memset(pad, 0, sizeof(pad));
	pad[0] = 0x80;
	for (int i = 0; i < 8; i++)
		pad[kol + i] = (uint8_t)(bits >> (56 - 8 * i));
	uint64_t len = s->len;
	ks_sha256_update(s, pad, kol + 8);
	s->len = len;
	for (int i = 0; i < 8; i++)
		st32be(out + 4 * i, s->h[i]);
	memset(s->buf, 0, sizeof(s->buf));
}

void ks_sha256_buf(const void *data, size_t n, uint8_t out[KS_SHA256_LEN])
{
	ks_sha256 s;
	ks_sha256_init(&s);
	ks_sha256_update(&s, data, n);
	ks_sha256_final(&s, out);
}
