/*
 * SPDX-License-Identifier: MIT
 */
#include "cache.h"

#include <stdlib.h>
#include <string.h>

#include "kusok/kusok.h"

struct elem {
	uint8_t id[32];
	int32_t slot;
};

void ks_cache_clear(ks_cache *c)
{
	/* буферы оставляем — пригодятся */
	ks_tab_clear(&c->map);
	for (uint32_t i = 0; i < c->max; i++) {
		c->s[i].prev = c->s[i].next = -1;
		c->svob[i] = (int32_t)(c->max - 1 - i);
	}
	c->nsvob = c->max;
	c->head = c->tail = -1;
}

int ks_cache_init(ks_cache *c, uint32_t max)
{
	memset(c, 0, sizeof(*c));
	if (!max || max > (1u << 20))
		return KUSOK_EINVAL;
	c->max = max;
	c->s = calloc(max, sizeof(*c->s));
	c->svob = calloc(max, sizeof(*c->svob));
	int rc = c->s && c->svob
		     ? ks_tab_init(&c->map, sizeof(struct elem), max)
		     : KUSOK_ENOMEM;
	if (rc) {
		free(c->s);
		free(c->svob);
		memset(c, 0, sizeof(*c));
		return rc;
	}
	ks_cache_clear(c);
	return KUSOK_OK;
}

void ks_cache_free(ks_cache *c)
{
	if (!c->s)
		return;
	for (uint32_t i = 0; i < c->max; i++)
		free(c->s[i].buf);
	free(c->s);
	free(c->svob);
	ks_tab_free(&c->map);
	memset(c, 0, sizeof(*c));
}

static void otcepit(ks_cache *c, int32_t i)
{
	ks_cache_slot *x = &c->s[i];
	if (x->prev >= 0)
		c->s[x->prev].next = x->next;
	else
		c->head = x->next;
	if (x->next >= 0)
		c->s[x->next].prev = x->prev;
	else
		c->tail = x->prev;
	x->prev = x->next = -1;
}

static void v_nachalo(ks_cache *c, int32_t i)
{
	ks_cache_slot *x = &c->s[i];
	x->prev = -1;
	x->next = c->head;
	if (c->head >= 0)
		c->s[c->head].prev = i;
	c->head = i;
	if (c->tail < 0)
		c->tail = i;
}

/* убрать слот из карты и списка, вернуть в свободные */
static void osvobodit(ks_cache *c, int32_t i)
{
	uint8_t key[32];
	memcpy(key, c->s[i].id, 32);
	ks_tab_del(&c->map, key);
	otcepit(c, i);
	c->svob[c->nsvob++] = i;
}

const uint8_t *ks_cache_get(ks_cache *c, const uint8_t id[32], uint32_t *len)
{
	struct elem *e = ks_tab_get(&c->map, id);
	if (!e) {
		c->misses++;
		return NULL;
	}
	c->hits++;
	int32_t i = e->slot;
	if (c->head != i) {
		otcepit(c, i);
		v_nachalo(c, i);
	}
	*len = c->s[i].len;
	return c->s[i].buf;
}

void ks_cache_drop(ks_cache *c, const uint8_t id[32])
{
	struct elem *e = ks_tab_get(&c->map, id);
	if (e)
		osvobodit(c, e->slot);
}

int ks_cache_put(ks_cache *c, const uint8_t id[32], uint32_t len, uint8_t **buf)
{
	ks_cache_drop(c, id);
	if (!c->nsvob)
		osvobodit(c, c->tail); /* самый старый */
	int32_t i = c->svob[c->nsvob - 1];
	ks_cache_slot *x = &c->s[i];
	if (len > x->cap || !x->buf) {
		uint8_t *nb = realloc(x->buf, len ? len : 1);
		if (!nb)
			return KUSOK_ENOMEM;
		x->buf = nb;
		x->cap = len ? len : 1;
	}
	void *slot;
	int rc = ks_tab_put(&c->map, id, &slot, NULL);
	if (rc)
		return rc;
	((struct elem *)slot)->slot = i;
	c->nsvob--;
	memcpy(x->id, id, 32);
	x->len = len;
	v_nachalo(c, i);
	*buf = x->buf;
	return KUSOK_OK;
}
