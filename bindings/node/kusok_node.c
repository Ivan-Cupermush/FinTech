/*
 * привязка для node.js (N-API): одно открытое хранилище на процесс,
 * долгие операции идут в пуле libuv и возвращают Promise
 *
 * SPDX-License-Identifier: MIT
 */
#define NAPI_VERSION 8
#define _GNU_SOURCE
#include <fcntl.h>
#include <node_api.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "kusok/kusok.h"

#define MAX_BUF (1u << 30)

struct hran {
	kusok *ks;
	pthread_mutex_t mu; /* дескриптор однопоточный */
	int zadach;
};

enum { OP_PUT, OP_PUTFILE, OP_READ, OP_GC, OP_FSCK };

struct zad {
	napi_async_work w;
	napi_deferred d;
	napi_ref self, buf;
	struct hran *h;
	int op, rc;
	const uint8_t *data;
	size_t n;
	char *path;
	kusok_id id;
	uint64_t off, novyh;
	uint8_t *out;
	size_t len, got;
	double min;
	kusok_gc_report gr;
	kusok_fsck_report fr;
};

static const char *code_name(int rc)
{
	switch (rc) {
	case KUSOK_EIO:
		return "EIO";
	case KUSOK_ENOMEM:
		return "ENOMEM";
	case KUSOK_EINVAL:
		return "EINVAL";
	case KUSOK_ENOTFOUND:
		return "ENOTFOUND";
	case KUSOK_ECORRUPT:
		return "ECORRUPT";
	case KUSOK_ELOCKED:
		return "ELOCKED";
	case KUSOK_EBUSY:
		return "EBUSY";
	case KUSOK_ETOOBIG:
		return "ETOOBIG";
	case KUSOK_ERDONLY:
		return "ERDONLY";
	case KUSOK_EFORMAT:
		return "EFORMAT";
	}
	return "EUNKNOWN";
}

/* Error с полями code и errno, как у fs */
static napi_value make_err(napi_env env, int rc, const char *gde)
{
	char msg[256];
	napi_value m, c, num, err;
	snprintf(msg, sizeof(msg), "kusok %s: %s", gde, kusok_strerror(rc));
	napi_create_string_utf8(env, msg, NAPI_AUTO_LENGTH, &m);
	napi_create_string_utf8(env, code_name(rc), NAPI_AUTO_LENGTH, &c);
	napi_create_error(env, c, m, &err);
	napi_create_int32(env, rc, &num);
	napi_set_named_property(env, err, "errno", num);
	return err;
}

static napi_value throw_rc(napi_env env, int rc, const char *gde)
{
	napi_throw(env, make_err(env, rc, gde));
	return NULL;
}

static void set_num(napi_env env, napi_value o, const char *k, double v)
{
	napi_value x;
	napi_create_double(env, v, &x);
	napi_set_named_property(env, o, k, x);
}

static napi_value str(napi_env env, const char *s)
{
	napi_value x;
	napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &x);
	return x;
}

static napi_value id_str(napi_env env, const kusok_id *id)
{
	char hex[KUSOK_HEX_LEN + 1];
	kusok_id_hex(id, hex);
	return str(env, hex);
}

/* аргументы и this; h = NULL, если хранилище закрыто */
static int args(napi_env env, napi_callback_info info, size_t want,
		napi_value *argv, napi_value *self, struct hran **h)
{
	size_t argc = want;
	napi_value th;
	if (napi_get_cb_info(env, info, &argc, argv, &th, NULL) != napi_ok)
		return -1;
	for (size_t i = argc; i < want; i++)
		napi_get_undefined(env, &argv[i]);
	if (self)
		*self = th;
	if (napi_unwrap(env, th, (void **)h) != napi_ok || !*h) {
		napi_throw_type_error(env, NULL, "это не хранилище kusok");
		return -1;
	}
	if (!(*h)->ks) {
		throw_rc(env, KUSOK_EINVAL, "хранилище закрыто");
		return -1;
	}
	return 0;
}

