/*
 * открытие, запись, чтение. каталог: FORMAT, LOCK, packs/, refs.snap, refs.log
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include "fsutil.h"
#include "idx.h"
#include "lz.h"
#include "store_int.h"

#define FORMAT_NAME "FORMAT"
#define FORMAT_TEXT "kusok store v1\n"

void kusok_opts_default(kusok_opts *o)
{
	memset(o, 0, sizeof(*o));
	o->min_chunk = 2048;
	o->avg_chunk = 8192;
	o->max_chunk = 65536;
	o->pack_limit = 64u << 20;
	o->compress = 1;
	o->sync = 1;
	o->cache_chunks = 64;
}

/* ------------------------------------------------------------ мелочи */

int ks_tmp_reserve(kusok *ks, size_t n)
{
	if (n <= ks->tmp_cap)
		return KUSOK_OK;
	size_t nc = ks->tmp_cap ? ks->tmp_cap : 65536;
	while (nc < n)
		nc *= 2;
	uint8_t *p = realloc(ks->tmp, nc);
	if (!p)
		return KUSOK_ENOMEM;
	ks->tmp = p;
	ks->tmp_cap = nc;
	return KUSOK_OK;
}

ks_pack *ks_pack_by_id(kusok *ks, uint32_t id)
{
	size_t l = 0, r = ks->npacks;
	while (l < r) {
		size_t m = l + (r - l) / 2;
		if (ks->packs[m].id == id)
			return &ks->packs[m];
		if (ks->packs[m].id < id)
			l = m + 1;
		else
			r = m;
	}
	return NULL;
}

ks_pack *ks_active(kusok *ks)
{
	return ks->npacks ? &ks->packs[ks->npacks - 1] : NULL;
}

static int packs_push(kusok *ks, const ks_pack *p)
{
	if (ks->npacks == ks->cappacks) {
		size_t nc = ks->cappacks ? ks->cappacks * 2 : 8;
		ks_pack *a = realloc(ks->packs, nc * sizeof(*a));
		if (!a)
			return KUSOK_ENOMEM;
		ks->packs = a;
		ks->cappacks = nc;
	}
	ks->packs[ks->npacks++] = *p;
	return KUSOK_OK;
}

int ks_roll(kusok *ks)
{
	ks_pack nov;
	uint32_t id = 1;
	ks_pack *a = ks_active(ks);
	if (a) {
		/* старый pack на диск раньше нового */
		int rc = ks_pack_sync(a);
		if (rc)
			return rc;
		/* индекс — только ускорение, без него просто обход */
		if (ks_idx_build(ks->packsfd, a))
			(void)ks_idx_remove(ks->packsfd, a->id);
		id = a->id + 1;
	}
	int rc = ks_pack_create(ks->packsfd, id, &nov);
	if (rc)
		return rc;
	rc = packs_push(ks, &nov);
	if (rc)
		ks_pack_close(&nov);
	return rc;
}

int ks_append(kusok *ks, const ks_rec *r, const void *payload, uint32_t *pack,
	      uint64_t *off)
{
	if (ks->o.read_only)
		return KUSOK_ERDONLY;
	ks_pack *a = ks_active(ks);
	if (!a || a->len >= ks->o.pack_limit) {
		int rc = ks_roll(ks);
		if (rc)
			return rc;
		a = ks_active(ks);
	}
	*pack = a->id;
	return ks_pack_append(a, r, payload, off);
}

static void ent_set(ks_ent *e, const ks_rec *r, uint32_t pack, uint64_t off)
{
	e->off = off;
	e->pack = pack;
	e->slen = r->slen;
	e->rlen = r->rlen;
	e->type = r->type;
	e->codec = r->codec;
}

int ks_load_rec(kusok *ks, const ks_ent *e, const uint8_t **payload)
{
	ks_pack *p = ks_pack_by_id(ks, e->pack);
	if (!p)
		return KUSOK_ECORRUPT;
	int rc = ks_tmp_reserve(ks, e->slen ? e->slen : 1);
	if (rc)
		return rc;
	ks_rec r;
	rc = ks_pack_read(p, e->off, &r, ks->tmp, ks->tmp_cap);
	if (rc)
		return rc == KUSOK_ETOOBIG ? KUSOK_ECORRUPT : rc;
	if (r.type != e->type || r.slen != e->slen || memcmp(r.id, e->id, 32))
		return KUSOK_ECORRUPT;
	*payload = ks->tmp;
	return KUSOK_OK;
}

