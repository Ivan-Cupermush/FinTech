/*
 * сбой = копия каталога, обрезанная в случайном месте.
 * всё, что прошло commit, должно читаться
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "fsutil.h"
#include "kusok/kusok.h"
#include "tt.h"

static void copy_file(const char *from, const char *to, long long limit)
{
	int a = open(from, O_RDONLY);
	if (a < 0)
		return;
	int b = open(to, O_CREAT | O_TRUNC | O_WRONLY, 0644);
	uint8_t buf[65536];
	long long kol = 0;
	ssize_t r;
	while ((r = read(a, buf, sizeof(buf))) > 0) {
		if (limit >= 0 && kol + r > limit)
			r = (ssize_t)(limit - kol);
		if (r <= 0)
			break;
		tt_write(b, buf, (size_t)r);
		kol += r;
	}
	close(a);
	close(b);
}

/* копия, -1 = не обрезать */
static void snapshot(const char *src, const char *dst, long long pack_len,
		     long long log_len)
{
	char a[4200], b[4200];
	mkdir(dst, 0755);
	snprintf(b, sizeof(b), "%s/packs", dst);
	mkdir(b, 0755);
	const char *names[] = {"FORMAT", "refs.snap"};
	for (int i = 0; i < 2; i++) {
		snprintf(a, sizeof(a), "%s/%s", src, names[i]);
		snprintf(b, sizeof(b), "%s/%s", dst, names[i]);
		copy_file(a, b, -1);
	}
	snprintf(a, sizeof(a), "%s/refs.log", src);
	snprintf(b, sizeof(b), "%s/refs.log", dst);
	copy_file(a, b, log_len);
	snprintf(a, sizeof(a), "%s/packs/00000001.pack", src);
	snprintf(b, sizeof(b), "%s/packs/00000001.pack", dst);
	copy_file(a, b, pack_len);
}

static long long fsize(const char *dir, const char *name)
{
	char p[4200];
	struct stat st;
	snprintf(p, sizeof(p), "%s/%s", dir, name);
	return stat(p, &st) ? -1 : (long long)st.st_size;
}

