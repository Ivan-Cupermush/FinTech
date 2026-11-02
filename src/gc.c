/*
 * сборка мусора: mark & compact.
 * живое из «жертв» копируем в новый pack, fsync, потом удаляем жертвы
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "fsutil.h"
#include "idx.h"
#include "store_int.h"

static void clear_marks(ks_tab *t)
{
	for (size_t i = ks_tab_next(t, 0); i < t->cap;
	     i = ks_tab_next(t, i + 1))
		((ks_ent *)ks_tab_at(t, i))->mark = 0;
}

static int mark_live(kusok *ks)
{
	clear_marks(&ks->chunks);
	clear_marks(&ks->files);
	for (size_t i = ks_tab_next(&ks->refs, 0); i < ks->refs.cap;
	     i = ks_tab_next(&ks->refs, i + 1)) {
		ks_ref *r = ks_tab_at(&ks->refs, i);
		if (r->refs <= 0)
			continue;
		ks_ent *f = ks_tab_get(&ks->files, r->id);
		if (!f)
			continue; /* это покажет fsck */
		f->mark = 1;
		int rc = ks_load_mf(ks, r->id, 1);
		if (rc)
			return rc;
		for (uint32_t k = 0; k < ks->mf.n; k++) {
			ks_ent *c = ks_tab_get(&ks->chunks, ks->mf.ids[k]);
			if (c)
				c->mark = 1;
		}
	}
	return KUSOK_OK;
}

static size_t pack_index(const kusok *ks, uint32_t id)
{
	size_t l = 0, r = ks->npacks;
	while (l < r) {
		size_t m = l + (r - l) / 2;
		if (ks->packs[m].id < id)
			l = m + 1;
		else
			r = m;
	}
	return l;
}

static void count_live(const kusok *ks, const ks_tab *t, uint64_t *live)
{
	for (size_t i = ks_tab_next(t, 0); i < t->cap;
	     i = ks_tab_next(t, i + 1)) {
		const ks_ent *e = ks_tab_at(t, i);
		if (!e->mark)
			continue;
		size_t k = pack_index(ks, e->pack);
		if (k < ks->npacks && ks->packs[k].id == e->pack)
			live[k] += KS_REC_HDR + e->slen;
	}
}

static int is_victim(const uint32_t *v, size_t nv, uint32_t id)
{
	size_t l = 0, r = nv;
	while (l < r) {
		size_t m = l + (r - l) / 2;
		if (v[m] == id)
			return 1;
		if (v[m] < id)
			l = m + 1;
		else
			r = m;
	}
	return 0;
}

static int move_live(kusok *ks, ks_tab *t, const uint32_t *v, size_t nv)
{
	for (size_t i = ks_tab_next(t, 0); i < t->cap;
	     i = ks_tab_next(t, i + 1)) {
		ks_ent *e = ks_tab_at(t, i);
		if (!e->mark || !is_victim(v, nv, e->pack))
			continue;
		const uint8_t *pl;
		int rc = ks_load_rec(ks, e, &pl);
		if (rc)
			return rc;
		ks_rec r = {.type = e->type,
			    .codec = e->codec,
			    .slen = e->slen,
			    .rlen = e->rlen};
		memcpy(r.id, e->id, 32);
		uint32_t pack;
		uint64_t off;
		rc = ks_append(ks, &r, pl, &pack, &off);
		if (rc)
			return rc;
		e->pack = pack;
		e->off = off;
	}
	return KUSOK_OK;
}

/* мёртвое из жертв — из индекса */
static uint64_t drop_dead(ks_tab *t, const uint32_t *v, size_t nv)
{
	uint64_t kol = 0;
	for (size_t i = ks_tab_next(t, 0); i < t->cap;) {
		ks_ent *e = ks_tab_at(t, i);
		if (!e->mark && is_victim(v, nv, e->pack)) {
			uint8_t key[32];
			memcpy(key, e->id, 32);
			ks_tab_del(t, key);
			kol++;
			i = ks_tab_next(t, i); /* сюда мог приехать сосед */
			continue;
		}
		i = ks_tab_next(t, i + 1);
	}
	return kol;
}

int kusok_gc(kusok *ks, double min_garbage, kusok_gc_report *rep)
{
	kusok_gc_report tmp;
	if (!rep)
		rep = &tmp;
	memset(rep, 0, sizeof(*rep));
	if (!ks || min_garbage < 0 || min_garbage > 1)
		return KUSOK_EINVAL;
	if (ks->o.read_only)
		return KUSOK_ERDONLY;
	if (ks->busy)
		return KUSOK_EBUSY;
	for (size_t i = 0; i < ks->npacks; i++)
		rep->bytes_before += ks->packs[i].len;

	int rc = mark_live(ks);
	if (rc)
		return rc;

	uint64_t *live = calloc(ks->npacks ? ks->npacks : 1, sizeof(*live));
	uint32_t *v = malloc((ks->npacks ? ks->npacks : 1) * sizeof(*v));
	if (!live || !v) {
		free(live);
		free(v);
		return KUSOK_ENOMEM;
	}
	count_live(ks, &ks->chunks, live);
	count_live(ks, &ks->files, live);

	size_t nv = 0;
	int active_victim = 0;
	for (size_t i = 0; i < ks->npacks; i++) {
		const ks_pack *p = &ks->packs[i];
		uint64_t body = p->len - KS_PACK_HDR + p->tail;
		uint64_t musor = body - live[i];
		int last = i + 1 == ks->npacks;
		int bad;
		if (body == 0)
			bad = !last;
		else
			bad = musor > 0 &&
			      (double)musor >= min_garbage * (double)body;
		if (!bad)
			continue;
		v[nv++] = p->id; /* уже по порядку */
		if (last)
			active_victim = 1;
	}
	free(live);

	if (nv == 0) {
		free(v);
		rep->bytes_after = rep->bytes_before;
		return ks_checkpoint_int(ks);
	}
	/* в жертву не пишем */
	if (active_victim)
		rc = ks_roll(ks);
	if (!rc)
		rc = move_live(ks, &ks->files, v, nv);
	if (!rc)
		rc = move_live(ks, &ks->chunks, v, nv);
	if (!rc)
		rc = ks_pack_sync(ks_active(ks));
	if (rc) {
		free(v);
		ks_drop_caches(ks);
		return rc;
	}
	rep->records_dropped += drop_dead(&ks->files, v, nv);
	rep->records_dropped += drop_dead(&ks->chunks, v, nv);

	/* удаляем жертвы */
	size_t w = 0;
	for (size_t i = 0; i < ks->npacks; i++) {
		ks_pack *p = &ks->packs[i];
		if (is_victim(v, nv, p->id)) {
			char name[32];
			ks_pack_name(p->id, name);
			ks_pack_close(p);
			int r2 = ks_idx_remove(ks->packsfd, p->id);
			if (r2 && !rc)
				rc = r2;
			if (unlinkat(ks->packsfd, name, 0) && !rc)
				rc = KUSOK_EIO;
			rep->packs_rewritten++;
			continue;
		}
		ks->packs[w++] = *p;
	}
	ks->npacks = w;
	free(v);
	ks_drop_caches(ks);
	if (!rc)
		rc = ks_fsync_dir(ks->packsfd);
	if (!rc)
		rc = ks_checkpoint_int(ks);
	for (size_t i = 0; i < ks->npacks; i++)
		rep->bytes_after += ks->packs[i].len;
	return rc;
}
