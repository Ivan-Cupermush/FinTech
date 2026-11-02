/*
 * libFuzzer: сжать и распаковать
 *
 * SPDX-License-Identifier: MIT
 */
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "cdc.h"
#include "lz.h"

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
	size_t cap = ks_lz_bound(size);
	uint8_t *z = malloc(cap), *back = malloc(size ? size : 1);
	size_t zn, bn;
	if (ks_lz_compress(data, size, z, cap, &zn) != 0)
		abort(); /* bound обязан хватать всегда */
	if (ks_lz_decompress(z, zn, back, size, &bn) != 0 || bn != size ||
	    memcmp(back, data, size) != 0)
		abort();
	/* сильный режим, уровень из первого байта */
	int level = KS_LZ_HC_MIN + (size ? data[0] % 11 : 0);
	if (ks_lz_compress_hc(data, size, z, cap, &zn, level) != 0)
		abort();
	if (ks_lz_decompress(z, zn, back, size, &bn) != 0 || bn != size ||
	    memcmp(back, data, size) != 0)
		abort();
	/* и нарезка: сумма кусков == размер, каждый в пределах */
	ks_cdc c;
	ks_cdc_init(&c, 64, 256, 1024);
	size_t pos = 0;
	while (pos < size) {
		size_t cut = ks_cdc_cut(&c, data + pos, size - pos);
		if (cut == 0 || cut > c.max)
			abort();
		pos += cut;
	}
	free(z);
	free(back);
	return 0;
}
