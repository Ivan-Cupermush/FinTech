/*
 * сборка мусора
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "fsutil.h"
#include "kusok/kusok.h"
#include "tt.h"

TT_TEST(frees_space)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 400000 };
	uint8_t *a = malloc(N), *b = malloc(N);
	tt_fill(a, N, 1);
	tt_fill(b, N, 2);
	kusok_id ia = tt_put(ks, a, N);
	kusok_id ib = tt_put(ks, b, N);
	TT_OK(kusok_unref(ks, &ia));
	kusok_gc_report r;
	TT_OK(kusok_gc(ks, 0.2, &r));
	printf("    pack переписано %u, байт %llu -> %llu\n", r.packs_rewritten,
	       (unsigned long long)r.bytes_before,
	       (unsigned long long)r.bytes_after);
	TT_CHECK(r.packs_rewritten > 0);
	TT_CHECK(r.bytes_after < r.bytes_before * 6 / 10);
	TT_CHECK(tt_same(ks, &ib, b, N));
	kusok_fsck_report f;
	TT_OK(kusok_fsck(ks, &f));
	TT_EQU(f.bad_records + f.broken_files + f.missing_manifests, 0);
	ks = tt_reopen(ks, dir);
	TT_CHECK(tt_same(ks, &ib, b, N));
	kusok_close(ks);
	free(a);
	free(b);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(shared_chunks_survive)
{
	/* b = a с правкой, удаляем a */
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 300000 };
	uint8_t *a = malloc(N), *b = malloc(N);
	tt_fill_text(a, N, 3);
	memcpy(b, a, N);
	memcpy(b + N / 3, "!!! changed !!!", 15);
	kusok_id ia = tt_put(ks, a, N);
	kusok_id ib = tt_put(ks, b, N);
	kusok_unref(ks, &ia);
	kusok_gc_report r;
	TT_OK(kusok_gc(ks, 0, &r));
	TT_CHECK(tt_same(ks, &ib, b, N));
	uint64_t size;
	TT_EQ(kusok_size(ks, &ia, &size), KUSOK_ENOTFOUND);
	/* выброшены только куски, которых нет в b, и манифест a */
	TT_CHECK(r.records_dropped >= 2 && r.records_dropped < 10);
	kusok_close(ks);
	free(a);
	free(b);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(threshold_respected)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 200000 };
	uint8_t *a = malloc(N);
	tt_fill(a, N, 4);
	tt_put(ks, a, N);
	kusok_id small = tt_put(ks, "tiny", 4);
	kusok_unref(ks, &small);
	kusok_gc_report r;
	/* мусора — 4 байта и манифест, порог 0.5 — ничего не трогаем */
	TT_OK(kusok_gc(ks, 0.5, &r));
	TT_EQU(r.packs_rewritten, 0);
	TT_EQU(r.records_dropped, 0);
	/* порог 0 — подбираем и это */
	TT_OK(kusok_gc(ks, 0, &r));
	TT_EQU(r.packs_rewritten, 1);
	TT_EQ(kusok_gc(ks, 1.5, &r), KUSOK_EINVAL);
	TT_EQ(kusok_gc(ks, -0.1, &r), KUSOK_EINVAL);
	kusok_close(ks);
	free(a);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(nothing_to_do)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	tt_put(ks, "live", 4);
	kusok_gc_report r;
	TT_OK(kusok_gc(ks, 0, &r));
	TT_EQU(r.packs_rewritten, 0);
	TT_EQU(r.bytes_before, r.bytes_after);
	TT_OK(kusok_gc(ks, 0, &r)); /* и повторно — тоже ничего */
	TT_EQU(r.packs_rewritten, 0);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(dedup_after_gc)
{
	/* после переезда дедупликация работает */
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 150000 };
	uint8_t *a = malloc(N), *junk = malloc(N);
	tt_fill(a, N, 5);
	tt_fill(junk, N, 6);
	kusok_id ij = tt_put(ks, junk, N);
	tt_put(ks, a, N);
	kusok_unref(ks, &ij);
	TT_OK(kusok_gc(ks, 0, NULL));
	tt_put(ks, a, N);
	TT_EQU(kusok_last_put_new_bytes(ks), 0);
	kusok_close(ks);
	free(a);
	free(junk);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(crash_between_copy_and_delete)
{
	/* вернём удалённые pack — будут две копии */
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 200000 };
	uint8_t *a = malloc(N), *b = malloc(N);
	tt_fill(a, N, 7);
	tt_fill_text(b, N, 8);
	kusok_id ia = tt_put(ks, a, N);
	kusok_id ib = tt_put(ks, b, N);
	kusok_unref(ks, &ia);
	kusok_close(ks);

	char packs[4200];
	snprintf(packs, sizeof(packs), "%s/packs", dir);
	int pfd = open(packs, O_RDONLY | O_DIRECTORY);
	/* запоминаем все pack до сборки */
	uint8_t *saved[64];
	size_t sizes[64];
	char names[64][32];
	int kol = 0;
	for (uint32_t id = 1; id < 64; id++) {
		snprintf(names[kol], 32, "%08u.pack", id);
		if (ks_read_file(pfd, names[kol], &saved[kol], &sizes[kol]) ==
		    0)
			kol++;
	}
	ks = tt_open(dir);
	TT_OK(kusok_gc(ks, 0, NULL));
	kusok_close(ks);
	/* «воскрешаем» удалённые */
	for (int i = 0; i < kol; i++) {
		int fd =
		    openat(pfd, names[i], O_CREAT | O_EXCL | O_WRONLY, 0644);
		if (fd >= 0) {
			tt_write(fd, saved[i], sizes[i]);
			close(fd);
		}
		free(saved[i]);
	}
	close(pfd);
	ks = tt_open(dir);
	TT_CHECK(tt_same(ks, &ib, b, N));
	kusok_fsck_report f;
	TT_OK(kusok_fsck(ks, &f));
	TT_EQU(f.broken_files, 0);
	/* следующая сборка убирает дубликаты */
	kusok_stat s1, s2;
	kusok_stat_get(ks, &s1);
	TT_OK(kusok_gc(ks, 0, NULL));
	kusok_stat_get(ks, &s2);
	TT_CHECK(s2.stored_bytes < s1.stored_bytes);
	TT_CHECK(tt_same(ks, &ib, b, N));
	kusok_close(ks);
	free(a);
	free(b);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(everything_dead)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 300000 };
	uint8_t *a = malloc(N);
	tt_fill(a, N, 9);
	kusok_id ia = tt_put(ks, a, N);
	kusok_unref(ks, &ia);
	TT_OK(kusok_gc(ks, 0, NULL));
	kusok_stat st;
	kusok_stat_get(ks, &st);
	TT_EQU(st.files, 0);
	TT_EQU(st.chunks, 0);
	TT_CHECK(st.stored_bytes < 1024); /* остался пустой активный pack */
	/* и хранилище после этого работает как новое */
	kusok_id ib = tt_put(ks, a, 1000);
	ks = tt_reopen(ks, dir);
	TT_CHECK(tt_same(ks, &ib, a, 1000));
	kusok_close(ks);
	free(a);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(frees_space);
	TT_RUN(shared_chunks_survive);
	TT_RUN(threshold_respected);
	TT_RUN(nothing_to_do);
	TT_RUN(dedup_after_gc);
	TT_RUN(crash_between_copy_and_delete);
	TT_RUN(everything_dead);
	return tt_done();
}