static int get_id(napi_env env, napi_value v, kusok_id *id)
{
	char hex[KUSOK_HEX_LEN + 2];
	size_t len = 0;
	if (napi_get_value_string_utf8(env, v, hex, sizeof(hex), &len) !=
		napi_ok ||
	    len != KUSOK_HEX_LEN || kusok_id_parse(hex, id)) {
		napi_throw_type_error(env, NULL, "id — это 64 hex-символа");
		return -1;
	}
	return 0;
}

static int get_num(napi_env env, napi_value v, double def, double *out)
{
	napi_valuetype t;
	napi_typeof(env, v, &t);
	if (t == napi_undefined) {
		*out = def;
		return 0;
	}
	if (t != napi_number || napi_get_value_double(env, v, out) != napi_ok ||
	    *out != *out || *out < 0) {
		napi_throw_type_error(env, NULL, "ожидалось число >= 0");
		return -1;
	}
	return 0;
}

/* поле опций: число или true/false */
static int opt_int(napi_env env, napi_value o, const char *k, int *out)
{
	bool est;
	napi_value v;
	napi_valuetype t;
	if (napi_has_named_property(env, o, k, &est) != napi_ok || !est)
		return 0;
	napi_get_named_property(env, o, k, &v);
	napi_typeof(env, v, &t);
	if (t == napi_boolean) {
		bool b;
		napi_get_value_bool(env, v, &b);
		*out = b;
		return 0;
	}
	if (t == napi_number) {
		double d;
		napi_get_value_double(env, v, &d);
		if (d >= 0 && d <= 1u << 30 && d == (int)d) {
			*out = (int)d;
			return 0;
		}
	}
	char msg[96];
	snprintf(msg, sizeof(msg), "опция %s: нужно целое число", k);
	napi_throw_type_error(env, NULL, msg);
	return -1;
}

/* ------------------------------------------------------------ открытие */

static void hran_free(napi_env env, void *data, void *hint)
{
	(void)env;
	(void)hint;
	struct hran *h = data;
	if (h->ks)
		kusok_close(h->ks);
	pthread_mutex_destroy(&h->mu);
	free(h);
}

/* new Kusok(dir, opts) */
static napi_value ctor(napi_env env, napi_callback_info info)
{
	size_t argc = 2;
	napi_value argv[2], th;
	napi_get_cb_info(env, info, &argc, argv, &th, NULL);
	char dir[4096];
	size_t len;
	if (argc < 1 || napi_get_value_string_utf8(
			    env, argv[0], dir, sizeof(dir), &len) != napi_ok) {
		napi_throw_type_error(env, NULL, "нужен путь к каталогу");
		return NULL;
	}
	kusok_opts o;
	kusok_opts_default(&o);
	napi_valuetype t = napi_undefined;
	if (argc > 1)
		napi_typeof(env, argv[1], &t);
	if (t == napi_object) {
		int u[4] = {(int)o.min_chunk, (int)o.avg_chunk,
			    (int)o.max_chunk, (int)o.pack_limit};
		if (opt_int(env, argv[1], "readOnly", &o.read_only) ||
		    opt_int(env, argv[1], "sync", &o.sync) ||
		    opt_int(env, argv[1], "compress", &o.compress) ||
		    opt_int(env, argv[1], "salvage", &o.salvage) ||
		    opt_int(env, argv[1], "threads", &o.threads) ||
		    opt_int(env, argv[1], "cacheChunks", &o.cache_chunks) ||
		    opt_int(env, argv[1], "minChunk", &u[0]) ||
		    opt_int(env, argv[1], "avgChunk", &u[1]) ||
		    opt_int(env, argv[1], "maxChunk", &u[2]) ||
		    opt_int(env, argv[1], "packLimit", &u[3]))
			return NULL;
		o.min_chunk = (uint32_t)u[0];
		o.avg_chunk = (uint32_t)u[1];
		o.max_chunk = (uint32_t)u[2];
		o.pack_limit = (uint32_t)u[3];
	} else if (t != napi_undefined) {
		napi_throw_type_error(env, NULL, "опции — это объект");
		return NULL;
	}
	struct hran *h = calloc(1, sizeof(*h));
	if (!h)
		return throw_rc(env, KUSOK_ENOMEM, "open");
	int rc = kusok_open(dir, &o, &h->ks);
	if (rc) {
		free(h);
		return throw_rc(env, rc, "open");
	}
	pthread_mutex_init(&h->mu, NULL);
	if (napi_wrap(env, th, h, hran_free, NULL, NULL) != napi_ok) {
		kusok_close(h->ks);
		pthread_mutex_destroy(&h->mu);
		free(h);
		return NULL;
	}
	return th;
}