int ks_load_chunk(kusok *ks, const uint8_t id[32], uint32_t want_len,
		  const uint8_t **data)
{
	uint32_t len;
	const uint8_t *v = ks_cache_get(&ks->cache, id, &len);
	if (v) {
		*data = v;
		return len == want_len ? KUSOK_OK : KUSOK_ECORRUPT;
	}
	ks_ent *e = ks_tab_get(&ks->chunks, id);
	if (!e || e->rlen != want_len)
		return KUSOK_ECORRUPT;
	const uint8_t *pl;
	int rc = ks_load_rec(ks, e, &pl);
	if (rc)
		return rc;
	uint8_t *buf;
	rc = ks_cache_put(&ks->cache, id, e->rlen, &buf);
	if (rc)
		return rc;
	if (e->codec == KS_CODEC_RAW) {
		memcpy(buf, pl, e->rlen);
	} else {
		size_t got;
		rc = ks_lz_decompress(pl, e->slen, buf, e->rlen, &got);
		if (rc || got != e->rlen) {
			ks_cache_drop(&ks->cache, id);
			return KUSOK_ECORRUPT;
		}
	}
	*data = buf;
	return KUSOK_OK;
}

int64_t ks_refs_of(const kusok *ks, const uint8_t id[32])
{
	const ks_ref *r = ks_tab_get(&ks->refs, id);
	return r ? r->refs : 0;
}

int ks_load_mf(kusok *ks, const uint8_t id[32], int live)
{
	if (live && ks_refs_of(ks, id) <= 0)
		return KUSOK_ENOTFOUND;
	if (ks->mf_ok && memcmp(ks->mf_id, id, 32) == 0)
		return KUSOK_OK;
	ks_ent *e = ks_tab_get(&ks->files, id);
	if (!e)
		return live ? KUSOK_ECORRUPT : KUSOK_ENOTFOUND;
	const uint8_t *pl;
	int rc = ks_load_rec(ks, e, &pl);
	if (rc)
		return rc;
	ks->mf_ok = 0;
	rc = ks_mf_decode(pl, e->slen, KS_CDC_MAX_LIMIT, &ks->mf);
	if (rc)
		return rc;
	memcpy(ks->mf_id, id, 32);
	ks->mf_ok = 1;
	return KUSOK_OK;
}

int ks_mf_size_of(kusok *ks, const ks_ent *e, uint64_t *size)
{
	uint8_t h[KS_MF_HDR];
	ks_pack *p = ks_pack_by_id(ks, e->pack);
	if (!p || e->slen < KS_MF_HDR)
		return KUSOK_ECORRUPT;
	int rc = ks_pread_full(p->fd, h, KS_MF_HDR, e->off + KS_REC_HDR);
	if (rc)
		return rc;
	return ks_mf_peek_size(h, size);
}

void ks_drop_caches(kusok *ks)
{
	ks_cache_clear(&ks->cache);
	ks->mf_ok = 0;
}

/* ------------------------------------------------------------ открытие */

struct scan_ctx {
	kusok *ks;
	uint32_t pack;
};

static int scan_add(const ks_rec *r, uint64_t off, void *ctx)
{
	struct scan_ctx *sc = ctx;
	ks_tab *t = r->type == KS_REC_CHUNK ? &sc->ks->chunks : &sc->ks->files;
	void *slot;
	int fresh;
	int rc = ks_tab_put(t, r->id, &slot, &fresh);
	if (rc)
		return rc;
	/* после сбоя в gc запись бывает дважды, берём первую */
	if (fresh)
		ent_set(slot, r, sc->pack, off);
	return KUSOK_OK;
}

static int cmp_u32(const void *a, const void *b)
{
	uint32_t x = *(const uint32_t *)a, y = *(const uint32_t *)b;
	return (x > y) - (x < y);
}

