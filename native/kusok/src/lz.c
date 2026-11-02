/*
 * SPDX-License-Identifier: MIT
 */
#include "lz.h"

#include <stdlib.h>
#include <string.h>

#include "bytes.h"
#include "kusok/kusok.h"

#define MINMATCH 4
#define LASTLITERALS 5
#define MFLIMIT 12
#define MAX_OFF 65535
#define HASH_LOG 14
#define NO_POS 0xFFFFFFFFu

size_t ks_lz_bound(size_t n)
{
	return n + n / 255 + 16;
}

static inline uint32_t hash4(uint32_t v)
{
	/* хеш Кнута */
	return (v * 2654435761u) >> (32 - HASH_LOG);
}

static uint8_t *put_len(uint8_t *op, size_t len)
{
	while (len >= 255) {
		*op++ = 255;
		len -= 255;
	}
	*op++ = (uint8_t)len;
	return op;
}

static size_t seq_size(size_t lit, size_t ml)
{
	size_t s = 1 + lit;
	if (lit >= 15)
		s += (lit - 15) / 255 + 1;
	if (ml != (size_t)-1) {
		s += 2;
		if (ml >= 15)
			s += (ml - 15) / 255 + 1;
	}
	return s;
}

/* ml == -1 — только литералы */
static uint8_t *put_seq(uint8_t *op, const uint8_t *lit, size_t nlit,
			size_t off, size_t ml)
{
	uint8_t *tok = op++;
	uint8_t t = 0;
	if (nlit >= 15) {
		t = 15 << 4;
		op = put_len(op, nlit - 15);
	} else {
		t = (uint8_t)(nlit << 4);
	}
	memcpy(op, lit, nlit);
	op += nlit;
	if (ml != (size_t)-1) {
		st16(op, (uint16_t)off);
		op += 2;
		if (ml >= 15) {
			t |= 15;
			op = put_len(op, ml - 15);
		} else {
			t |= (uint8_t)ml;
		}
	}
	*tok = t;
	return op;
}

int ks_lz_compress(const uint8_t *src, size_t n, uint8_t *dst, size_t cap,
		   size_t *out)
{
	uint32_t tab[1u << HASH_LOG];
	uint8_t *op = dst;
	const uint8_t *kon = dst + cap;
	size_t anchor = 0;

	if (n > KS_LZ_MAX_INPUT)
		return KUSOK_ETOOBIG;

	if (n >= MFLIMIT + 1) {
		size_t limit = n - MFLIMIT;
		size_t matchlimit = n - LASTLITERALS;
		size_t ip = 0;
		memset(tab, 0xff, sizeof(tab));
		while (ip < limit) {
			uint32_t v = peek32(src + ip);
			uint32_t h = hash4(v);
			uint32_t ref = tab[h];
			tab[h] = (uint32_t)ip;
			if (ref == NO_POS || ip - ref > MAX_OFF ||
			    peek32(src + ref) != v) {
				/* нет совпадений — шаг больше */
				ip += 1 + ((ip - anchor) >> 6);
				continue;
			}
			size_t r = ref;
			while (ip > anchor && r > 0 &&
			       src[ip - 1] == src[r - 1]) {
				ip--;
				r--;
			}
			size_t len = MINMATCH;
			while (ip + len < matchlimit &&
			       src[ip + len] == src[r + len])
				len++;
			size_t nlit = ip - anchor;
			if ((size_t)(kon - op) < seq_size(nlit, len - MINMATCH))
				return KUSOK_ETOOBIG;
			op = put_seq(op, src + anchor, nlit, ip - r,
				     len - MINMATCH);
			ip += len;
			anchor = ip;
			if (ip < limit && ip >= 2)
				tab[hash4(peek32(src + ip - 2))] =
				    (uint32_t)(ip - 2);
		}
	}
	size_t nlit = n - anchor;
	if ((size_t)(kon - op) < seq_size(nlit, (size_t)-1))
		return KUSOK_ETOOBIG;
	op = put_seq(op, src + anchor, nlit, 0, (size_t)-1);
	*out = (size_t)(op - dst);
	return KUSOK_OK;
}

/*
 * сильное сжатие (как lz4hc): все позиции с тем же хешем связаны в
 * цепочку, смотрим до attempts кандидатов и берём самое длинное.
 * плюс ленивый поиск: если на шаг дальше совпадение длиннее — берём его
 */
#define HC_LOG 15
#define HC_WIN 65536

struct hc {
	uint32_t head[1u << HC_LOG];
	uint16_t prev[HC_WIN]; /* шаг назад к прошлой позиции с тем же хешем */
	size_t next;	       /* до куда уже вставили */
};

static inline uint32_t hash_hc(uint32_t v)
{
	return (v * 2654435761u) >> (32 - HC_LOG);
}

static void hc_vstavit(struct hc *h, const uint8_t *src, size_t do_)
{
	for (; h->next < do_; h->next++) {
		uint32_t k = hash_hc(peek32(src + h->next));
		size_t shag = h->next - h->head[k];
		if (h->head[k] == NO_POS || shag > MAX_OFF)
			shag = 0; /* 0 — цепочка кончилась */
		h->prev[h->next & (HC_WIN - 1)] = (uint16_t)shag;
		h->head[k] = (uint32_t)h->next;
	}
}

