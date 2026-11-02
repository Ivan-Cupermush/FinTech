/*
 * SPDX-License-Identifier: MIT
 */
#include "pool.h"

#include <pthread.h>
#include <stdlib.h>

#include "kusok/kusok.h"

struct ks_pool {
	pthread_mutex_t mu;
	pthread_cond_t go;   /* есть работа */
	pthread_cond_t done; /* работа кончилась */
	pthread_t *th;
	unsigned nth;

	ks_job_fn fn;
	void *ctx;
	size_t n, next, gotovo;
	unsigned long pokolenie;
	int stop;
};

/* взять следующий индекс и сделать его, пока есть */
static void rabotat(ks_pool *p)
{
	for (;;) {
		pthread_mutex_lock(&p->mu);
		if (p->next >= p->n) {
			pthread_mutex_unlock(&p->mu);
			return;
		}
		size_t i = p->next++;
		ks_job_fn fn = p->fn;
		void *ctx = p->ctx;
		pthread_mutex_unlock(&p->mu);

		fn(ctx, i);

		pthread_mutex_lock(&p->mu);
		if (++p->gotovo == p->n)
			pthread_cond_signal(&p->done);
		pthread_mutex_unlock(&p->mu);
	}
}

static void *potok(void *arg)
{
	ks_pool *p = arg;
	unsigned long bylo = 0;
	for (;;) {
		pthread_mutex_lock(&p->mu);
		while (!p->stop && p->pokolenie == bylo)
			pthread_cond_wait(&p->go, &p->mu);
		if (p->stop) {
			pthread_mutex_unlock(&p->mu);
			return NULL;
		}
		bylo = p->pokolenie;
		pthread_mutex_unlock(&p->mu);
		rabotat(p);
	}
}

int ks_pool_new(unsigned nthreads, ks_pool **out)
{
	if (!out || nthreads > KS_POOL_MAX)
		return KUSOK_EINVAL;
	ks_pool *p = calloc(1, sizeof(*p));
	if (!p)
		return KUSOK_ENOMEM;
	pthread_mutex_init(&p->mu, NULL);
	pthread_cond_init(&p->go, NULL);
	pthread_cond_init(&p->done, NULL);
	/* главный поток считается за один */
	unsigned nado = nthreads > 1 ? nthreads - 1 : 0;
	if (nado) {
		p->th = calloc(nado, sizeof(*p->th));
		if (!p->th) {
			ks_pool_free(p);
			return KUSOK_ENOMEM;
		}
	}
	for (unsigned i = 0; i < nado; i++) {
		if (pthread_create(&p->th[i], NULL, potok, p)) {
			ks_pool_free(p);
			return KUSOK_ENOMEM;
		}
		p->nth++;
	}
	*out = p;
	return KUSOK_OK;
}

void ks_pool_free(ks_pool *p)
{
	if (!p)
		return;
	pthread_mutex_lock(&p->mu);
	p->stop = 1;
	pthread_cond_broadcast(&p->go);
	pthread_mutex_unlock(&p->mu);
	for (unsigned i = 0; i < p->nth; i++)
		pthread_join(p->th[i], NULL);
	free(p->th);
	pthread_cond_destroy(&p->go);
	pthread_cond_destroy(&p->done);
	pthread_mutex_destroy(&p->mu);
	free(p);
}

unsigned ks_pool_threads(const ks_pool *p)
{
	return p ? p->nth + 1 : 1;
}

void ks_pool_run(ks_pool *p, ks_job_fn fn, void *ctx, size_t n)
{
	if (!n)
		return;
	if (!p || !p->nth || n == 1) {
		for (size_t i = 0; i < n; i++)
			fn(ctx, i);
		return;
	}
	pthread_mutex_lock(&p->mu);
	p->fn = fn;
	p->ctx = ctx;
	p->n = n;
	p->next = 0;
	p->gotovo = 0;
	p->pokolenie++;
	pthread_cond_broadcast(&p->go);
	pthread_mutex_unlock(&p->mu);

	rabotat(p);

	pthread_mutex_lock(&p->mu);
	while (p->gotovo < p->n)
		pthread_cond_wait(&p->done, &p->mu);
	pthread_mutex_unlock(&p->mu);
}