static int list_packs(kusok *ks, uint32_t **ids, size_t *n)
{
	int fd = dup(ks->packsfd);
	if (fd < 0)
		return KUSOK_EIO;
	DIR *d = fdopendir(fd);
	if (!d) {
		close(fd);
		return KUSOK_EIO;
	}
	rewinddir(d);
	uint32_t *a = NULL;
	size_t kol = 0, cap = 0;
	int rc = KUSOK_OK;
	struct dirent *de;
	while ((de = readdir(d))) {
		uint32_t id;
		if (ks_pack_parse_name(de->d_name, &id))
			continue;
		if (kol == cap) {
			size_t nc = cap ? cap * 2 : 16;
			uint32_t *na = realloc(a, nc * sizeof(*na));
			if (!na) {
				rc = KUSOK_ENOMEM;
				break;
			}
			a = na;
			cap = nc;
		}
		a[kol++] = id;
	}
	closedir(d);
	if (rc) {
		free(a);
		return rc;
	}
	if (kol)
		qsort(a, kol, sizeof(*a), cmp_u32);
	*ids = a;
	*n = kol;
	return KUSOK_OK;
}

static int load_packs(kusok *ks)
{
	uint32_t *ids;
	size_t n;
	int rw = !ks->o.read_only;
	int last_rw = 0;
	int rc = list_packs(ks, &ids, &n);
	if (rc)
		return rc;
	for (size_t i = 0; i < n && !rc; i++) {
		int last = i + 1 == n;
		ks_pack p;
		rc = ks_pack_open(ks->packsfd, ids[i], rw && last, &p);
		if (rc == KUSOK_ECORRUPT && last && rw) {
			/* пустой недописанный pack — удаляем */
			struct stat st;
			char name[32];
			ks_pack_name(ids[i], name);
			if (fstatat(ks->packsfd, name, &st, 0) == 0 &&
			    st.st_size <= (off_t)KS_PACK_HDR) {
				rc = unlinkat(ks->packsfd, name, 0) ? KUSOK_EIO
								    : KUSOK_OK;
				continue;
			}
		}
		if (rc == KUSOK_ECORRUPT && ks->o.salvage) {
			rc = KUSOK_OK;
			ks->salvaged++;
			continue;
		}
		if (rc)
			break;
		struct scan_ctx sc = {ks, p.id};
		uint64_t good;
		int seal = 0;
		rc = KUSOK_ENOTFOUND;
		if (!last && !ks->o.salvage) {
			rc = ks_idx_load(ks->packsfd, &p, scan_add, &sc, &good);
			if (!rc)
				ks->idx_hits++;
		}
		if (rc == KUSOK_ENOTFOUND || rc == KUSOK_ECORRUPT) {
			/* CRC проверяем только у последнего */
			rc = ks_pack_scan(&p, last, scan_add, &sc, &good, NULL);
			if (!rc && !last && rw && good == p.len)
				(void)ks_idx_build(ks->packsfd, &p);
		}
		if (!rc && good < p.len) {
			if (last) {
				/* рваный хвост: не режем, пишем в новый pack */
				p.tail = p.len - good;
				p.len = good;
				seal = 1;
			} else if (ks->o.salvage) {
				p.tail = p.len - good;
				p.len = good;
				ks->salvaged++;
			} else {
				rc = KUSOK_ECORRUPT;
			}
		}
		if (!rc && last && rw && !seal) {
			/* в него будем дописывать — старый индекс врёт */
			rc = ks_idx_remove(ks->packsfd, p.id);
			if (!rc)
				rc = ks_fsync_dir(ks->packsfd);
		}
		if (!rc)
			rc = packs_push(ks, &p);
		if (rc)
			ks_pack_close(&p);
		else
			last_rw = rw && last && !seal;
	}
	free(ids);
	if (rc)
		return rc;
	if (rw) {
		ks_pack *a = ks_active(ks);
		if (!a || !last_rw || a->len >= ks->o.pack_limit)
			rc = ks_roll(ks);
	}
	return rc;
}

static int check_format(kusok *ks)
{
	uint8_t *buf;
	size_t n;
	int rc = ks_read_file(ks->dirfd, FORMAT_NAME, &buf, &n);
	if (rc == KUSOK_ENOTFOUND && !ks->o.read_only)
		return ks_write_atomic(ks->dirfd, FORMAT_NAME, FORMAT_TEXT,
				       strlen(FORMAT_TEXT));
	if (rc)
		return rc;
	if (n != strlen(FORMAT_TEXT) || memcmp(buf, FORMAT_TEXT, n) != 0)
		rc = KUSOK_EFORMAT;
	free(buf);
	return rc;
}

