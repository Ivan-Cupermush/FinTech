/*
 * разбор HTTP для kusok serve
 *
 * SPDX-License-Identifier: MIT
 */
#include <stdlib.h>
#include <string.h>

#include "http.h"
#include "tt.h"

static int razobrat(const char *s, ks_http_req *r)
{
	return ks_http_parse(s, strlen(s), r);
}

TT_TEST(simple_get)
{
	ks_http_req r;
	const char *s =
	    "GET /f/abc?x=1&min=0.5 HTTP/1.1\r\nHost: a\r\n\r\nNEXT";
	TT_EQ(razobrat(s, &r), (int)(strlen(s) - 4));
	TT_CHECK(!strcmp(r.method, "GET"));
	TT_CHECK(!strcmp(r.path, "/f/abc"));
	TT_CHECK(!strcmp(r.query, "x=1&min=0.5"));
	TT_EQ(r.minor, 1);
	TT_EQ(r.keep_alive, 1);
	TT_EQ(r.content_length, -1);
	TT_EQ(r.has_range, 0);
	char v[16];
	TT_EQ(ks_http_query(r.query, "min", v, sizeof(v)), 0);
	TT_CHECK(!strcmp(v, "0.5"));
	TT_EQ(ks_http_query(r.query, "mi", v, sizeof(v)), -1);
	TT_EQ(ks_http_query(r.query, "y", v, sizeof(v)), -1);
	TT_EQ(ks_http_query(r.query, "x", v, 1), -1); /* не влезло */
}

TT_TEST(headers)
{
	ks_http_req r;
	TT_CHECK(razobrat("PUT /f HTTP/1.1\r\ncontent-length:  123 \r\n"
			  "Connection: Close\r\nRANGE: bytes=5-\r\n"
			  "Expect: 100-continue\r\n\r\n",
			  &r) > 0);
	TT_EQ(r.content_length, 123);
	TT_EQ(r.keep_alive, 0);
	TT_EQ(r.has_range, 1);
	TT_CHECK(!strcmp(r.range, "bytes=5-"));
	TT_EQ(r.expect_continue, 1);
	/* 1.0: по умолчанию закрываем, keep-alive только если попросили */
	TT_CHECK(razobrat("GET / HTTP/1.0\r\n\r\n", &r) > 0);
	TT_EQ(r.keep_alive, 0);
	TT_CHECK(razobrat("GET / HTTP/1.0\r\nConnection: keep-alive\r\n\r\n",
			  &r) > 0);
	TT_EQ(r.keep_alive, 1);
	TT_CHECK(
	    razobrat("PUT /f HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n",
		     &r) > 0);
	TT_EQ(r.chunked, 1);
}

TT_TEST(incomplete_and_bad)
{
	ks_http_req r;
	TT_EQ(razobrat("GET / HTTP/1.1\r\nHost: a\r\n", &r), 0);
	TT_EQ(razobrat("", &r), 0);
	static const char *const plohie[] = {
	    "GET\r\n\r\n",
	    "get / HTTP/1.1\r\n\r\n",
	    "GET nopath HTTP/1.1\r\n\r\n",
	    "GET / HTTP/2.0\r\n\r\n",
	    "GET / HTTP/1.1 \r\n\r\n",
	    "GET / HTTP/1.1\r\nNoColon\r\n\r\n",
	    "GET / HTTP/1.1\r\nBad Name: x\r\n\r\n",
	    "GET / HTTP/1.1\r\n: empty\r\n\r\n",
	    "PUT /f HTTP/1.1\r\nContent-Length: -5\r\n\r\n",
	    "PUT /f HTTP/1.1\r\nContent-Length: 12a\r\n\r\n",
	    "PUT /f HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n",
	    "TOOLONGMETHOD / HTTP/1.1\r\n\r\n",
	};
	for (size_t i = 0; i < sizeof(plohie) / sizeof(*plohie); i++)
		TT_EQ(razobrat(plohie[i], &r), -1);
	/* одинаковые Content-Length дважды — можно */
	TT_CHECK(razobrat("PUT /f HTTP/1.1\r\nContent-Length: 2\r\n"
			  "Content-Length: 2\r\n\r\n",
			  &r) > 0);
	/* длинный путь */
	char dlin[600] = "GET /";
	memset(dlin + 5, 'a', 400);
	strcpy(dlin + 405, " HTTP/1.1\r\n\r\n");
	TT_EQ(razobrat(dlin, &r), -1);
}

