/*
 * pack-файл
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "bytes.h"
#include "kusok/kusok.h"
#include "pack.h"
#include "sha256.h"
#include "tt.h"

static int dir_open(const char *p)
{
	return open(p, O_RDONLY | O_DIRECTORY);
}

static ks_rec rec_of(uint8_t type, const uint8_t *d, uint32_t n)
{
	ks_rec r = {.type = type, .codec = KS_CODEC_RAW, .slen = n, .rlen = n};
	ks_sha256_buf(d, n, r.id);
	return r;
}

static int count(const ks_rec *r, uint64_t off, void *ctx)
{
	(void)r;
	(void)off;
	(*(int *)ctx)++;
	return 0;
}

TT_TEST(names)
{
	char name[32];
	uint32_t id;
	ks_pack_name(42, name);
	TT_CHECK(strcmp(name, "00000042.pack") == 0);
	TT_OK(ks_pack_parse_name(name, &id));
	TT_EQU(id, 42);
	TT_CHECK(ks_pack_parse_name("42.pack", &id) != 0);
	TT_CHECK(ks_pack_parse_name("00000042.pack.tmp", &id) != 0);
	TT_CHECK(ks_pack_parse_name("0000004x.pack", &id) != 0);
	TT_CHECK(ks_pack_parse_name("LOCK", &id) != 0);
}

TT_TEST(rec_sanity)
{
	ks_rec r = {
	    .type = KS_REC_CHUNK, .codec = KS_CODEC_RAW, .slen = 5, .rlen = 5};
	TT_CHECK(ks_rec_sane(&r));
	r.type = 9;
	TT_CHECK(!ks_rec_sane(&r));
	r.type = KS_REC_CHUNK;
	r.rlen = 6; /* без сжатия длины обязаны совпадать */
	TT_CHECK(!ks_rec_sane(&r));
	r.codec = KS_CODEC_LZ;
	TT_CHECK(ks_rec_sane(&r));
	r.rlen = 5 * 255 + 17; /* lz4 так не раздувает */
	TT_CHECK(!ks_rec_sane(&r));
	r.codec = 7;
	TT_CHECK(!ks_rec_sane(&r));
}

