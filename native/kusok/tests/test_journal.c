/*
 * журнал ссылок
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
#include "journal.h"
#include "kusok/kusok.h"
#include "tt.h"

static void id_of(int i, uint8_t id[32])
{
	memset(id, 0, 32);
	id[0] = (uint8_t)i;
	id[31] = 0xAB;
}

static int64_t refs_of(ks_tab *t, int i)
{
	uint8_t id[32];
	id_of(i, id);
	ks_ref *r = ks_tab_get(t, id);
	return r ? r->refs : 0;
}

static void reopen(int dfd, ks_tab *t, ks_journal *j)
{
	ks_journal_close(j);
	ks_tab_free(t);
	ks_tab_init(t, sizeof(ks_ref), 0);
	TT_OK(ks_journal_open(dfd, 1, t, j));
}

static off_t fsize(int dfd, const char *name)
{
	struct stat st;
	if (fstatat(dfd, name, &st, 0))
		return -1;
	return st.st_size;
}

TT_TEST(replay)
{
	char *dir = tt_tmpdir();
	int dfd = open(dir, O_RDONLY | O_DIRECTORY);
	ks_tab t;
	ks_journal j;
	ks_tab_init(&t, sizeof(ks_ref), 0);
	TT_OK(ks_journal_open(dfd, 1, &t, &j));
	uint8_t a[32], b[32];
	id_of(1, a);
	id_of(2, b);
	for (int i = 0; i < 5; i++)
		TT_OK(ks_journal_add(&j, a, KS_JR_INC));
	TT_OK(ks_journal_add(&j, a, KS_JR_DEC));
	TT_OK(ks_journal_add(&j, b, KS_JR_INC));
	TT_OK(ks_journal_sync(&j));
	TT_EQU(j.seq, 7);
	TT_EQ(ks_journal_add(&j, a, 9), KUSOK_EINVAL);
	reopen(dfd, &t, &j);
	TT_EQ(refs_of(&t, 1), 4);
	TT_EQ(refs_of(&t, 2), 1);
	TT_EQU(j.seq, 7);
	TT_EQU(j.torn, 0);
	ks_journal_close(&j);
	ks_tab_free(&t);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(checkpoint_truncates)
{
	char *dir = tt_tmpdir();
	int dfd = open(dir, O_RDONLY | O_DIRECTORY);
	ks_tab t;
	ks_journal j;
	ks_tab_init(&t, sizeof(ks_ref), 0);
	TT_OK(ks_journal_open(dfd, 1, &t, &j));
	uint8_t a[32];
	for (int i = 0; i < 30; i++) {
		id_of(i, a);
		ks_journal_add(&j, a, KS_JR_INC);
		ks_refs_apply(&t, a, 1);
	}
	id_of(3, a);
	ks_journal_add(&j, a, KS_JR_DEC);
	ks_refs_apply(&t, a, -1);
	TT_OK(ks_journal_checkpoint(&j, &t));
	TT_EQ(fsize(dfd, "refs.log"), 0);
	/* в снимок попали 29 ненулевых */
	TT_EQ(fsize(dfd, "refs.snap"), KS_SNAP_HDR + 29 * KS_SNAP_ENT + 4);
	/* после снимка — ещё изменения в журнал */
	id_of(5, a);
	ks_journal_add(&j, a, KS_JR_INC);
	reopen(dfd, &t, &j);
	TT_EQ(refs_of(&t, 5), 2);
	TT_EQ(refs_of(&t, 3), 0);
	TT_EQ(refs_of(&t, 29), 1);
	TT_EQU(j.seq, 32);
	ks_journal_close(&j);
	ks_tab_free(&t);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(crash_between_snapshot_and_truncate)
{
	/* как будто упали до ftruncate */
	char *dir = tt_tmpdir();
	int dfd = open(dir, O_RDONLY | O_DIRECTORY);
	ks_tab t;
	ks_journal j;
	ks_tab_init(&t, sizeof(ks_ref), 0);
	TT_OK(ks_journal_open(dfd, 1, &t, &j));
	uint8_t a[32];
	id_of(7, a);
	for (int i = 0; i < 3; i++) {
		ks_journal_add(&j, a, KS_JR_INC);
		ks_refs_apply(&t, a, 1);
	}
	uint8_t *old;
	size_t oldn;
	TT_OK(ks_read_file(dfd, "refs.log", &old, &oldn));
	TT_OK(ks_journal_checkpoint(&j, &t));
	ks_journal_close(&j);
	int fd = openat(dfd, "refs.log", O_WRONLY | O_TRUNC);
	tt_write(fd, old, oldn);
	close(fd);
	free(old);
	reopen(dfd, &t, &j);
	TT_EQ(refs_of(&t, 7), 3); /* не 6 */
	/* и новые записи после такого открытия продолжают счёт */
	ks_journal_add(&j, a, KS_JR_INC);
	reopen(dfd, &t, &j);
	TT_EQ(refs_of(&t, 7), 4);
	ks_journal_close(&j);
	ks_tab_free(&t);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(torn_tail)
{
	char *dir = tt_tmpdir();
	int dfd = open(dir, O_RDONLY | O_DIRECTORY);
	ks_tab t;
	ks_journal j;
	ks_tab_init(&t, sizeof(ks_ref), 0);
	TT_OK(ks_journal_open(dfd, 1, &t, &j));
	uint8_t a[32];
	id_of(1, a);
	for (int i = 0; i < 4; i++)
		ks_journal_add(&j, a, KS_JR_INC);
	/* обрываем последнюю запись на середине */
	TT_OK(ftruncate(j.fd, 3 * KS_JR_REC + 20) ? KUSOK_EIO : 0);
	reopen(dfd, &t, &j);
	TT_EQ(refs_of(&t, 1), 3);
	TT_EQU(j.torn, 20);
	TT_EQ(fsize(dfd, "refs.log"), 3 * KS_JR_REC); /* хвост отрезан */
	ks_journal_add(&j, a, KS_JR_INC);
	reopen(dfd, &t, &j);
	TT_EQ(refs_of(&t, 1), 4);
	ks_journal_close(&j);
	ks_tab_free(&t);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(corrupt_record_stops_replay)
{
	char *dir = tt_tmpdir();
	int dfd = open(dir, O_RDONLY | O_DIRECTORY);
	ks_tab t;
	ks_journal j;
	ks_tab_init(&t, sizeof(ks_ref), 0);
	TT_OK(ks_journal_open(dfd, 1, &t, &j));
	uint8_t a[32];
	id_of(1, a);
	for (int i = 0; i < 5; i++)
		ks_journal_add(&j, a, KS_JR_INC);
	uint8_t x = 0xFF;
	tt_pwrite(j.fd, &x, 1, 2 * KS_JR_REC + 30); /* портим третью */
	reopen(dfd, &t, &j);
	TT_EQ(refs_of(&t, 1), 2);
	ks_journal_close(&j);
	ks_tab_free(&t);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(corrupt_snapshot)
{
	char *dir = tt_tmpdir();
	int dfd = open(dir, O_RDONLY | O_DIRECTORY);
	ks_tab t;
	ks_journal j;
	ks_tab_init(&t, sizeof(ks_ref), 0);
	TT_OK(ks_journal_open(dfd, 1, &t, &j));
	uint8_t a[32];
	id_of(1, a);
	ks_journal_add(&j, a, KS_JR_INC);
	ks_refs_apply(&t, a, 1);
	TT_OK(ks_journal_checkpoint(&j, &t));
	ks_journal_close(&j);
	int fd = openat(dfd, "refs.snap", O_WRONLY);
	tt_pwrite(fd, "Z", 1, KS_SNAP_HDR + 3);
	close(fd);
	ks_tab_free(&t);
	ks_tab_init(&t, sizeof(ks_ref), 0);
	/* снимок молча не игнорируем: потеря счётчиков = потеря файлов */
	TT_EQ(ks_journal_open(dfd, 1, &t, &j), KUSOK_ECORRUPT);
	ks_journal_close(&j);
	ks_tab_free(&t);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(read_only_without_log)
{
	char *dir = tt_tmpdir();
	int dfd = open(dir, O_RDONLY | O_DIRECTORY);
	ks_tab t;
	ks_journal j;
	ks_tab_init(&t, sizeof(ks_ref), 0);
	TT_OK(ks_journal_open(dfd, 0, &t, &j));
	uint8_t a[32] = {0};
	TT_EQ(ks_journal_add(&j, a, KS_JR_INC), KUSOK_ERDONLY);
	TT_EQ(ks_journal_checkpoint(&j, &t), KUSOK_ERDONLY);
	ks_journal_close(&j);
	ks_tab_free(&t);
	close(dfd);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(replay);
	TT_RUN(checkpoint_truncates);
	TT_RUN(crash_between_snapshot_and_truncate);
	TT_RUN(torn_tail);
	TT_RUN(corrupt_record_stops_replay);
	TT_RUN(corrupt_snapshot);
	TT_RUN(read_only_without_log);
	return tt_done();
}
