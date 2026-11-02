/*
 * libFuzzer: распаковка мусора
 *
 * SPDX-License-Identifier: MIT
 */
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include "lz.h"

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
	/* 2 байта — размер выхода */
	if (size < 2)
		return 0;
	size_t cap = (size_t)data[0] | ((size_t)data[1] << 8);
	uint8_t *out = malloc(cap ? cap : 1);
	size_t n;
	ks_lz_decompress(data + 2, size - 2, out, cap, &n);
	free(out);
	return 0;
}
