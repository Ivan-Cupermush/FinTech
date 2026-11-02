/*
 * SHA-256: векторы NIST
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "sha256.h"
#include "tt.h"

static void hex(const uint8_t d[32], char out[65])
{
	for (int i = 0; i < 32; i++)
		sprintf(out + 2 * i, "%02x", d[i]);
}

static void chek(const void *data, size_t n, const char *want)
{
	uint8_t d[32];
	char h[65];
	ks_sha256_buf(data, n, d);
	hex(d, h);
	TT_CHECK(strcmp(h, want) == 0);
	if (strcmp(h, want) != 0)
		fprintf(stderr, "    получили %s\n    ждали    %s\n", h, want);
}

TT_TEST(nist_vectors)
{
	chek(
	    "", 0,
	    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	chek(
	    "abc", 3,
	    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	const char *s448 =
	    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
	chek(
	    s448, strlen(s448),
	    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
	const char *s896 =
	    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmn"
	    "hijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu";
	chek(
	    s896, strlen(s896),
	    "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
}

TT_TEST(million_a)
{
	/* миллион 'a' подаём кусками неудобной длины */
	ks_sha256 s;
	uint8_t blok[997], d[32];
	char h[65];
	memset(blok, 'a', sizeof(blok));
	ks_sha256_init(&s);
	size_t ost = 1000000;
	while (ost) {
		size_t k = ost < sizeof(blok) ? ost : sizeof(blok);
		ks_sha256_update(&s, blok, k);
		ost -= k;
	}
	ks_sha256_final(&s, d);
	hex(d, h);
	TT_CHECK(strcmp(h, "cdc76e5c9914fb9281a1c7e284d73e67"
			   "f1809a48a497200e046d39ccc7112cd0") == 0);
}

TT_TEST(lengths_around_padding)
{
	/* длины 0..199, эталон из hashlib */
	ks_sha256 all;
	uint8_t d[32], buf[200];
	char h[65];
	ks_sha256_init(&all);
	for (size_t n = 0; n < 200; n++) {
		for (size_t i = 0; i < n; i++)
			buf[i] = (uint8_t)(i * 7 + n);
		ks_sha256_buf(buf, n, d);
		ks_sha256_update(&all, d, 32);
	}
	ks_sha256_final(&all, d);
	hex(d, h);
	TT_CHECK(strcmp(h, "8c7c9ff69da76fc28823a1cb97268672"
			   "663e628e1ea955868b16db46bab0545d") == 0);
}

TT_TEST(streaming_equals_oneshot)
{
	enum { N = 5000 };
	uint8_t *data = malloc(N);
	uint8_t want[32], got[32];
	tt_fill(data, N, 42);
	ks_sha256_buf(data, N, want);
	/* разрезаем в каждой точке на два куска */
	for (size_t cut = 0; cut <= N; cut += 37) {
		ks_sha256 s;
		ks_sha256_init(&s);
		ks_sha256_update(&s, data, cut);
		ks_sha256_update(&s, data + cut, N - cut);
		ks_sha256_final(&s, got);
		TT_MEMEQ(got, want, 32);
	}
	/* и по байту */
	ks_sha256 s;
	ks_sha256_init(&s);
	for (size_t i = 0; i < N; i++)
		ks_sha256_update(&s, data + i, 1);
	ks_sha256_final(&s, got);
	TT_MEMEQ(got, want, 32);
	free(data);
}

TT_TEST(zero_length_updates)
{
	ks_sha256 s;
	uint8_t a[32], b[32];
	ks_sha256_init(&s);
	ks_sha256_update(&s, "", 0);
	ks_sha256_update(&s, "ab", 2);
	ks_sha256_update(&s, NULL, 0);
	ks_sha256_update(&s, "c", 1);
	ks_sha256_final(&s, a);
	ks_sha256_buf("abc", 3, b);
	TT_MEMEQ(a, b, 32);
}

TT_TEST(different_inputs_differ)
{
	uint8_t a[32], b[32];
	ks_sha256_buf("kusok", 5, a);
	ks_sha256_buf("kusoK", 5, b);
	TT_CHECK(memcmp(a, b, 32) != 0);
	/* один бит — половина бит хеша меняется (лавина) */
	int raz = 0;
	for (int i = 0; i < 32; i++)
		raz += __builtin_popcount(a[i] ^ b[i]);
	TT_CHECK(raz > 80 && raz < 176);
}

TT_TEST(hw_matches_sw)
{
	/* SHA-NI и обычный C должны давать одно и то же на любых длинах */
	enum { N = 3000 };
	uint8_t *d = malloc(N);
	tt_fill(d, N, 31);
	printf("    (SHA-NI: %s)\n", ks_sha256_hw() ? "да" : "нет");
	size_t raznye = 0;
	for (size_t n = 0; n < N; n += 7) {
		uint8_t a[32], b[32];
		ks_sha256_use_hw(1);
		ks_sha256_buf(d, n, a);
		ks_sha256_use_hw(0);
		ks_sha256_buf(d, n, b);
		raznye += memcmp(a, b, 32) != 0;
	}
	ks_sha256_use_hw(1);
	TT_EQU(raznye, 0);
	/* и векторы NIST проходят в обоих режимах */
	ks_sha256_use_hw(0);
	nist_vectors();
	million_a();
	ks_sha256_use_hw(1);
	free(d);
}

int main(void)
{
	TT_RUN(nist_vectors);
	TT_RUN(million_a);
	TT_RUN(lengths_around_padding);
	TT_RUN(streaming_equals_oneshot);
	TT_RUN(zero_length_updates);
	TT_RUN(different_inputs_differ);
	TT_RUN(hw_matches_sw);
	return tt_done();
}
