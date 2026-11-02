/*
 * kusok-bench speed | dedup | more | all — цифры для docs/EXPERIMENTS.md
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <ftw.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "cdc.h"
#include "crc32c.h"
#include "kusok/kusok.h"
#include "lz.h"
#include "sha256.h"
#include "tab.h"

/* ------------------------------------------------------------ данные */

static uint64_t rnd(uint64_t *s)
{
	uint64_t x = *s;
	x ^= x >> 12;
	x ^= x << 25;
	x ^= x >> 27;
	*s = x;
	return x * 0x2545F4914F6CDD1Dull;
}

static void fill_random(uint8_t *p, size_t n, uint64_t seed)
{
	uint64_t s = seed | 1;
	for (size_t i = 0; i < n; i++)
		p[i] = (uint8_t)(rnd(&s) >> 56);
}

/* похоже на обычный текст */
static void fill_text(uint8_t *p, size_t n, uint64_t seed)
{
	static const char *slova[] = {
	    "цель ",
	    "задача ",
	    "отчёт ",
	    "метрика ",
	    "студент ",
	    "курс ",
	    "kusok ",
	    "offix ",
	    "план ",
	    "квартал ",
	    "выполнено ",
	    "срок ",
	    "ответственный ",
	    "результат ",
	    "и ",
	    "в ",
	    "по ",
	    "на ",
	    "2026 ",
	    "%; ",
	    "\n",
	    "- ",
	    "проект ",
	    "команда ",
	};
	uint64_t s = seed | 1;
	size_t i = 0;
	while (i < n) {
		const char *w =
		    slova[rnd(&s) % (sizeof(slova) / sizeof(*slova))];
		for (size_t k = 0; w[k] && i < n; k++)
			p[i++] = (uint8_t)w[k];
		if (rnd(&s) % 9 == 0 && i + 4 < n) {
			char num[8];
			int len = snprintf(num, sizeof(num), "%u",
					   (unsigned)(rnd(&s) % 1000));
			for (int k = 0; k < len && i < n; k++)
				p[i++] = (uint8_t)num[k];
		}
	}
}

static double now(void)
{
	struct timespec t;
	clock_gettime(CLOCK_MONOTONIC, &t);
	return (double)t.tv_sec + (double)t.tv_nsec / 1e9;
}

static _Noreturn void die(const char *what, int rc)
{
	fprintf(stderr, "kusok-bench: %s: %s\n", what, kusok_strerror(rc));
	exit(1);
}

