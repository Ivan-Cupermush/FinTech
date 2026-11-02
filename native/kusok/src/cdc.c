/*
 * SPDX-License-Identifier: MIT
 */
#include "cdc.h"

#include <pthread.h>
#include <stdlib.h>
#include <string.h>

#include "kusok/kusok.h"

static uint64_t gear[256];
static pthread_once_t gear_once = PTHREAD_ONCE_INIT;

static uint64_t splitmix(uint64_t *s)
{
	uint64_t z = (*s += 0x9E3779B97F4A7C15ull);
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
	z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
	return z ^ (z >> 31);
}

static void gear_init(void)
{
	/* seed не менять: от него зависят границы кусков */
	uint64_t s = 0x6b75736f6bull; /* "kusok" */
	for (int i = 0; i < 256; i++)
		gear[i] = splitmix(&s);
}

const uint64_t *ks_gear_table(void)
{
	pthread_once(&gear_once, gear_init);
	return gear;
}

uint64_t ks_cdc_mask(unsigned k)
{
	/* старшие биты помнят больше байт */
	uint64_t m = 0;
	if (k == 0)
		return 0;
	if (k > 48)
		k = 48;
	for (unsigned i = 0; i < k; i++)
		m |= 1ull << (63 - (i * 48) / k);
	return m;
}

static int log2u(uint32_t x)
{
	int r = 0;
	while (x > 1) {
		x >>= 1;
		r++;
	}
	return r;
}

int ks_cdc_init(ks_cdc *c, uint32_t min, uint32_t avg, uint32_t max)
{
	if (avg == 0 || (avg & (avg - 1)) != 0)
		return KUSOK_EINVAL;
	if (min < KS_CDC_MIN_LIMIT || min >= avg || avg >= max ||
	    max > KS_CDC_MAX_LIMIT)
		return KUSOK_EINVAL;
	int bits = log2u(avg);
	c->min = min;
	c->avg = avg;
	c->max = max;
	c->mask_s = ks_cdc_mask((unsigned)bits + 2);
	c->mask_l = ks_cdc_mask((unsigned)(bits > 2 ? bits - 2 : 1));
	ks_gear_table();
	return KUSOK_OK;
}

size_t ks_cdc_cut(const ks_cdc *c, const uint8_t *buf, size_t n)
{
	if (n <= c->min)
		return n;
	if (n > c->max)
		n = c->max;
	size_t normal = c->avg < n ? c->avg : n;
	uint64_t fp = 0;
	size_t i = c->min; /* до min не режем */
	for (; i < normal; i++) {
		fp = (fp << 1) + gear[buf[i]];
		if (!(fp & c->mask_s))
			return i + 1;
	}
	for (; i < n; i++) {
		fp = (fp << 1) + gear[buf[i]];
		if (!(fp & c->mask_l))
			return i + 1;
	}
	return n;
}

int ks_chunker_init(ks_chunker *k, const ks_cdc *c)
{
	k->c = *c;
	k->cap = (size_t)c->max * 2;
	k->beg = k->end = 0;
	k->buf = malloc(k->cap);
	return k->buf ? KUSOK_OK : KUSOK_ENOMEM;
}

void ks_chunker_free(ks_chunker *k)
{
	free(k->buf);
	k->buf = NULL;
}

static int drain(ks_chunker *k, size_t need, ks_chunk_cb cb, void *ctx)
{
	while (k->end - k->beg >= need && k->end > k->beg) {
		size_t cut =
		    ks_cdc_cut(&k->c, k->buf + k->beg, k->end - k->beg);
		int rc = cb(k->buf + k->beg, cut, ctx);
		k->beg += cut;
		if (rc)
			return rc;
	}
	return KUSOK_OK;
}

int ks_chunker_feed(ks_chunker *k, const void *data, size_t n, ks_chunk_cb cb,
		    void *ctx)
{
	const uint8_t *p = data;
	while (n) {
		if (k->end == k->cap) {
			/* хвост в начало */
			size_t ost = k->end - k->beg;
			memmove(k->buf, k->buf + k->beg, ost);
			k->beg = 0;
			k->end = ost;
		}
		size_t kol = k->cap - k->end;
		if (kol > n)
			kol = n;
		memcpy(k->buf + k->end, p, kol);
		k->end += kol;
		p += kol;
		n -= kol;
		int rc = drain(k, k->c.max, cb, ctx);
		if (rc)
			return rc;
	}
	return KUSOK_OK;
}

int ks_chunker_finish(ks_chunker *k, ks_chunk_cb cb, void *ctx)
{
	int rc = drain(k, 1, cb, ctx);
	k->beg = k->end = 0;
	return rc;
}