static int check_opts(const kusok_opts *o, ks_cdc *cdc)
{
	if (o->pack_limit < 4096 || o->pack_limit > (1u << 30))
		return KUSOK_EINVAL;
	if (o->threads < 0 || o->threads > KS_POOL_MAX)
		return KUSOK_EINVAL;
	if (o->compress < 0 || o->compress > KS_LZ_HC_MAX)
		return KUSOK_EINVAL;
	if (o->cache_chunks < 1 || o->cache_chunks > 65536)
		return KUSOK_EINVAL;
	return ks_cdc_init(cdc, o->min_chunk, o->avg_chunk, o->max_chunk);
}

int kusok_open(const char *dir, const kusok_opts *opts, kusok **out)
{
	kusok_opts def;
	kusok_opts_default(&def);
	if (opts) {
		kusok_opts o = *opts;
		if (!o.min_chunk)
			o.min_chunk = def.min_chunk;
		if (!o.avg_chunk)
			o.avg_chunk = def.avg_chunk;
		if (!o.max_chunk)
			o.max_chunk = def.max_chunk;
		if (!o.pack_limit)
			o.pack_limit = def.pack_limit;
		if (!o.cache_chunks)
			o.cache_chunks = def.cache_chunks;
		def = o;
	}
	if (!dir || !out)
		return KUSOK_EINVAL;
	kusok *ks = calloc(1, sizeof(*ks));
	if (!ks)
		return KUSOK_ENOMEM;
	ks->o = def;
	ks->dirfd = ks->packsfd = ks->lockfd = -1;
	ks->jr.fd = -1;
	ks_mf_init(&ks->mf);
	int rw = !ks->o.read_only;
	int rc = check_opts(&ks->o, &ks->cdc);
	if (rc)
		goto fail;

	if (rw && mkdir(dir, 0755) && errno != EEXIST) {
		rc = KUSOK_EIO;
		goto fail;
	}
	ks->dirfd = open(dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
	if (ks->dirfd < 0) {
		rc = errno == ENOENT ? KUSOK_ENOTFOUND : KUSOK_EIO;
		goto fail;
	}
	ks->lockfd =
	    openat(ks->dirfd, "LOCK",
		   (rw ? O_RDWR | O_CREAT : O_RDONLY) | O_CLOEXEC, 0644);
	if (ks->lockfd < 0) {
		rc = errno == ENOENT ? KUSOK_ENOTFOUND : KUSOK_EIO;
		goto fail;
	}
	if (flock(ks->lockfd, (rw ? LOCK_EX : LOCK_SH) | LOCK_NB)) {
		rc = errno == EWOULDBLOCK ? KUSOK_ELOCKED : KUSOK_EIO;
		goto fail;
	}
	rc = check_format(ks);
	if (rc)
		goto fail;
	if (rw && mkdirat(ks->dirfd, "packs", 0755) && errno != EEXIST) {
		rc = KUSOK_EIO;
		goto fail;
	}
	ks->packsfd =
	    openat(ks->dirfd, "packs", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
	if (ks->packsfd < 0) {
		rc = errno == ENOENT ? KUSOK_ECORRUPT : KUSOK_EIO;
		goto fail;
	}
	if ((rc = ks_tab_init(&ks->chunks, sizeof(ks_ent), 1024)) ||
	    (rc = ks_tab_init(&ks->files, sizeof(ks_ent), 64)) ||
	    (rc = ks_tab_init(&ks->refs, sizeof(ks_ref), 64)) ||
	    (rc = ks_cache_init(&ks->cache, (uint32_t)ks->o.cache_chunks)))
		goto fail;
	rc = load_packs(ks);
	if (rc)
		goto fail;
	rc = ks_journal_open(ks->dirfd, rw, &ks->refs, &ks->jr);
	if (rc)
		goto fail;
	if (rw && ks->o.threads > 1) {
		rc = ks_pool_new((unsigned)ks->o.threads, &ks->pool);
		if (rc)
			goto fail;
	}
	*out = ks;
	return KUSOK_OK;
fail:
	ks->o.read_only = 1;
	kusok_close(ks);
	return rc;
}

int kusok_close(kusok *ks)
{
	int rc = KUSOK_OK;
	if (!ks)
		return KUSOK_OK;
	if (!ks->o.read_only) {
		ks_pack *a = ks_active(ks);
		if (a)
			rc = ks_pack_sync(a);
		if (!rc && !ks->busy)
			rc = ks_checkpoint_int(ks);
	}
	for (size_t i = 0; i < ks->npacks; i++)
		ks_pack_close(&ks->packs[i]);
	free(ks->packs);
	ks_journal_close(&ks->jr);
	ks_tab_free(&ks->chunks);
	ks_tab_free(&ks->files);
	ks_tab_free(&ks->refs);
	ks_mf_free(&ks->mf);
	ks_pool_free(ks->pool);
	ks_cache_free(&ks->cache);
	free(ks->tmp);
	if (ks->packsfd >= 0)
		close(ks->packsfd);
	if (ks->lockfd >= 0)
		close(ks->lockfd);
	if (ks->dirfd >= 0)
		close(ks->dirfd);
	free(ks);
	return rc;
}

/* ------------------------------------------------------------ запись */

/* дописать готовую запись и внести в индекс */
int ks_write_rec(kusok *ks, ks_tab *t, const ks_rec *r, const void *pl)
{
	uint32_t pack;
	uint64_t off;
	int rc = ks_append(ks, r, pl, &pack, &off);
	if (rc)
		return rc;
	void *slot;
	rc = ks_tab_put(t, r->id, &slot, NULL);
	if (rc)
		return rc;
	ent_set(slot, r, pack, off);
	return KUSOK_OK;
}

/* жмём, если экономим хотя бы 1/16. 0 — не сжалось */
static size_t szhat(const uint8_t *d, size_t n, uint8_t *z, int level)
{
	size_t zn;
	int rc;
	if (n < 64)
		return 0;
	if (level >= KS_LZ_HC_MIN)
		rc = ks_lz_compress_hc(d, n, z, n - n / 16, &zn, level);
	else
		rc = ks_lz_compress(d, n, z, n - n / 16, &zn);
	return rc == KUSOK_OK ? zn : 0;
}

static int store_manifest(kusok *ks, const uint8_t id[32], const uint8_t *d,
			  size_t n)
{
	if (n > KS_REC_MAX)
		return KUSOK_ETOOBIG;
	ks_rec r = {.type = KS_REC_MANIFEST, .codec = KS_CODEC_RAW};
	r.slen = r.rlen = (uint32_t)n;
	memcpy(r.id, id, 32);
	return ks_write_rec(ks, &ks->files, &r, d);
}

/* пачка: не больше стольких кусков и байт */
#define PACHKA_KUS 64
#define PACHKA_BYTES (4u << 20)

static void job_hash(void *ctx, size_t i)
{
	kusok_put *p = ctx;
	ks_bkus *k = &p->kus[i];
	ks_sha256_buf(p->buf + k->off, k->len, k->id);
}

static void job_zhat(void *ctx, size_t i)
{
	kusok_put *p = ctx;
	ks_bkus *k = &p->kus[i];
	if (k->nov)
		k->zlen = (uint32_t)szhat(p->buf + k->off, k->len,
					  p->zbuf + k->off, p->ks->o.compress);
}

/* был ли такой же кусок раньше в этой пачке */
static int uzhe_v_pachke(const kusok_put *p, size_t i)
{
	for (size_t j = 0; j < i; j++)
		if (p->kus[j].nov && !memcmp(p->kus[j].id, p->kus[i].id, 32))
			return 1;
	return 0;
}

static int flush(kusok_put *p)
{
	kusok *ks = p->ks;
	if (!p->nkus)
		return KUSOK_OK;
	ks_pool_run(ks->pool, job_hash, p, p->nkus);
	for (size_t i = 0; i < p->nkus; i++) {
		ks_bkus *k = &p->kus[i];
		k->nov =
		    !ks_tab_get(&ks->chunks, k->id) && !uzhe_v_pachke(p, i);
		k->zlen = 0;
	}
	if (ks->o.compress)
		ks_pool_run(ks->pool, job_zhat, p, p->nkus);
	int rc = KUSOK_OK;
	for (size_t i = 0; i < p->nkus && !rc; i++) {
		ks_bkus *k = &p->kus[i];
		if (k->nov) {
			ks_rec r = {.type = KS_REC_CHUNK,
				    .codec = KS_CODEC_RAW,
				    .slen = k->len,
				    .rlen = k->len};
			const uint8_t *pl = p->buf + k->off;
			memcpy(r.id, k->id, 32);
			if (k->zlen) {
				r.codec = KS_CODEC_LZ;
				r.slen = k->zlen;
				pl = p->zbuf + k->off;
			}
			rc = ks_write_rec(ks, &ks->chunks, &r, pl);
			p->nov += k->len;
		}
		if (!rc)
			rc = ks_mf_push(&p->mf, k->id, k->len);
	}
	p->nkus = 0;
	p->blen = 0;
	return rc;
}

static int on_chunk(const uint8_t *data, size_t n, void *ctx)
{
	kusok_put *p = ctx;
	if (p->nkus == PACHKA_KUS || p->blen + n > p->bcap) {
		int rc = flush(p);
		if (rc)
			return rc;
	}
	ks_bkus *k = &p->kus[p->nkus++];
	k->off = p->blen;
	k->len = (uint32_t)n;
	memcpy(p->buf + p->blen, data, n);
	p->blen += n;
	return KUSOK_OK;
}

int kusok_put_begin(kusok *ks, kusok_put **out)
{
	if (!ks || !out)
		return KUSOK_EINVAL;
	if (ks->o.read_only)
		return KUSOK_ERDONLY;
	if (ks->busy)
		return KUSOK_EBUSY;
	kusok_put *p = calloc(1, sizeof(*p));
	if (!p)
		return KUSOK_ENOMEM;
	p->ks = ks;
	ks_sha256_init(&p->sha);
	ks_mf_init(&p->mf);
	/* в пачку всегда влезает хотя бы один самый длинный кусок */
	p->bcap =
	    PACHKA_BYTES > ks->o.max_chunk ? PACHKA_BYTES : ks->o.max_chunk;
	p->buf = malloc(p->bcap);
	p->zbuf = malloc(p->bcap);
	p->kus = calloc(PACHKA_KUS, sizeof(*p->kus));
	int rc = p->buf && p->zbuf && p->kus ? ks_chunker_init(&p->ch, &ks->cdc)
					     : KUSOK_ENOMEM;
	if (rc) {
		free(p->buf);
		free(p->zbuf);
		free(p->kus);
		ks_mf_free(&p->mf);
		free(p);
		return rc;
	}
	ks->busy = 1;
	*out = p;
	return KUSOK_OK;
}

int kusok_put_write(kusok_put *p, const void *buf, size_t n)
{
	if (!p || (!buf && n))
		return KUSOK_EINVAL;
	if (p->err)
		return p->err;
	ks_sha256_update(&p->sha, buf, n);
	p->err = ks_chunker_feed(&p->ch, buf, n, on_chunk, p);
	return p->err;
}

static void put_free(kusok_put *p)
{
	p->ks->busy = 0;
	ks_chunker_free(&p->ch);
	ks_mf_free(&p->mf);
	free(p->buf);
	free(p->zbuf);
	free(p->kus);
	free(p);
}

void kusok_put_abort(kusok_put *p)
{
	if (p)
		put_free(p);
}

int kusok_put_commit(kusok_put *p, kusok_id *id)
{
	if (!p)
		return KUSOK_EINVAL;
	kusok *ks = p->ks;
	int rc = p->err;
	if (!rc)
		rc = ks_chunker_finish(&p->ch, on_chunk, p);
	if (!rc)
		rc = flush(p);
	uint8_t fid[32];
	ks_sha256_final(&p->sha, fid);
	if (!rc && !ks_tab_get(&ks->files, fid)) {
		size_t n = ks_mf_encoded_size(&p->mf);
		uint8_t *buf = malloc(n);
		if (!buf) {
			rc = KUSOK_ENOMEM;
		} else {
			ks_mf_encode(&p->mf, buf);
			rc = store_manifest(ks, fid, buf, n);
			free(buf);
		}
	}
	/* сначала данные, потом ссылка */
	if (!rc && ks->o.sync)
		rc = ks_pack_sync(ks_active(ks));
	if (!rc)
		rc = ks_journal_add(&ks->jr, fid, KS_JR_INC);
	if (!rc && ks->o.sync)
		rc = ks_journal_sync(&ks->jr);
	if (!rc)
		rc = ks_refs_apply(&ks->refs, fid, 1);
	if (!rc) {
		ks->last_new = p->nov;
		if (id)
			memcpy(id->b, fid, 32);
	}
	put_free(p);
	return rc;
}

int kusok_put_mem(kusok *ks, const void *buf, size_t n, kusok_id *id)
{
	kusok_put *p;
	int rc = kusok_put_begin(ks, &p);
	if (rc)
		return rc;
	rc = kusok_put_write(p, buf, n);
	if (rc) {
		kusok_put_abort(p);
		return rc;
	}
	return kusok_put_commit(p, id);
}

int kusok_put_fd(kusok *ks, int fd, kusok_id *id)
{
	enum { PORC = 1 << 20 };
	uint8_t *buf = malloc(PORC);
	if (!buf)
		return KUSOK_ENOMEM;
	kusok_put *p;
	int rc = kusok_put_begin(ks, &p);
	if (rc) {
		free(buf);
		return rc;
	}
	for (;;) {
		size_t got;
		rc = ks_read_some(fd, buf, PORC, &got);
		if (rc || got == 0)
			break;
		rc = kusok_put_write(p, buf, got);
		if (rc)
			break;
	}
	free(buf);
	if (rc) {
		kusok_put_abort(p);
		return rc;
	}
	return kusok_put_commit(p, id);
}

uint64_t kusok_last_put_new_bytes(const kusok *ks)
{
	return ks ? ks->last_new : 0;
}

/* ------------------------------------------------------------ чтение */

int kusok_size(kusok *ks, const kusok_id *id, uint64_t *size)
{
	if (!ks || !id || !size)
		return KUSOK_EINVAL;
	if (ks_refs_of(ks, id->b) <= 0)
		return KUSOK_ENOTFOUND;
	ks_ent *e = ks_tab_get(&ks->files, id->b);
	if (!e)
		return KUSOK_ECORRUPT;
	return ks_mf_size_of(ks, e, size);
}

int kusok_read(kusok *ks, const kusok_id *id, uint64_t off, void *buf, size_t n,
	       size_t *got)
{
	if (!ks || !id || (!buf && n) || !got)
		return KUSOK_EINVAL;
	*got = 0;
	int rc = ks_load_mf(ks, id->b, 1);
	if (rc)
		return rc;
	if (off >= ks->mf.size || n == 0)
		return KUSOK_OK;
	uint8_t *out = buf;
	uint32_t i = ks_mf_find(&ks->mf, off);
	size_t kol = 0;
	while (kol < n && i < ks->mf.n) {
		const uint8_t *kus;
		rc = ks_load_chunk(ks, ks->mf.ids[i], ks->mf.lens[i], &kus);
		if (rc)
			return rc;
		uint64_t nach = ks_mf_start(&ks->mf, i);
		size_t vnutri = (size_t)(off + kol - nach);
		size_t mozhno = ks->mf.lens[i] - vnutri;
		if (mozhno > n - kol)
			mozhno = n - kol;
		memcpy(out + kol, kus + vnutri, mozhno);
		kol += mozhno;
		i++;
	}
	*got = kol;
	return KUSOK_OK;
}

int kusok_get_fd(kusok *ks, const kusok_id *id, int fd)
{
	if (!ks || !id)
		return KUSOK_EINVAL;
	int rc = ks_load_mf(ks, id->b, 1);
	if (rc)
		return rc;
	for (uint32_t i = 0; i < ks->mf.n; i++) {
		const uint8_t *kus;
		rc = ks_load_chunk(ks, ks->mf.ids[i], ks->mf.lens[i], &kus);
		if (rc)
			return rc;
		rc = ks_write_all(fd, kus, ks->mf.lens[i]);
		if (rc)
			return rc;
	}
	return KUSOK_OK;
}

/* ------------------------------------------------------------ ссылки */

static int change_ref(kusok *ks, const kusok_id *id, int op)
{
	if (!ks || !id)
		return KUSOK_EINVAL;
	if (ks->o.read_only)
		return KUSOK_ERDONLY;
	if (!ks_tab_get(&ks->files, id->b))
		return KUSOK_ENOTFOUND;
	if (op == KS_JR_DEC && ks_refs_of(ks, id->b) <= 0)
		return KUSOK_ENOTFOUND;
	int rc = ks_journal_add(&ks->jr, id->b, op);
	if (!rc && ks->o.sync)
		rc = ks_journal_sync(&ks->jr);
	if (!rc)
		rc = ks_refs_apply(&ks->refs, id->b, op == KS_JR_INC ? 1 : -1);
	return rc;
}

int kusok_ref(kusok *ks, const kusok_id *id)
{
	return change_ref(ks, id, KS_JR_INC);
}

int kusok_unref(kusok *ks, const kusok_id *id)
{
	return change_ref(ks, id, KS_JR_DEC);
}

int kusok_refs(kusok *ks, const kusok_id *id, int64_t *refs)
{
	if (!ks || !id || !refs)
		return KUSOK_EINVAL;
	if (!ks_tab_get(&ks->files, id->b))
		return KUSOK_ENOTFOUND;
	*refs = ks_refs_of(ks, id->b);
	return KUSOK_OK;
}

/* ------------------------------------------------------------ обзор */

int kusok_stat_get(kusok *ks, kusok_stat *st)
{
	if (!ks || !st)
		return KUSOK_EINVAL;
	memset(st, 0, sizeof(*st));
	st->chunks = ks->chunks.n;
	for (size_t i = ks_tab_next(&ks->chunks, 0); i < ks->chunks.cap;
	     i = ks_tab_next(&ks->chunks, i + 1))
		st->unique_bytes += ((ks_ent *)ks_tab_at(&ks->chunks, i))->rlen;
	for (size_t i = 0; i < ks->npacks; i++)
		st->stored_bytes += ks->packs[i].len;
	st->packs = (uint32_t)ks->npacks;
	st->cache_hits = ks->cache.hits;
	st->cache_misses = ks->cache.misses;
	for (size_t i = ks_tab_next(&ks->refs, 0); i < ks->refs.cap;
	     i = ks_tab_next(&ks->refs, i + 1)) {
		ks_ref *r = ks_tab_at(&ks->refs, i);
		if (r->refs <= 0)
			continue;
		ks_ent *e = ks_tab_get(&ks->files, r->id);
		uint64_t size;
		if (!e || ks_mf_size_of(ks, e, &size))
			continue;
		st->files++;
		st->logical_bytes += size * (uint64_t)r->refs;
	}
	return KUSOK_OK;
}

int kusok_list(kusok *ks, kusok_list_cb cb, void *ctx)
{
	if (!ks || !cb)
		return KUSOK_EINVAL;
	for (size_t i = ks_tab_next(&ks->refs, 0); i < ks->refs.cap;
	     i = ks_tab_next(&ks->refs, i + 1)) {
		ks_ref *r = ks_tab_at(&ks->refs, i);
		if (r->refs <= 0)
			continue;
		ks_ent *e = ks_tab_get(&ks->files, r->id);
		uint64_t size;
		if (!e || ks_mf_size_of(ks, e, &size))
			continue;
		kusok_id id;
		memcpy(id.b, r->id, 32);
		int rc = cb(&id, size, r->refs, ctx);
		if (rc)
			return rc;
	}
	return KUSOK_OK;
}

int ks_checkpoint_int(kusok *ks)
{
	for (size_t i = ks_tab_next(&ks->refs, 0); i < ks->refs.cap;) {
		ks_ref *r = ks_tab_at(&ks->refs, i);
		if (r->refs == 0) {
			uint8_t key[32];
			memcpy(key, r->id, 32);
			ks_tab_del(&ks->refs, key);
			/* в i мог приехать сосед */
			i = ks_tab_next(&ks->refs, i);
			continue;
		}
		i = ks_tab_next(&ks->refs, i + 1);
	}
	return ks_journal_checkpoint(&ks->jr, &ks->refs);
}

int kusok_checkpoint(kusok *ks)
{
	if (!ks)
		return KUSOK_EINVAL;
	if (ks->o.read_only)
		return KUSOK_ERDONLY;
	if (ks->busy)
		return KUSOK_EBUSY;
	int rc = ks_pack_sync(ks_active(ks));
	if (rc)
		return rc;
	return ks_checkpoint_int(ks);
}
