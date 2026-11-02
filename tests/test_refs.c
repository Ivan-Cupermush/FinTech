/*
 * счётчики ссылок
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "kusok/kusok.h"
#include "tt.h"

static int64_t refs(kusok *ks, const kusok_id *id)
{
	int64_t r = -1;
	kusok_refs(ks, id, &r);
	return r;
}

TT_TEST(ref_unref_cycle)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok_id id = tt_put(ks, "forwarded photo", 15);
	TT_EQ(refs(ks, &id), 1);
	TT_OK(kusok_ref(ks, &id));
	TT_OK(kusok_ref(ks, &id));
	TT_EQ(refs(ks, &id), 3);
	TT_OK(kusok_unref(ks, &id));
	TT_OK(kusok_unref(ks, &id));
	TT_CHECK(tt_same(ks, &id, "forwarded photo", 15)); /* ещё жив */
	TT_OK(kusok_unref(ks, &id));
	TT_EQ(refs(ks, &id), 0);
	/* ссылок нет — файла для читателя нет */
	uint64_t size;
	TT_EQ(kusok_size(ks, &id, &size), KUSOK_ENOTFOUND);
	TT_EQ(kusok_unref(ks, &id), KUSOK_ENOTFOUND); /* ниже нуля нельзя */
	/* но до сборки мусора его можно воскресить */
	TT_OK(kusok_ref(ks, &id));
	TT_CHECK(tt_same(ks, &id, "forwarded photo", 15));
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(unknown_file)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok_id id;
	memset(id.b, 7, 32);
	int64_t r;
	TT_EQ(kusok_ref(ks, &id), KUSOK_ENOTFOUND);
	TT_EQ(kusok_unref(ks, &id), KUSOK_ENOTFOUND);
	TT_EQ(kusok_refs(ks, &id, &r), KUSOK_ENOTFOUND);
	TT_EQ(kusok_ref(NULL, &id), KUSOK_EINVAL);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(persist_through_reopen_and_checkpoint)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok_id a = tt_put(ks, "aaaa", 4);
	kusok_id b = tt_put(ks, "bbbb", 4);
	for (int i = 0; i < 10; i++)
		kusok_ref(ks, &a);
	kusok_unref(ks, &b);
	TT_OK(kusok_checkpoint(ks));
	kusok_ref(ks, &a); /* уже после снимка — в журнал */
	ks = tt_reopen(ks, dir);
	TT_EQ(refs(ks, &a), 12);
	TT_EQ(refs(ks, &b), 0);
	ks = tt_reopen(ks, dir);
	TT_EQ(refs(ks, &a), 12);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

struct sbor {
	int kol;
	uint64_t bytes;
	int64_t refs;
};

static int sobrat(const kusok_id *id, uint64_t size, int64_t r, void *ctx)
{
	(void)id;
	struct sbor *s = ctx;
	s->kol++;
	s->bytes += size;
	s->refs += r;
	return 0;
}

static int stop(const kusok_id *id, uint64_t size, int64_t r, void *ctx)
{
	(void)id;
	(void)size;
	(void)r;
	(void)ctx;
	return 77;
}

TT_TEST(list_and_stat)
{
	char *dir = tt_tmpdir();
	kusok *ks = tt_open(dir);
	kusok_id a = tt_put(ks, "1234567890", 10);
	tt_put(ks, "abc", 3);
	kusok_id c = tt_put(ks, "zz", 2);
	kusok_ref(ks, &a);
	kusok_unref(ks, &c);
	struct sbor s = {0, 0, 0};
	TT_OK(kusok_list(ks, sobrat, &s));
	TT_EQ(s.kol, 2);
	TT_EQU(s.bytes, 13);
	TT_EQ(s.refs, 3);
	TT_EQ(kusok_list(ks, stop, NULL), 77);
	kusok_stat st;
	TT_OK(kusok_stat_get(ks, &st));
	TT_EQU(st.files, 2);
	TT_EQU(st.logical_bytes, 10 * 2 + 3);
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

TT_TEST(sync_off_still_consistent_after_clean_close)
{
	char *dir = tt_tmpdir();
	kusok_opts o = tt_opts();
	o.sync = 0;
	kusok *ks = tt_open_with(dir, &o);
	kusok_id a = tt_put(ks, "nosync", 6);
	kusok_ref(ks, &a);
	kusok_close(ks);
	ks = tt_open_with(dir, &o);
	TT_EQ(refs(ks, &a), 2);
	TT_CHECK(tt_same(ks, &a, "nosync", 6));
	kusok_close(ks);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(ref_unref_cycle);
	TT_RUN(unknown_file);
	TT_RUN(persist_through_reopen_and_checkpoint);
	TT_RUN(list_and_stat);
	TT_RUN(sync_off_still_consistent_after_clean_close);
	return tt_done();
}
