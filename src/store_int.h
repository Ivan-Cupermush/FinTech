/*
 * внутренности хранилища: общее для store.c, gc.c, fsck.c
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_STORE_INT_H
#define KS_STORE_INT_H

#include <stddef.h>
#include <stdint.h>

#include "cache.h"
#include "cdc.h"
#include "journal.h"
#include "kusok/kusok.h"
#include "manifest.h"
#include "pack.h"
#include "pool.h"
#include "sha256.h"
#include "tab.h"

/* где лежит запись */
typedef struct ks_ent {
	uint8_t id[32];
	uint64_t off;
	uint32_t pack;
	uint32_t slen;
	uint32_t rlen;
	uint8_t type;
	uint8_t codec;
	uint8_t mark; /* для gc */
	uint8_t pad;
} ks_ent;

struct kusok {
	kusok_opts o;
	ks_cdc cdc;
	int dirfd, packsfd, lockfd;

	/* последний — активный */
	ks_pack *packs;
	size_t npacks, cappacks;

	ks_tab chunks; /* ks_ent */
	ks_tab files;  /* ks_ent манифестов */
	ks_tab refs;   /* ks_ref */
	ks_journal jr;

	uint32_t idx_hits; /* сколько pack открыли по индексу */

	int busy; /* открыт put */
	uint64_t salvaged;
	uint64_t last_new;

	ks_pool *pool;

	ks_cache cache; /* распакованные куски */

	/* кэш манифеста */
	int mf_ok;
	uint8_t mf_id[32];
	ks_manifest mf;

	uint8_t *tmp;
	size_t tmp_cap;
};

/* кусок в пачке на запись */
typedef struct ks_bkus {
	size_t off; /* где в buf */
	uint32_t len;
	uint32_t zlen; /* 0 — не сжался */
	uint8_t id[32];
	uint8_t nov; /* надо писать */
} ks_bkus;

struct kusok_put {
	kusok *ks;
	ks_chunker ch;
	ks_sha256 sha;
	ks_manifest mf;
	uint64_t nov; /* новых байт */
	int err;

	/* пачка кусков: хешируем и жмём её сразу всем пулом */
	uint8_t *buf;
	uint8_t *zbuf; /* сжатое, у куска i — с того же off */
	size_t blen, bcap;
	ks_bkus *kus;
	size_t nkus;
};

/* store.c */
int ks_tmp_reserve(kusok *ks, size_t n);
int ks_write_rec(kusok *ks, ks_tab *t, const ks_rec *r, const void *pl);
ks_pack *ks_pack_by_id(kusok *ks, uint32_t id);
ks_pack *ks_active(kusok *ks);
int ks_roll(kusok *ks);
int ks_append(kusok *ks, const ks_rec *r, const void *payload, uint32_t *pack,
	      uint64_t *off);
int ks_load_rec(kusok *ks, const ks_ent *e, const uint8_t **payload);
int ks_load_chunk(kusok *ks, const uint8_t id[32], uint32_t want_len,
		  const uint8_t **data);
int ks_load_mf(kusok *ks, const uint8_t id[32], int live);
int ks_mf_size_of(kusok *ks, const ks_ent *e, uint64_t *size);
int64_t ks_refs_of(const kusok *ks, const uint8_t id[32]);
void ks_drop_caches(kusok *ks);
int ks_checkpoint_int(kusok *ks);

#endif
