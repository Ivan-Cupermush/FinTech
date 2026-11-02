/*
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include "journal.h"

#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "bytes.h"
#include "crc32c.h"
#include "fsutil.h"
#include "kusok/kusok.h"

#define LOG_NAME "refs.log"
#define SNAP_NAME "refs.snap"

int ks_refs_apply(ks_tab *refs, const uint8_t id[32], int64_t delta)
{
	void *slot;
	int rc = ks_tab_put(refs, id, &slot, NULL);
	if (rc)
		return rc;
	((ks_ref *)slot)->refs += delta;
	return KUSOK_OK;
}

static int load_snap(int dirfd, ks_tab *refs, uint64_t *seq)
{
	uint8_t *buf;
	size_t n;
	*seq = 0;
	int rc = ks_read_file(dirfd, SNAP_NAME, &buf, &n);
	if (rc == KUSOK_ENOTFOUND)
		return KUSOK_OK; /* новое хранилище */
	if (rc)
		return rc;
	rc = KUSOK_ECORRUPT;
	if (n < KS_SNAP_HDR + 4 || memcmp(buf, KS_SNAP_MAGIC, 8) != 0)
		goto out;
	if (ld32(buf + 8) != 1) {
		rc = KUSOK_EFORMAT;
		goto out;
	}
	if (ks_crc32c(0, buf, n - 4) != ld32(buf + n - 4))
		goto out;
	uint64_t kol = ld64(buf + 24);
	if ((n - KS_SNAP_HDR - 4) % KS_SNAP_ENT ||
	    (n - KS_SNAP_HDR - 4) / KS_SNAP_ENT != kol)
		goto out;
	const uint8_t *p = buf + KS_SNAP_HDR;
	for (uint64_t i = 0; i < kol; i++, p += KS_SNAP_ENT) {
		int e = ks_refs_apply(refs, p, (int64_t)ld64(p + 32));
		if (e) {
			rc = e;
			goto out;
		}
	}
	*seq = ld64(buf + 16);
	rc = KUSOK_OK;
out:
	free(buf);
	return rc;
}

static void rec_encode(uint8_t r[KS_JR_REC], const uint8_t id[32], int op,
		       uint64_t seq)
{
	memset(r, 0, KS_JR_REC);
	r[4] = (uint8_t)op;
	st64(r + 8, seq);
	memcpy(r + 16, id, 32);
	st32(r, ks_crc32c(0, r + 4, KS_JR_REC - 4));
}

static int rec_ok(const uint8_t r[KS_JR_REC])
{
	if (ks_crc32c(0, r + 4, KS_JR_REC - 4) != ld32(r))
		return 0;
	if (r[4] != KS_JR_INC && r[4] != KS_JR_DEC)
		return 0;
	return r[5] == 0 && r[6] == 0 && r[7] == 0;
}

