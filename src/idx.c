/*
 * формат:
 *   "KUSOKIX1", u32 версия, u32 id pack, u64 длина pack, u64 n,
 *   n раз: u64 off, u32 slen, u32 rlen, u8 тип, u8 кодек, u16 0, [32] id,
 *   u32 crc32c всего выше
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include "idx.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "bytes.h"
#include "crc32c.h"
#include "fsutil.h"
#include "kusok/kusok.h"

#define IDX_VERSION 1u

void ks_idx_name(uint32_t id, char out[32])
{
	snprintf(out, 32, "%08u.idx", id);
}

int ks_idx_parse_name(const char *name, uint32_t *id)
{
	uint32_t v = 0;
	for (int i = 0; i < 8; i++) {
		if (name[i] < '0' || name[i] > '9')
			return -1;
		v = v * 10 + (uint32_t)(name[i] - '0');
	}
	if (strcmp(name + 8, ".idx") != 0)
		return -1;
	*id = v;
	return 0;
}

struct sbor {
	uint8_t *buf;
	size_t n, cap;
	uint64_t kol;
};

static int dobavit(const ks_rec *r, uint64_t off, void *ctx)
{
	struct sbor *s = ctx;
	if (s->n + KS_IDX_ENT > s->cap) {
		size_t nc = s->cap * 2;
		uint8_t *nb = realloc(s->buf, nc);
		if (!nb)
			return KUSOK_ENOMEM;
		s->buf = nb;
		s->cap = nc;
	}
	uint8_t *e = s->buf + s->n;
	memset(e, 0, KS_IDX_ENT);
	st64(e, off);
	st32(e + 8, r->slen);
	st32(e + 12, r->rlen);
	e[16] = r->type;
	e[17] = r->codec;
	memcpy(e + 20, r->id, 32);
	s->n += KS_IDX_ENT;
	s->kol++;
	return KUSOK_OK;
}

int ks_idx_build(int packsfd, const ks_pack *p)
{
	struct sbor s = {malloc(65536), KS_IDX_HDR, 65536, 0};
	if (!s.buf)
		return KUSOK_ENOMEM;
	uint64_t good;
	int rc = ks_pack_scan(p, 0, dobavit, &s, &good, NULL);
	if (!rc && good != p->len)
		rc = KUSOK_ECORRUPT;
	if (!rc && s.n + 4 > s.cap) {
		uint8_t *nb = realloc(s.buf, s.n + 4);
		if (!nb)
			rc = KUSOK_ENOMEM;
		else
			s.buf = nb;
	}
	if (!rc) {
		memcpy(s.buf, KS_IDX_MAGIC, 8);
		st32(s.buf + 8, IDX_VERSION);
		st32(s.buf + 12, p->id);
		st64(s.buf + 16, p->len);
		st64(s.buf + 24, s.kol);
		st32(s.buf + s.n, ks_crc32c(0, s.buf, s.n));
		char name[32];
		ks_idx_name(p->id, name);
		rc = ks_write_atomic(packsfd, name, s.buf, s.n + 4);
	}
	free(s.buf);
	return rc;
}

int ks_idx_load(int packsfd, const ks_pack *p, ks_scan_cb cb, void *ctx,
		uint64_t *len)
{
	char name[32];
	ks_idx_name(p->id, name);
	uint8_t *b;
	size_t n;
	int rc = ks_read_file(packsfd, name, &b, &n);
	if (rc)
		return rc;
	rc = KUSOK_ECORRUPT;
	if (n < KS_IDX_HDR + 4 || memcmp(b, KS_IDX_MAGIC, 8) ||
	    ld32(b + 8) != IDX_VERSION || ld32(b + 12) != p->id)
		goto out;
	uint64_t kol = ld64(b + 24), dlina = ld64(b + 16);
	if (kol > (n - KS_IDX_HDR - 4) / KS_IDX_ENT ||
	    KS_IDX_HDR + kol * KS_IDX_ENT + 4 != n)
		goto out;
	if (ld32(b + n - 4) != ks_crc32c(0, b, n - 4))
		goto out;
	/* индекс не может знать больше, чем лежит в pack */
	if (dlina > p->len + p->tail || dlina < KS_PACK_HDR)
		goto out;
	uint64_t prev = KS_PACK_HDR;
	for (uint64_t i = 0; i < kol; i++) {
		const uint8_t *e = b + KS_IDX_HDR + i * KS_IDX_ENT;
		ks_rec r;
		uint64_t off = ld64(e);
		r.slen = ld32(e + 8);
		r.rlen = ld32(e + 12);
		r.type = e[16];
		r.codec = e[17];
		memcpy(r.id, e + 20, 32);
		if (!ks_rec_sane(&r) || off != prev ||
		    off + KS_REC_HDR + r.slen > dlina)
			goto out;
		prev = off + KS_REC_HDR + r.slen;
	}
	if (prev != dlina)
		goto out;
	/* всё проверили — теперь отдаём */
	for (uint64_t i = 0; i < kol; i++) {
		const uint8_t *e = b + KS_IDX_HDR + i * KS_IDX_ENT;
		ks_rec r;
		r.slen = ld32(e + 8);
		r.rlen = ld32(e + 12);
		r.type = e[16];
		r.codec = e[17];
		memcpy(r.id, e + 20, 32);
		rc = cb(&r, ld64(e), ctx);
		if (rc)
			goto out;
	}
	*len = dlina;
	rc = KUSOK_OK;
out:
	free(b);
	return rc;
}

int ks_idx_remove(int packsfd, uint32_t id)
{
	char name[32];
	ks_idx_name(id, name);
	if (unlinkat(packsfd, name, 0) && errno != ENOENT)
		return KUSOK_EIO;
	return KUSOK_OK;
}
