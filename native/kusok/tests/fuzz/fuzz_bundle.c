/*
 * libFuzzer: мусор вместо пакета для import
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#include "kusok/kusok.h"

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
	static kusok *ks;
	static int kol;
	if (!ks || ++kol % 500 == 0) {
		/* время от времени — новое хранилище, чтобы не разрасталось */
		static char dir[64];
		if (ks) {
			kusok_close(ks);
			char cmd[128];
			snprintf(cmd, sizeof(cmd), "rm -rf %s", dir);
			if (system(cmd))
				abort();
		}
		strcpy(dir, "/tmp/fuzz_bundle_XXXXXX");
		if (!mkdtemp(dir))
			abort();
		kusok_opts o;
		kusok_opts_default(&o);
		o.sync = 0;
		if (kusok_open(dir, &o, &ks))
			abort();
	}
	/* настоящая шапка + мусор, иначе всё отсекается на магии */
	int fd = memfd_create("b", 0);
	if (fd < 0 || write(fd, "KUSOKBN1\1\0\0\0\0\0\0\0", 16) != 16 ||
	    write(fd, data, size) != (ssize_t)size)
		abort();
	lseek(fd, 0, SEEK_SET);
	kusok_import(ks, fd, NULL);
	close(fd);
	kusok_fsck_report f;
	if (kusok_fsck(ks, &f) || f.broken_files || f.missing_manifests)
		abort(); /* что принято — должно быть целым */
	return 0;
}
