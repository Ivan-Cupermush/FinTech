#!/usr/bin/env bash
# Собирает offix и укладывает в один архив всё, что нужно песочнице на сервере.
# Запускать на любой машине с Node 22 (не на маленьком сервере: сборка сайта
# съедает больше памяти, чем там есть), из корня репозитория:
#
#   deploy/sandbox/pack.sh            # npm ci, сборка, архив offix-sandbox.tgz
#   deploy/sandbox/pack.sh --no-build # только архив из уже собранного
#
# В архиве нет node_modules: зависимости сервер ставит сам (README, шаг 3).
set -euo pipefail

cd "$(dirname "$0")/../.."
out="${OUT:-offix-sandbox.tgz}"

if [[ "${1:-}" != "--no-build" ]]; then
  npm ci
  npm run build
fi

for f in server/dist/index.js server/dist/migrations web/dist/index.html; do
  [[ -e "$f" ]] || { echo "Нет $f — сначала соберите: npm ci && npm run build" >&2; exit 1; }
done

# Файлы рабочих пространств нужны npm ci, чтобы поставить зависимости сервера по lock-файлу.
tar -czf "$out" \
  package.json package-lock.json \
  packages/core/package.json \
  server/package.json server/dist \
  web/package.json web/dist \
  --exclude='native/kusok/build*' native/kusok \
  deploy/sandbox

echo "Готово: $out ($(du -h "$out" | cut -f1)). Дальше — deploy/sandbox/README.md, шаг 2."
