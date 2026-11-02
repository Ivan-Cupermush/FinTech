/*
 * пакет для переноса между хранилищами (бэкап с сервера).
 *
 *   "KUSOKBN1", u32 версия, u32 0
 *   'R' + запись как в pack (48 байт + данные) — куски и манифесты
 *   'T' + u64 n + n раз (id[32], i64 ссылок) + u32 crc32c
 *   'E'
 *
 * всё читается подряд, поэтому годится труба: ssh ... export - | import -
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "bytes.h"
#include "crc32c.h"
#include "fsutil.h"
#include "lz.h"
#include "store_int.h"

#define BN_MAGIC "KUSOKBN1"
#define BN_VERSION 1u
#define BN_MAX_FILES (1u << 26)

/* ------------------------------------------------------------ запись */

struct pisatel {
	int fd;
	uint8_t buf[65536];
	size_t n;
	uint64_t vsego;
};

static int sbrosit(struct pisatel *w)
{
	int rc = ks_write_all(w->fd, w->buf, w->n);
	w->n = 0;
	return rc;
}

static int vyvesti(struct pisatel *w, const void *p, size_t n)
{
	w->vsego += n;
	if (w->n + n > sizeof(w->buf)) {
		int rc = sbrosit(w);
		if (rc)
			return rc;
		if (n > sizeof(w->buf))
			return ks_write_all(w->fd, p, n);
	}
	memcpy(w->buf + w->n, p, n);
	w->n += n;
	return KUSOK_OK;
}

static int zapis(struct pisatel *w, kusok *ks, const ks_ent *e)
{
	const uint8_t *pl;
	int rc = ks_load_rec(ks, e, &pl);
	if (rc)
		return rc;
	ks_rec r = {.type = e->type,
		    .codec = e->codec,
		    .slen = e->slen,
		    .rlen = e->rlen};
	memcpy(r.id, e->id, 32);
	uint8_t hdr[1 + KS_REC_HDR];
	hdr[0] = 'R';
	ks_rec_encode(&r, pl, hdr + 1);
	rc = vyvesti(w, hdr, sizeof(hdr));
	return rc ? rc : vyvesti(w, pl, e->slen);
}

int kusok_export(kusok *ks, int fd, const kusok_id *known, size_t nknown,
		 kusok_bundle_report *rep)
{
	kusok_bundle_report tmp;
	if (!rep)
		rep = &tmp;
	memset(rep, 0, sizeof(*rep));
	if (!ks || fd < 0 || (nknown && !known))
		return KUSOK_EINVAL;
	struct pisatel *w = malloc(sizeof(*w));
	/* что не кладём: есть у получателя или уже положили.
	 * куски и манифесты врозь: у файла из одного куска id совпадают */
	ks_tab uzhe, uzhe_mf;
	if (!w)
		return KUSOK_ENOMEM;
	w->fd = fd;
	w->n = 0;
	w->vsego = 0;
	int rc = ks_tab_init(&uzhe, 32, nknown + 1024);
	if (rc) {
		free(w);
		return rc;
	}
	if ((rc = ks_tab_init(&uzhe_mf, 32, nknown + 64))) {
		ks_tab_free(&uzhe);
		free(w);
		return rc;
	}
	for (size_t i = 0; i < nknown && !rc; i++) {
		void *slot;
		rc = ks_tab_put(&uzhe, known[i].b, &slot, NULL);
		if (!rc)
			rc = ks_tab_put(&uzhe_mf, known[i].b, &slot, NULL);
	}
	uint8_t h[16];
	memcpy(h, BN_MAGIC, 8);
	st32(h + 8, BN_VERSION);
	st32(h + 12, 0);
	if (!rc)
		rc = vyvesti(w, h, sizeof(h));

	/* живые файлы: сначала их куски, потом манифест */
	uint8_t *tabl = NULL;
	uint64_t nf = 0;
	for (size_t i = ks_tab_next(&ks->refs, 0); !rc && i < ks->refs.cap;
	     i = ks_tab_next(&ks->refs, i + 1)) {
		ks_ref ref = *(ks_ref *)ks_tab_at(&ks->refs, i);
		if (ref.refs <= 0)
			continue;
		rc = ks_load_mf(ks, ref.id, 1);
		for (uint32_t k = 0; !rc && k < ks->mf.n; k++) {
			const uint8_t *cid = ks->mf.ids[k];
			int fresh;
			void *slot;
			rc = ks_tab_put(&uzhe, cid, &slot, &fresh);
			if (rc || !fresh) {
				rep->skipped += !rc;
				continue;
			}
			ks_ent *e = ks_tab_get(&ks->chunks, cid);
			rc = e ? zapis(w, ks, e) : KUSOK_ECORRUPT;
			rep->chunks++;
		}
		if (rc)
			break;
		int fresh;
		void *slot;
		rc = ks_tab_put(&uzhe_mf, ref.id, &slot, &fresh);
		if (!rc && fresh) {
			ks_ent *e = ks_tab_get(&ks->files, ref.id);
			rc = e ? zapis(w, ks, e) : KUSOK_ECORRUPT;
		}
		if (rc)
			break;
		uint8_t *nt = realloc(tabl, (size_t)(nf + 1) * 40);
		if (!nt) {
			rc = KUSOK_ENOMEM;
			break;
		}
		tabl = nt;
		memcpy(tabl + nf * 40, ref.id, 32);
		st64(tabl + nf * 40 + 32, (uint64_t)ref.refs);
		nf++;
	}
	if (!rc) {
		uint8_t t[9];
		t[0] = 'T';
		st64(t + 1, nf);
		uint8_t c[5];
		st32(c,
		     ks_crc32c(ks_crc32c(0, t + 1, 8), tabl, (size_t)nf * 40));
		c[4] = 'E';
		if (!(rc = vyvesti(w, t, sizeof(t))) &&
		    !(rc = vyvesti(w, tabl, (size_t)nf * 40)) &&
		    !(rc = vyvesti(w, c, sizeof(c))))
			rc = sbrosit(w);
	}
	rep->files = nf;
	rep->bytes = w->vsego;
	free(tabl);
	free(w);
	ks_tab_free(&uzhe);
	ks_tab_free(&uzhe_mf);
	return rc;
}