static napi_value m_close(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[1];
	if (args(env, info, 0, argv, NULL, &h))
		return NULL;
	/* пока идут промисы, закрывать нельзя */
	if (h->zadach)
		return throw_rc(env, KUSOK_EBUSY, "close");
	int rc = kusok_close(h->ks);
	h->ks = NULL;
	if (rc)
		return throw_rc(env, rc, "close");
	return NULL;
}

/* ------------------------------------------------------------ быстрые */

static napi_value m_size(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[1], r;
	kusok_id id;
	uint64_t size;
	if (args(env, info, 1, argv, NULL, &h) || get_id(env, argv[0], &id))
		return NULL;
	pthread_mutex_lock(&h->mu);
	int rc = kusok_size(h->ks, &id, &size);
	pthread_mutex_unlock(&h->mu);
	if (rc)
		return throw_rc(env, rc, "size");
	napi_create_double(env, (double)size, &r);
	return r;
}

static napi_value refs_op(napi_env env, napi_callback_info info, int op)
{
	struct hran *h;
	napi_value argv[1], r;
	kusok_id id;
	int64_t refs = 0;
	if (args(env, info, 1, argv, NULL, &h) || get_id(env, argv[0], &id))
		return NULL;
	pthread_mutex_lock(&h->mu);
	int rc = op > 0	  ? kusok_ref(h->ks, &id)
		 : op < 0 ? kusok_unref(h->ks, &id)
			  : KUSOK_OK;
	if (!rc)
		rc = kusok_refs(h->ks, &id, &refs);
	pthread_mutex_unlock(&h->mu);
	if (rc)
		return throw_rc(env, rc,
				op > 0	 ? "ref"
				: op < 0 ? "unref"
					 : "refs");
	napi_create_double(env, (double)refs, &r);
	return r;
}

static napi_value m_ref(napi_env env, napi_callback_info info)
{
	return refs_op(env, info, 1);
}

static napi_value m_unref(napi_env env, napi_callback_info info)
{
	return refs_op(env, info, -1);
}

static napi_value m_refs(napi_env env, napi_callback_info info)
{
	return refs_op(env, info, 0);
}

static napi_value m_stat(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[1], o;
	kusok_stat s;
	if (args(env, info, 0, argv, NULL, &h))
		return NULL;
	pthread_mutex_lock(&h->mu);
	int rc = kusok_stat_get(h->ks, &s);
	pthread_mutex_unlock(&h->mu);
	if (rc)
		return throw_rc(env, rc, "stat");
	napi_create_object(env, &o);
	set_num(env, o, "files", (double)s.files);
	set_num(env, o, "chunks", (double)s.chunks);
	set_num(env, o, "logicalBytes", (double)s.logical_bytes);
	set_num(env, o, "uniqueBytes", (double)s.unique_bytes);
	set_num(env, o, "storedBytes", (double)s.stored_bytes);
	set_num(env, o, "packs", (double)s.packs);
	set_num(env, o, "cacheHits", (double)s.cache_hits);
	set_num(env, o, "cacheMisses", (double)s.cache_misses);
	return o;
}

static napi_value m_checkpoint(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[1];
	if (args(env, info, 0, argv, NULL, &h))
		return NULL;
	pthread_mutex_lock(&h->mu);
	int rc = kusok_checkpoint(h->ks);
	pthread_mutex_unlock(&h->mu);
	if (rc)
		return throw_rc(env, rc, "checkpoint");
	return NULL;
}

