/*
 * libFuzzer: мусор вместо idx-файла. принятый индекс обязан
 * описывать записи подряд внутри pack
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "bytes.h"
#include "crc32c.h"
#include "idx.h"

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

struct proverka {
	uint64_t prev;
};

static int cb(const ks_rec *r, uint64_t off, void *ctx)
{
	struct proverka *p = ctx;
	if (off != p->prev || !ks_rec_sane(r))
		abort();
	p->prev = off + KS_REC_HDR + r->slen;
	return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
	static int dirfd = -1;
	if (dirfd < 0) {
		char tmpl[] = "/tmp/fuzz_idx_XXXXXX";
		if (!mkdtemp(tmpl))
			abort();
		dirfd = open(tmpl, O_RDONLY | O_DIRECTORY);
	}
	int fd =
	    openat(dirfd, "00000007.idx", O_CREAT | O_TRUNC | O_WRONLY, 0644);
	if (fd < 0 || write(fd, data, size) != (ssize_t)size)
		abort();
	close(fd);
	ks_pack p = {.fd = -1, .id = 7, .len = 1u << 20, .tail = 0};
	struct proverka pr = {KS_PACK_HDR};
	uint64_t len;
	if (ks_idx_load(dirfd, &p, cb, &pr, &len) == 0 &&
	    (pr.prev != len || len > p.len))
		abort();
	return 0;
}
