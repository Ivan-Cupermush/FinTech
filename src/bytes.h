/*
 * числа little-endian без выравнивания
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_BYTES_H
#define KS_BYTES_H

#include <stdint.h>
#include <string.h>

static inline uint16_t ld16(const uint8_t *p)
{
	return (uint16_t)(p[0] | (p[1] << 8));
}

static inline uint32_t ld32(const uint8_t *p)
{
	return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
	       ((uint32_t)p[3] << 24);
}

static inline uint64_t ld64(const uint8_t *p)
{
	return (uint64_t)ld32(p) | ((uint64_t)ld32(p + 4) << 32);
}

static inline void st16(uint8_t *p, uint16_t v)
{
	p[0] = (uint8_t)v;
	p[1] = (uint8_t)(v >> 8);
}

static inline void st32(uint8_t *p, uint32_t v)
{
	p[0] = (uint8_t)v;
	p[1] = (uint8_t)(v >> 8);
	p[2] = (uint8_t)(v >> 16);
	p[3] = (uint8_t)(v >> 24);
}

static inline void st64(uint8_t *p, uint64_t v)
{
	st32(p, (uint32_t)v);
	st32(p + 4, (uint32_t)(v >> 32));
}

/* big-endian — для SHA-256 */
static inline uint32_t ld32be(const uint8_t *p)
{
	return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
	       ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

static inline void st32be(uint8_t *p, uint32_t v)
{
	p[0] = (uint8_t)(v >> 24);
	p[1] = (uint8_t)(v >> 16);
	p[2] = (uint8_t)(v >> 8);
	p[3] = (uint8_t)v;
}

static inline uint32_t peek32(const uint8_t *p)
{
	uint32_t v;
	memcpy(&v, p, 4);
	return v;
}

static inline uint64_t peek64(const uint8_t *p)
{
	uint64_t v;
	memcpy(&v, p, 8);
	return v;
}

#endif
