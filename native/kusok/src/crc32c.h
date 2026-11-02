/*
 * CRC32C, как в iSCSI и ext4. есть SSE4.2 — берём инструкцию
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_CRC32C_H
#define KS_CRC32C_H

#include <stddef.h>
#include <stdint.h>

/* начинать с 0 */
uint32_t ks_crc32c(uint32_t crc, const void *data, size_t n);

uint32_t ks_crc32c_sw(uint32_t crc, const void *data, size_t n);

int ks_crc32c_hw(void);

#endif
