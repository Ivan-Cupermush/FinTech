/*
 * манифест: из каких кусков собран файл.
 * "KSMF", u32 n, u64 size, n раз (id[32], u32 len)
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_MANIFEST_H
#define KS_MANIFEST_H

#include <stddef.h>
#include <stdint.h>

#define KS_MF_MAGIC "KSMF"
#define KS_MF_HDR 16u
#define KS_MF_ENT 36u

typedef struct ks_manifest {
	uint64_t size;
	uint32_t n;
	uint8_t (*ids)[32];
	uint32_t *lens;
	uint64_t *end; /* префиксные суммы */
	uint32_t cap;
} ks_manifest;

void ks_mf_init(ks_manifest *m);
void ks_mf_free(ks_manifest *m);
void ks_mf_reset(ks_manifest *m);

int ks_mf_push(ks_manifest *m, const uint8_t id[32], uint32_t len);

size_t ks_mf_encoded_size(const ks_manifest *m);
void ks_mf_encode(const ks_manifest *m, uint8_t *out);

/* строгий разбор */
int ks_mf_decode(const uint8_t *buf, size_t n, uint32_t max_chunk,
		 ks_manifest *m);

int ks_mf_peek_size(const uint8_t hdr[KS_MF_HDR], uint64_t *size);

/* в каком куске байт off */
uint32_t ks_mf_find(const ks_manifest *m, uint64_t off);

static inline uint64_t ks_mf_start(const ks_manifest *m, uint32_t i)
{
	return i ? m->end[i - 1] : 0;
}

#endif