TT_TEST(header_too_big)
{
	ks_http_req r;
	size_t n = KS_HTTP_MAX_HDR + 10;
	char *b = malloc(n);
	memcpy(b, "GET / HTTP/1.1\r\nX: ", 19);
	memset(b + 19, 'x', n - 19);
	TT_EQ(ks_http_parse(b, n, &r), -2);
	free(b);
}

TT_TEST(ranges)
{
	uint64_t a, b;
	TT_EQ(ks_http_range("bytes=0-99", 1000, &a, &b), 0);
	TT_EQU(a, 0);
	TT_EQU(b, 100);
	TT_EQ(ks_http_range("bytes=900-", 1000, &a, &b), 0);
	TT_EQU(a, 900);
	TT_EQU(b, 1000);
	TT_EQ(ks_http_range("bytes=990-5000", 1000, &a, &b), 0);
	TT_EQU(b, 1000);
	TT_EQ(ks_http_range("bytes=-10", 1000, &a, &b), 0);
	TT_EQU(a, 990);
	TT_EQU(b, 1000);
	TT_EQ(ks_http_range("bytes=-5000", 1000, &a, &b), 0);
	TT_EQU(a, 0);
	/* за концом и пустой файл — 416 */
	TT_EQ(ks_http_range("bytes=1000-", 1000, &a, &b), -1);
	TT_EQ(ks_http_range("bytes=-0", 1000, &a, &b), -1);
	TT_EQ(ks_http_range("bytes=-5", 0, &a, &b), -1);
	/* непонятное — отдаём файл целиком */
	TT_EQ(ks_http_range("items=0-5", 1000, &a, &b), 1);
	TT_EQ(ks_http_range("bytes=0-5,10-20", 1000, &a, &b), 1);
	TT_EQ(ks_http_range("bytes=5", 1000, &a, &b), 1);
	TT_EQ(ks_http_range("bytes=9-3", 1000, &a, &b), 1);
	TT_EQ(ks_http_range("bytes=x-3", 1000, &a, &b), 1);
}

TT_TEST(garbage_never_crashes)
{
	/* случайные байты и случайные порчи настоящего запроса */
	const char *s = "PUT /f/0123?min=1 HTTP/1.1\r\nContent-Length: 77\r\n"
			"Range: bytes=1-2\r\nConnection: keep-alive\r\n\r\n";
	size_t n = strlen(s);
	char b[256];
	uint64_t x = 9;
	size_t prinyato = 0;
	for (int k = 0; k < 50000; k++) {
		memcpy(b, s, n);
		for (int f = 0; f < 3; f++)
			b[tt_rand(&x) % n] = (char)tt_rand(&x);
		ks_http_req r;
		int h = ks_http_parse(b, n, &r);
		if (h > 0) {
			prinyato++;
			TT_CHECK(h <= (int)n);
			TT_CHECK(strlen(r.path) < sizeof(r.path));
			uint64_t a, e;
			if (r.has_range &&
			    ks_http_range(r.range, 50, &a, &e) == 0)
				TT_CHECK(a < e && e <= 50);
		}
	}
	printf("    принято испорченных запросов: %zu из 50000\n", prinyato);
}

TT_TEST(reasons)
{
	TT_CHECK(!strcmp(ks_http_reason(206), "Partial Content"));
	TT_CHECK(!strcmp(ks_http_reason(416), "Range Not Satisfiable"));
	TT_CHECK(!strcmp(ks_http_reason(999), "Unknown"));
}

int main(void)
{
	TT_RUN(simple_get);
	TT_RUN(headers);
	TT_RUN(incomplete_and_bad);
	TT_RUN(header_too_big);
	TT_RUN(ranges);
	TT_RUN(garbage_never_crashes);
	TT_RUN(reasons);
	return tt_done();
}
