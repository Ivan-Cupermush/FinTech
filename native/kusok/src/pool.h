/*
 * пул потоков: параллельный for по индексам 0..n-1.
 * главный поток тоже работает, без потоков всё идёт по очереди
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef KS_POOL_H
#define KS_POOL_H

#include <stddef.h>

#define KS_POOL_MAX 64

typedef void (*ks_job_fn)(void *ctx, size_t i);

typedef struct ks_pool ks_pool;

/* nthreads <= 1 — без потоков */
int ks_pool_new(unsigned nthreads, ks_pool **out);
void ks_pool_free(ks_pool *p);
unsigned ks_pool_threads(const ks_pool *p);

/* fn(ctx, i) для всех i, возвращается когда всё готово */
void ks_pool_run(ks_pool *p, ks_job_fn fn, void *ctx, size_t n);

#endif
