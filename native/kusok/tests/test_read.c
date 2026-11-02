/*
 * чтение с любого смещения
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "kusok/kusok.h"
#include "tt.h"

static uint8_t *dannye;
static kusok_id fid;
static kusok *ks;
static char *dir;
enum { N = 777777 };

static void podgotovka(void)
{
	dir = tt_tmpdir();
	ks = tt_open(dir);
	dannye = malloc(N);
	tt_fill_text(dannye, N / 2, 1);
	tt_fill(dannye + N / 2, N - N / 2,
		2); /* половина жмётся, половина нет */
	fid = tt_put(ks, dannye, N);
}

static void uborka(void)
{
	kusok_close(ks);
	free(dannye);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(random_ranges)
{
	uint64_t s = 99;
	uint8_t *buf = malloc(70000);
	size_t bad = 0;
	for (int k = 0; k < 3000; k++) {
		uint64_t off = tt_rand(&s) % N;
		size_t len = (size_t)(tt_rand(&s) % 70000);
		size_t got;
		if (kusok_read(ks, &fid, off, buf, len, &got)) {
			bad++;
			continue;
		}
		size_t want = off + len <= N ? len : N - off;
		bad += got != want || memcmp(buf, dannye + off, got) != 0;
	}
	TT_EQU(bad, 0);
	free(buf);
}

TT_TEST(byte_by_byte_prefix)
{
	/* по байту — проверяет кэш куска и переходы между кусками */
	size_t bad = 0;
	for (uint64_t off = 0; off < 20000; off++) {
		uint8_t b;
		size_t got;
		kusok_read(ks, &fid, off, &b, 1, &got);
		bad += got != 1 || b != dannye[off];
	}
	TT_EQU(bad, 0);
}

TT_TEST(sequential_small_reads)
{
	uint8_t *out = malloc(N);
	size_t pos = 0, got;
	while (pos < N) {
		size_t want = 1 + pos % 997;
		TT_OK(kusok_read(ks, &fid, pos, out + pos, want, &got));
		if (got == 0)
			break;
		pos += got;
	}
	TT_EQU(pos, N);
	TT_MEMEQ(out, dannye, N);
	free(out);
}

TT_TEST(past_the_end)
{
	uint8_t buf[100];
	size_t got = 123;
	TT_OK(kusok_read(ks, &fid, N, buf, sizeof(buf), &got));
	TT_EQU(got, 0);
	TT_OK(kusok_read(ks, &fid, (uint64_t)N + 1000000, buf, sizeof(buf),
			 &got));
	TT_EQU(got, 0);
	TT_OK(kusok_read(ks, &fid, N - 10, buf, sizeof(buf), &got));
	TT_EQU(got, 10);
	TT_MEMEQ(buf, dannye + N - 10, 10);
	TT_OK(kusok_read(ks, &fid, 5, buf, 0, &got));
	TT_EQU(got, 0);
}

TT_TEST(whole_file_in_one_call)
{
	uint8_t *out = malloc(N + 5);
	size_t got;
	TT_OK(kusok_read(ks, &fid, 0, out, N + 5, &got));
	TT_EQU(got, N);
	TT_MEMEQ(out, dannye, N);
	free(out);
}

TT_TEST(two_files_interleaved)
{
	/* два файла вперемешку */
	enum { M = 50000 };
	uint8_t *b = malloc(M);
	tt_fill(b, M, 3);
	kusok_id id2 = tt_put(ks, b, M);
	size_t bad = 0;
	for (uint64_t off = 0; off < M; off += 501) {
		uint8_t x[64], y[64];
		size_t g1, g2;
		kusok_read(ks, &fid, off, x, 64, &g1);
		kusok_read(ks, &id2, off, y, 64, &g2);
		size_t w2 = off + 64 <= M ? 64 : M - off;
		bad += g1 != 64 || memcmp(x, dannye + off, 64) != 0;
		bad += g2 != w2 || memcmp(y, b + off, g2) != 0;
	}
	TT_EQU(bad, 0);
	free(b);
}

TT_TEST(unknown_id)
{
	kusok_id net;
	memset(net.b, 0x42, 32);
	uint8_t buf[8];
	size_t got;
	uint64_t size;
	TT_EQ(kusok_read(ks, &net, 0, buf, 8, &got), KUSOK_ENOTFOUND);
	TT_EQ(kusok_size(ks, &net, &size), KUSOK_ENOTFOUND);
	TT_EQ(kusok_get_fd(ks, &net, 1), KUSOK_ENOTFOUND);
	TT_EQ(kusok_read(ks, NULL, 0, buf, 8, &got), KUSOK_EINVAL);
	TT_EQ(kusok_read(ks, &fid, 0, NULL, 8, &got), KUSOK_EINVAL);
}

TT_TEST(read_after_reopen_read_only)
{
	kusok_close(ks);
	kusok_opts o = tt_opts();
	o.read_only = 1;
	TT_OK(kusok_open(dir, &o, &ks));
	uint8_t buf[1000];
	size_t got;
	TT_OK(kusok_read(ks, &fid, 400000, buf, sizeof(buf), &got));
	TT_EQU(got, sizeof(buf));
	TT_MEMEQ(buf, dannye + 400000, sizeof(buf));
}

int main(void)
{
	podgotovka();
	TT_RUN(random_ranges);
	TT_RUN(byte_by_byte_prefix);
	TT_RUN(sequential_small_reads);
	TT_RUN(past_the_end);
	TT_RUN(whole_file_in_one_call);
	TT_RUN(two_files_interleaved);
	TT_RUN(unknown_id);
	TT_RUN(read_after_reopen_read_only);
	uborka();
	return tt_done();
}
