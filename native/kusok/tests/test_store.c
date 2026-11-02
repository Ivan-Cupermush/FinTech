/*
 * хранилище целиком
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "kusok/kusok.h"
#include "sha256.h"
#include "tt.h"

TT_TEST(put_get_simple)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	const char *s = "привет, kusok";
	kusok_id id = tt_put(ks, s, strlen(s));
	/* id файла — это SHA-256 содержимого */
	uint8_t want[32];
	ks_sha256_buf(s, strlen(s), want);
	TT_MEMEQ(id.b, want, 32);
	TT_CHECK(tt_same(ks, &id, s, strlen(s)));
	int64_t refs;
	TT_OK(kusok_refs(ks, &id, &refs));
	TT_EQ(refs, 1);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(survives_reopen)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 300000 };
	uint8_t *d = malloc(N);
	tt_fill_text(d, N, 1);
	kusok_id id = tt_put(ks, d, N);
	ks = tt_reopen(ks, dir);
	TT_CHECK(tt_same(ks, &id, d, N));
	kusok_stat st;
	TT_OK(kusok_stat_get(ks, &st));
	TT_EQU(st.files, 1);
	TT_CHECK(st.packs > 1); /* pack_limit 64K — значит несколько */
	kusok_close(ks);
	free(d);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(same_file_twice_costs_nothing)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 200000 };
	uint8_t *d = malloc(N);
	tt_fill(d, N, 2);
	kusok_id a = tt_put(ks, d, N);
	TT_EQU(kusok_last_put_new_bytes(ks), N);
	kusok_stat before, after;
	kusok_stat_get(ks, &before);
	kusok_id b = tt_put(ks, d, N);
	TT_EQU(kusok_last_put_new_bytes(ks), 0);
	TT_MEMEQ(a.b, b.b, 32);
	kusok_stat_get(ks, &after);
	/* ничего не прибавилось */
	TT_EQU(after.stored_bytes, before.stored_bytes);
	TT_EQU(after.logical_bytes, 2 * (uint64_t)N);
	int64_t refs;
	kusok_refs(ks, &a, &refs);
	TT_EQ(refs, 2);
	kusok_close(ks);
	free(d);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(similar_files_share_chunks)
{
	/* «версия документа»: 300 KB, потом вставка в середину */
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 300000 };
	uint8_t *a = malloc(N), *b = malloc(N + 100);
	tt_fill_text(a, N, 3);
	memcpy(b, a, N / 2);
	memset(b + N / 2, '#', 100);
	memcpy(b + N / 2 + 100, a + N / 2, N - N / 2);
	tt_put(ks, a, N);
	kusok_id ib = tt_put(ks, b, N + 100);
	uint64_t nov = kusok_last_put_new_bytes(ks);
	printf("    вторая версия добавила %llu байт из %d\n",
	       (unsigned long long)nov, N + 100);
	TT_CHECK(nov < 12 * 1024); /* пара соседних кусков, а не весь файл */
	TT_CHECK(tt_same(ks, &ib, b, N + 100));
	kusok_close(ks);
	free(a);
	free(b);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(empty_file)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok_id id = tt_put(ks, "", 0);
	uint64_t size = 99;
	TT_OK(kusok_size(ks, &id, &size));
	TT_EQU(size, 0);
	ks = tt_reopen(ks, dir);
	TT_OK(kusok_size(ks, &id, &size));
	TT_EQU(size, 0);
	uint8_t buf[4];
	size_t got = 7;
	TT_OK(kusok_read(ks, &id, 0, buf, 4, &got));
	TT_EQU(got, 0);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(single_chunk_file_vs_chunk)
{
	/* id файла == id куска */
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	uint8_t d[200];
	tt_fill(d, sizeof(d), 4);
	kusok_id id = tt_put(ks, d, sizeof(d));
	TT_CHECK(tt_same(ks, &id, d, sizeof(d)));
	ks = tt_reopen(ks, dir);
	TT_CHECK(tt_same(ks, &id, d, sizeof(d)));
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(streaming_put)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 100000 };
	uint8_t *d = malloc(N);
	tt_fill_text(d, N, 5);
	kusok_put *p;
	TT_OK(kusok_put_begin(ks, &p));
	/* пока запись открыта — вторую не начать, gc нельзя */
	kusok_put *p2;
	TT_EQ(kusok_put_begin(ks, &p2), KUSOK_EBUSY);
	TT_EQ(kusok_gc(ks, 0.5, NULL), KUSOK_EBUSY);
	TT_EQ(kusok_checkpoint(ks), KUSOK_EBUSY);
	for (size_t i = 0; i < N; i += 333)
		TT_OK(kusok_put_write(p, d + i, i + 333 <= N ? 333 : N - i));
	kusok_id id;
	TT_OK(kusok_put_commit(p, &id));
	TT_CHECK(tt_same(ks, &id, d, N));
	TT_OK(kusok_put_begin(ks, &p2)); /* теперь можно */
	kusok_put_abort(p2);
	kusok_close(ks);
	free(d);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(abort_leaves_no_file)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { N = 300000 };
	uint8_t *d = malloc(N);
	tt_fill(d, N, 6);
	kusok_put *p;
	TT_OK(kusok_put_begin(ks, &p));
	TT_OK(kusok_put_write(p, d, N));
	kusok_put_abort(p);
	kusok_stat st;
	kusok_stat_get(ks, &st);
	TT_EQU(st.files, 0);
	TT_CHECK(st.chunks > 0); /* полные пачки легли, их соберёт gc */
	kusok_id id;
	ks_sha256_buf(d, N, id.b);
	free(d);
	uint64_t size;
	TT_EQ(kusok_size(ks, &id, &size), KUSOK_ENOTFOUND);
	kusok_gc_report r;
	TT_OK(kusok_gc(ks, 0, &r));
	kusok_stat_get(ks, &st);
	TT_EQU(st.chunks, 0);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(put_fd)
{
	char *dir = tt_tmpdir();
	char path[4200];
	snprintf(path, sizeof(path), "%s/input.bin", dir);
	enum { N = 3 * 1024 * 1024 + 17 }; /* больше буфера чтения в 1 MiB */
	uint8_t *d = malloc(N);
	tt_fill_text(d, N, 7);
	int fd = open(path, O_CREAT | O_WRONLY, 0644);
	TT_EQ(write(fd, d, N), N);
	close(fd);
	char sdir[4200];
	snprintf(sdir, sizeof(sdir), "%s/store", dir);
	kusok *ks = tt_open(sdir);
	fd = open(path, O_RDONLY);
	kusok_id id;
	TT_OK(kusok_put_fd(ks, fd, &id));
	close(fd);
	TT_CHECK(tt_same(ks, &id, d, N));
	/* get_fd обратно в файл */
	snprintf(path, sizeof(path), "%s/output.bin", dir);
	fd = open(path, O_CREAT | O_RDWR | O_TRUNC, 0644);
	TT_OK(kusok_get_fd(ks, &id, fd));
	uint8_t *back = malloc(N);
	TT_EQ(pread(fd, back, N, 0), N);
	TT_MEMEQ(back, d, N);
	close(fd);
	kusok_close(ks);
	free(d);
	free(back);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(lock_is_exclusive)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok *other = NULL;
	kusok_opts o = tt_opts();
	TT_EQ(kusok_open(dir, &o, &other), KUSOK_ELOCKED);
	o.read_only = 1;
	TT_EQ(kusok_open(dir, &o, &other), KUSOK_ELOCKED);
	kusok_close(ks);
	TT_OK(kusok_open(dir, &o, &other)); /* читатель */
	kusok *other2 = NULL;
	TT_OK(kusok_open(dir, &o, &other2)); /* и ещё один читатель */
	kusok_opts w = tt_opts();
	TT_EQ(kusok_open(dir, &w, &ks), KUSOK_ELOCKED); /* но не писатель */
	kusok_close(other);
	kusok_close(other2);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(read_only_mode)
{
	char *dir = tt_tmpdir();
	kusok_opts o = tt_opts();
	o.read_only = 1;
	kusok *ks = NULL;
	/* на чтение несуществующее не создаём */
	char path[4200];
	snprintf(path, sizeof(path), "%s/nope", dir);
	TT_EQ(kusok_open(path, &o, &ks), KUSOK_ENOTFOUND);
	ks = tt_open(dir);
	kusok_id id = tt_put(ks, "abc", 3);
	kusok_close(ks);
	TT_OK(kusok_open(dir, &o, &ks));
	TT_CHECK(tt_same(ks, &id, "abc", 3));
	kusok_put *p;
	TT_EQ(kusok_put_begin(ks, &p), KUSOK_ERDONLY);
	TT_EQ(kusok_ref(ks, &id), KUSOK_ERDONLY);
	TT_EQ(kusok_gc(ks, 0.1, NULL), KUSOK_ERDONLY);
	TT_EQ(kusok_checkpoint(ks), KUSOK_ERDONLY);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(bad_options)
{
	char *dir = tt_tmpdir();
	kusok *ks = NULL;
	kusok_opts o = tt_opts();
	o.avg_chunk = 1000;
	TT_EQ(kusok_open(dir, &o, &ks), KUSOK_EINVAL);
	o = tt_opts();
	o.pack_limit = 100;
	TT_EQ(kusok_open(dir, &o, &ks), KUSOK_EINVAL);
	TT_EQ(kusok_open(NULL, NULL, &ks), KUSOK_EINVAL);
	/* NULL опции = по умолчанию */
	TT_OK(kusok_open(dir, NULL, &ks));
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(format_marker)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok_close(ks);
	char path[4200];
	snprintf(path, sizeof(path), "%s/FORMAT", dir);
	int fd = open(path, O_WRONLY | O_TRUNC);
	tt_write(fd, "kusok store v9\n", 15);
	close(fd);
	kusok_opts o = tt_opts();
	TT_EQ(kusok_open(dir, &o, &ks), KUSOK_EFORMAT);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(compression_on_and_off)
{
	enum { N = 200000 };
	uint8_t *d = malloc(N);
	tt_fill_text(d, N, 8);
	kusok_stat s1, s2;
	for (int z = 0; z < 2; z++) {
		char *dir = tt_tmpdir();
		kusok_opts o = tt_opts();
		o.compress = z;
		kusok *ks = tt_open_with(dir, &o);
		kusok_id id = tt_put(ks, d, N);
		TT_CHECK(tt_same(ks, &id, d, N));
		kusok_stat_get(ks, z ? &s2 : &s1);
		kusok_close(ks);
		/* открыть с другой настройкой — читается всё равно */
		o.compress = !z;
		ks = tt_open_with(dir, &o);
		TT_CHECK(tt_same(ks, &id, d, N));
		kusok_close(ks);
		tt_rmdir(dir);
		free(dir);
	}
	printf("    без сжатия %llu, со сжатием %llu байт\n",
	       (unsigned long long)s1.stored_bytes,
	       (unsigned long long)s2.stored_bytes);
	/* мелкие куски жмутся хуже */
	TT_CHECK(s2.stored_bytes * 10 < s1.stored_bytes * 7);
	free(d);
}

TT_TEST(ids_hex)
{
	kusok_id id, back;
	for (int i = 0; i < 32; i++)
		id.b[i] = (uint8_t)(i * 9);
	char hex[65];
	kusok_id_hex(&id, hex);
	TT_EQU(strlen(hex), 64);
	TT_OK(kusok_id_parse(hex, &back));
	TT_MEMEQ(back.b, id.b, 32);
	hex[10] = 'G';
	TT_EQ(kusok_id_parse(hex, &back), KUSOK_EINVAL);
	TT_EQ(kusok_id_parse("abc", &back), KUSOK_EINVAL);
	char longer[70];
	kusok_id_hex(&id, longer);
	strcat(longer, "00");
	TT_EQ(kusok_id_parse(longer, &back), KUSOK_EINVAL);
	TT_OK(kusok_id_parse("ABCDEF0123456789abcdef0123456789"
			     "ABCDEF0123456789abcdef0123456789",
			     &back));
}

TT_TEST(strerror_covers_all)
{
	for (int e = 0; e >= KUSOK_EFORMAT; e--)
		TT_CHECK(strcmp(kusok_strerror(e), "unknown error") != 0);
	TT_CHECK(strcmp(kusok_strerror(-100), "unknown error") == 0);
}

TT_TEST(many_small_files)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	enum { K = 500 };
	static kusok_id ids[K];
	for (int i = 0; i < K; i++) {
		char s[64];
		int n = snprintf(s, sizeof(s), "сообщение номер %d", i);
		ids[i] = tt_put(ks, s, (size_t)n);
	}
	ks = tt_reopen(ks, dir);
	size_t bad = 0;
	for (int i = 0; i < K; i++) {
		char s[64];
		int n = snprintf(s, sizeof(s), "сообщение номер %d", i);
		bad += !tt_same(ks, &ids[i], s, (size_t)n);
	}
	TT_EQU(bad, 0);
	kusok_stat st;
	kusok_stat_get(ks, &st);
	TT_EQU(st.files, K);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(put_get_simple);
	TT_RUN(survives_reopen);
	TT_RUN(same_file_twice_costs_nothing);
	TT_RUN(similar_files_share_chunks);
	TT_RUN(empty_file);
	TT_RUN(single_chunk_file_vs_chunk);
	TT_RUN(streaming_put);
	TT_RUN(abort_leaves_no_file);
	TT_RUN(put_fd);
	TT_RUN(lock_is_exclusive);
	TT_RUN(read_only_mode);
	TT_RUN(bad_options);
	TT_RUN(format_marker);
	TT_RUN(compression_on_and_off);
	TT_RUN(ids_hex);
	TT_RUN(strerror_covers_all);
	TT_RUN(many_small_files);
	return tt_done();
}
