/*
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include "pack.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/uio.h>
#include <unistd.h>

#include "bytes.h"
#include "crc32c.h"
#include "fsutil.h"
#include "kusok/kusok.h"

void ks_pack_name(uint32_t id, char out[32])
{
	snprintf(out, 32, "%08u.pack", id);
}

int ks_pack_parse_name(const char *name, uint32_t *id)
{
	/* ровно 8 цифр и .pack */
	uint32_t v = 0;
	for (int i = 0; i < 8; i++) {
		if (name[i] < '0' || name[i] > '9')
			return -1;
		v = v * 10 + (uint32_t)(name[i] - '0');
	}
	if (strcmp(name + 8, ".pack") != 0)
		return -1;
	*id = v;
	return 0;
}

uint32_t ks_rec_crc(const uint8_t hdr[KS_REC_HDR], const void *payload,
		    uint32_t slen)
{
	uint32_t c = ks_crc32c(0, hdr + 4, KS_REC_HDR - 4);
	return ks_crc32c(c, payload, slen);
}

void ks_rec_encode(const ks_rec *r, const void *payload,
		   uint8_t hdr[KS_REC_HDR])
{
	hdr[4] = r->type;
	hdr[5] = r->codec;
	st16(hdr + 6, 0);
	st32(hdr + 8, r->slen);
	st32(hdr + 12, r->rlen);
	memcpy(hdr + 16, r->id, 32);
	st32(hdr, ks_rec_crc(hdr, payload, r->slen));
}

int ks_rec_decode(const uint8_t hdr[KS_REC_HDR], ks_rec *r, uint32_t *crc)
{
	*crc = ld32(hdr);
	r->type = hdr[4];
	r->codec = hdr[5];
	r->slen = ld32(hdr + 8);
	r->rlen = ld32(hdr + 12);
	memcpy(r->id, hdr + 16, 32);
	if (ld16(hdr + 6) != 0)
		return KUSOK_ECORRUPT;
	return ks_rec_sane(r) ? KUSOK_OK : KUSOK_ECORRUPT;
}

int ks_rec_sane(const ks_rec *r)
{
	if (r->type != KS_REC_CHUNK && r->type != KS_REC_MANIFEST)
		return 0;
	if (r->codec != KS_CODEC_RAW && r->codec != KS_CODEC_LZ)
		return 0;
	if (r->slen > KS_REC_MAX || r->rlen > KS_REC_MAX)
		return 0;
	if (r->codec == KS_CODEC_RAW && r->slen != r->rlen)
		return 0;
	if (r->codec == KS_CODEC_LZ &&
	    (r->slen == 0 || (uint64_t)r->rlen > (uint64_t)r->slen * 255 + 16))
		return 0;
	return 1;
}

static void hdr_encode(uint32_t id, uint8_t h[KS_PACK_HDR])
{
	memcpy(h, KS_PACK_MAGIC, 8);
	st32(h + 8, KS_PACK_VERSION);
	st32(h + 12, id);
	st32(h + 16, ks_crc32c(0, h, 16));
	st32(h + 20, 0);
}

int ks_pack_create(int dirfd, uint32_t id, ks_pack *p)
{
	char name[32];
	uint8_t h[KS_PACK_HDR];
	ks_pack_name(id, name);
	int fd =
	    openat(dirfd, name, O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0644);
	if (fd < 0)
		return KUSOK_EIO;
	hdr_encode(id, h);
	int rc = ks_pwrite_all(fd, h, KS_PACK_HDR, 0);
	if (!rc)
		rc = ks_datasync(fd);
	if (!rc)
		rc = ks_fsync_dir(dirfd);
	if (rc) {
		close(fd);
		unlinkat(dirfd, name, 0);
		return rc;
	}
	p->fd = fd;
	p->id = id;
	p->len = KS_PACK_HDR;
	p->tail = 0;
	return KUSOK_OK;
}

int ks_pack_open(int dirfd, uint32_t id, int rw, ks_pack *p)
{
	char name[32];
	uint8_t h[KS_PACK_HDR], want[KS_PACK_HDR];
	ks_pack_name(id, name);
	int fd = openat(dirfd, name, (rw ? O_RDWR : O_RDONLY) | O_CLOEXEC);
	if (fd < 0)
		return errno == ENOENT ? KUSOK_ENOTFOUND : KUSOK_EIO;
	uint64_t len;
	int rc = ks_file_size(fd, &len);
	if (!rc && len < KS_PACK_HDR)
		rc = KUSOK_ECORRUPT;
	if (!rc)
		rc = ks_pread_full(fd, h, KS_PACK_HDR, 0);
	if (!rc) {
		hdr_encode(id, want);
		if (memcmp(h, KS_PACK_MAGIC, 8) == 0 &&
		    ld32(h + 8) != KS_PACK_VERSION)
			rc = KUSOK_EFORMAT;
		else if (memcmp(h, want, KS_PACK_HDR) != 0)
			rc = KUSOK_ECORRUPT;
	}
	if (rc) {
		close(fd);
		return rc;
	}
	p->fd = fd;
	p->id = id;
	p->len = len;
	p->tail = 0;
	return KUSOK_OK;
}

