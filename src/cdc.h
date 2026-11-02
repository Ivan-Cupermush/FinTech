/*
 * нарезка по содержимому — FastCDC (Xia и др., 2016).
 * режем там, где (fp & mask) == 0, fp = (fp << 1) + gear[b]
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_CDC_H
#define KS_CDC_H

#include <stddef.h>
#include <stdint.h>

#define KS_CDC_MIN_LIMIT 64u
#define KS_CDC_MAX_LIMIT (1u << 22) /* 4 MiB */

typedef struct ks_cdc {
	uint32_t min, avg, max;
	uint64_t mask_s; /* до avg */
	uint64_t mask_l; /* после avg */
} ks_cdc;

/* avg — степень двойки, 64 <= min < avg < max */
int ks_cdc_init(ks_cdc *c, uint32_t min, uint32_t avg, uint32_t max);

const uint64_t *ks_gear_table(void);

/* k единиц по битам 16..63 */
uint64_t ks_cdc_mask(unsigned k);

/* длина первого куска */
size_t ks_cdc_cut(const ks_cdc *c, const uint8_t *buf, size_t n);

typedef int (*ks_chunk_cb)(const uint8_t *p, size_t n, void *ctx);

typedef struct ks_chunker {
	ks_cdc c;
	uint8_t *buf;
	size_t cap;
	size_t beg, end;
} ks_chunker;

int ks_chunker_init(ks_chunker *k, const ks_cdc *c);
void ks_chunker_free(ks_chunker *k);
int ks_chunker_feed(ks_chunker *k, const void *data, size_t n, ks_chunk_cb cb,
		    void *ctx);
int ks_chunker_finish(ks_chunker *k, ks_chunk_cb cb, void *ctx);

#endif
