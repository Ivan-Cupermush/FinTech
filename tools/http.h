/*
 * маленький разбор HTTP/1.x для kusok serve: только то, что нужно
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_HTTP_H
#define KS_HTTP_H

#include <stddef.h>
#include <stdint.h>

#define KS_HTTP_MAX_HDR 16384

typedef struct ks_http_req {
	char method[8];
	char path[256];		/* без query */
	char query[256];	/* после '?', без него */
	int minor;		/* HTTP/1.minor */
	int64_t content_length; /* -1 — нет */
	int chunked;
	int keep_alive;
	int has_range;
	char range[128];
	int expect_continue;
} ks_http_req;

/*
 * >0 — длина заголовка, 0 — нужно ещё данных, -1 — плохой запрос,
 * -2 — заголовок слишком длинный
 */
int ks_http_parse(const char *buf, size_t n, ks_http_req *r);

/* Range: 0 — отрезок [*beg, *end), 1 — отдать всё, -1 — 416 */
int ks_http_range(const char *spec, uint64_t size, uint64_t *beg,
		  uint64_t *end);

/* значение параметра из query; 0 — нашли */
int ks_http_query(const char *query, const char *name, char *out, size_t cap);

const char *ks_http_reason(int code);

#endif
