#!/usr/bin/env bash
# Откат к предыдущей версии (server/dist-prev и web/dist-prev). База не откатывается:
# миграции offix только добавляют таблицы и столбцы, прежняя версия работает с новой схемой.
#   sudo bash deploy/linux/rollback.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/common.sh"

DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE="offix"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Запустите от root: sudo bash rollback.sh"
for d in "$DIR/server/dist-prev" "$DIR/web/dist-prev"; do
  [[ -d "$d" ]] || die "Нет предыдущей версии: $d"
done
PORT=$(env_get "$DIR/server/.env" PORT); PORT=${PORT:-4000}

step "Возвращаю предыдущую версию"
for current in "$DIR/server/dist" "$DIR/web/dist"; do
  rm -rf "$current-failed"
  [[ -d "$current" ]] && mv "$current" "$current-failed"
  mv "$current-prev" "$current"
done
systemctl restart "$SERVICE"
wait_health "$PORT" 90 || die "Прежняя версия тоже не отвечает: journalctl -u $SERVICE -n 50"
show_health "$PORT"
ok "Откат выполнен. Неудачная версия лежит в */dist-failed для разбора."