struct spisok {
	napi_env env;
	napi_value arr;
	uint32_t n;
};

static int list_cb(const kusok_id *id, uint64_t size, int64_t refs, void *ctx)
{
	struct spisok *s = ctx;
	napi_value o;
	napi_create_object(s->env, &o);
	napi_set_named_property(s->env, o, "id", id_str(s->env, id));
	set_num(s->env, o, "size", (double)size);
	set_num(s->env, o, "refs", (double)refs);
	napi_set_element(s->env, s->arr, s->n++, o);
	return 0;
}

static napi_value m_list(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[1];
	if (args(env, info, 0, argv, NULL, &h))
		return NULL;
	struct spisok s = {.env = env};
	napi_create_array(env, &s.arr);
	pthread_mutex_lock(&h->mu);
	int rc = kusok_list(h->ks, list_cb, &s);
	pthread_mutex_unlock(&h->mu);
	if (rc)
		return throw_rc(env, rc, "list");
	return s.arr;
}

/* ------------------------------------------------------------ промисы */

static void z_exec(napi_env env, void *data)
{
	(void)env;
	struct zad *z = data;
	kusok *ks = z->h->ks;
	pthread_mutex_lock(&z->h->mu);
	switch (z->op) {
	case OP_PUT:
		z->rc = kusok_put_mem(ks, z->data, z->n, &z->id);
		z->novyh = kusok_last_put_new_bytes(ks);
		break;
	case OP_PUTFILE: {
		int fd = open(z->path, O_RDONLY | O_CLOEXEC);
		if (fd < 0) {
			z->rc = KUSOK_ENOTFOUND;
			break;
		}
		z->rc = kusok_put_fd(ks, fd, &z->id);
		z->novyh = kusok_last_put_new_bytes(ks);
		close(fd);
		break;
	}
	case OP_READ: {
		uint64_t size;
		z->rc = kusok_size(ks, &z->id, &size);
		if (z->rc)
			break;
		uint64_t ost = z->off < size ? size - z->off : 0;
		if (z->len > ost)
			z->len = (size_t)ost;
		z->out = malloc(z->len ? z->len : 1);
		if (!z->out) {
			z->rc = KUSOK_ENOMEM;
			break;
		}
		z->rc = kusok_read(ks, &z->id, z->off, z->out, z->len, &z->got);
		break;
	}
	case OP_GC:
		z->rc = kusok_gc(ks, z->min, &z->gr);
		break;
	case OP_FSCK:
		z->rc = kusok_fsck(ks, &z->fr);
		break;
	}
	pthread_mutex_unlock(&z->h->mu);
}

static napi_value z_result(napi_env env, struct zad *z)
{
	napi_value o;
	switch (z->op) {
	case OP_PUT:
	case OP_PUTFILE:
		napi_create_object(env, &o);
		napi_set_named_property(env, o, "id", id_str(env, &z->id));
		set_num(env, o, "newBytes", (double)z->novyh);
		return o;
	case OP_READ:
		napi_create_buffer_copy(env, z->got, z->out, NULL, &o);
		return o;
	case OP_GC:
		napi_create_object(env, &o);
		set_num(env, o, "packsRewritten", z->gr.packs_rewritten);
		set_num(env, o, "bytesBefore", (double)z->gr.bytes_before);
		set_num(env, o, "bytesAfter", (double)z->gr.bytes_after);
		set_num(env, o, "recordsDropped",
			(double)z->gr.records_dropped);
		return o;
	default:
		napi_create_object(env, &o);
		set_num(env, o, "records", (double)z->fr.records);
		set_num(env, o, "badRecords", (double)z->fr.bad_records);
		set_num(env, o, "files", (double)z->fr.files);
		set_num(env, o, "brokenFiles", (double)z->fr.broken_files);
		set_num(env, o, "missingManifests",
			(double)z->fr.missing_manifests);
		set_num(env, o, "tailBytes", (double)z->fr.tail_bytes);
		return o;
	}
}

