/*
 * журнал ссылок refs.log + снимок refs.snap.
 * формат — в docs/ARCHITECTURE.md
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_JOURNAL_H
#define KS_JOURNAL_H

#include <stdint.h>

#include "tab.h"

#define KS_JR_REC 48u
#define KS_SNAP_MAGIC "KUSOKRS1"
#define KS_SNAP_HDR 32u
#define KS_SNAP_ENT 40u

enum { KS_JR_INC = 1, KS_JR_DEC = 2 };

typedef struct ks_ref {
	uint8_t id[32];
	int64_t refs;
} ks_ref;

typedef struct ks_journal {
	int dirfd;
	int fd;
	int rw;
	uint64_t seq;
	uint64_t len;
	uint64_t torn; /* сколько отрезали при открытии */
} ks_journal;

/* снимок + проиграть журнал в refs */
int ks_journal_open(int dirfd, int rw, ks_tab *refs, ks_journal *j);
void ks_journal_close(ks_journal *j);

int ks_journal_add(ks_journal *j, const uint8_t id[32], int op);
int ks_journal_sync(ks_journal *j);

/* записать снимок, обрезать журнал */
int ks_journal_checkpoint(ks_journal *j, const ks_tab *refs);

int ks_refs_apply(ks_tab *refs, const uint8_t id[32], int64_t delta);

#endif
