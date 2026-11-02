/*
 * libFuzzer: мусор вместо pack-файла
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
#include <sys/stat.h>
#include <unistd.h>

#include "crc32c.h"
#include "kusok/kusok.h"
#include "pack.h"

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

static char dir[256];

static void podgotovka(void)
{
	if (dir[0])
		return;
	snprintf(dir, sizeof(dir), "/tmp/kusok-fuzz-%d", (int)getpid());
	mkdir(dir, 0755);
	char p[300];
	snprintf(p, sizeof(p), "%s/packs", dir);
	mkdir(p, 0755);
	snprintf(p, sizeof(p), "%s/FORMAT", dir);
	FILE *f = fopen(p, "w");
	fputs("kusok store v1\n", f);
	fclose(f);
	snprintf(p, sizeof(p), "%s/LOCK", dir);
	close(open(p, O_CREAT | O_WRONLY, 0644));
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
	podgotovka();
	char p[300];
	snprintf(p, sizeof(p), "%s/packs/00000001.pack", dir);
	int fd = open(p, O_CREAT | O_TRUNC | O_WRONLY, 0644);
	/* настоящий заголовок + мусор */
	uint8_t h[KS_PACK_HDR] = {'K', 'U', 'S', 'O', 'K', 'P', 'K', '1',
				  1,   0,   0,	 0,   1,   0,	0,   0};
	uint32_t c = ks_crc32c(0, h, 16);
	memcpy(h + 16, &c, 4);
	if (write(fd, h, sizeof(h)) != (ssize_t)sizeof(h) ||
	    write(fd, data, size) != (ssize_t)size)
		abort();
	close(fd);
	kusok_opts o;
	kusok_opts_default(&o);
	o.read_only = 1;
	o.salvage = 1;
	kusok *ks;
	if (kusok_open(dir, &o, &ks) == 0) {
		kusok_fsck_report r;
		kusok_fsck(ks, &r);
		kusok_stat st;
		kusok_stat_get(ks, &st);
		kusok_close(ks);
	}
	return 0;
}
