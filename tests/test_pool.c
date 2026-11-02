/*
 * пул потоков и многопоточная запись
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#include "kusok/kusok.h"
#include "pool.h"
#include "tt.h"

struct schet {
	atomic_uint *bylo; /* сколько раз сделали индекс i */
	atomic_ullong summa;
};

static void job(void *ctx, size_t i)
{
	struct schet *s = ctx;
	atomic_fetch_add(&s->bylo[i], 1);
	atomic_fetch_add(&s->summa, i);
}

static int kazhdyi_raz(unsigned nth, size_t n)
{
	ks_pool *p;
	if (ks_pool_new(nth, &p))
		return 0;
	struct schet s;
	s.bylo = calloc(n ? n : 1, sizeof(*s.bylo));
	atomic_init(&s.summa, 0);
	ks_pool_run(p, job, &s, n);
	int ok = atomic_load(&s.summa) == (unsigned long long)n * (n - 1) / 2 ||
		 n == 0;
	for (size_t i = 0; i < n; i++)
		ok &= atomic_load(&s.bylo[i]) == 1;
	free(s.bylo);
	ks_pool_free(p);
	return ok;
}

TT_TEST(every_index_once)
{
	static const unsigned nth[] = {0, 1, 2, 3, 4, 8};
	static const size_t n[] = {0, 1, 2, 7, 64, 1000};
	for (size_t a = 0; a < 6; a++)
		for (size_t b = 0; b < 6; b++)
			TT_CHECK(kazhdyi_raz(nth[a], n[b]));
}

TT_TEST(many_runs_one_pool)
{
	/* пул живёт долго, работа приходит пачками — как при записи */
	ks_pool *p;
	TT_OK(ks_pool_new(4, &p));
	TT_EQ(ks_pool_threads(p), 4);
	size_t bad = 0;
	for (int r = 0; r < 2000; r++) {
		size_t n = 1 + (size_t)r % 70;
		struct schet s;
		atomic_uint bylo[70];
		for (size_t i = 0; i < 70; i++)
			atomic_init(&bylo[i], 0);
		s.bylo = bylo;
		atomic_init(&s.summa, 0);
		ks_pool_run(p, job, &s, n);
		bad += atomic_load(&s.summa) != n * (n - 1) / 2;
	}
	TT_EQU(bad, 0);
	ks_pool_free(p);
}

TT_TEST(bad_args)
{
	ks_pool *p;
	TT_EQ(ks_pool_new(KS_POOL_MAX + 1, &p), KUSOK_EINVAL);
	TT_EQ(ks_pool_new(2, NULL), KUSOK_EINVAL);
	TT_EQ(ks_pool_threads(NULL), 1);
	ks_pool_free(NULL);
	kusok_opts o = tt_opts();
	o.threads = -1;
	kusok *ks;
	char *dir = tt_tmpdir();
	TT_EQ(kusok_open(dir, &o, &ks), KUSOK_EINVAL);
	o.threads = KS_POOL_MAX + 1;
	TT_EQ(kusok_open(dir, &o, &ks), KUSOK_EINVAL);
	tt_rmdir(dir);
	free(dir);
}

/* одно и то же в хранилище с n потоками; вернуть pack-файл целиком */
static uint8_t *zapisat(int nth, size_t *len, kusok_id ids[3])
{
	char *dir = tt_tmpdir();
	kusok_opts o = tt_opts();
	o.threads = nth;
	o.pack_limit = 1u << 30;
	kusok *ks = tt_open_with(dir, &o);
	enum { N = 900000 };
	uint8_t *d = malloc(N);
	tt_fill_text(d, N / 2, 1);
	tt_fill(d + N / 2, N - N / 2, 2);
	int ok = 1;
	ids[0] = tt_put(ks, d, N);
	ok &= tt_same(ks, &ids[0], d, N);
	memset(d + 1000, 'x', 5000); /* правка в начале */
	ids[1] = tt_put(ks, d, N);
	ok &= tt_same(ks, &ids[1], d, N);
	ids[2] = tt_put(ks, d + 77, N - 77);
	ok &= tt_same(ks, &ids[2], d + 77, N - 77);
	if (!ok)
		ids[0].b[0] ^= 1; /* чтобы сравнение id упало */
	kusok_close(ks);
	free(d);
	char path[4200];
	snprintf(path, sizeof(path), "%s/packs/00000001.pack", dir);
	FILE *f = fopen(path, "rb");
	fseek(f, 0, SEEK_END);
	*len = (size_t)ftell(f);
	rewind(f);
	uint8_t *buf = malloc(*len);
	if (fread(buf, 1, *len, f) != *len)
		*len = 0;
	fclose(f);
	tt_rmdir(dir);
	free(dir);
	return buf;
}

TT_TEST(threads_give_same_bytes)
{
	/* сколько бы ни было потоков, на диске байт в байт одно и то же */
	size_t n1, n4, n7;
	kusok_id a[3], b[3], c[3];
	uint8_t *p1 = zapisat(1, &n1, a);
	uint8_t *p4 = zapisat(4, &n4, b);
	uint8_t *p7 = zapisat(7, &n7, c);
	TT_EQU(n1, n4);
	TT_EQU(n1, n7);
	TT_CHECK(n1 > 0 && !memcmp(p1, p4, n1) && !memcmp(p1, p7, n1));
	TT_MEMEQ(a, b, sizeof(a));
	TT_MEMEQ(a, c, sizeof(a));
	free(p1);
	free(p4);
	free(p7);
}

TT_TEST(threads_dedup_inside_batch)
{
	/* один и тот же кусок много раз в одной пачке — пишется один раз */
	char *dir = tt_tmpdir();
	kusok_opts o = tt_opts();
	o.threads = 4;
	o.compress = 0;
	kusok *ks = tt_open_with(dir, &o);
	enum { K = 4096, RAZ = 50 };
	uint8_t *d = malloc(K * RAZ);
	uint8_t kus[K];
	tt_fill(kus, K, 9);
	for (int i = 0; i < RAZ; i++)
		memcpy(d + i * K, kus, K);
	kusok_id id = tt_put(ks, d, K * RAZ);
	TT_CHECK(tt_same(ks, &id, d, K * RAZ));
	TT_CHECK(kusok_last_put_new_bytes(ks) < K * 4);
	kusok_close(ks);
	free(d);
	tt_rmdir(dir);
	free(dir);
}

int main(void)
{
	TT_RUN(every_index_once);
	TT_RUN(many_runs_one_pool);
	TT_RUN(bad_args);
	TT_RUN(threads_give_same_bytes);
	TT_RUN(threads_dedup_inside_batch);
	return tt_done();
}