static const char *op_name[] = {"put", "putFile", "read", "gc", "fsck"};

static void z_done(napi_env env, napi_status st, void *data)
{
	struct zad *z = data;
	if (st == napi_cancelled)
		z->rc = KUSOK_EINVAL;
	if (z->rc)
		napi_reject_deferred(env, z->d,
				     make_err(env, z->rc, op_name[z->op]));
	else
		napi_resolve_deferred(env, z->d, z_result(env, z));
	z->h->zadach--;
	if (z->buf)
		napi_delete_reference(env, z->buf);
	napi_delete_reference(env, z->self);
	napi_delete_async_work(env, z->w);
	free(z->out);
	free(z->path);
	free(z);
}

/* общая часть: держим this (и буфер), ставим работу в очередь */
static napi_value z_start(napi_env env, struct zad *z, napi_value self)
{
	napi_value p, name;
	if (napi_create_promise(env, &z->d, &p) != napi_ok)
		goto fail;
	napi_create_reference(env, self, 1, &z->self);
	napi_create_string_utf8(env, op_name[z->op], NAPI_AUTO_LENGTH, &name);
	if (napi_create_async_work(env, NULL, name, z_exec, z_done, z, &z->w) !=
		napi_ok ||
	    napi_queue_async_work(env, z->w) != napi_ok) {
		napi_throw_error(env, NULL, "не удалось поставить задачу");
		return NULL;
	}
	z->h->zadach++;
	return p;
fail:
	if (z->buf)
		napi_delete_reference(env, z->buf);
	free(z->path);
	free(z);
	return NULL;
}

static struct zad *z_new(napi_env env, struct hran *h, int op)
{
	struct zad *z = calloc(1, sizeof(*z));
	if (!z) {
		throw_rc(env, KUSOK_ENOMEM, op_name[op]);
		return NULL;
	}
	z->h = h;
	z->op = op;
	return z;
}

/* put(Buffer | Uint8Array | string) -> {id, newBytes} */
static napi_value m_put(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[1], self, v;
	if (args(env, info, 1, argv, &self, &h))
		return NULL;
	bool isbuf = false, isarr = false;
	napi_valuetype t;
	napi_is_buffer(env, argv[0], &isbuf);
	napi_is_typedarray(env, argv[0], &isarr);
	napi_typeof(env, argv[0], &t);
	v = argv[0];
	if (t == napi_string) {
		/* строку переводим в Buffer, чтобы данные жили до конца задачи */
		size_t n;
		napi_get_value_string_utf8(env, argv[0], NULL, 0, &n);
		char *tmp = malloc(n + 1);
		if (!tmp)
			return throw_rc(env, KUSOK_ENOMEM, "put");
		napi_get_value_string_utf8(env, argv[0], tmp, n + 1, &n);
		napi_create_buffer_copy(env, n, tmp, NULL, &v);
		free(tmp);
		isbuf = true;
	}
	if (!isbuf && !isarr) {
		napi_throw_type_error(env, NULL,
				      "put: нужен Buffer или строка");
		return NULL;
	}
	struct zad *z = z_new(env, h, OP_PUT);
	if (!z)
		return NULL;
	void *d;
	if (isbuf) {
		napi_get_buffer_info(env, v, &d, &z->n);
	} else {
		napi_typedarray_type tt;
		size_t len, off;
		napi_value ab;
		napi_get_typedarray_info(env, v, &tt, &len, &d, &ab, &off);
		if (tt != napi_uint8_array) {
			free(z);
			napi_throw_type_error(env, NULL,
					      "put: нужен Uint8Array");
			return NULL;
		}
		z->n = len;
	}
	z->data = d;
	napi_create_reference(env, v, 1, &z->buf);
	return z_start(env, z, self);
}

