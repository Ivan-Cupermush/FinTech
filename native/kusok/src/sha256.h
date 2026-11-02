/*
 * SHA-256 (FIPS 180-4)
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_SHA256_H
#define KS_SHA256_H

#include <stddef.h>
#include <stdint.h>

#define KS_SHA256_LEN 32

typedef struct ks_sha256 {
	uint32_t h[8];
	uint64_t len;
	uint8_t buf[64];
	size_t nb;
} ks_sha256;

void ks_sha256_init(ks_sha256 *s);
void ks_sha256_update(ks_sha256 *s, const void *data, size_t n);
void ks_sha256_final(ks_sha256 *s, uint8_t out[KS_SHA256_LEN]);

int ks_sha256_hw(void);
/* 0 — только обычный C */
void ks_sha256_use_hw(int on);

void ks_sha256_buf(const void *data, size_t n, uint8_t out[KS_SHA256_LEN]);

#endif
