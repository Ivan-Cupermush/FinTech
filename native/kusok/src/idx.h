/*
 * индекс pack-файла на диске: 00000001.idx рядом с 00000001.pack.
 * пишется, когда pack запечатан, и при открытии заменяет обход
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_IDX_H
#define KS_IDX_H

#include <stddef.h>
#include <stdint.h>

#include "pack.h"

#define KS_IDX_MAGIC "KUSOKIX1"
#define KS_IDX_HDR 32u
#define KS_IDX_ENT 56u

/* "%08u.idx" */
void ks_idx_name(uint32_t id, char out[32]);
int ks_idx_parse_name(const char *name, uint32_t *id);

/* обойти заголовки pack и записать индекс до p->len */
int ks_idx_build(int packsfd, const ks_pack *p);

/*
 * загрузить и отдать записи по порядку, как ks_pack_scan.
 * KUSOK_ENOTFOUND — нет файла, KUSOK_ECORRUPT — не сходится, тогда обход
 */
int ks_idx_load(int packsfd, const ks_pack *p, ks_scan_cb cb, void *ctx,
		uint64_t *len);

int ks_idx_remove(int packsfd, uint32_t id);

#endif
