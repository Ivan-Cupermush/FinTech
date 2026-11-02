#!/bin/sh
# сквозной тест командной строки: put/get/cat/ref/rm/ls/stat/gc/fsck/chunks.
# запуск: sh tests/cli_test.sh путь/к/kusok
#
# SPDX-License-Identifier: MIT
set -eu

K=${1:-./kusok}
T=$(mktemp -d "${TMPDIR:-/tmp}/kusok-cli-XXXXXX")
trap 'rm -rf "$T"' EXIT
S="$T/store"

oshibka() {
	echo "FAIL: $*" >&2
	exit 1
}

# данные: текст, его правка и случайный файл
i=0
while [ $i -lt 3000 ]; do
	echo "строка $i: kusok режет файлы по содержимому"
	i=$((i + 1))
done >"$T/a.txt"
sed 's/строка 1500:/СТРОКА 1500 (правка):/' "$T/a.txt" >"$T/b.txt"
head -c 300000 /dev/urandom >"$T/r.bin"
: >"$T/empty"

# put печатает id; повтор того же файла новых байт не добавляет
out=$("$K" "$S" put "$T/a.txt")
ida=$(echo "$out" | cut -c1-64)
[ ${#ida} -eq 64 ] || oshibka "put не напечатал id"
want=$(sha256sum "$T/a.txt" | cut -c1-64)
[ "$ida" = "$want" ] || oshibka "id не равен sha256 файла"
"$K" "$S" put "$T/a.txt" | grep -q "новых 0" || oshibka "дедупликация"

# правка в середине: второй раз — ноль новых байт
idb=$("$K" "$S" put "$T/b.txt" | cut -c1-64)
nov=$("$K" --json "$S" put "$T/b.txt" | sed 's/.*"new_bytes":\([0-9]*\).*/\1/')
[ "$nov" -eq 0 ] || oshibka "повторный put правки"

idr=$("$K" "$S" put "$T/r.bin" | cut -c1-64)
ide=$("$K" "$S" put "$T/empty" | cut -c1-64)

# get и cat
"$K" "$S" get "$ida" "$T/a.out"
cmp -s "$T/a.txt" "$T/a.out" || oshibka "get a"
"$K" "$S" get "$idr" >"$T/r.out"
cmp -s "$T/r.bin" "$T/r.out" || oshibka "get r в stdout"
"$K" "$S" get "$ide" "$T/e.out"
[ ! -s "$T/e.out" ] || oshibka "пустой файл"
"$K" "$S" cat "$idr" 1000 5000 >"$T/part"
dd if="$T/r.bin" bs=1 skip=1000 count=5000 2>/dev/null | cmp -s - "$T/part" ||
	oshibka "cat с середины"

# ссылки
"$K" "$S" ref "$idr" | grep -q "ссылок: 2" || oshibka "ref"
"$K" "$S" rm "$idr" | grep -q "ссылок: 1" || oshibka "rm"
"$K" "$S" rm "$idr" | grep -q "ссылок: 0" || oshibka "rm до нуля"
if "$K" "$S" get "$idr" "$T/x" 2>/dev/null; then oshibka "удалённый читается"; fi

# ls и stat
[ "$("$K" "$S" ls | wc -l)" -eq 3 ] || oshibka "ls"
"$K" --json "$S" stat | grep -q '"files":3' || oshibka "stat"

# gc освобождает место от случайного файла
before=$("$K" --json "$S" stat | sed 's/.*"stored_bytes":\([0-9]*\).*/\1/')
"$K" "$S" gc 0 >/dev/null
after=$("$K" --json "$S" stat | sed 's/.*"stored_bytes":\([0-9]*\).*/\1/')
[ "$after" -lt "$before" ] || oshibka "gc не освободил место"
"$K" "$S" get "$idb" "$T/b.out"
cmp -s "$T/b.txt" "$T/b.out" || oshibka "b после gc"

# перенос в другое хранилище: полный пакет, потом добавка
D="$T/backup"
"$K" "$S" export "$T/full.kb" 2>/dev/null || oshibka "export"
"$K" "$D" import "$T/full.kb" 2>/dev/null || oshibka "import"
"$K" "$D" get "$idb" "$T/b.bk"
cmp -s "$T/b.txt" "$T/b.bk" || oshibka "b из бэкапа"
"$K" "$D" ids > "$T/have"
[ "$(wc -l < "$T/have")" -gt 0 ] || oshibka "ids"
printf "новый маленький файл\n" > "$T/c.txt"
idc=$("$K" "$S" put "$T/c.txt" | cut -d' ' -f1)
"$K" --json "$S" export - "$T/have" > "$T/inc.kb" 2>/dev/null
[ "$(wc -c < "$T/inc.kb")" -lt "$(wc -c < "$T/full.kb")" ] ||
	oshibka "добавка не меньше полного"
"$K" "$D" import - < "$T/inc.kb" 2>/dev/null || oshibka "import из трубы"
"$K" "$D" get "$idc" | cmp -s - "$T/c.txt" || oshibka "c из бэкапа"
"$K" "$D" fsck > /dev/null || oshibka "fsck бэкапа"
printf 'junk' > "$T/junk.kb"
if "$K" "$D" import "$T/junk.kb" 2>/dev/null; then oshibka "мусор принят"; fi

# сильное сжатие и потоки
"$K" --level 9 --threads 3 "$T/hc" put "$T/a.txt" > /dev/null || oshibka "level"
"$K" --no-compress "$T/raw" put "$T/a.txt" > /dev/null
hc=$("$K" --json "$T/hc" stat | sed 's/.*"stored_bytes":\([0-9]*\).*/\1/')
raw=$("$K" --json "$T/raw" stat | sed 's/.*"stored_bytes":\([0-9]*\).*/\1/')
[ "$hc" -lt "$raw" ] || oshibka "level 9 не сжал"
set +e
"$K" --level 13 "$T/hc" stat >/dev/null 2>&1
[ $? -eq 2 ] || oshibka "level 13"
set -e

# fsck: чисто, потом портим байт данных — код 3
"$K" "$S" fsck >/dev/null || oshibka "fsck чистого"
pack=$(ls "$S/packs" | grep "pack$" | head -1)
printf 'X' | dd of="$S/packs/$pack" bs=1 seek=200 conv=notrunc 2>/dev/null
set +e
"$K" "$S" fsck >/dev/null
rc=$?
set -e
[ $rc -eq 3 ] || oshibka "fsck не заметил порчу (код $rc)"

# неправильные вызовы — код 2
set +e
"$K" >/dev/null 2>&1
[ $? -eq 2 ] || oshibka "без аргументов"
"$K" "$S" get nothex >/dev/null 2>&1
[ $? -eq 2 ] || oshibka "плохой id"
"$K" "$S" frobnicate >/dev/null 2>&1
[ $? -eq 2 ] || oshibka "неизвестная команда"
set -e

# chunks показывает нарезку без хранилища
"$K" chunks "$T/a.txt" | tail -1 | grep -q "кусков:" || oshibka "chunks"
"$K" --version | grep -q "kusok" || oshibka "version"

echo "cli: всё ок"