void ks_pack_close(ks_pack *p)
{
	if (p->fd >= 0)
		close(p->fd);
	p->fd = -1;
}

int ks_pack_append(ks_pack *p, const ks_rec *r, const void *payload,
		   uint64_t *off)
{
	uint8_t hdr[KS_REC_HDR];
	if (!ks_rec_sane(r))
		return KUSOK_EINVAL;
	ks_rec_encode(r, payload, hdr);
	struct iovec iov[2] = {
	    {.iov_base = hdr, .iov_len = KS_REC_HDR},
	    /* pwritev не пишет в iov_base, const снимаем честно */
	    {.iov_base = (void *)(uintptr_t)payload, .iov_len = r->slen},
	};
	uint64_t pos = p->len;
	size_t ost = KS_REC_HDR + (size_t)r->slen;
	while (ost) {
		ssize_t w = pwritev(p->fd, iov, 2, (off_t)pos);
		if (w < 0) {
			if (errno == EINTR)
				continue;
			return KUSOK_EIO;
		}
		/* дописываем остаток */
		size_t s = (size_t)w;
		pos += s;
		ost -= s;
		for (int i = 0; i < 2 && s; i++) {
			size_t k = s < iov[i].iov_len ? s : iov[i].iov_len;
			iov[i].iov_base = (uint8_t *)iov[i].iov_base + k;
			iov[i].iov_len -= k;
			s -= k;
		}
	}
	*off = p->len;
	p->len = pos;
	return KUSOK_OK;
}

int ks_pack_read_hdr(const ks_pack *p, uint64_t off, ks_rec *r)
{
	uint8_t hdr[KS_REC_HDR];
	uint32_t crc;
	if (off < KS_PACK_HDR || off + KS_REC_HDR > p->len)
		return KUSOK_ECORRUPT;
	int rc = ks_pread_full(p->fd, hdr, KS_REC_HDR, off);
	if (rc)
		return rc;
	rc = ks_rec_decode(hdr, r, &crc);
	if (rc)
		return rc;
	if (off + KS_REC_HDR + r->slen > p->len)
		return KUSOK_ECORRUPT;
	return KUSOK_OK;
}

int ks_pack_read(const ks_pack *p, uint64_t off, ks_rec *r, uint8_t *payload,
		 size_t cap)
{
	uint8_t hdr[KS_REC_HDR];
	uint32_t crc;
	if (off < KS_PACK_HDR || off + KS_REC_HDR > p->len)
		return KUSOK_ECORRUPT;
	int rc = ks_pread_full(p->fd, hdr, KS_REC_HDR, off);
	if (rc)
		return rc;
	rc = ks_rec_decode(hdr, r, &crc);
	if (rc)
		return rc;
	if (r->slen > cap)
		return KUSOK_ETOOBIG;
	if (off + KS_REC_HDR + r->slen > p->len)
		return KUSOK_ECORRUPT;
	rc = ks_pread_full(p->fd, payload, r->slen, off + KS_REC_HDR);
	if (rc)
		return rc;
	if (ks_rec_crc(hdr, payload, r->slen) != crc)
		return KUSOK_ECORRUPT;
	return KUSOK_OK;
}

int ks_pack_scan(const ks_pack *p, int verify, ks_scan_cb cb, void *ctx,
		 uint64_t *good_end, uint64_t *bad)
{
	uint64_t off = KS_PACK_HDR, kol_bad = 0;
	uint8_t *buf = NULL;
	size_t cap = 0;
	int rc = KUSOK_OK;
	while (off < p->len) {
		ks_rec r;
		int e = ks_pack_read_hdr(p, off, &r);
		if (e == KUSOK_EIO) {
			rc = e;
			break;
		}
		if (e)
			break;
		if (verify) {
			if (r.slen > cap) {
				size_t nc = r.slen < 65536 ? 65536 : r.slen;
				uint8_t *nb = realloc(buf, nc);
				if (!nb) {
					rc = KUSOK_ENOMEM;
					break;
				}
				buf = nb;
				cap = nc;
			}
			e = ks_pack_read(p, off, &r, buf, cap);
			if (e == KUSOK_EIO || e == KUSOK_ENOMEM) {
				rc = e;
				break;
			}
			if (e) {
				kol_bad++;
				off += KS_REC_HDR + r.slen;
				continue;
			}
		}
		rc = cb(&r, off, ctx);
		if (rc)
			break;
		off += KS_REC_HDR + r.slen;
	}
	free(buf);
	*good_end = off;
	if (bad)
		*bad = kol_bad;
	return rc;
}

int ks_pack_sync(ks_pack *p)
{
	return ks_datasync(p->fd);
}
