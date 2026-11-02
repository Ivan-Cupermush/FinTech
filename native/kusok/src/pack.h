/*
 * pack-файл: заголовок 24 байта и записи, только дописываем в конец.
 * формат расписан в docs/ARCHITECTURE.md
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_PACK_H
#define KS_PACK_H

#include <stddef.h>
#include <stdint.h>

#define KS_PACK_MAGIC "KUSOKPK1"
#define KS_PACK_VERSION 1u
#define KS_PACK_HDR 24u
#define KS_REC_HDR 48u
#define KS_REC_MAX (1u << 30)

enum { KS_REC_CHUNK = 1, KS_REC_MANIFEST = 2 };
enum { KS_CODEC_RAW = 0, KS_CODEC_LZ = 1 };

typedef struct ks_rec {
	uint8_t type;
	uint8_t codec;
	uint32_t slen;
	uint32_t rlen;
	uint8_t id[32];
} ks_rec;

typedef struct ks_pack {
	int fd;
	uint32_t id;
	uint64_t len;
	uint64_t tail; /* рваный хвост за len */
} ks_pack;

/* "%08u.pack" */
void ks_pack_name(uint32_t id, char out[32]);
int ks_pack_parse_name(const char *name, uint32_t *id);

void ks_rec_encode(const ks_rec *r, const void *payload,
		   uint8_t hdr[KS_REC_HDR]);
/* CRC записи: байты [4..48) заголовка и данные */
uint32_t ks_rec_crc(const uint8_t hdr[KS_REC_HDR], const void *payload,
		    uint32_t slen);
int ks_rec_decode(const uint8_t hdr[KS_REC_HDR], ks_rec *r, uint32_t *crc);
int ks_rec_sane(const ks_rec *r);

int ks_pack_create(int dirfd, uint32_t id, ks_pack *p);
int ks_pack_open(int dirfd, uint32_t id, int rw, ks_pack *p);
void ks_pack_close(ks_pack *p);

int ks_pack_append(ks_pack *p, const ks_rec *r, const void *payload,
		   uint64_t *off);
/* read проверяет CRC */
int ks_pack_read_hdr(const ks_pack *p, uint64_t off, ks_rec *r);
int ks_pack_read(const ks_pack *p, uint64_t off, ks_rec *r, uint8_t *payload,
		 size_t cap);

/*
 * обход записей. verify = 0 — только заголовки.
 * битые данные пропускаем (*bad++), на битом заголовке стоп
 */
typedef int (*ks_scan_cb)(const ks_rec *r, uint64_t off, void *ctx);
int ks_pack_scan(const ks_pack *p, int verify, ks_scan_cb cb, void *ctx,
		 uint64_t *good_end, uint64_t *bad);

int ks_pack_sync(ks_pack *p);

#endif
