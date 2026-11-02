/*
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include "fsutil.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "kusok/kusok.h"

int ks_pwrite_all(int fd, const void *buf, size_t n, uint64_t off)
{
	const uint8_t *p = buf;
	while (n) {
		ssize_t w = pwrite(fd, p, n, (off_t)off);
		if (w < 0) {
			if (errno == EINTR)
				continue;
			return KUSOK_EIO;
		}
		p += w;
		n -= (size_t)w;
		off += (uint64_t)w;
	}
	return KUSOK_OK;
}

int ks_write_all(int fd, const void *buf, size_t n)
{
	const uint8_t *p = buf;
	while (n) {
		ssize_t w = write(fd, p, n);
		if (w < 0) {
			if (errno == EINTR)
				continue;
			return KUSOK_EIO;
		}
		p += w;
		n -= (size_t)w;
	}
	return KUSOK_OK;
}

int ks_pread_full(int fd, void *buf, size_t n, uint64_t off)
{
	uint8_t *p = buf;
	while (n) {
		ssize_t r = pread(fd, p, n, (off_t)off);
		if (r < 0) {
			if (errno == EINTR)
				continue;
			return KUSOK_EIO;
		}
		if (r == 0)
			return KUSOK_ECORRUPT;
		p += r;
		n -= (size_t)r;
		off += (uint64_t)r;
	}
	return KUSOK_OK;
}

int ks_read_some(int fd, void *buf, size_t n, size_t *got)
{
	uint8_t *p = buf;
	size_t kol = 0;
	while (kol < n) {
		ssize_t r = read(fd, p + kol, n - kol);
		if (r < 0) {
			if (errno == EINTR)
				continue;
			return KUSOK_EIO;
		}
		if (r == 0)
			break;
		kol += (size_t)r;
	}
	*got = kol;
	return KUSOK_OK;
}

int ks_datasync(int fd)
{
#if defined(__linux__)
	if (fdatasync(fd))
		return KUSOK_EIO;
#else
	if (fsync(fd))
		return KUSOK_EIO;
#endif
	return KUSOK_OK;
}

int ks_fsync_dir(int dirfd)
{
	/* где-то fsync каталога даёт EINVAL, это норм */
	if (fsync(dirfd) && errno != EINVAL)
		return KUSOK_EIO;
	return KUSOK_OK;
}

int ks_write_atomic(int dirfd, const char *name, const void *buf, size_t n)
{
	char tmp[256];
	if (snprintf(tmp, sizeof(tmp), "%s.tmp", name) >= (int)sizeof(tmp))
		return KUSOK_EINVAL;
	int fd =
	    openat(dirfd, tmp, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
	if (fd < 0)
		return KUSOK_EIO;
	int rc = ks_write_all(fd, buf, n);
	if (!rc && fsync(fd))
		rc = KUSOK_EIO;
	if (close(fd) && !rc)
		rc = KUSOK_EIO;
	if (!rc && renameat(dirfd, tmp, dirfd, name))
		rc = KUSOK_EIO;
	if (!rc)
		rc = ks_fsync_dir(dirfd);
	if (rc)
		unlinkat(dirfd, tmp, 0);
	return rc;
}

int ks_file_size(int fd, uint64_t *size)
{
	struct stat st;
	if (fstat(fd, &st))
		return KUSOK_EIO;
	*size = (uint64_t)st.st_size;
	return KUSOK_OK;
}

int ks_read_file(int dirfd, const char *name, uint8_t **buf, size_t *n)
{
	int fd = openat(dirfd, name, O_RDONLY | O_CLOEXEC);
	if (fd < 0)
		return errno == ENOENT ? KUSOK_ENOTFOUND : KUSOK_EIO;
	uint64_t sz;
	int rc = ks_file_size(fd, &sz);
	if (rc) {
		close(fd);
		return rc;
	}
	if (sz > ((uint64_t)1 << 32)) {
		close(fd);
		return KUSOK_ETOOBIG;
	}
	uint8_t *p = malloc(sz ? (size_t)sz : 1);
	if (!p) {
		close(fd);
		return KUSOK_ENOMEM;
	}
	rc = sz ? ks_pread_full(fd, p, (size_t)sz, 0) : KUSOK_OK;
	close(fd);
	if (rc) {
		free(p);
		return rc;
	}
	*buf = p;
	*n = (size_t)sz;
	return KUSOK_OK;
}