/* putFile(path) -> {id, newBytes}, файл читается потоком */
static napi_value m_put_file(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[1], self;
	size_t n;
	if (args(env, info, 1, argv, &self, &h))
		return NULL;
	if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &n) != napi_ok) {
		napi_throw_type_error(env, NULL, "putFile: нужен путь");
		return NULL;
	}
	struct zad *z = z_new(env, h, OP_PUTFILE);
	if (!z)
		return NULL;
	z->path = malloc(n + 1);
	if (!z->path) {
		free(z);
		return throw_rc(env, KUSOK_ENOMEM, "putFile");
	}
	napi_get_value_string_utf8(env, argv[0], z->path, n + 1, &n);
	return z_start(env, z, self);
}

/* read(id, off = 0, len = до конца) -> Buffer */
static napi_value m_read(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[3], self;
	kusok_id id;
	double off, len;
	if (args(env, info, 3, argv, &self, &h) || get_id(env, argv[0], &id) ||
	    get_num(env, argv[1], 0, &off) ||
	    get_num(env, argv[2], MAX_BUF, &len))
		return NULL;
	if (len > MAX_BUF)
		return throw_rc(env, KUSOK_ETOOBIG, "read");
	struct zad *z = z_new(env, h, OP_READ);
	if (!z)
		return NULL;
	z->id = id;
	z->off = (uint64_t)off;
	z->len = (size_t)len;
	return z_start(env, z, self);
}

static napi_value m_gc(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[1], self;
	double min;
	if (args(env, info, 1, argv, &self, &h) ||
	    get_num(env, argv[0], 0.3, &min))
		return NULL;
	if (min > 1) {
		napi_throw_range_error(env, NULL, "gc: доля мусора от 0 до 1");
		return NULL;
	}
	struct zad *z = z_new(env, h, OP_GC);
	if (!z)
		return NULL;
	z->min = min;
	return z_start(env, z, self);
}

static napi_value m_fsck(napi_env env, napi_callback_info info)
{
	struct hran *h;
	napi_value argv[1], self;
	if (args(env, info, 0, argv, &self, &h))
		return NULL;
	struct zad *z = z_new(env, h, OP_FSCK);
	if (!z)
		return NULL;
	return z_start(env, z, self);
}

/* ------------------------------------------------------------ модуль */

static napi_value init(napi_env env, napi_value exports)
{
	napi_property_descriptor m[] = {
	    {"close", NULL, m_close, NULL, NULL, NULL, napi_default, NULL},
	    {"size", NULL, m_size, NULL, NULL, NULL, napi_default, NULL},
	    {"ref", NULL, m_ref, NULL, NULL, NULL, napi_default, NULL},
	    {"unref", NULL, m_unref, NULL, NULL, NULL, napi_default, NULL},
	    {"refs", NULL, m_refs, NULL, NULL, NULL, napi_default, NULL},
	    {"stat", NULL, m_stat, NULL, NULL, NULL, napi_default, NULL},
	    {"list", NULL, m_list, NULL, NULL, NULL, napi_default, NULL},
	    {"checkpoint", NULL, m_checkpoint, NULL, NULL, NULL, napi_default,
	     NULL},
	    {"put", NULL, m_put, NULL, NULL, NULL, napi_default, NULL},
	    {"putFile", NULL, m_put_file, NULL, NULL, NULL, napi_default, NULL},
	    {"read", NULL, m_read, NULL, NULL, NULL, napi_default, NULL},
	    {"gc", NULL, m_gc, NULL, NULL, NULL, napi_default, NULL},
	    {"fsck", NULL, m_fsck, NULL, NULL, NULL, napi_default, NULL},
	};
	napi_value cls;
	if (napi_define_class(env, "Kusok", NAPI_AUTO_LENGTH, ctor, NULL,
			      sizeof(m) / sizeof(*m), m, &cls) != napi_ok)
		return NULL;
	napi_set_named_property(env, exports, "Kusok", cls);
	napi_set_named_property(env, exports, "version",
				str(env, KUSOK_VERSION_STRING));
	return exports;
}

NAPI_MODULE(kusok, init)