/* самое длинное совпадение для ip; 0 — нет */
static size_t hc_naiti(struct hc *h, const uint8_t *src, size_t ip,
		       size_t matchlimit, unsigned attempts, size_t *ref)
{
	hc_vstavit(h, src, ip);
	uint32_t v = peek32(src + ip);
	size_t best = 0;
	uint32_t c = h->head[hash_hc(v)];
	for (unsigned k = 0; k < attempts && c != NO_POS; k++) {
		if (ip - c > MAX_OFF || c >= ip)
			break;
		if (peek32(src + c) == v && src[c + best] == src[ip + best]) {
			size_t len = MINMATCH;
			while (ip + len < matchlimit &&
			       src[ip + len] == src[c + len])
				len++;
			if (len > best) {
				best = len;
				*ref = c;
			}
		}
		uint16_t shag = h->prev[c & (HC_WIN - 1)];
		if (!shag)
			break;
		c -= shag;
	}
	return best >= MINMATCH ? best : 0;
}

int ks_lz_compress_hc(const uint8_t *src, size_t n, uint8_t *dst, size_t cap,
		      size_t *out, int level)
{
	if (level < KS_LZ_HC_MIN || level > KS_LZ_HC_MAX)
		return KUSOK_EINVAL;
	if (n > KS_LZ_MAX_INPUT)
		return KUSOK_ETOOBIG;
	struct hc *h = malloc(sizeof(*h));
	if (!h)
		return KUSOK_ENOMEM;
	memset(h->head, 0xff, sizeof(h->head));
	h->next = 0;
	unsigned attempts = 1u << (level - 1);
	uint8_t *op = dst;
	const uint8_t *kon = dst + cap;
	size_t anchor = 0;
	int rc = KUSOK_OK;

	if (n >= MFLIMIT + 1) {
		size_t limit = n - MFLIMIT;
		size_t matchlimit = n - LASTLITERALS;
		size_t ip = 0;
		while (ip < limit) {
			size_t r1;
			size_t l1 =
			    hc_naiti(h, src, ip, matchlimit, attempts, &r1);
			if (!l1) {
				ip++;
				continue;
			}
			/* ленивый шаг: вдруг со следующей позиции лучше */
			while (ip + 1 < limit) {
				size_t r2;
				size_t l2 = hc_naiti(h, src, ip + 1, matchlimit,
						     attempts, &r2);
				if (l2 <= l1)
					break;
				ip++;
				l1 = l2;
				r1 = r2;
			}
			size_t nlit = ip - anchor;
			if ((size_t)(kon - op) <
			    seq_size(nlit, l1 - MINMATCH)) {
				rc = KUSOK_ETOOBIG;
				break;
			}
			op = put_seq(op, src + anchor, nlit, ip - r1,
				     l1 - MINMATCH);
			ip += l1;
			anchor = ip;
		}
	}
	if (!rc) {
		size_t nlit = n - anchor;
		if ((size_t)(kon - op) < seq_size(nlit, (size_t)-1))
			rc = KUSOK_ETOOBIG;
		else
			op = put_seq(op, src + anchor, nlit, 0, (size_t)-1);
	}
	free(h);
	if (!rc)
		*out = (size_t)(op - dst);
	return rc;
}

/* -1 — вход кончился */
static int get_len(const uint8_t *src, size_t n, size_t *ip, size_t *len)
{
	uint8_t s;
	do {
		if (*ip >= n)
			return -1;
		s = src[(*ip)++];
		*len += s;
		if (*len > KS_LZ_MAX_INPUT)
			return -1;
	} while (s == 255);
	return 0;
}

int ks_lz_decompress(const uint8_t *src, size_t n, uint8_t *dst, size_t cap,
		     size_t *out)
{
	size_t ip = 0, op = 0;
	for (;;) {
		if (ip >= n)
			return KUSOK_ECORRUPT;
		uint8_t tok = src[ip++];
		size_t lit = tok >> 4;
		if (lit == 15 && get_len(src, n, &ip, &lit))
			return KUSOK_ECORRUPT;
		if (lit > n - ip || lit > cap - op)
			return KUSOK_ECORRUPT;
		memcpy(dst + op, src + ip, lit);
		ip += lit;
		op += lit;
		if (ip == n)
			break; /* последняя последовательность — без совпадения */
		if (n - ip < 2)
			return KUSOK_ECORRUPT;
		size_t off = ld16(src + ip);
		ip += 2;
		if (off == 0 || off > op)
			return KUSOK_ECORRUPT;
		size_t ml = tok & 15;
		if (ml == 15 && get_len(src, n, &ip, &ml))
			return KUSOK_ECORRUPT;
		ml += MINMATCH;
		if (ml > cap - op)
			return KUSOK_ECORRUPT;
		uint8_t *d = dst + op;
		const uint8_t *s = d - off;
		if (off >= ml) {
			memcpy(d, s, ml);
		} else {
			/* перекрытие — по байту */
			for (size_t i = 0; i < ml; i++)
				d[i] = s[i];
		}
		op += ml;
	}
	*out = op;
	return KUSOK_OK;
}
