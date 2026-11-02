/*
 * libFuzzer: разбор HTTP-запроса и Range
 *
 * SPDX-License-Identifier: MIT
 */
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "http.h"

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
	ks_http_req r;
	int h = ks_http_parse((const char *)data, size, &r);
	if (h > (int)size)
		abort();
	if (h > 0) {
		uint64_t a, b;
		for (uint64_t n = 0; n < 3000; n += 997)
			if (r.has_range &&
			    ks_http_range(r.range, n, &a, &b) == 0 &&
			    !(a < b && b <= n))
				abort();
		char v[32];
		ks_http_query(r.query, "min", v, sizeof(v));
	}
	return 0;
}
