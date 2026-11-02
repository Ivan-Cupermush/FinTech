/*
 *   GET|HEAD /f/ID      файл, понимает Range
 *   PUT /f              положить (нужен Content-Length) -> 201 {"id":..}
 *   POST /f/ID/ref      +1 ссылка
 *   DELETE /f/ID        -1 ссылка
 *   GET /stat           статистика
 *   POST /gc?min=0.3    сборка мусора
 *
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include "serve.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#include "http.h"

#define MAX_CONN 256
#define PORCIYA 65536
#define TIMEOUT_S 60

enum { ST_HDR, ST_BODY, ST_SEND, ST_CLOSE };

struct conn {
	int fd;
	int st;
	char in[KS_HTTP_MAX_HDR + 1];
	size_t inlen;
	ks_http_req req;
	char *out;
	size_t outlen, outoff;
	/* отдача файла */
	kusok_id id;
	uint64_t pos, end;
	/* приём файла */
	kusok_put *put;
	uint64_t ostalos;
	int keep;
	time_t last;
};

static volatile sig_atomic_t stop;

static void on_signal(int sig)
{
	(void)sig;
	stop = 1;
}

/* ------------------------------------------------------------ ответы */

static int out_reserve(struct conn *c, size_t n)
{
	if (c->outoff == c->outlen)
		c->outoff = c->outlen = 0;
	if (c->outlen + n <= PORCIYA + 1024)
		return 0;
	return -1;
}

static void out_add(struct conn *c, const char *s, size_t n)
{
	if (out_reserve(c, n) == 0) {
		memcpy(c->out + c->outlen, s, n);
		c->outlen += n;
	}
}

static void header(struct conn *c, int code, const char *type, uint64_t len,
		   const char *extra)
{
	char h[1024];
	int n = snprintf(h, sizeof(h),
			 "HTTP/1.1 %d %s\r\n"
			 "Content-Length: %" PRIu64 "\r\n"
			 "%s%s%s"
			 "%s"
			 "Connection: %s\r\n\r\n",
			 code, ks_http_reason(code), len,
			 type ? "Content-Type: " : "", type ? type : "",
			 type ? "\r\n" : "", extra ? extra : "",
			 c->keep ? "keep-alive" : "close");
	out_add(c, h, (size_t)n);
}

static void otvet(struct conn *c, int code, const char *type, const char *body)
{
	size_t n = body ? strlen(body) : 0;
	header(c, code, type, n, NULL);
	if (n && strcmp(c->req.method, "HEAD"))
		out_add(c, body, n);
	c->st = ST_SEND;
}

static void oshibka(struct conn *c, int code, const char *what)
{
	char b[256];
	snprintf(b, sizeof(b), "{\"error\":\"%s\"}\n", what);
	if (code >= 400 && code != 404 && code != 416 && code != 409)
		c->keep = 0;
	otvet(c, code, "application/json", b);
}

static int kod_oshibki(int rc)
{
	switch (rc) {
	case KUSOK_ENOTFOUND:
		return 404;
	case KUSOK_EBUSY:
		return 409;
	case KUSOK_EINVAL:
		return 400;
	default:
		return 500;
	}
}

/* ------------------------------------------------------------ запросы */

/* "/f/<64 hex>" и дальше хвост; 0 — ок */
static int id_iz_puti(const char *path, kusok_id *id, const char **hvost)
{
	if (strncmp(path, "/f/", 3) || strlen(path) < 3 + KUSOK_HEX_LEN)
		return -1;
	char hex[KUSOK_HEX_LEN + 1];
	memcpy(hex, path + 3, KUSOK_HEX_LEN);
	hex[KUSOK_HEX_LEN] = 0;
	*hvost = path + 3 + KUSOK_HEX_LEN;
	return kusok_id_parse(hex, id);
}

static void na_get(kusok *ks, struct conn *c, const kusok_id *id)
{
	uint64_t size;
	int rc = kusok_size(ks, id, &size);
	if (rc) {
		oshibka(c, kod_oshibki(rc), kusok_strerror(rc));
		return;
	}
	uint64_t beg = 0, end = size;
	int code = 200;
	if (c->req.has_range) {
		int r = ks_http_range(c->req.range, size, &beg, &end);
		if (r < 0) {
			char e[96];
			snprintf(e, sizeof(e),
				 "Content-Range: bytes */%" PRIu64 "\r\n",
				 size);
			header(c, 416, NULL, 0, e);
			c->st = ST_SEND;
			return;
		}
		if (r == 0)
			code = 206;
	}
	char extra[256];
	char hex[KUSOK_HEX_LEN + 1];
	kusok_id_hex(id, hex);
	int n = snprintf(extra, sizeof(extra),
			 "Accept-Ranges: bytes\r\nETag: \"%s\"\r\n", hex);
	if (code == 206)
		snprintf(extra + n, sizeof(extra) - (size_t)n,
			 "Content-Range: bytes %" PRIu64 "-%" PRIu64 "/%" PRIu64
			 "\r\n",
			 beg, end - 1, size);
	header(c, code, "application/octet-stream", end - beg, extra);
	c->id = *id;
	c->pos = beg;
	c->end = strcmp(c->req.method, "HEAD") ? end : beg;
	c->st = ST_SEND;
}