TT_TEST(append_read_scan)
{
	char *dir = tt_tmpdir();
	int dfd = dir_open(dir);
	ks_pack p;
	TT_OK(ks_pack_create(dfd, 1, &p));
	TT_EQU(p.len, KS_PACK_HDR);
	uint8_t d[10][1000];
	uint64_t offs[10];
	for (int i = 0; i < 10; i++) {
		tt_fill(d[i], 100 * (size_t)(i + 1), (uint64_t)i);
		ks_rec r = rec_of(KS_REC_CHUNK, d[i], 100 * (uint32_t)(i + 1));
		TT_OK(ks_pack_append(&p, &r, d[i], &offs[i]));
	}
	for (int i = 9; i >= 0; i--) {
		ks_rec r;
		uint8_t buf[1000];
		TT_OK(ks_pack_read(&p, offs[i], &r, buf, sizeof(buf)));
		TT_EQU(r.slen, 100 * (uint32_t)(i + 1));
		TT_MEMEQ(buf, d[i], r.slen);
	}
	ks_pack_close(&p);
	/* открыть заново: длина та же, проход видит все 10 */
	TT_OK(ks_pack_open(dfd, 1, 0, &p));
	int kol = 0;
	uint64_t good;
	TT_OK(ks_pack_scan(&p, 1, count, &kol, &good, NULL));
	TT_EQ(kol, 10);
	TT_EQU(good, p.len);
	ks_pack_close(&p);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(torn_tail_every_byte)
{
	/* режем последнюю запись на каждой длине */
	char *dir = tt_tmpdir();
	int dfd = dir_open(dir);
	ks_pack p;
	TT_OK(ks_pack_create(dfd, 3, &p));
	uint8_t a[300], b[200];
	tt_fill(a, sizeof(a), 1);
	tt_fill(b, sizeof(b), 2);
	uint64_t off_a, off_b;
	ks_rec ra = rec_of(KS_REC_CHUNK, a, sizeof(a));
	ks_rec rb = rec_of(KS_REC_MANIFEST, b, sizeof(b));
	ks_pack_append(&p, &ra, a, &off_a);
	ks_pack_append(&p, &rb, b, &off_b);
	uint64_t full = p.len;
	size_t bad = 0;
	for (uint64_t len = off_b; len < full; len++) {
		p.len = len; /* как будто файл такой длины */
		int kol = 0;
		uint64_t good;
		TT_OK(ks_pack_scan(&p, 1, count, &kol, &good, NULL));
		bad += kol != 1 || good != off_b;
		/* и без проверки CRC заголовок не выходит за конец */
		kol = 0;
		TT_OK(ks_pack_scan(&p, 0, count, &kol, &good, NULL));
		bad += kol != 1;
	}
	TT_EQU(bad, 0);
	ks_pack_close(&p);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(bit_flip_detected)
{
	char *dir = tt_tmpdir();
	int dfd = dir_open(dir);
	ks_pack p;
	TT_OK(ks_pack_create(dfd, 1, &p));
	uint8_t a[500], buf[500];
	tt_fill(a, sizeof(a), 3);
	ks_rec r = rec_of(KS_REC_CHUNK, a, sizeof(a));
	uint64_t off;
	ks_pack_append(&p, &r, a, &off);
	/* переворачиваем по одному биту в каждом байте записи */
	size_t ne_zametili = 0;
	for (uint64_t pos = off; pos < p.len; pos++) {
		uint8_t c;
		tt_pread(p.fd, &c, 1, (off_t)pos);
		uint8_t x = c ^ 0x10;
		tt_pwrite(p.fd, &x, 1, (off_t)pos);
		ks_rec got;
		ne_zametili +=
		    ks_pack_read(&p, off, &got, buf, sizeof(buf)) == KUSOK_OK;
		tt_pwrite(p.fd, &c, 1, (off_t)pos);
	}
	TT_EQU(ne_zametili, 0);
	ks_rec got;
	TT_OK(ks_pack_read(&p, off, &got, buf, sizeof(buf)));
	ks_pack_close(&p);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(header_checks)
{
	char *dir = tt_tmpdir();
	int dfd = dir_open(dir);
	ks_pack p;
	TT_OK(ks_pack_create(dfd, 5, &p));
	ks_pack_close(&p);
	TT_EQ(ks_pack_create(dfd, 5, &p), KUSOK_EIO); /* уже есть */
	/* переименованный файл: id в заголовке не совпадёт с именем */
	renameat(dfd, "00000005.pack", dfd, "00000006.pack");
	TT_EQ(ks_pack_open(dfd, 6, 0, &p), KUSOK_ECORRUPT);
	renameat(dfd, "00000006.pack", dfd, "00000005.pack");
	TT_OK(ks_pack_open(dfd, 5, 1, &p));
	/* версия 2 — честно говорим «неизвестный формат» */
	uint8_t h[KS_PACK_HDR];
	tt_pread(p.fd, h, sizeof(h), 0);
	st32(h + 8, 2);
	tt_pwrite(p.fd, h, sizeof(h), 0);
	ks_pack_close(&p);
	TT_EQ(ks_pack_open(dfd, 5, 0, &p), KUSOK_EFORMAT);
	TT_EQ(ks_pack_open(dfd, 77, 0, &p), KUSOK_ENOTFOUND);
	/* файл короче заголовка */
	int fd = openat(dfd, "00000009.pack", O_CREAT | O_WRONLY, 0644);
	tt_write(fd, "KUSOK", 5);
	close(fd);
	TT_EQ(ks_pack_open(dfd, 9, 0, &p), KUSOK_ECORRUPT);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(read_rejects_bad_offsets)
{
	char *dir = tt_tmpdir();
	int dfd = dir_open(dir);
	ks_pack p;
	TT_OK(ks_pack_create(dfd, 1, &p));
	uint8_t a[64], buf[64];
	tt_fill(a, sizeof(a), 4);
	ks_rec r = rec_of(KS_REC_CHUNK, a, sizeof(a));
	uint64_t off;
	ks_pack_append(&p, &r, a, &off);
	ks_rec got;
	TT_EQ(ks_pack_read(&p, 0, &got, buf, sizeof(buf)), KUSOK_ECORRUPT);
	TT_EQ(ks_pack_read(&p, p.len, &got, buf, sizeof(buf)), KUSOK_ECORRUPT);
	TT_EQ(ks_pack_read(&p, off + 1, &got, buf, sizeof(buf)),
	      KUSOK_ECORRUPT);
	TT_EQ(ks_pack_read(&p, off, &got, buf, 10), KUSOK_ETOOBIG);
	ks_pack_close(&p);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(scan_skips_bad_payload)
{
	/* битые данные в середине: запись пропускается, следующие целы */
	char *dir = tt_tmpdir();
	int dfd = dir_open(dir);
	ks_pack p;
	TT_OK(ks_pack_create(dfd, 1, &p));
	uint8_t a[100];
	tt_fill(a, sizeof(a), 5);
	ks_rec r = rec_of(KS_REC_CHUNK, a, sizeof(a));
	uint64_t o1, o2, o3;
	ks_pack_append(&p, &r, a, &o1);
	ks_pack_append(&p, &r, a, &o2);
	ks_pack_append(&p, &r, a, &o3);
	uint8_t x = 0x77;
	tt_pwrite(p.fd, &x, 1, (long long)(o2 + KS_REC_HDR + 10));
	int kol = 0;
	uint64_t good, bad;
	TT_OK(ks_pack_scan(&p, 1, count, &kol, &good, &bad));
	TT_EQ(kol, 2);
	TT_EQU(bad, 1);
	TT_EQU(good, p.len);
	/* без проверки CRC порчу не видно — это работа fsck */
	kol = 0;
	TT_OK(ks_pack_scan(&p, 0, count, &kol, &good, &bad));
	TT_EQ(kol, 3);
	TT_EQU(bad, 0);
	ks_pack_close(&p);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(append_rejects_insane)
{
	char *dir = tt_tmpdir();
	int dfd = dir_open(dir);
	ks_pack p;
	TT_OK(ks_pack_create(dfd, 1, &p));
	ks_rec r = {.type = 0, .codec = 0, .slen = 1, .rlen = 1};
	uint64_t off;
	TT_EQ(ks_pack_append(&p, &r, "x", &off), KUSOK_EINVAL);
	TT_EQU(p.len, KS_PACK_HDR);
	ks_pack_close(&p);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(names);
	TT_RUN(rec_sanity);
	TT_RUN(append_read_scan);
	TT_RUN(torn_tail_every_byte);
	TT_RUN(bit_flip_detected);
	TT_RUN(header_checks);
	TT_RUN(read_rejects_bad_offsets);
	TT_RUN(scan_skips_bad_payload);
	TT_RUN(append_rejects_insane);
	return tt_done();
}
