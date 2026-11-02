/*
 * fsck: CRC каждой записи и SHA-256 каждого живого файла
 *
 * SPDX-License-Identifier: MIT
 */
#include <string.h>

#include "store_int.h"

static int count_rec(const ks_rec *r, uint64_t off, void *ctx)
{
	(void)r;
	(void)off;
	(*(uint64_t *)ctx)++;
	return KUSOK_OK;
}

/* 1 — целый, 0 — битый, <0 — ошибка */
static int chek_file(kusok *ks, const uint8_t id[32])
{
	int rc = ks_load_mf(ks, id, 1);
	if (rc == KUSOK_EIO || rc == KUSOK_ENOMEM)
		return rc;
	if (rc)
		return 0;
	ks_sha256 s;
	ks_sha256_init(&s);
	uint32_t n = ks->mf.n;
	for (uint32_t i = 0; i < n; i++) {
		const uint8_t *kus;
		rc = ks_load_chunk(ks, ks->mf.ids[i], ks->mf.lens[i], &kus);
		if (rc == KUSOK_EIO || rc == KUSOK_ENOMEM)
			return rc;
		if (rc)
			return 0;
		ks_sha256_update(&s, kus, ks->mf.lens[i]);
	}
	uint8_t got[32];
	ks_sha256_final(&s, got);
	return memcmp(got, id, 32) == 0;
}

int kusok_fsck(kusok *ks, kusok_fsck_report *rep)
{
	kusok_fsck_report tmp;
	if (!rep)
		rep = &tmp;
	memset(rep, 0, sizeof(*rep));
	if (!ks)
		return KUSOK_EINVAL;
	if (ks->busy)
		return KUSOK_EBUSY;

	/* что отбросил salvage — тоже порча */
	rep->bad_records = ks->salvaged;
	for (size_t i = 0; i < ks->npacks; i++) {
		uint64_t good, bad;
		int rc = ks_pack_scan(&ks->packs[i], 1, count_rec,
				      &rep->records, &good, &bad);
		if (rc)
			return rc;
		rep->bad_records += bad + (good < ks->packs[i].len);
		rep->tail_bytes += ks->packs[i].tail;
	}

	/* кэши сбрасываем */
	ks_drop_caches(ks);
	for (size_t i = ks_tab_next(&ks->refs, 0); i < ks->refs.cap;
	     i = ks_tab_next(&ks->refs, i + 1)) {
		ks_ref *r = ks_tab_at(&ks->refs, i);
		if (r->refs <= 0)
			continue;
		if (!ks_tab_get(&ks->files, r->id)) {
			rep->missing_manifests++;
			continue;
		}
		rep->files++;
		int ok = chek_file(ks, r->id);
		if (ok < 0)
			return ok;
		if (!ok)
			rep->broken_files++;
	}
	ks_drop_caches(ks);
	return KUSOK_OK;
}
