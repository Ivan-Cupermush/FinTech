/*
 * kusok serve: хранилище по HTTP для сервера offix.
 * один поток, poll, без своих потоков и без fork
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_SERVE_H
#define KS_SERVE_H

#include "kusok/kusok.h"

/* port 0 — любой свободный, его номер печатается в stdout */
int ks_serve(kusok *ks, const char *host, int port);

#endif