TT_TEST(crash_during_put_at_every_point)
{
	char *dir = tt_tmpdir();
	char src[4200];
	snprintf(src, sizeof(src), "%s/src", dir);
	kusok_opts o = tt_opts();
	o.pack_limit = 1u << 30; /* всё в одном pack — так проще резать */
	kusok *ks = tt_open_with(src, &o);
	enum { N = 60000 };
	uint8_t *a = malloc(N), *b = malloc(N), *c = malloc(N);
	tt_fill_text(a, N, 1);
	tt_fill(b, N, 2);
	tt_fill_text(c, N, 3);
	kusok_id ia = tt_put(ks, a, N);
	kusok_id ib = tt_put(ks, b, N);
	long long pack_ok = fsize(src, "packs/00000001.pack");
	long long log_ok = fsize(src, "refs.log");
	kusok_id ic = tt_put(ks, c, N);
	long long pack_end = fsize(src, "packs/00000001.pack");
	long long log_end = fsize(src, "refs.log");
	TT_CHECK(pack_end > pack_ok && log_end > log_ok);

	/* обрыв в каждой ~97-й позиции записи файла c */
	size_t prov = 0, bad = 0;
	for (long long cut = pack_ok; cut <= pack_end; cut += 97) {
		char dst[4200];
		snprintf(dst, sizeof(dst), "%s/crash-%lld", dir, cut);
		long long log = cut == pack_end ? log_end : log_ok;
		snapshot(src, dst, cut, log);
		kusok *k2;
		kusok_opts o2 = o;
		if (kusok_open(dst, &o2, &k2)) {
			bad++;
			continue;
		}
		bad += !tt_same(k2, &ia, a, N);
		bad += !tt_same(k2, &ib, b, N);
		uint64_t size;
		int rc = kusok_size(k2, &ic, &size);
		if (cut == pack_end)
			bad += !tt_same(k2, &ic, c, N);
		else
			bad += rc != KUSOK_ENOTFOUND;
		kusok_fsck_report f;
		kusok_fsck(k2, &f);
		bad += f.bad_records + f.broken_files + f.missing_manifests;
		/* и в такое хранилище можно писать дальше */
		kusok_id ix = tt_put(k2, c, N);
		bad += !tt_same(k2, &ix, c, N);
		kusok_close(k2);
		tt_rmdir(dst);
		prov++;
	}
	printf("    проверено точек обрыва: %zu\n", prov);
	TT_EQU(bad, 0);
	kusok_close(ks);
	free(a);
	free(b);
	free(c);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(crash_with_torn_journal)
{
	char *dir = tt_tmpdir();
	char src[4200], dst[4200];
	snprintf(src, sizeof(src), "%s/src", dir);
	snprintf(dst, sizeof(dst), "%s/dst", dir);
	kusok *ks = tt_open(src);
	kusok_id ia = tt_put(ks, "first", 5);
	for (int i = 0; i < 5; i++)
		kusok_ref(ks, &ia);
	long long log = fsize(src, "refs.log");
	/* полторы последние записи пропали */
	char a[8400], b[8400];
	snapshot(src, dst, -1, log - 48 - 20);
	/* остальные pack тоже нужны */
	for (uint32_t id = 2; id < 10; id++) {
		snprintf(a, sizeof(a), "%s/packs/%08u.pack", src, id);
		snprintf(b, sizeof(b), "%s/packs/%08u.pack", dst, id);
		copy_file(a, b, -1);
	}
	kusok *k2 = tt_open(dst);
	int64_t r;
	TT_OK(kusok_refs(k2, &ia, &r));
	TT_EQ(r, 4); /* 1 + 5 - потерянная последняя */
	kusok_close(k2);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(garbage_after_last_record)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok_id ia = tt_put(ks, "payload", 7);
	kusok_close(ks);
	char p[4200];
	snprintf(p, sizeof(p), "%s/packs/00000001.pack", dir);
	int fd = open(p, O_WRONLY | O_APPEND);
	uint8_t junk[333];
	tt_fill(junk, sizeof(junk), 5);
	tt_write(fd, junk, sizeof(junk));
	close(fd);
	long long before = fsize(dir, "packs/00000001.pack");
	ks = tt_open(dir);
	TT_CHECK(tt_same(ks, &ia, "payload", 7));
	/* файл не обрезан (вдруг это порча, а не обрыв), пишем в новый pack */
	TT_CHECK(fsize(dir, "packs/00000001.pack") == before);
	kusok_id ib = tt_put(ks, "next", 4);
	TT_CHECK(fsize(dir, "packs/00000002.pack") > 0);
	kusok_fsck_report f;
	TT_OK(kusok_fsck(ks, &f));
	TT_EQU(f.tail_bytes, 333);
	TT_EQU(f.broken_files + f.missing_manifests, 0);
	/* хвост — мусор, сборка его уберёт */
	TT_OK(kusok_gc(ks, 0, NULL));
	TT_OK(kusok_fsck(ks, &f));
	TT_EQU(f.tail_bytes, 0);
	TT_CHECK(tt_same(ks, &ia, "payload", 7));
	TT_CHECK(tt_same(ks, &ib, "next", 4));
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(torn_pack_creation)
{
	/* упали сразу после создания следующего pack: в нём 10 байт */
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok_id ia = tt_put(ks, "x", 1);
	kusok_close(ks);
	char p[4200];
	snprintf(p, sizeof(p), "%s/packs/00000002.pack", dir);
	int fd = open(p, O_CREAT | O_WRONLY, 0644);
	tt_write(fd, "KUSOKPK1\0\0", 10);
	close(fd);
	ks = tt_open(dir);
	TT_CHECK(tt_same(ks, &ia, "x", 1));
	kusok_id ib = tt_put(ks, "y", 1);
	ks = tt_reopen(ks, dir);
	TT_CHECK(tt_same(ks, &ib, "y", 1));
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(damaged_sealed_pack)
{
	/* порча в середине: без salvage отказ */
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 200000 };
	uint8_t *a = malloc(N);
	tt_fill(a, N, 6);
	kusok_id ia = tt_put(ks, a, N);
	kusok_id ib = tt_put(ks, "small file", 10);
	kusok_close(ks);
	char p[4200];
	snprintf(p, sizeof(p), "%s/packs/00000001.pack", dir);
	int fd = open(p, O_RDWR);
	uint8_t big = 0x7F; /* старший байт slen первой записи */
	tt_pwrite(fd, &big, 1, 24 + 11);
	close(fd);
	kusok_opts o = tt_opts();
	/* с индексом открытие не читает pack — порчу видят чтение и fsck */
	TT_OK(kusok_open(dir, &o, &ks));
	uint8_t b0[16];
	size_t g0;
	TT_EQ(kusok_read(ks, &ia, 0, b0, 16, &g0), KUSOK_ECORRUPT);
	TT_CHECK(tt_same(ks, &ib, "small file", 10));
	kusok_fsck_report f0;
	TT_OK(kusok_fsck(ks, &f0));
	TT_CHECK(f0.broken_files == 1 && f0.bad_records >= 1);
	kusok_close(ks);
	/* без индекса — обход, и он отказывает */
	snprintf(p, sizeof(p), "%s/packs/00000001.idx", dir);
	TT_EQ(unlink(p), 0);
	TT_EQ(kusok_open(dir, &o, &ks), KUSOK_ECORRUPT);
	o.salvage = 1;
	o.read_only = 1;
	TT_OK(kusok_open(dir, &o, &ks));
	TT_CHECK(tt_same(ks, &ib, "small file", 10)); /* он в другом pack */
	uint8_t buf[16];
	size_t got;
	TT_EQ(kusok_read(ks, &ia, 0, buf, 16, &got), KUSOK_ECORRUPT);
	kusok_fsck_report f;
	TT_OK(kusok_fsck(ks, &f));
	TT_CHECK(f.broken_files == 1 && f.bad_records >= 1);
	kusok_close(ks);
	free(a);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(reopen_many_times)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok_id ids[30];
	char s[30][32];
	for (int i = 0; i < 30; i++) {
		snprintf(s[i], 32, "file-%d-%d", i, i * i);
		ids[i] = tt_put(ks, s[i], strlen(s[i]));
		ks = tt_reopen(ks, dir);
	}
	size_t bad = 0;
	for (int i = 0; i < 30; i++)
		bad += !tt_same(ks, &ids[i], s[i], strlen(s[i]));
	TT_EQU(bad, 0);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(crash_during_put_at_every_point);
	TT_RUN(crash_with_torn_journal);
	TT_RUN(garbage_after_last_record);
	TT_RUN(torn_pack_creation);
	TT_RUN(damaged_sealed_pack);
	TT_RUN(reopen_many_times);
	return tt_done();
}