int ks_journal_open(int dirfd, int rw, ks_tab *refs, ks_journal *j)
{
	uint64_t snap_seq;
	memset(j, 0, sizeof(*j));
	j->dirfd = dirfd;
	j->fd = -1;
	j->rw = rw;
	int rc = load_snap(dirfd, refs, &snap_seq);
	if (rc)
		return rc;
	j->seq = snap_seq;

	int fl = rw ? (O_RDWR | O_CREAT) : O_RDONLY;
	j->fd = openat(dirfd, LOG_NAME, fl | O_CLOEXEC, 0644);
	if (j->fd < 0) {
		if (!rw && errno == ENOENT)
			return KUSOK_OK; /* читать нечего */
		return KUSOK_EIO;
	}
	uint64_t size;
	rc = ks_file_size(j->fd, &size);
	if (rc)
		return rc;

	enum { PORC = 4096 };
	uint8_t *buf = malloc(PORC * KS_JR_REC);
	if (!buf)
		return KUSOK_ENOMEM;
	uint64_t pos = 0, good = 0;
	int stop = 0;
	while (!stop && pos + KS_JR_REC <= size) {
		uint64_t kol = (size - pos) / KS_JR_REC;
		if (kol > PORC)
			kol = PORC;
		rc = ks_pread_full(j->fd, buf, (size_t)(kol * KS_JR_REC), pos);
		if (rc)
			break;
		for (uint64_t i = 0; i < kol; i++) {
			const uint8_t *r = buf + i * KS_JR_REC;
			uint64_t seq = ld64(r + 8);
			/* битая или дырка в seq — хвост */
			if (!rec_ok(r) ||
			    (seq > snap_seq && seq != j->seq + 1)) {
				stop = 1;
				break;
			}
			if (seq > snap_seq) {
				int64_t d = r[4] == KS_JR_INC ? 1 : -1;
				rc = ks_refs_apply(refs, r + 16, d);
				if (rc) {
					stop = 1;
					break;
				}
				j->seq = seq;
			}
			pos += KS_JR_REC;
			good = pos;
		}
	}
	free(buf);
	if (rc)
		return rc;
	j->len = good;
	j->torn = size - good;
	if (rw && good != size) {
		if (ftruncate(j->fd, (off_t)good) || ks_datasync(j->fd))
			return KUSOK_EIO;
	}
	return KUSOK_OK;
}

void ks_journal_close(ks_journal *j)
{
	if (j->fd >= 0)
		close(j->fd);
	j->fd = -1;
}

int ks_journal_add(ks_journal *j, const uint8_t id[32], int op)
{
	uint8_t r[KS_JR_REC];
	if (!j->rw)
		return KUSOK_ERDONLY;
	if (op != KS_JR_INC && op != KS_JR_DEC)
		return KUSOK_EINVAL;
	rec_encode(r, id, op, j->seq + 1);
	int rc = ks_pwrite_all(j->fd, r, KS_JR_REC, j->len);
	if (rc)
		return rc;
	j->seq++;
	j->len += KS_JR_REC;
	return KUSOK_OK;
}

int ks_journal_sync(ks_journal *j)
{
	if (j->fd < 0 || !j->rw)
		return KUSOK_OK;
	return ks_datasync(j->fd);
}

int ks_journal_checkpoint(ks_journal *j, const ks_tab *refs)
{
	if (!j->rw)
		return KUSOK_ERDONLY;
	uint64_t kol = 0;
	for (size_t i = ks_tab_next(refs, 0); i < refs->cap;
	     i = ks_tab_next(refs, i + 1))
		if (((const ks_ref *)ks_tab_at(refs, i))->refs != 0)
			kol++;
	size_t n = KS_SNAP_HDR + (size_t)kol * KS_SNAP_ENT + 4;
	uint8_t *buf = malloc(n);
	if (!buf)
		return KUSOK_ENOMEM;
	memcpy(buf, KS_SNAP_MAGIC, 8);
	st32(buf + 8, 1);
	st32(buf + 12, 0);
	st64(buf + 16, j->seq);
	st64(buf + 24, kol);
	uint8_t *p = buf + KS_SNAP_HDR;
	for (size_t i = ks_tab_next(refs, 0); i < refs->cap;
	     i = ks_tab_next(refs, i + 1)) {
		const ks_ref *r = ks_tab_at(refs, i);
		if (r->refs == 0)
			continue;
		memcpy(p, r->id, 32);
		st64(p + 32, (uint64_t)r->refs);
		p += KS_SNAP_ENT;
	}
	st32(buf + n - 4, ks_crc32c(0, buf, n - 4));
	int rc = ks_write_atomic(j->dirfd, SNAP_NAME, buf, n);
	free(buf);
	if (rc)
		return rc;
	/* упадём тут — seq спасёт */
	if (ftruncate(j->fd, 0) || ks_datasync(j->fd))
		return KUSOK_EIO;
	j->len = 0;
	return KUSOK_OK;
}