static char *tmp_store(void)
{
	const char *base = getenv("TMPDIR");
	char *p = malloc(4096);
	snprintf(p, 4096, "%s/kusok-bench-XXXXXX", base ? base : "/tmp");
	if (!mkdtemp(p)) {
		perror("mkdtemp");
		exit(1);
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

static void rm_store(char *p)
{
	nftw(p, rm_one, 16, FTW_DEPTH | FTW_PHYS);
	free(p);
}

static kusok *open_full(char *dir, int compress, int threads, int cache)
{
	kusok_opts o;
	kusok_opts_default(&o);
	o.sync = 0; /* меряем алгоритмы, а не диск */
	o.compress = compress;
	o.threads = threads;
	if (cache)
		o.cache_chunks = cache;
	kusok *ks;
	int rc = kusok_open(dir, &o, &ks);
	if (rc)
		die("open", rc);
	return ks;
}

static kusok *open_store(char *dir, int compress)
{
	return open_full(dir, compress, 1, 0);
}

/* ------------------------------------------------------------ скорость */

#define MB (1024.0 * 1024.0)

static void speed_row(const char *name, size_t bytes, double sec)
{
	printf("| %s | %.0f |\n", name, (double)bytes / MB / sec);
}

static volatile uint64_t sink; /* чтобы компилятор не выкинул замеры */

static void bench_speed(void)
{
	enum { N = 64 << 20, BLK = 8192 };
	uint8_t *text = malloc(N), *rand_ = malloc(N), *back = malloc(N);
	uint8_t z[2 * BLK], one[BLK];
	fill_text(text, N, 1);
	fill_random(rand_, N, 2);
	printf("\n### Скорость: один поток, %d МБ на замер\n\n", N >> 20);
	printf("| операция | МБ/с |\n");
	printf("|---|---:|\n");

	uint8_t d[32];
	ks_sha256_use_hw(0);
	double t = now();
	ks_sha256_buf(rand_, N, d);
	speed_row("SHA-256, обычный C", N, now() - t);
	ks_sha256_use_hw(1);
	if (ks_sha256_hw()) {
		t = now();
		ks_sha256_buf(rand_, N, d);
		speed_row("SHA-256, инструкции SHA-NI", N, now() - t);
	}
	sink += d[0];

	t = now();
	sink += ks_crc32c_sw(0, rand_, N);
	speed_row("CRC32C, таблицы slicing-by-8", N, now() - t);
	if (ks_crc32c_hw()) {
		t = now();
		sink += ks_crc32c(0, rand_, N);
		speed_row("CRC32C, инструкция SSE4.2", N, now() - t);
	}

	ks_cdc c;
	ks_cdc_init(&c, 2048, 8192, 65536);
	t = now();
	size_t kol = 0;
	for (size_t pos = 0; pos < N; kol++)
		pos += ks_cdc_cut(&c, rand_ + pos, N - pos);
	speed_row("FastCDC, нарезка (средний 8 KiB)", N, now() - t);
	sink += kol;

	/* lz: кусками по 8 KiB, как в хранилище */
	size_t zn, bn, total_z = 0;
	t = now();
	for (size_t pos = 0; pos < N; pos += BLK) {
		ks_lz_compress(text + pos, BLK, z, sizeof(z), &zn);
		total_z += zn;
	}
	speed_row("LZ4-блок, сжатие текста", N, now() - t);
	ks_lz_compress(text, BLK, z, sizeof(z), &zn);
	t = now();
	for (size_t pos = 0; pos < N; pos += BLK) {
		ks_lz_decompress(z, zn, one, BLK, &bn);
		sink += one[pos % BLK];
	}
	speed_row("LZ4-блок, распаковка текста", N, now() - t);

	char *dir = tmp_store();
	kusok *ks = open_store(dir, 1);
	kusok_id id1, id2;
	int rc;
	t = now();
	if ((rc = kusok_put_mem(ks, text, N, &id1)))
		die("put", rc);
	double tp1 = now() - t;
	t = now();
	if ((rc = kusok_put_mem(ks, rand_, N, &id2)))
		die("put", rc);
	double tp2 = now() - t;
	t = now();
	if ((rc = kusok_put_mem(ks, text, N, &id1)))
		die("put", rc);
	double tdup = now() - t;
	t = now();
	size_t got;
	if ((rc = kusok_read(ks, &id1, 0, back, N, &got)))
		die("read", rc);
	double tg = now() - t;
	if (got != N || memcmp(back, text, N))
		die("read", KUSOK_ECORRUPT);
	speed_row("kusok put: текст (резка+хеш+сжатие)", N, tp1);
	speed_row("kusok put: случайные данные", N, tp2);
	speed_row("kusok put: повтор (только хеши)", N, tdup);
	speed_row("kusok read: текст (распаковка)", N, tg);
	printf("\nтекст кусками по 8 KiB сжался до %.1f%%\n",
	       100.0 * (double)total_z / N);
	kusok_close(ks);
	rm_store(dir);
	free(text);
	free(rand_);
	free(back);
}

/* ------------------------------------------------------------ потоки, hc, индекс, кэш */

static void bench_threads(void)
{
	enum { N = 64 << 20 };
	uint8_t *text = malloc(N);
	fill_text(text, N, 21);
	long ncpu = sysconf(_SC_NPROCESSORS_ONLN);
	printf("\n### Запись в несколько потоков, %d МБ текста, ядер: %ld\n\n",
	       N >> 20, ncpu);
	printf("| потоки | МБ/с |\n|---:|---:|\n");
	uint8_t first[32];
	for (int th = 1; th <= 8; th *= 2) {
		char *dir = tmp_store();
		kusok *ks = open_full(dir, 1, th, 0);
		kusok_id id;
		double t = now();
		int rc = kusok_put_mem(ks, text, N, &id);
		if (rc)
			die("put", rc);
		t = now() - t;
		/* результат не зависит от числа потоков */
		if (th == 1)
			memcpy(first, id.b, 32);
		else if (memcmp(first, id.b, 32))
			die("put", KUSOK_ECORRUPT);
		printf("| %d | %.0f |\n", th, (double)N / MB / t);
		kusok_close(ks);
		rm_store(dir);
	}
	free(text);
}

static void bench_hc(void)
{
	enum { N = 16 << 20, BLK = 65536 };
	uint8_t *text = malloc(N), *z = malloc(2 * BLK), *back = malloc(BLK);
	fill_text(text, N, 31);
	printf("\n### Сжатие текста по уровням, куски 64 KiB, %d МБ\n\n",
	       N >> 20);
	printf("| уровень | сжатие МБ/с | распаковка МБ/с | размер |\n");
	printf("|---:|---:|---:|---:|\n");
	int levels[] = {1, 2, 4, 6, 9, 12};
	for (size_t li = 0; li < sizeof(levels) / sizeof(*levels); li++) {
		int lv = levels[li];
		size_t zn, bn, total = 0;
		double t = now(), tz = 0, td = 0;
		for (size_t pos = 0; pos < N; pos += BLK) {
			t = now();
			if (lv == 1)
				ks_lz_compress(text + pos, BLK, z, 2 * BLK,
					       &zn);
			else
				ks_lz_compress_hc(text + pos, BLK, z, 2 * BLK,
						  &zn, lv);
			tz += now() - t;
			total += zn;
			t = now();
			if (ks_lz_decompress(z, zn, back, BLK, &bn) ||
			    bn != BLK || memcmp(back, text + pos, BLK))
				die("lz", KUSOK_ECORRUPT);
			td += now() - t;
		}
		printf("| %d | %.0f | %.0f | %.1f%% |\n", lv, N / MB / tz,
		       N / MB / td, 100.0 * (double)total / N);
	}
	free(text);
	free(z);
	free(back);
}

static void bench_open(void)
{
	enum { FILES = 4000, SZ = 16384 };
	char *dir = tmp_store();
	kusok_opts o;
	kusok_opts_default(&o);
	o.sync = 0;
	o.pack_limit = 4u << 20;
	kusok *ks;
	int rc = kusok_open(dir, &o, &ks);
	if (rc)
		die("open", rc);
	uint8_t *buf = malloc(SZ);
	for (int i = 0; i < FILES; i++) {
		kusok_id id;
		fill_random(buf, SZ, (uint64_t)i + 100);
		if ((rc = kusok_put_mem(ks, buf, SZ, &id)))
			die("put", rc);
	}
	kusok_close(ks);
	free(buf);
	o.read_only = 1;
	double t = now();
	if ((rc = kusok_open(dir, &o, &ks)))
		die("open", rc);
	double ti = now() - t;
	kusok_close(ks);
	/* убрали индексы — открытие обходит pack */
	char cmd[4200];
	snprintf(cmd, sizeof(cmd), "rm -f %s/packs/*.idx", dir);
	if (system(cmd))
		die("rm", KUSOK_EIO);
	t = now();
	if ((rc = kusok_open(dir, &o, &ks)))
		die("open", rc);
	double ts = now() - t;
	kusok_close(ks);
	printf("\n### Открытие хранилища: %d файлов, %d МБ\n\n", FILES,
	       FILES * SZ >> 20);
	printf("| как | мс |\n|---|---:|\n");
	printf("| по индексам .idx | %.1f |\n", ti * 1000);
	printf("| обход pack-файлов | %.1f |\n", ts * 1000);
	rm_store(dir);
}

static void bench_cache(void)
{
	enum { N = 8 << 20, RD = 4096, ITER = 20000 };
	uint8_t *text = malloc(N), buf[RD];
	fill_text(text, N, 41);
	printf("\n### Кэш чтения: %d случайных чтений по %d байт из "
	       "\"горячих\" 512 KiB файла %d МБ\n\n",
	       ITER, RD, N >> 20);
	printf(
	    "| кэш, кусков | попадания | мкс на чтение |\n|---:|---:|---:|\n");
	int sizes[] = {1, 16, 64, 256};
	for (size_t si = 0; si < sizeof(sizes) / sizeof(*sizes); si++) {
		char *dir = tmp_store();
		kusok *ks = open_full(dir, 1, 1, sizes[si]);
		kusok_id id;
		int rc = kusok_put_mem(ks, text, N, &id);
		if (rc)
			die("put", rc);
		uint64_t s = 5;
		double t = now();
		for (int i = 0; i < ITER; i++) {
			size_t got;
			uint64_t off = rnd(&s) % ((512 << 10) - RD);
			if ((rc = kusok_read(ks, &id, off, buf, RD, &got)))
				die("read", rc);
			sink += buf[0];
		}
		t = now() - t;
		kusok_stat st;
		kusok_stat_get(ks, &st);
		uint64_t all = st.cache_hits + st.cache_misses;
		printf("| %d | %.1f%% | %.1f |\n", sizes[si],
		       all ? 100.0 * (double)st.cache_hits / (double)all : 0,
		       t * 1e6 / ITER);
		kusok_close(ks);
		rm_store(dir);
	}
	free(text);
}

/* ------------------------------------------------------------ дедупликация */

/* уникальные байты при блоках постоянной длины */
struct fixed {
	ks_tab t;
	uint64_t unique;
	size_t blok;
};

static void fixed_feed(struct fixed *f, const uint8_t *p, size_t n)
{
	for (size_t pos = 0; pos < n; pos += f->blok) {
		size_t k = n - pos < f->blok ? n - pos : f->blok;
		uint8_t d[32];
		void *slot;
		int fresh;
		ks_sha256_buf(p + pos, k, d);
		ks_tab_put(&f->t, d, &slot, &fresh);
		if (fresh)
			f->unique += k;
	}
}

struct prog {
	kusok *ks[2]; /* 0 — без сжатия, 1 — со сжатием */
	struct fixed f4, f8;
	uint64_t logical;
};

static void put_all(struct prog *g, const uint8_t *p, size_t n)
{
	for (int i = 0; i < 2; i++) {
		kusok_id id;
		int rc = kusok_put_mem(g->ks[i], p, n, &id);
		if (rc)
			die("put", rc);
	}
	fixed_feed(&g->f4, p, n);
	fixed_feed(&g->f8, p, n);
	g->logical += n;
}

/* правка документа: вставка, удаление или замена 20..220 байт */
static size_t edit(uint8_t *doc, size_t n, size_t cap, uint64_t *s)
{
	size_t pos = (size_t)(rnd(s) % n);
	size_t len = 20 + (size_t)(rnd(s) % 200);
	switch (rnd(s) % 3) {
	case 0:
		if (n + len > cap)
			return n;
		memmove(doc + pos + len, doc + pos, n - pos);
		fill_text(doc + pos, len, rnd(s));
		return n + len;
	case 1:
		if (pos + len > n)
			len = n - pos;
		memmove(doc + pos, doc + pos + len, n - pos - len);
		return n - len;
	default:
		if (pos + len > n)
			len = n - pos;
		fill_text(doc + pos, len, rnd(s));
		return n;
	}
}

/* 1: документ базы знаний 2 МБ, 40 версий, в каждой 5 мелких правок */
static void sc_versions(struct prog *g)
{
	size_t cap = 4 << 20, n = 2 << 20;
	uint8_t *doc = malloc(cap);
	uint64_t s = 7;
	fill_text(doc, n, 3);
	for (int v = 0; v < 40; v++) {
		put_all(g, doc, n);
		for (int k = 0; k < 5; k++)
			n = edit(doc, n, cap, &s);
	}
	free(doc);
}

/* 2: 120 вложений, каждое переслано 1..12 раз */
static void sc_forwards(struct prog *g)
{
	uint64_t s = 11;
	uint8_t *buf = malloc(3 << 20);
	for (int i = 0; i < 120; i++) {
		size_t n = 30000 + (size_t)(rnd(&s) % (2 << 20));
		if (rnd(&s) % 3 != 0)
			fill_random(buf, n, rnd(&s));
		else
			fill_text(buf, n, rnd(&s));
		int raz = 1 + (int)((rnd(&s) % 100) * (rnd(&s) % 100) / 900);
		for (int k = 0; k < raz; k++)
			put_all(g, buf, n);
	}
	free(buf);
}

/* 3: CSV из 1С каждую неделю, +1500 строк и 20 правок */
static void sc_reports(struct prog *g)
{
	size_t cap = 8 << 20, n = 0;
	uint8_t *csv = malloc(cap);
	uint64_t s = 13;
	n += (size_t)snprintf((char *)csv, cap,
			      "дата;сотрудник;метрика;значение\n");
	for (int week = 0; week < 52; week++) {
		for (int r = 0; r < 1500 && n + 100 < cap; r++)
			n += (size_t)snprintf(
			    (char *)csv + n, cap - n,
			    "2026-%02d-%02d;сотрудник-%03u;kpi-%u;%u\n",
			    1 + week / 5, 1 + week % 28,
			    (unsigned)(rnd(&s) % 300), (unsigned)(rnd(&s) % 40),
			    (unsigned)(rnd(&s) % 10000));
		for (int k = 0; k < 20 && n + 1 < cap; k++) {
			size_t pos = (size_t)(rnd(&s) % n);
			if (rnd(&s) &
			    1) { /* вставили цифру — дальше всё сдвинулось */
				memmove(csv + pos + 1, csv + pos, n - pos);
				n++;
			}
			csv[pos] = (uint8_t)('0' + rnd(&s) % 10);
		}
		put_all(g, csv, n);
	}
	free(csv);
}

struct itog {
	uint64_t logical, fixed8, fixed4, cdc, stored;
};

static void row(const char *name, const struct itog *r)
{
	printf("| %s | %.1f | %.1f | %.1f | %.1f | %.1f | %.1fx |\n", name,
	       (double)r->logical / MB, (double)r->fixed8 / MB,
	       (double)r->fixed4 / MB, (double)r->cdc / MB,
	       (double)r->stored / MB, (double)r->logical / (double)r->stored);
}

static void run_scenario(const char *name, void (*fn)(struct prog *),
			 struct itog *total)
{
	char *dirs[2];
	struct prog g;
	memset(&g, 0, sizeof(g));
	for (int i = 0; i < 2; i++) {
		dirs[i] = tmp_store();
		g.ks[i] = open_store(dirs[i], i);
	}
	g.f4.blok = 4096;
	g.f8.blok = 8192;
	ks_tab_init(&g.f4.t, 32, 1024);
	ks_tab_init(&g.f8.t, 32, 1024);
	fn(&g);
	kusok_stat a, b;
	kusok_stat_get(g.ks[0], &a);
	kusok_stat_get(g.ks[1], &b);
	struct itog r = {g.logical, g.f8.unique, g.f4.unique, a.unique_bytes,
			 b.stored_bytes};
	row(name, &r);
	total->logical += r.logical;
	total->fixed8 += r.fixed8;
	total->fixed4 += r.fixed4;
	total->cdc += r.cdc;
	total->stored += r.stored;
	for (int i = 0; i < 2; i++) {
		kusok_close(g.ks[i]);
		rm_store(dirs[i]);
	}
	ks_tab_free(&g.f4.t);
	ks_tab_free(&g.f8.t);
}

static void bench_dedup(void)
{
	printf("\n### Экономия места, МБ (меньше — лучше)\n\n");
	printf("| сценарий | без kusok | блоки 8K | блоки 4K | FastCDC | kusok "
	       "| экономия |\n");
	printf("|---|---:|---:|---:|---:|---:|---:|\n");
	struct itog total = {0};
	run_scenario("версии документа", sc_versions, &total);
	run_scenario("пересылки вложений", sc_forwards, &total);
	run_scenario("недельные CSV из 1С", sc_reports, &total);
	row("всего", &total);
	printf("\nблоки 8K/4K — дедупликация кусками постоянного размера;\n"
	       "FastCDC — уникальные байты после нарезки по содержимому;\n"
	       "kusok — реальный размер pack-файлов (FastCDC + сжатие + "
	       "заголовки).\n");
}

int main(int argc, char **argv)
{
	const char *what = argc > 1 ? argv[1] : "all";
	if (strcmp(what, "speed") && strcmp(what, "dedup") &&
	    strcmp(what, "more") && strcmp(what, "all")) {
		fprintf(stderr,
			"использование: kusok-bench [speed|dedup|more|all]\n");
		return 2;
	}
	printf("kusok-bench %s, crc32c: %s, sha256: %s\n", KUSOK_VERSION_STRING,
	       ks_crc32c_hw() ? "SSE4.2" : "таблицы",
	       ks_sha256_hw() ? "SHA-NI" : "C");
	int all = !strcmp(what, "all");
	if (all || !strcmp(what, "speed"))
		bench_speed();
	if (all || !strcmp(what, "more")) {
		bench_threads();
		bench_hc();
		bench_open();
		bench_cache();
	}
	if (all || !strcmp(what, "dedup"))
		bench_dedup();
	return 0;
}
