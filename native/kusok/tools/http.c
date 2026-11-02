/*
 * SPDX-License-Identifier: MIT
 */
#include "http.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

static const char *najti_konec(const char *buf, size_t n)
{
	for (size_t i = 3; i < n; i++)
		if (buf[i] == '\n' && buf[i - 1] == '\r' &&
		    buf[i - 2] == '\n' && buf[i - 3] == '\r')
			return buf + i + 1;
	return NULL;
}

/* десятичное число без знака целиком; -1 — не число */
static int64_t chislo(const char *s, size_t n)
{
	if (!n || n > 18)
		return -1;
	int64_t v = 0;
	for (size_t i = 0; i < n; i++) {
		if (s[i] < '0' || s[i] > '9')
			return -1;
		v = v * 10 + (s[i] - '0');
	}
	return v;
}

static size_t obrezat(const char **s, size_t n)
{
	while (n && (**s == ' ' || **s == '\t')) {
		(*s)++;
		n--;
	}
	while (n && ((*s)[n - 1] == ' ' || (*s)[n - 1] == '\t'))
		n--;
	return n;
}

static int est_slovo(const char *v, size_t n, const char *slovo)
{
	/* "keep-alive", "close" — среди значений через запятую */
	size_t k = strlen(slovo);
	for (size_t i = 0; i + k <= n; i++)
		if (!strncasecmp(v + i, slovo, k) &&
		    (i == 0 || v[i - 1] == ',' || v[i - 1] == ' ') &&
		    (i + k == n || v[i + k] == ',' || v[i + k] == ' '))
			return 1;
	return 0;
}

static int zagolovok(ks_http_req *r, const char *name, size_t nn, const char *v,
		     size_t vn, int *conn_close, int *conn_keep)
{
	vn = obrezat(&v, vn);
	if (nn == 14 && !strncasecmp(name, "Content-Length", 14)) {
		int64_t x = chislo(v, vn);
		if (x < 0 || (r->content_length >= 0 && r->content_length != x))
			return -1;
		r->content_length = x;
	} else if (nn == 17 && !strncasecmp(name, "Transfer-Encoding", 17)) {
		r->chunked = 1; /* любой — не поддерживаем, ответим 411 */
	} else if (nn == 10 && !strncasecmp(name, "Connection", 10)) {
		*conn_close |= est_slovo(v, vn, "close");
		*conn_keep |= est_slovo(v, vn, "keep-alive");
	} else if (nn == 5 && !strncasecmp(name, "Range", 5)) {
		if (vn >= sizeof(r->range))
			return -1;
		memcpy(r->range, v, vn);
		r->range[vn] = 0;
		r->has_range = 1;
	} else if (nn == 6 && !strncasecmp(name, "Expect", 6)) {
		r->expect_continue = est_slovo(v, vn, "100-continue");
	}
	return 0;
}

