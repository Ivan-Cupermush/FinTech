/*
 * fsck находит то, что сломали руками
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "journal.h"
#include "kusok/kusok.h"
#include "tt.h"

static void problem_count(kusok *ks, kusok_fsck_report *f)
{
	TT_OK(kusok_fsck(ks, f));
}

TT_TEST(clean_store)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 100000 };
	uint8_t *a = malloc(N);
	tt_fill_text(a, N, 1);
	tt_put(ks, a, N);
	tt_put(ks, "", 0);
	kusok_fsck_report f;
	problem_count(ks, &f);
	TT_EQU(f.files, 2);
	TT_CHECK(f.records > 10);
	TT_EQU(f.bad_records + f.broken_files + f.missing_manifests, 0);
	kusok_close(ks);
	free(a);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(flipped_byte_in_chunk)
{
	char *dir = tt_tmpdir();
	kusok_opts o = tt_opts();
	o.pack_limit = 1u << 30;
	kusok *ks = tt_open_with(dir, &o);
	enum { N = 50000 };
	uint8_t *a = malloc(N), *b = malloc(N);
	tt_fill(a, N, 2);
	tt_fill(b, N, 3);
	kusok_id ia = tt_put(ks, a, N);
	kusok_id ib = tt_put(ks, b, N);
	kusok_close(ks);
	/* портим байт где-то в середине данных файла a */
	char p[4200];
	snprintf(p, sizeof(p), "%s/packs/00000001.pack", dir);
	int fd = open(p, O_RDWR);
	uint8_t x;
	tt_pread(fd, &x, 1, 24 + 48 + 1000);
	x ^= 0x01;
	tt_pwrite(fd, &x, 1, 24 + 48 + 1000);
	close(fd);
	ks = tt_open_with(dir, &o);
	kusok_fsck_report f;
	problem_count(ks, &f);
	TT_EQU(f.bad_records, 1);
	TT_EQU(f.broken_files, 1);
	/* испорченный файл не читается, соседний — читается */
	uint8_t buf[100];
	size_t got;
	TT_EQ(kusok_read(ks, &ia, 0, buf, sizeof(buf), &got), KUSOK_ECORRUPT);
	TT_CHECK(tt_same(ks, &ib, b, N));
	kusok_close(ks);
	free(a);
	free(b);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(missing_pack_file)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 200000 };
	uint8_t *a = malloc(N);
	tt_fill(a, N, 4);
	kusok_id ia = tt_put(ks, a, N);
	kusok_id ib = tt_put(ks, "kept", 4);
	kusok_close(ks);
	char p[4200];
	snprintf(p, sizeof(p), "%s/packs/00000002.pack", dir);
	TT_EQ(unlink(p), 0);
	ks = tt_open(dir);
	kusok_fsck_report f;
	problem_count(ks, &f);
	TT_EQU(f.broken_files, 1);
	TT_CHECK(tt_same(ks, &ib, "kept", 4));
	uint64_t size;
	TT_OK(kusok_size(ks, &ia, &size)); /* манифест цел, размер известен */
	TT_EQU(size, N);
	kusok_close(ks);
	free(a);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(reference_without_manifest)
{
	/* ссылка на файл, которого нет */
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	tt_put(ks, "a", 1);
	kusok_close(ks);
	/* дописываем в журнал запись +1 для несуществующего id */
	char p[4200];
	snprintf(p, sizeof(p), "%s", dir);
	int dfd = open(p, O_RDONLY | O_DIRECTORY);
	ks_tab t;
	ks_journal j;
	ks_tab_init(&t, sizeof(ks_ref), 0);
	TT_OK(ks_journal_open(dfd, 1, &t, &j));
	uint8_t ghost[32];
	memset(ghost, 0xEE, 32);
	TT_OK(ks_journal_add(&j, ghost, KS_JR_INC));
	ks_journal_close(&j);
	ks_tab_free(&t);
	close(dfd);
	ks = tt_open(dir);
	kusok_fsck_report f;
	problem_count(ks, &f);
	TT_EQU(f.missing_manifests, 1);
	TT_EQU(f.files, 1);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(clean_store);
	TT_RUN(flipped_byte_in_chunk);
	TT_RUN(missing_pack_file);
	TT_RUN(reference_without_manifest);
	return tt_done();
}
