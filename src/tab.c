/*
 * SPDX-License-Identifier: MIT
 */
#include "tab.h"

#include <stdlib.h>
#include <string.h>

#include "bytes.h"
#include "kusok/kusok.h"

static inline size_t home(const ks_tab *t, const uint8_t *key)
{
	return (size_t)ld64(key) & (t->cap - 1);
}

static int alloc(ks_tab *t, size_t cap)
{
	t->e = calloc(cap, t->esz);
	t->used = calloc(cap, 1);
	if (!t->e || !t->used) {
		free(t->e);
		free(t->used);
		t->e = t->used = NULL;
		return KUSOK_ENOMEM;
	}
	t->cap = cap;
	t->n = 0;
	return KUSOK_OK;
}

int ks_tab_init(ks_tab *t, size_t esz, size_t hint)
{
	size_t cap = 16;
	if (esz < KS_KEY_LEN)
		return KUSOK_EINVAL;
	while (cap * 7 / 10 < hint)
		cap *= 2;
	t->esz = esz;
	return alloc(t, cap);
}

void ks_tab_free(ks_tab *t)
{
	free(t->e);
	free(t->used);
	t->e = t->used = NULL;
	t->cap = t->n = 0;
}

void ks_tab_clear(ks_tab *t)
{
	memset(t->used, 0, t->cap);
	t->n = 0;
}

void *ks_tab_get(const ks_tab *t, const uint8_t key[KS_KEY_LEN])
{
	size_t mask = t->cap - 1;
	for (size_t i = home(t, key);; i = (i + 1) & mask) {
		if (!t->used[i])
			return NULL;
		uint8_t *el = t->e + i * t->esz;
		if (memcmp(el, key, KS_KEY_LEN) == 0)
			return el;
	}
}

/* без проверки на дубль */
static void raw_insert(ks_tab *t, const uint8_t *el)
{
	size_t mask = t->cap - 1;
	size_t i = home(t, el);
	while (t->used[i])
		i = (i + 1) & mask;
	memcpy(t->e + i * t->esz, el, t->esz);
	t->used[i] = 1;
	t->n++;
}

static int grow(ks_tab *t)
{
	ks_tab old = *t;
	if (alloc(t, old.cap * 2)) {
		*t = old;
		return KUSOK_ENOMEM;
	}
	for (size_t i = 0; i < old.cap; i++)
		if (old.used[i])
			raw_insert(t, old.e + i * old.esz);
	free(old.e);
	free(old.used);
	return KUSOK_OK;
}

int ks_tab_put(ks_tab *t, const uint8_t key[KS_KEY_LEN], void **slot,
	       int *fresh)
{
	void *el = ks_tab_get(t, key);
	if (el) {
		*slot = el;
		if (fresh)
			*fresh = 0;
		return KUSOK_OK;
	}
	/* не больше 70% */
	if ((t->n + 1) * 10 > t->cap * 7) {
		int rc = grow(t);
		if (rc)
			return rc;
	}
	size_t mask = t->cap - 1;
	size_t i = home(t, key);
	while (t->used[i])
		i = (i + 1) & mask;
	uint8_t *p = t->e + i * t->esz;
	memset(p, 0, t->esz);
	memcpy(p, key, KS_KEY_LEN);
	t->used[i] = 1;
	t->n++;
	*slot = p;
	if (fresh)
		*fresh = 1;
	return KUSOK_OK;
}

int ks_tab_del(ks_tab *t, const uint8_t key[KS_KEY_LEN])
{
	size_t mask = t->cap - 1;
	size_t i = home(t, key);
	for (;; i = (i + 1) & mask) {
		if (!t->used[i])
			return 0;
		if (memcmp(t->e + i * t->esz, key, KS_KEY_LEN) == 0)
			break;
	}
	t->used[i] = 0;
	t->n--;
	/* подтягиваем хвост цепочки в дырку */
	size_t j = i;
	for (;;) {
		j = (j + 1) & mask;
		if (!t->used[j])
			break;
		size_t k = home(t, t->e + j * t->esz);
		int ostaetsya =
		    (i <= j) ? (i < k && k <= j) : (i < k || k <= j);
		if (ostaetsya)
			continue;
		memcpy(t->e + i * t->esz, t->e + j * t->esz, t->esz);
		t->used[i] = 1;
		t->used[j] = 0;
		i = j;
	}
	return 1;
}

size_t ks_tab_next(const ks_tab *t, size_t i)
{
	while (i < t->cap && !t->used[i])
		i++;
	return i;
}

size_t ks_tab_max_probe(const ks_tab *t)
{
	size_t mx = 0, mask = t->cap - 1;
	for (size_t i = 0; i < t->cap; i++) {
		if (!t->used[i])
			continue;
		size_t d = (i - home(t, t->e + i * t->esz)) & mask;
		if (d > mx)
			mx = d;
	}
	return mx;
}