int ks_http_parse(const char *buf, size_t n, ks_http_req *r)
{
	const char *kon = najti_konec(buf, n);
	if (!kon)
		return n >= KS_HTTP_MAX_HDR ? -2 : 0;
	if (kon - buf > KS_HTTP_MAX_HDR)
		return -2;
	memset(r, 0, sizeof(*r));
	r->content_length = -1;

	/* строка запроса: МЕТОД ПУТЬ HTTP/1.x */
	const char *p = buf, *eol = memchr(buf, '\r', (size_t)(kon - buf));
	const char *sp = memchr(p, ' ', (size_t)(eol - p));
	if (!sp || sp == p || sp - p >= (long)sizeof(r->method))
		return -1;
	memcpy(r->method, p, (size_t)(sp - p));
	for (char *m = r->method; *m; m++)
		if (!isupper((unsigned char)*m))
			return -1;
	p = sp + 1;
	sp = memchr(p, ' ', (size_t)(eol - p));
	if (!sp || *p != '/')
		return -1;
	const char *q = memchr(p, '?', (size_t)(sp - p));
	const char *pkon = q ? q : sp;
	if (pkon - p >= (long)sizeof(r->path))
		return -1;
	memcpy(r->path, p, (size_t)(pkon - p));
	if (q) {
		if (sp - q - 1 >= (long)sizeof(r->query))
			return -1;
		memcpy(r->query, q + 1, (size_t)(sp - q - 1));
	}
	p = sp + 1;
	if (eol - p != 8 || strncmp(p, "HTTP/1.", 7) ||
	    (p[7] != '0' && p[7] != '1'))
		return -1;
	r->minor = p[7] - '0';

	int conn_close = 0, conn_keep = 0;
	p = eol + 2;
	while (p < kon - 2) {
		eol = memchr(p, '\r', (size_t)(kon - p));
		if (!eol || eol[1] != '\n')
			return -1;
		const char *colon = memchr(p, ':', (size_t)(eol - p));
		if (!colon || colon == p)
			return -1;
		for (const char *c = p; c < colon; c++)
			if (*c == ' ' || *c == '\t')
				return -1; /* пробел в имени запрещён */
		if (zagolovok(r, p, (size_t)(colon - p), colon + 1,
			      (size_t)(eol - colon - 1), &conn_close,
			      &conn_keep))
			return -1;
		p = eol + 2;
	}
	r->keep_alive = r->minor == 1 ? !conn_close : conn_keep;
	return (int)(kon - buf);
}

int ks_http_range(const char *spec, uint64_t size, uint64_t *beg, uint64_t *end)
{
	if (strncmp(spec, "bytes=", 6))
		return 1; /* чужие единицы — игнорируем */
	const char *s = spec + 6;
	if (strchr(s, ','))
		return 1; /* несколько отрезков — отдаём всё, так можно */
	const char *dash = strchr(s, '-');
	if (!dash)
		return 1;
	int64_t a = dash == s ? -1 : chislo(s, (size_t)(dash - s));
	int64_t b = dash[1] ? chislo(dash + 1, strlen(dash + 1)) : -1;
	if ((dash != s && a < 0) || (dash[1] && b < 0))
		return 1; /* мусор — как будто Range нет */
	if (a < 0) {
		/* bytes=-N: последние N */
		if (b <= 0)
			return -1;
		*beg = (uint64_t)b >= size ? 0 : size - (uint64_t)b;
		*end = size;
		return size ? 0 : -1;
	}
	if ((uint64_t)a >= size)
		return -1;
	if (b >= 0 && b < a)
		return 1;
	*beg = (uint64_t)a;
	*end = b < 0 || (uint64_t)b >= size ? size : (uint64_t)b + 1;
	return 0;
}

int ks_http_query(const char *query, const char *name, char *out, size_t cap)
{
	size_t k = strlen(name);
	const char *p = query;
	while (*p) {
		const char *amp = strchr(p, '&');
		size_t len = amp ? (size_t)(amp - p) : strlen(p);
		if (len > k && !strncmp(p, name, k) && p[k] == '=') {
			size_t vn = len - k - 1;
			if (vn >= cap)
				return -1;
			memcpy(out, p + k + 1, vn);
			out[vn] = 0;
			return 0;
		}
		p += len + (amp ? 1 : 0);
	}
	return -1;
}

const char *ks_http_reason(int code)
{
	switch (code) {
	case 100:
		return "Continue";
	case 200:
		return "OK";
	case 201:
		return "Created";
	case 204:
		return "No Content";
	case 206:
		return "Partial Content";
	case 400:
		return "Bad Request";
	case 404:
		return "Not Found";
	case 405:
		return "Method Not Allowed";
	case 409:
		return "Conflict";
	case 411:
		return "Length Required";
	case 413:
		return "Payload Too Large";
	case 416:
		return "Range Not Satisfiable";
	case 431:
		return "Request Header Fields Too Large";
	case 500:
		return "Internal Server Error";
	case 503:
		return "Service Unavailable";
	default:
		return "Unknown";
	}
}
