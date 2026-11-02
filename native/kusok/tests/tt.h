/*
 * tt — маленький фреймворк для тестов.
 * TT_TEST(imya) {...}, в main: TT_RUN(imya); return tt_done();
 *
 * SPDX-License-Identifier: MIT
 */
#ifndef TT_H
#define TT_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

#include "kusok/kusok.h"

extern int tt_fails;
extern int tt_checks;
extern const char *tt_cur;

void tt_fail(const char *file, int line, const char *what);
void tt_fail_u(const char *file, int line, const char *what,
	       unsigned long long a, unsigned long long b);
void tt_fail_i(const char *file, int line, const char *what, long long a,
	       long long b);
int tt_done(void);

/* временный каталог для теста; удаляется рекурсивно в tt_rmdir */
char *tt_tmpdir(void);
void tt_rmdir(const char *path);

/* детерминированный генератор: одинаковые данные на любой машине */
uint64_t tt_rand(uint64_t *s);
void tt_fill(void *buf, size_t n, uint64_t seed);
/* похоже на текст: слова из маленького словаря — хорошо жмётся */
void tt_fill_text(void *buf, size_t n, uint64_t seed);

/* ввод-вывод для подготовки «испорченных» файлов: ошибка = выход */
void tt_pread(int fd, void *buf, size_t n, long long off);
void tt_pwrite(int fd, const void *buf, size_t n, long long off);
void tt_write(int fd, const void *buf, size_t n);

/* мелкие куски и pack */
kusok_opts tt_opts(void);
kusok *tt_open(const char *dir);
kusok *tt_open_with(const char *dir, const kusok_opts *o);
kusok *tt_reopen(kusok *ks, const char *dir);
/* положить буфер, упасть на ошибке */
kusok_id tt_put(kusok *ks, const void *buf, size_t n);
/* прочитать файл целиком и сравнить с ожидаемым */
int tt_same(kusok *ks, const kusok_id *id, const void *want, size_t n);

#define TT_TEST(name) static void name(void)

#define TT_RUN(name)                                                           \
	do {                                                                   \
		int was_ = tt_fails;                                           \
		tt_cur = #name;                                                \
		name();                                                        \
		printf("%s %s\n", tt_fails == was_ ? "ok  " : "FAIL", #name);  \
	} while (0)

#define TT_CHECK(c)                                                            \
	do {                                                                   \
		tt_checks++;                                                   \
		if (!(c))                                                      \
			tt_fail(__FILE__, __LINE__, #c);                       \
	} while (0)

#define TT_EQ(a, b)                                                            \
	do {                                                                   \
		long long a_ = (long long)(a), b_ = (long long)(b);            \
		tt_checks++;                                                   \
		if (a_ != b_)                                                  \
			tt_fail_i(__FILE__, __LINE__, #a " == " #b, a_, b_);   \
	} while (0)

#define TT_EQU(a, b)                                                           \
	do {                                                                   \
		unsigned long long a_ = (unsigned long long)(a);               \
		unsigned long long b_ = (unsigned long long)(b);               \
		tt_checks++;                                                   \
		if (a_ != b_)                                                  \
			tt_fail_u(__FILE__, __LINE__, #a " == " #b, a_, b_);   \
	} while (0)

#define TT_OK(expr) TT_EQ((expr), 0)

#define TT_MEMEQ(a, b, n)                                                      \
	do {                                                                   \
		tt_checks++;                                                   \
		if (memcmp((a), (b), (n)) != 0)                                \
			tt_fail(__FILE__, __LINE__,                            \
				"memcmp(" #a ", " #b ") == 0");                \
	} while (0)

#endif