/* ------------------------------------------------------------ чтение */

struct chitatel {
	int fd;
	uint8_t buf[65536];
	size_t beg, end;
	uint64_t vsego;
};

/* ровно n байт; конец раньше — пакет оборван */
static int vzyat(struct chitatel *c, void *p, size_t n)
{
	uint8_t *o = p;
	c->vsego += n;
	while (n) {
		if (c->beg == c->end) {
			size_t got;
			int rc =
			    ks_read_some(c->fd, c->buf, sizeof(c->buf), &got);
			if (rc)
				return rc;
			if (!got)
				return KUSOK_ECORRUPT;
			c->beg = 0;
			c->end = got;
		}
		size_t k = c->end - c->beg < n ? c->end - c->beg : n;
		memcpy(o, c->buf + c->beg, k);
		c->beg += k;
		o += k;
		n -= k;
	}
	return KUSOK_OK;
}

/*
 * n байт в растущий буфер. память растёт вместе с пришедшими данными,
 * а не по заявленной длине: врущая длина не съест всю память
 */
static int vzyat_v(struct chitatel *c, uint8_t **buf, size_t *cap, size_t n)
{
	size_t est = 0;
	while (est < n) {
		size_t shag = n - est;
		size_t predel = est > 65536 ? est : 65536;
		if (shag > predel)
			shag = predel;
		if (est + shag > *cap) {
			uint8_t *nb = realloc(*buf, est + shag);
			if (!nb)
				return KUSOK_ENOMEM;
			*buf = nb;
			*cap = est + shag;
		}
		int rc = vzyat(c, *buf + est, shag);
		if (rc)
			return rc;
		est += shag;
	}
	return KUSOK_OK;
}

/* проверить, что содержимое записи — правда то, что в id */
static int proverit(kusok *ks, const ks_rec *r, const uint8_t *pl,
		    uint8_t **raw, size_t *rawcap)
{
	const uint8_t *d = pl;
	if (r->codec == KS_CODEC_LZ) {
		if (r->rlen / 255 > r->slen)
			return KUSOK_ECORRUPT; /* lz4 так не раздувает */
		if (r->rlen > *rawcap) {
			uint8_t *nb = realloc(*raw, r->rlen);
			if (!nb)
				return KUSOK_ENOMEM;
			*raw = nb;
			*rawcap = r->rlen;
		}
		size_t got;
		if (ks_lz_decompress(pl, r->slen, *raw, r->rlen, &got) ||
		    got != r->rlen)
			return KUSOK_ECORRUPT;
		d = *raw;
	} else if (r->slen != r->rlen) {
		return KUSOK_ECORRUPT;
	}
	if (r->type == KS_REC_CHUNK) {
		if (r->rlen > ks->o.max_chunk)
			return KUSOK_ETOOBIG; /* у получателя куски мельче */
		uint8_t id[32];
		ks_sha256_buf(d, r->rlen, id);
		return memcmp(id, r->id, 32) ? KUSOK_ECORRUPT : KUSOK_OK;
	}
	ks_manifest m;
	ks_mf_init(&m);
	int rc = ks_mf_decode(d, r->rlen, ks->o.max_chunk, &m);
	ks_mf_free(&m);
	return rc;
}

/* у файла есть манифест и все куски */
static int celyi(kusok *ks, const uint8_t id[32])
{
	if (!ks_tab_get(&ks->files, id))
		return 0;
	if (ks_load_mf(ks, id, 0))
		return 0;
	for (uint32_t i = 0; i < ks->mf.n; i++)
		if (!ks_tab_get(&ks->chunks, ks->mf.ids[i]))
			return 0;
	return 1;
}

