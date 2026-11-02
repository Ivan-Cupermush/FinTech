/*
 * сжатие в формате блока LZ4, совместимо с настоящим lz4
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_LZ_H
#define KS_LZ_H

#include <stddef.h>
#include <stdint.h>

#define KS_LZ_MAX_INPUT 0x7E000000u

size_t ks_lz_bound(size_t n);

/* не влезло в cap — KUSOK_ETOOBIG */
int ks_lz_compress(const uint8_t *src, size_t n, uint8_t *dst, size_t cap,
		   size_t *out);

/* сильнее и медленнее, формат тот же. level 2..12 */
#define KS_LZ_HC_MIN 2
#define KS_LZ_HC_MAX 12
int ks_lz_compress_hc(const uint8_t *src, size_t n, uint8_t *dst, size_t cap,
		      size_t *out, int level);

/* на мусоре — KUSOK_ECORRUPT, за буферы не выходит */
int ks_lz_decompress(const uint8_t *src, size_t n, uint8_t *dst, size_t cap,
		     size_t *out);

#endif
