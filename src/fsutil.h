/*
 * обёртки над системными вызовами
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_FSUTIL_H
#define KS_FSUTIL_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

int ks_pwrite_all(int fd, const void *buf, size_t n, uint64_t off);
int ks_write_all(int fd, const void *buf, size_t n);
/* ровно n байт, иначе KUSOK_ECORRUPT */
int ks_pread_full(int fd, void *buf, size_t n, uint64_t off);
int ks_read_some(int fd, void *buf, size_t n, size_t *got);

int ks_datasync(int fd);
int ks_fsync_dir(int dirfd);

/* tmp -> fsync -> rename */
int ks_write_atomic(int dirfd, const char *name, const void *buf, size_t n);

/* целиком в malloc */
int ks_read_file(int dirfd, const char *name, uint8_t **buf, size_t *n);

int ks_file_size(int fd, uint64_t *size);

#endif
