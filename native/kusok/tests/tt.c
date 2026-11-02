/*
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include "tt.h"

#include <ftw.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int tt_fails = 0;
int tt_checks = 0;
const char *tt_cur = "";

void tt_fail(const char *file, int line, const char *what)
{
	tt_fails++;
	fprintf(stderr, "  %s:%d: [%s] не выполнено: %s\n", file, line, tt_cur,
		what);
}

void tt_fail_u(const char *file, int line, const char *what,
	       unsigned long long a, unsigned long long b)
{
	tt_fails++;
	fprintf(stderr, "  %s:%d: [%s] %s: %llu != %llu\n", file, line, tt_cur,
		what, a, b);
}

void tt_fail_i(const char *file, int line, const char *what, long long a,
	       long long b)
{
	tt_fails++;
	fprintf(stderr, "  %s:%d: [%s] %s: %lld != %lld\n", file, line, tt_cur,
		what, a, b);
}

int tt_done(void)
{
	printf("%d проверок, %d упало\n", tt_checks, tt_fails);
	return tt_fails ? 1 : 0;
}

char *tt_tmpdir(void)
{
	const char *base = getenv("TMPDIR");
	char *p = malloc(4096);
	snprintf(p, 4096, "%s/kusok-test-XXXXXX", base ? base : "/tmp");
	if (!mkdtemp(p)) {
		perror("mkdtemp");
		exit(2);
	}
	return p;
}

static int rm_one(const char *path, const struct stat *st, int flag,
		  struct FTW *ftw)
{
	(void)st;
	(void)flag;
	(void)ftw;
	return remove(path);
}

void tt_rmdir(const char *path)
{
	nftw(path, rm_one, 16, FTW_DEPTH | FTW_PHYS);
}

uint64_t tt_rand(uint64_t *s)
{
	/* xorshift64* */
	uint64_t x = *s ? *s : 0x9E3779B97F4A7C15ull;
	x ^= x >> 12;
	x ^= x << 25;
	x ^= x >> 27;
	*s = x;
	return x * 0x2545F4914F6CDD1Dull;
}

void tt_fill(void *buf, size_t n, uint64_t seed)
{
	uint8_t *p = buf;
	uint64_t s = seed;
	for (size_t i = 0; i < n; i++)
		p[i] = (uint8_t)(tt_rand(&s) >> 56);
}

void tt_fill_text(void *buf, size_t n, uint64_t seed)
{
	static const char *slova[] = {
	    "kusok ", "pack ",	  "file ",   "offix ",	 "goal ",    "metric ",
	    "chat ",  "message ", "the ",    "and ",	 "of ",	     "data ",
	    "store ", "\n",	  "report ", "student ", "teacher ", "task ",
	};
	uint8_t *p = buf;
	uint64_t s = seed;
	size_t i = 0;
	while (i < n) {
		const char *w =
		    slova[tt_rand(&s) % (sizeof(slova) / sizeof(*slova))];
		for (size_t k = 0; w[k] && i < n; k++)
			p[i++] = (uint8_t)w[k];
	}
}

void tt_pread(int fd, void *buf, size_t n, long long off)
{
	if (pread(fd, buf, n, (off_t)off) != (ssize_t)n) {
		perror("pread");
		exit(2);
	}
}

void tt_pwrite(int fd, const void *buf, size_t n, long long off)
{
	if (pwrite(fd, buf, n, (off_t)off) != (ssize_t)n) {
		perror("pwrite");
		exit(2);
	}
}

void tt_write(int fd, const void *buf, size_t n)
{
	if (write(fd, buf, n) != (ssize_t)n) {
		perror("write");
		exit(2);
	}
}

kusok_opts tt_opts(void)
{
	kusok_opts o;
	kusok_opts_default(&o);
	o.min_chunk = 256;
	o.avg_chunk = 1024;
	o.max_chunk = 4096;
	o.pack_limit = 64 * 1024;
	return o;
}

kusok *tt_open_with(const char *dir, const kusok_opts *o)
{
	kusok *ks = NULL;
	int rc = kusok_open(dir, o, &ks);
	if (rc) {
		fprintf(stderr, "kusok_open(%s): %s\n", dir,
			kusok_strerror(rc));
		exit(2);
	}
	return ks;
}

kusok *tt_open(const char *dir)
{
	kusok_opts o = tt_opts();
	return tt_open_with(dir, &o);
}

kusok *tt_reopen(kusok *ks, const char *dir)
{
	int rc = kusok_close(ks);
	if (rc) {
		fprintf(stderr, "kusok_close: %s\n", kusok_strerror(rc));
		exit(2);
	}
	return tt_open(dir);
}

kusok_id tt_put(kusok *ks, const void *buf, size_t n)
{
	kusok_id id;
	int rc = kusok_put_mem(ks, buf, n, &id);
	if (rc) {
		fprintf(stderr, "kusok_put_mem: %s\n", kusok_strerror(rc));
		exit(2);
	}
	return id;
}

int tt_same(kusok *ks, const kusok_id *id, const void *want, size_t n)
{
	uint64_t size;
	if (kusok_size(ks, id, &size) || size != n)
		return 0;
	uint8_t *buf = malloc(n ? n : 1);
	size_t got;
	int ok = kusok_read(ks, id, 0, buf, n, &got) == KUSOK_OK && got == n &&
		 memcmp(buf, want, n) == 0;
	free(buf);
	return ok;
}
