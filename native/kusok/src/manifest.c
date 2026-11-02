/*
 * SPDX-License-Identifier: MIT
 */
#include "manifest.h"

#include <stdlib.h>
#include <string.h>

#include "bytes.h"
#include "kusok/kusok.h"

void ks_mf_init(ks_manifest *m)
{
	memset(m, 0, sizeof(*m));
}

void ks_mf_free(ks_manifest *m)
{
	free(m->ids);
	free(m->lens);
	free(m->end);
	ks_mf_init(m);
}

void ks_mf_reset(ks_manifest *m)
{
	m->n = 0;
	m->size = 0;
}

static int reserve(ks_manifest *m, uint32_t need)
{
	if (need <= m->cap)
		return KUSOK_OK;
	uint32_t nc = m->cap ? m->cap : 16;
	while (nc < need) {
		if (nc > UINT32_MAX / 2)
			return KUSOK_ETOOBIG;
		nc *= 2;
	}
	void *a = realloc(m->ids, (size_t)nc * 32);
	if (!a)
		return KUSOK_ENOMEM;
	m->ids = a;
	void *b = realloc(m->lens, (size_t)nc * sizeof(uint32_t));
	if (!b)
		return KUSOK_ENOMEM;
	m->lens = b;
	void *c = realloc(m->end, (size_t)nc * sizeof(uint64_t));
	if (!c)
		return KUSOK_ENOMEM;
	m->end = c;
	m->cap = nc;
	return KUSOK_OK;
}

int ks_mf_push(ks_manifest *m, const uint8_t id[32], uint32_t len)
{
	if (len == 0)
		return KUSOK_EINVAL;
	if (m->n == UINT32_MAX)
		return KUSOK_ETOOBIG;
	int rc = reserve(m, m->n + 1);
	if (rc)
		return rc;
	memcpy(m->ids[m->n], id, 32);
	m->lens[m->n] = len;
	m->size += len;
	m->end[m->n] = m->size;
	m->n++;
	return KUSOK_OK;
}

size_t ks_mf_encoded_size(const ks_manifest *m)
{
	return KS_MF_HDR + (size_t)m->n * KS_MF_ENT;
}

void ks_mf_encode(const ks_manifest *m, uint8_t *out)
{
	memcpy(out, KS_MF_MAGIC, 4);
	st32(out + 4, m->n);
	st64(out + 8, m->size);
	uint8_t *p = out + KS_MF_HDR;
	for (uint32_t i = 0; i < m->n; i++) {
		memcpy(p, m->ids[i], 32);
		st32(p + 32, m->lens[i]);
		p += KS_MF_ENT;
	}
}

int ks_mf_peek_size(const uint8_t hdr[KS_MF_HDR], uint64_t *size)
{
	if (memcmp(hdr, KS_MF_MAGIC, 4) != 0)
		return KUSOK_ECORRUPT;
	*size = ld64(hdr + 8);
	return KUSOK_OK;
}

int ks_mf_decode(const uint8_t *buf, size_t n, uint32_t max_chunk,
		 ks_manifest *m)
{
	if (n < KS_MF_HDR || memcmp(buf, KS_MF_MAGIC, 4) != 0)
		return KUSOK_ECORRUPT;
	uint32_t kol = ld32(buf + 4);
	uint64_t size = ld64(buf + 8);
	if ((n - KS_MF_HDR) / KS_MF_ENT != kol || (n - KS_MF_HDR) % KS_MF_ENT)
		return KUSOK_ECORRUPT;
	ks_mf_reset(m);
	int rc = reserve(m, kol ? kol : 1);
	if (rc)
		return rc;
	const uint8_t *p = buf + KS_MF_HDR;
	for (uint32_t i = 0; i < kol; i++) {
		uint32_t len = ld32(p + 32);
		if (len == 0 || len > max_chunk)
			return KUSOK_ECORRUPT;
		memcpy(m->ids[i], p, 32);
		m->lens[i] = len;
		m->size += len;
		m->end[i] = m->size;
		p += KS_MF_ENT;
	}
	m->n = kol;
	if (m->size != size)
		return KUSOK_ECORRUPT;
	return KUSOK_OK;
}

uint32_t ks_mf_find(const ks_manifest *m, uint64_t off)
{
	/* первый i, у которого end[i] > off */
	uint32_t l = 0, r = m->n;
	while (l < r) {
		uint32_t mid = l + (r - l) / 2;
		if (m->end[mid] > off)
			r = mid;
		else
			l = mid + 1;
	}
	return l;
}
