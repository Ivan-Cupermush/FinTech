/*
 * kusok — хранилище файлов с дедупликацией.
 * один открытый kusok — один поток.
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KUSOK_H
#define KUSOK_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define KUSOK_VERSION_MAJOR 0
#define KUSOK_VERSION_MINOR 5
#define KUSOK_VERSION_PATCH 0
#define KUSOK_VERSION_STRING "0.5.0"

#define KUSOK_ID_LEN 32
#define KUSOK_HEX_LEN 64

/* 0 или отрицательный код */
enum kusok_err {
	KUSOK_OK = 0,
	KUSOK_EIO = -1,
	KUSOK_ENOMEM = -2,
	KUSOK_EINVAL = -3,
	KUSOK_ENOTFOUND = -4,
	KUSOK_ECORRUPT = -5,
	KUSOK_ELOCKED = -6, /* занят другим процессом */
	KUSOK_EBUSY = -7,   /* идёт запись */
	KUSOK_ETOOBIG = -8,
	KUSOK_ERDONLY = -9,
	KUSOK_EFORMAT = -10,
};

typedef struct kusok kusok;
typedef struct kusok_put kusok_put;

/* SHA-256 содержимого */
typedef struct kusok_id {
	uint8_t b[KUSOK_ID_LEN];
} kusok_id;

typedef struct kusok_opts {
	uint32_t min_chunk;  /* 0 = 2 KiB */
	uint32_t avg_chunk;  /* степень двойки, 0 = 8 KiB */
	uint32_t max_chunk;  /* 0 = 64 KiB */
	uint32_t pack_limit; /* 0 = 64 MiB */
	int compress; /* 0 нет, 1 быстро, 2..12 сильнее */
	int sync;
	int read_only;
	int salvage;	  /* открыть даже битое */
	int threads;	  /* для хеша и сжатия, 0 = 1 */
	int cache_chunks; /* LRU распакованных кусков, 0 = 64 */
} kusok_opts;

void kusok_opts_default(kusok_opts *o);

int kusok_open(const char *dir, const kusok_opts *o, kusok **out);
int kusok_close(kusok *ks);

/* begin -> write... -> commit, commit даёт файлу +1 ссылку */
int kusok_put_begin(kusok *ks, kusok_put **out);
int kusok_put_write(kusok_put *p, const void *buf, size_t n);
int kusok_put_commit(kusok_put *p, kusok_id *id);
void kusok_put_abort(kusok_put *p);

int kusok_put_mem(kusok *ks, const void *buf, size_t n, kusok_id *id);
int kusok_put_fd(kusok *ks, int fd, kusok_id *id);

/* сколько новых байт записал последний put */
uint64_t kusok_last_put_new_bytes(const kusok *ks);

int kusok_size(kusok *ks, const kusok_id *id, uint64_t *size);

/* до n байт с off, *got < n только в конце файла */
int kusok_read(kusok *ks, const kusok_id *id, uint64_t off, void *buf, size_t n,
	       size_t *got);
int kusok_get_fd(kusok *ks, const kusok_id *id, int fd);

/* файл живёт, пока ссылок больше нуля */
int kusok_ref(kusok *ks, const kusok_id *id);
int kusok_unref(kusok *ks, const kusok_id *id);
int kusok_refs(kusok *ks, const kusok_id *id, int64_t *refs);

typedef struct kusok_stat {
	uint64_t files;
	uint64_t chunks;
	uint64_t logical_bytes; /* сколько было бы без kusok */
	uint64_t unique_bytes;
	uint64_t stored_bytes; /* сколько на диске */
	uint64_t cache_hits;
	uint64_t cache_misses;
	uint32_t packs;
} kusok_stat;

int kusok_stat_get(kusok *ks, kusok_stat *st);

typedef struct kusok_gc_report {
	uint32_t packs_rewritten;
	uint64_t bytes_before;
	uint64_t bytes_after;
	uint64_t records_dropped;
} kusok_gc_report;

/* переписать pack, где мусора >= min_garbage (0..1) */
int kusok_gc(kusok *ks, double min_garbage, kusok_gc_report *r);

typedef struct kusok_fsck_report {
	uint64_t records;
	uint64_t bad_records;
	uint64_t files;
	uint64_t broken_files;
	uint64_t missing_manifests;
	uint64_t tail_bytes; /* рваный хвост после сбоя */
} kusok_fsck_report;

/* проверить все CRC и SHA-256 */
int kusok_fsck(kusok *ks, kusok_fsck_report *r);

/* снимок ссылок + обрезать журнал */
int kusok_checkpoint(kusok *ks);

/* cb вернул не 0 — стоп, вернём его код */
typedef int (*kusok_list_cb)(const kusok_id *id, uint64_t size, int64_t refs,
			     void *ctx);
int kusok_list(kusok *ks, kusok_list_cb cb, void *ctx);

/* пакет для переноса в другое хранилище (бэкап) */
typedef struct kusok_bundle_report {
	uint64_t files;
	uint64_t chunks;  /* положили / приняли новых */
	uint64_t skipped; /* у получателя уже было */
	uint64_t bytes;
} kusok_bundle_report;

/* все живые файлы в fd, кроме кусков из known */
int kusok_export(kusok *ks, int fd, const kusok_id *known, size_t nknown,
		 kusok_bundle_report *r);
/* каждому файлу из пакета — хотя бы одна ссылка */
int kusok_import(kusok *ks, int fd, kusok_bundle_report *r);

/* id всех кусков и манифестов — то, что передают в known */
typedef int (*kusok_id_cb)(const kusok_id *id, void *ctx);
int kusok_list_ids(kusok *ks, kusok_id_cb cb, void *ctx);

const char *kusok_strerror(int err);
void kusok_id_hex(const kusok_id *id, char out[KUSOK_HEX_LEN + 1]);
int kusok_id_parse(const char *hex, kusok_id *id);

#ifdef __cplusplus
}
#endif

#endif /* KUSOK_H */