static void na_stat(kusok *ks, struct conn *c)
{
	kusok_stat st;
	int rc = kusok_stat_get(ks, &st);
	if (rc) {
		oshibka(c, 500, kusok_strerror(rc));
		return;
	}
	char b[512];
	snprintf(b, sizeof(b),
		 "{\"files\":%" PRIu64 ",\"chunks\":%" PRIu64
		 ",\"logical_bytes\":%" PRIu64 ",\"unique_bytes\":%" PRIu64
		 ",\"stored_bytes\":%" PRIu64 ",\"packs\":%u"
		 ",\"cache_hits\":%" PRIu64 ",\"cache_misses\":%" PRIu64 "}\n",
		 st.files, st.chunks, st.logical_bytes, st.unique_bytes,
		 st.stored_bytes, st.packs, st.cache_hits, st.cache_misses);
	otvet(c, 200, "application/json", b);
}

static void na_gc(kusok *ks, struct conn *c)
{
	double dolya = 0.3;
	char v[32];
	if (!ks_http_query(c->req.query, "min", v, sizeof(v))) {
		char *e;
		dolya = strtod(v, &e);
		if (*e || dolya < 0 || dolya > 1) {
			oshibka(c, 400, "min");
			return;
		}
	}
	kusok_gc_report r;
	int rc = kusok_gc(ks, dolya, &r);
	if (rc) {
		oshibka(c, kod_oshibki(rc), kusok_strerror(rc));
		return;
	}
	char b[256];
	snprintf(b, sizeof(b),
		 "{\"packs_rewritten\":%u,\"bytes_before\":%" PRIu64
		 ",\"bytes_after\":%" PRIu64 "}\n",
		 r.packs_rewritten, r.bytes_before, r.bytes_after);
	otvet(c, 200, "application/json", b);
}

static int kto_pishet; /* fd соединения с открытым put, -1 — никто */

static void na_put(kusok *ks, struct conn *c)
{
	if (c->req.chunked || c->req.content_length < 0) {
		oshibka(c, 411, "нужен Content-Length");
		return;
	}
	if (kto_pishet >= 0) {
		/* пишет другой — пусть повторит; тело не читаем, закрываем */
		c->keep = 0;
		header(c, 503, "application/json", 0, "Retry-After: 1\r\n");
		c->st = ST_SEND;
		return;
	}
	int rc = kusok_put_begin(ks, &c->put);
	if (rc) {
		oshibka(c, kod_oshibki(rc), kusok_strerror(rc));
		return;
	}
	kto_pishet = c->fd;
	c->ostalos = (uint64_t)c->req.content_length;
	c->st = ST_BODY;
	if (c->req.expect_continue)
		out_add(c, "HTTP/1.1 100 Continue\r\n\r\n", 25);
}

static void put_konec(kusok *ks, struct conn *c, int rc)
{
	kusok_id id;
	if (!rc)
		rc = kusok_put_commit(c->put, &id);
	else
		kusok_put_abort(c->put);
	c->put = NULL;
	kto_pishet = -1;
	if (rc) {
		oshibka(c, kod_oshibki(rc), kusok_strerror(rc));
		return;
	}
	char hex[KUSOK_HEX_LEN + 1], b[256];
	kusok_id_hex(&id, hex);
	snprintf(
	    b, sizeof(b),
	    "{\"id\":\"%s\",\"size\":%" PRIu64 ",\"new_bytes\":%" PRIu64 "}\n",
	    hex, (uint64_t)c->req.content_length, kusok_last_put_new_bytes(ks));
	otvet(c, 201, "application/json", b);
}

/* тело PUT: сколько байт из buf съели */
static size_t telo(kusok *ks, struct conn *c, const char *buf, size_t n)
{
	size_t k = n < c->ostalos ? n : (size_t)c->ostalos;
	if (k) {
		int rc = kusok_put_write(c->put, buf, k);
		c->ostalos -= k;
		if (rc) {
			put_konec(ks, c, rc);
			return k;
		}
	}
	if (!c->ostalos)
		put_konec(ks, c, 0);
	return k;
}

