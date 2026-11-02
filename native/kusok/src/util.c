/*
 * SPDX-License-Identifier: MIT
 */
#include <stddef.h>

#include "kusok/kusok.h"

const char *kusok_strerror(int err)
{
	switch (err) {
	case KUSOK_OK:
		return "ok";
	case KUSOK_EIO:
		return "input/output error";
	case KUSOK_ENOMEM:
		return "out of memory";
	case KUSOK_EINVAL:
		return "invalid argument";
	case KUSOK_ENOTFOUND:
		return "not found";
	case KUSOK_ECORRUPT:
		return "data is corrupted";
	case KUSOK_ELOCKED:
		return "store is locked by another process";
	case KUSOK_EBUSY:
		return "a write is in progress";
	case KUSOK_ETOOBIG:
		return "size out of range";
	case KUSOK_ERDONLY:
		return "store is read-only";
	case KUSOK_EFORMAT:
		return "unsupported format version";
	default:
		return "unknown error";
	}
}

void kusok_id_hex(const kusok_id *id, char out[KUSOK_HEX_LEN + 1])
{
	static const char cifry[] = "0123456789abcdef";
	for (int i = 0; i < KUSOK_ID_LEN; i++) {
		out[2 * i] = cifry[id->b[i] >> 4];
		out[2 * i + 1] = cifry[id->b[i] & 15];
	}
	out[KUSOK_HEX_LEN] = 0;
}

static int cifra(char c)
{
	if (c >= '0' && c <= '9')
		return c - '0';
	if (c >= 'a' && c <= 'f')
		return c - 'a' + 10;
	if (c >= 'A' && c <= 'F')
		return c - 'A' + 10;
	return -1;
}

int kusok_id_parse(const char *hex, kusok_id *id)
{
	if (!hex || !id)
		return KUSOK_EINVAL;
	for (int i = 0; i < KUSOK_ID_LEN; i++) {
		int hi = cifra(hex[2 * i]);
		int lo = hi < 0 ? -1 : cifra(hex[2 * i + 1]);
		if (hi < 0 || lo < 0)
			return KUSOK_EINVAL;
		id->b[i] = (uint8_t)(hi << 4 | lo);
	}
	return hex[KUSOK_HEX_LEN] == 0 ? KUSOK_OK : KUSOK_EINVAL;
}
