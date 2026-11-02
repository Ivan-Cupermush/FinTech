/*
 * хеш-таблица, открытая адресация, линейное пробирование.
 * ключ — первые 32 байта элемента. put может переместить элементы
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_TAB_H
#define KS_TAB_H

#include <stddef.h>
#include <stdint.h>

#define KS_KEY_LEN 32

typedef struct ks_tab {
	uint8_t *e;
	uint8_t *used;
	size_t esz;
	size_t cap; /* степень двойки */
	size_t n;
} ks_tab;

int ks_tab_init(ks_tab *t, size_t esz, size_t hint);
void ks_tab_free(ks_tab *t);
void ks_tab_clear(ks_tab *t);

void *ks_tab_get(const ks_tab *t, const uint8_t key[KS_KEY_LEN]);

/* найти или вставить, *fresh = 1 если новый */
int ks_tab_put(ks_tab *t, const uint8_t key[KS_KEY_LEN], void **slot,
	       int *fresh);

int ks_tab_del(ks_tab *t, const uint8_t key[KS_KEY_LEN]);

/* обход: i = next(t, 0); i < cap; i = next(t, i + 1) */
size_t ks_tab_next(const ks_tab *t, size_t i);

static inline void *ks_tab_at(const ks_tab *t, size_t i)
{
	return t->e + i * t->esz;
}

size_t ks_tab_max_probe(const ks_tab *t);

#endif