static void zapros(kusok *ks, struct conn *c)
{
	const char *m = c->req.method, *path = c->req.path, *hvost;
	kusok_id id;
	c->keep = c->req.keep_alive;
	int est_id = id_iz_puti(path, &id, &hvost) == 0;
	if (est_id && !*hvost) {
		if (!strcmp(m, "GET") || !strcmp(m, "HEAD"))
			na_get(ks, c, &id);
		else if (!strcmp(m, "DELETE")) {
			int rc = kusok_unref(ks, &id);
			if (rc)
				oshibka(c, kod_oshibki(rc), kusok_strerror(rc));
			else
				otvet(c, 204, NULL, NULL);
		} else
			oshibka(c, 405, "метод");
	} else if (est_id && !strcmp(hvost, "/ref")) {
		if (strcmp(m, "POST")) {
			oshibka(c, 405, "метод");
			return;
		}
		int rc = kusok_ref(ks, &id);
		if (rc)
			oshibka(c, kod_oshibki(rc), kusok_strerror(rc));
		else
			otvet(c, 204, NULL, NULL);
	} else if (!strcmp(path, "/f")) {
		if (!strcmp(m, "PUT") || !strcmp(m, "POST"))
			na_put(ks, c);
		else
			oshibka(c, 405, "метод");
	} else if (!strcmp(path, "/stat") && !strcmp(m, "GET")) {
		na_stat(ks, c);
	} else if (!strcmp(path, "/gc") && !strcmp(m, "POST")) {
		na_gc(ks, c);
	} else {
		oshibka(c, 404, "нет такого");
	}
}

/* ------------------------------------------------------------ соединения */

static void razobrat(kusok *ks, struct conn *c)
{
	while (c->st == ST_HDR && c->inlen) {
		int h = ks_http_parse(c->in, c->inlen, &c->req);
		if (h == 0)
			return;
		if (h < 0) {
			c->keep = 0;
			oshibka(c, h == -2 ? 431 : 400, "плохой запрос");
			c->inlen = 0;
			return;
		}
		memmove(c->in, c->in + h, c->inlen - (size_t)h);
		c->inlen -= (size_t)h;
		zapros(ks, c);
		if (c->st == ST_BODY && c->inlen) {
			size_t k = telo(ks, c, c->in, c->inlen);
			memmove(c->in, c->in + k, c->inlen - k);
			c->inlen -= k;
		}
	}
}

/* дочитать файл в буфер ответа */
static int podkachat(kusok *ks, struct conn *c)
{
	if (c->outoff < c->outlen || c->pos >= c->end)
		return 0;
	c->outoff = c->outlen = 0;
	size_t n =
	    c->end - c->pos < PORCIYA ? (size_t)(c->end - c->pos) : PORCIYA;
	size_t got;
	int rc = kusok_read(ks, &c->id, c->pos, c->out, n, &got);
	if (rc || got == 0)
		return -1; /* заголовок уже ушёл — только закрыть */
	c->outlen = got;
	c->pos += got;
	return 0;
}

static void zakryt(kusok *ks, struct conn *c)
{
	(void)ks;
	if (c->put) {
		kusok_put_abort(c->put);
		c->put = NULL;
		kto_pishet = -1;
	}
	close(c->fd);
	free(c->out);
	c->fd = -1;
}

/* ответ ушёл целиком: следующий запрос или закрыть */
static void gotovo(kusok *ks, struct conn *c)
{
	if (!c->keep) {
		c->st = ST_CLOSE;
		return;
	}
	c->st = ST_HDR;
	razobrat(ks, c);
}

static void chitat(kusok *ks, struct conn *c)
{
	char buf[PORCIYA];
	if (c->st == ST_BODY) {
		ssize_t r = read(c->fd, buf, sizeof(buf));
		if (r <= 0) {
			if (r < 0 && (errno == EAGAIN || errno == EINTR))
				return;
			c->st = ST_CLOSE;
			return;
		}
		size_t k = telo(ks, c, buf, (size_t)r);
		/* лишнее после тела — начало следующего запроса */
		size_t lishn = (size_t)r - k;
		if (lishn > sizeof(c->in) - 1 - c->inlen)
			lishn = sizeof(c->in) - 1 - c->inlen;
		memcpy(c->in + c->inlen, buf + k, lishn);
		c->inlen += lishn;
		return;
	}
	if (c->inlen >= sizeof(c->in) - 1) {
		/* ждём, пока уйдёт ответ */
		return;
	}
	ssize_t r = read(c->fd, c->in + c->inlen, sizeof(c->in) - 1 - c->inlen);
	if (r <= 0) {
		if (r < 0 && (errno == EAGAIN || errno == EINTR))
			return;
		c->st = ST_CLOSE;
		return;
	}
	c->inlen += (size_t)r;
	if (c->st == ST_HDR)
		razobrat(ks, c);
}

