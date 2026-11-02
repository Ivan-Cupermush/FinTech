#!/bin/sh
# эксперимент на настоящих данных: каждая версия репозитория (tar от
# git archive) кладётся в хранилище целиком, как если бы пользователь
# каждый раз заново загружал архив проекта. сравниваем «сколько бы
# заняли копии» и «сколько занял kusok».
#
#   scripts/bench_git.sh РЕПОЗИТОРИЙ [СКОЛЬКО_ВЕРСИЙ] [ПУТЬ_К_KUSOK]
#
# SPDX-License-Identifier: MIT
set -eu

repo=${1:?укажи путь к git-репозиторию}
kol=${2:-30}
kusok=${3:-build/kusok}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

vsego=0
n=0
for c in $(git -C "$repo" rev-list --first-parent -n "$kol" HEAD); do
	git -C "$repo" archive --format=tar "$c" > "$tmp/v.tar"
	sz=$(wc -c < "$tmp/v.tar")
	vsego=$((vsego + sz))
	"$kusok" --no-sync "$tmp/st" put "$tmp/v.tar" > /dev/null
	n=$((n + 1))
done

zanyato=$(du -sb "$tmp/st/packs" | cut -f1)
echo "версий:           $n"
echo "копиями, байт:    $vsego"
echo "в kusok, байт:    $zanyato"
awk -v a="$vsego" -v b="$zanyato" \
	'BEGIN { printf "экономия:         %.1fx\n", a / b }'
"$kusok" "$tmp/st" fsck > /dev/null && echo "fsck:             ok"