static int tablica(kusok *ks, struct chitatel *c, kusok_bundle_report *rep)
{
	uint8_t n8[8];
	int rc = vzyat(c, n8, 8);
	if (rc)
		return rc;
	uint64_t n = ld64(n8);
	if (n > BN_MAX_FILES)
		return KUSOK_ECORRUPT;
	uint8_t *t = NULL;
	size_t tcap = 0;
	uint8_t crc[5];
	rc = vzyat_v(c, &t, &tcap, (size_t)n * 40);
	if (!rc)
		rc = vzyat(c, crc, 5);
	if (!rc &&
	    (ld32(crc) != ks_crc32c(ks_crc32c(0, n8, 8), t, (size_t)n * 40) ||
	     crc[4] != 'E'))
		rc = KUSOK_ECORRUPT;
	/* сначала проверить всё, потом менять ссылки */
	for (uint64_t i = 0; !rc && i < n; i++)
		if (!celyi(ks, t + i * 40))
			rc = KUSOK_ECORRUPT;
	for (uint64_t i = 0; !rc && i < n; i++) {
		const uint8_t *id = t + i * 40;
		if (ks_refs_of(ks, id) > 0)
			continue;
		rc = ks_journal_add(&ks->jr, id, KS_JR_INC);
		if (!rc)
			rc = ks_refs_apply(&ks->refs, id, 1);
		rep->files++;
	}
	free(t);
	return rc;
}

int kusok_import(kusok *ks, int fd, kusok_bundle_report *rep)
{
	kusok_bundle_report tmp;
	if (!rep)
		rep = &tmp;
	memset(rep, 0, sizeof(*rep));
	if (!ks || fd < 0)
		return KUSOK_EINVAL;
	if (ks->o.read_only)
		return KUSOK_ERDONLY;
	if (ks->busy)
		return KUSOK_EBUSY;
	struct chitatel *c = malloc(sizeof(*c));
	if (!c)
		return KUSOK_ENOMEM;
	c->fd = fd;
	c->beg = c->end = 0;
	c->vsego = 0;
	uint8_t *pl = NULL, *raw = NULL;
	size_t plcap = 0, rawcap = 0;
	uint8_t h[16];
	int rc = vzyat(c, h, sizeof(h));
	if (!rc && (memcmp(h, BN_MAGIC, 8) || ld32(h + 12) != 0))
		rc = KUSOK_ECORRUPT;
	if (!rc && ld32(h + 8) != BN_VERSION)
		rc = KUSOK_EFORMAT;
	while (!rc) {
		uint8_t kind;
		rc = vzyat(c, &kind, 1);
		if (rc)
			break;
		if (kind == 'T') {
			rc = tablica(ks, c, rep);
			break;
		}
		if (kind != 'R') {
			rc = KUSOK_ECORRUPT;
			break;
		}
		uint8_t hdr[KS_REC_HDR];
		ks_rec r;
		uint32_t crc;
		rc = vzyat(c, hdr, sizeof(hdr));
		if (!rc)
			rc = ks_rec_decode(hdr, &r, &crc);
		if (rc)
			break;
		if (r.type == KS_REC_CHUNK &&
		    (r.rlen > ks->o.max_chunk || r.slen > r.rlen)) {
			rc = r.rlen > ks->o.max_chunk ? KUSOK_ETOOBIG
						      : KUSOK_ECORRUPT;
			break;
		}
		rc = vzyat_v(c, &pl, &plcap, r.slen);
		if (!rc && ks_rec_crc(hdr, pl, r.slen) != crc)
			rc = KUSOK_ECORRUPT;
		if (rc)
			break;
		ks_tab *t = r.type == KS_REC_CHUNK ? &ks->chunks : &ks->files;
		if (ks_tab_get(t, r.id)) {
			rep->skipped++;
			continue;
		}
		rc = proverit(ks, &r, pl, &raw, &rawcap);
		if (!rc)
			rc = ks_write_rec(ks, t, &r, pl);
		rep->chunks += r.type == KS_REC_CHUNK;
	}
	rep->bytes = c->vsego;
	if (!rc && ks->o.sync)
		rc = ks_pack_sync(ks_active(ks));
	if (!rc && ks->o.sync)
		rc = ks_journal_sync(&ks->jr);
	ks_drop_caches(ks);
	free(pl);
	free(raw);
	free(c);
	return rc;
}

int kusok_list_ids(kusok *ks, kusok_id_cb cb, void *ctx)
{
	if (!ks || !cb)
		return KUSOK_EINVAL;
	ks_tab *tt[2] = {&ks->chunks, &ks->files};
	for (int k = 0; k < 2; k++)
		for (size_t i = ks_tab_next(tt[k], 0); i < tt[k]->cap;
		     i = ks_tab_next(tt[k], i + 1)) {
			kusok_id id;
			memcpy(id.b, ks_tab_at(tt[k], i), 32);
			int rc = cb(&id, ctx);
			if (rc)
				return rc;
		}
	return KUSOK_OK;
}
