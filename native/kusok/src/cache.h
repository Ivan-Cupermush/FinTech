/*
 * LRU-кэш распакованных кусков: случайное чтение (Range, перемотка)
 * часто возвращается к тем же кускам
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_CACHE_H
#define KS_CACHE_H

#include <stdint.h>

#include "tab.h"

typedef struct ks_cache_slot {
	uint8_t id[32];
	uint8_t *buf;
	uint32_t len, cap;
	int32_t prev, next; /* список: head — самый свежий */
} ks_cache_slot;

typedef struct ks_cache {
	ks_tab map; /* id -> номер слота */
	ks_cache_slot *s;
	int32_t *svob; /* свободные слоты */
	uint32_t nsvob, max;
	int32_t head, tail;
	uint64_t hits, misses;
} ks_cache;

int ks_cache_init(ks_cache *c, uint32_t max);
void ks_cache_free(ks_cache *c);
void ks_cache_clear(ks_cache *c);

/* NULL — нет. найденный становится самым свежим */
const uint8_t *ks_cache_get(ks_cache *c, const uint8_t id[32], uint32_t *len);

/* место под кусок длины len; самый старый уходит, если места нет */
int ks_cache_put(ks_cache *c, const uint8_t id[32], uint32_t len,
		 uint8_t **buf);

/* выкинуть (например, если распаковка не удалась) */
void ks_cache_drop(ks_cache *c, const uint8_t id[32]);

#endif
