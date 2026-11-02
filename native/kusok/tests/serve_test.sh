#!/bin/sh
# kusok serve целиком: настоящий сервер и curl
#   tests/serve_test.sh ПУТЬ_К_KUSOK
# SPDX-License-Identifier: MIT
set -eu
kusok=$1
command -v curl > /dev/null || { echo "нет curl"; exit 77; }

tmp=$(mktemp -d)
pid=
trap '[ -n "$pid" ] && kill "$pid" 2> /dev/null && wait "$pid"; rm -rf "$tmp"' EXIT
fail() {
	echo "FAIL: $*"
	tail -20 "$tmp/log"
	exit 1
}

"$kusok" --no-sync "$tmp/st" serve 127.0.0.1:0 > "$tmp/port" 2> "$tmp/log" &
pid=$!
i=0
while [ ! -s "$tmp/port" ]; do
	i=$((i + 1))
	[ $i -gt 50 ] && fail "сервер не стартовал: $(cat "$tmp/log")"
	sleep 0.1
done
url=http://127.0.0.1:$(cat "$tmp/port")

head -c 300000 /dev/urandom > "$tmp/a"
seq 1 100000 > "$tmp/b"

# положить
curl -sf -X PUT --data-binary @"$tmp/a" "$url/f" > "$tmp/r1" || fail "put a"
ida=$(sed 's/.*"id":"\([0-9a-f]*\)".*/\1/' "$tmp/r1")
[ ${#ida} -eq 64 ] || fail "id: $(cat "$tmp/r1")"
[ "$ida" = "$(sha256sum "$tmp/a" | cut -d' ' -f1)" ] || fail "id не sha256"
curl -sf -X PUT --data-binary @"$tmp/b" "$url/f" > "$tmp/r2" || fail "put b"
idb=$(sed 's/.*"id":"\([0-9a-f]*\)".*/\1/' "$tmp/r2")

# второй раз — ничего нового
curl -sf -X PUT --data-binary @"$tmp/a" "$url/f" | grep -q '"new_bytes":0' ||
	fail "повтор записал новое"

# целиком
curl -sf "$url/f/$ida" -o "$tmp/a2" || fail "get"
cmp -s "$tmp/a" "$tmp/a2" || fail "get не тот"

# Range
curl -sf -r 1000-1999 "$url/f/$ida" -o "$tmp/part" || fail "range"
dd if="$tmp/a" bs=1 skip=1000 count=1000 2> /dev/null > "$tmp/want"
cmp -s "$tmp/part" "$tmp/want" || fail "range не тот"
code=$(curl -s -o /dev/null -w '%{http_code}' -r 5000- "$url/f/$idb")
[ "$code" = 206 ] || fail "range код $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -r 99999999- "$url/f/$idb")
[ "$code" = 416 ] || fail "416 код $code"
curl -s -r -7 "$url/f/$idb" | grep -qx '100000' || fail "суффикс"

# HEAD
curl -sfI "$url/f/$ida" | grep -qi '^content-length: 300000' || fail "head"

# keep-alive: два запроса в одном соединении
curl -sf "$url/f/$idb" "$url/f/$idb" -o /dev/null -o /dev/null ||
	fail "keep-alive"

# ссылки и удаление
curl -sf -X POST "$url/f/$idb/ref" || fail "ref"
curl -sf -X DELETE "$url/f/$idb" || fail "rm 1"
curl -sf "$url/f/$idb" -o /dev/null || fail "после rm 1 ещё жив"
curl -sf -X DELETE "$url/f/$idb" || fail "rm 2"
code=$(curl -s -o /dev/null -w '%{http_code}' "$url/f/$idb")
[ "$code" = 404 ] || fail "удалённый: $code"

# ошибки
code=$(curl -s -o /dev/null -w '%{http_code}' "$url/nope")
[ "$code" = 404 ] || fail "404: $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$url/f/$ida")
[ "$code" = 405 ] || fail "405: $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Transfer-Encoding: chunked' --data-binary @"$tmp/b" "$url/f")
[ "$code" = 411 ] || fail "411: $code"

# статистика и сборка мусора
curl -sf "$url/stat" | grep -q '"files":1' || fail "stat"
curl -sf -X POST "$url/gc?min=0" | grep -q packs_rewritten || fail "gc"
curl -sf "$url/f/$ida" -o "$tmp/a3" && cmp -s "$tmp/a" "$tmp/a3" ||
	fail "после gc"

# много параллельных клиентов
kids=
for k in 1 2 3 4 5 6 7 8; do
	curl -sf -r $((k * 1000))-$((k * 1000 + 4999)) "$url/f/$ida" \
		-o "$tmp/p$k" &
	kids="$kids $!"
done
for j in $kids; do wait "$j" || fail "параллельный curl"; done
for k in 1 2 3 4 5 6 7 8; do
	dd if="$tmp/a" bs=1000 skip=$k count=5 2> /dev/null | cmp -s - "$tmp/p$k" ||
		fail "параллельный $k"
done

# конвейер: два запроса одним куском, PUT с телом сразу за заголовком,
# тело частями с паузами
if command -v python3 > /dev/null; then
	python3 - "$(cat "$tmp/port")" "$ida" << 'PY' || fail "конвейер"
import socket, sys, time
port, ida = int(sys.argv[1]), sys.argv[2]
s = socket.create_connection(("127.0.0.1", port))
s.sendall((f"GET /f/{ida} HTTP/1.1\r\nRange: bytes=0-9\r\n\r\n"
           f"PUT /f HTTP/1.1\r\nContent-Length: 11\r\n\r\nhello").encode())
time.sleep(0.2)
s.sendall(b" world")
s.sendall(b"GET /stat HTTP/1.1\r\nConnection: close\r\n\r\n")
data = b""
while True:
    b = s.recv(65536)
    if not b:
        break
    data += b
assert data.count(b"HTTP/1.1 ") == 3, data
assert b"206 Partial" in data and b"201 Created" in data, data
assert b'"files":2' in data, data
PY
fi

# остановка по сигналу закрывает хранилище чисто
kill -TERM "$pid"
wait "$pid" || true
pid=
"$kusok" "$tmp/st" fsck > /dev/null || fail "fsck после остановки"
echo "serve: всё ок"
