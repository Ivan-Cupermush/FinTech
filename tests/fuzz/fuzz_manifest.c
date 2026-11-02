/*
 * libFuzzer: разбор манифеста
 *
 * SPDX-License-Identifier: MIT
 */
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include "manifest.h"

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
	ks_manifest m;
	ks_mf_init(&m);
	if (ks_mf_decode(data, size, 65536, &m) == 0) {
		uint64_t sum = 0;
		for (uint32_t i = 0; i < m.n; i++)
			sum += m.lens[i];
		if (sum != m.size)
			abort();
		if (m.size) {
			uint32_t i = ks_mf_find(&m, m.size - 1);
			if (i >= m.n)
				abort();
		}
	}
	ks_mf_free(&m);
	return 0;
}