static void pisat(kusok *ks, struct conn *c)
{
	while (c->st != ST_CLOSE) {
		if (podkachat(ks, c)) {
			c->st = ST_CLOSE;
			return;
		}
		if (c->outoff == c->outlen) {
			if (c->st == ST_SEND)
				gotovo(ks, c);
			return;
		}
		ssize_t w =
		    write(c->fd, c->out + c->outoff, c->outlen - c->outoff);
		if (w < 0) {
			if (errno != EAGAIN && errno != EINTR)
				c->st = ST_CLOSE;
			return;
		}
		c->outoff += (size_t)w;
	}
}

static int slushat(const char *host, int port, int *real_port)
{
	int fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
	if (fd < 0)
		return -1;
	int one = 1;
	setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
	struct sockaddr_in a = {.sin_family = AF_INET,
				.sin_port = htons((uint16_t)port)};
	if (inet_pton(AF_INET, host, &a.sin_addr) != 1 ||
	    bind(fd, (struct sockaddr *)&a, sizeof(a)) || listen(fd, 64)) {
		close(fd);
		return -1;
	}
	socklen_t al = sizeof(a);
	getsockname(fd, (struct sockaddr *)&a, &al);
	*real_port = ntohs(a.sin_port);
	fcntl(fd, F_SETFL, O_NONBLOCK);
	return fd;
}

int ks_serve(kusok *ks, const char *host, int port)
{
	int real_port;
	int lfd = slushat(host, port, &real_port);
	if (lfd < 0) {
		fprintf(stderr, "kusok serve: %s:%d: %s\n", host, port,
			strerror(errno));
		return KUSOK_EIO;
	}
	printf("%d\n", real_port);
	fflush(stdout);
	fprintf(stderr, "kusok serve: слушаю %s:%d\n", host, real_port);

	struct sigaction sa;
	memset(&sa, 0, sizeof(sa));
	sa.sa_handler = on_signal;
	sigaction(SIGINT, &sa, NULL);
	sigaction(SIGTERM, &sa, NULL);
	signal(SIGPIPE, SIG_IGN);

	static struct conn cs[MAX_CONN];
	struct pollfd pf[MAX_CONN + 1];
	int ncs = 0;
	kto_pishet = -1;
	stop = 0;

	while (!stop) {
		pf[0].fd = lfd;
		pf[0].events = POLLIN;
		for (int i = 0; i < ncs; i++) {
			pf[i + 1].fd = cs[i].fd;
			pf[i + 1].events = 0;
			if (cs[i].st == ST_HDR || cs[i].st == ST_BODY)
				pf[i + 1].events |= POLLIN;
			if (cs[i].outoff < cs[i].outlen || cs[i].st == ST_SEND)
				pf[i + 1].events |= POLLOUT;
		}
		int r = poll(pf, (nfds_t)ncs + 1, 1000);
		if (r < 0 && errno != EINTR)
			break;
		time_t now = time(NULL);
		if (r > 0 && (pf[0].revents & POLLIN)) {
			int fd;
			while ((fd = accept4(lfd, NULL, NULL,
					     SOCK_NONBLOCK | SOCK_CLOEXEC)) >=
			       0) {
				if (ncs == MAX_CONN) {
					close(fd);
					continue;
				}
				struct conn *c = &cs[ncs];
				memset(c, 0, offsetof(struct conn, in));
				c->inlen = 0;
				c->outlen = c->outoff = 0;
				c->put = NULL;
				c->pos = c->end = 0;
				c->fd = fd;
				c->st = ST_HDR;
				c->last = now;
				c->out = malloc(PORCIYA + 1024);
				if (!c->out) {
					close(fd);
					continue;
				}
				pf[ncs + 1].revents = 0;
				ncs++;
			}
		}
		for (int i = 0; i < ncs; i++) {
			struct conn *c = &cs[i];
			short ev = r > 0 ? pf[i + 1].revents : 0;
			if (pf[i + 1].fd != c->fd)
				ev =
				    0; /* новое соединение, poll его не видел */
			if (ev & (POLLIN | POLLHUP | POLLERR)) {
				c->last = now;
				chitat(ks, c);
			}
			if (c->st != ST_CLOSE &&
			    (ev & POLLOUT || c->outoff < c->outlen ||
			     c->st == ST_SEND)) {
				c->last = now;
				pisat(ks, c);
			}
			if (c->st != ST_CLOSE && now - c->last > TIMEOUT_S)
				c->st = ST_CLOSE;
		}
		/* убрать закрытые, сохраняя порядок не нужно */
		for (int i = 0; i < ncs;) {
			if (cs[i].st == ST_CLOSE) {
				zakryt(ks, &cs[i]);
				cs[i] = cs[--ncs];
			} else {
				i++;
			}
		}
	}
	for (int i = 0; i < ncs; i++)
		zakryt(ks, &cs[i]);
	close(lfd);
	fprintf(stderr, "kusok serve: остановлен\n");
	return KUSOK_OK;
}
