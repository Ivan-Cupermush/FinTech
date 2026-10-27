#!/usr/bin/env bash
# Обновление offix на Linux: git → сборка сайта и сервера рядом с работающими →
# подмена папок → перезапуск службы → проверка /api/health. Не ответил — сам откатывается.
#
#   sudo bash deploy/linux/update.sh              # из origin/main
#   sudo bash deploy/linux/update.sh --skip-pull  # собрать то, что уже в папке
# Миграции базы применяет сам сервер при запуске. Предыдущая версия — в */dist-prev.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/common.sh"

DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BRANCH="main"
SERVICE="offix"
SKIP_PULL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --skip-pull) SKIP_PULL=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Запустите от root: sudo bash update.sh"
systemctl cat "$SERVICE" >/dev/null 2>&1 || die "Служба $SERVICE не найдена. Сначала — install.sh"
OWNER=$(stat -c %U "$DIR")
as_owner() { sudo -u "$OWNER" -H "$@"; }
PORT=$(env_get "$DIR/server/.env" PORT); PORT=${PORT:-4000}

if [[ $SKIP_PULL -eq 0 ]]; then
  step "Получаю обновления из origin/$BRANCH"
  as_owner git -C "$DIR" fetch origin "$BRANCH"
  # Только fast-forward: правки на сервере не затираются молча.
  as_owner git -C "$DIR" merge --ff-only "origin/$BRANCH"
fi
VERSION=$(as_owner git -C "$DIR" rev-parse --short HEAD)

if deps_changed "$DIR"; then
  step "Зависимости изменились — npm ci"
  # --include=dev: сборке нужны TypeScript, Vite и esbuild.
  (cd "$DIR" && as_owner npm ci --include=dev --no-audit --no-fund)
  deps_stamp "$DIR"
else
  ok "Зависимости не менялись"
fi

step "Собираю сайт"
rm -rf "$DIR/web/dist-next"
(cd "$DIR" && as_owner npm run build -w web -- --outDir dist-next --emptyOutDir)
# Файлы прежней версии сайта — рядом с новыми: вкладки, открытые до обновления, догрузят свои части.
if [[ -d "$DIR/web/dist/assets" ]]; then
  as_owner cp -n "$DIR/web/dist/assets/"* "$DIR/web/dist-next/assets/" 2>/dev/null || true
fi

step "Собираю сервер"
rm -rf "$DIR/server/dist-next"
(cd "$DIR" && as_owner env OFFIX_VERSION="$VERSION" npm run build -w server -- --outdir dist-next)

step "Подменяю версии и перезапускаю $SERVICE"
switch_folder "$DIR/server/dist" "$DIR/server/dist-next"
switch_folder "$DIR/web/dist" "$DIR/web/dist-next"
systemctl restart "$SERVICE"
if wait_health "$PORT" 90; then
  ok "Обновлено до версии $VERSION"
  show_health "$PORT"
  exit 0
fi

warn "Новая версия не ответила за 90 с — возвращаю прежнюю"
journalctl -u "$SERVICE" -n 30 --no-pager || true
if [[ -d "$DIR/server/dist-prev" && -d "$DIR/web/dist-prev" ]]; then
  bash "$SCRIPT_DIR/rollback.sh" --dir "$DIR" --service "$SERVICE"
fi
die "Обновление до $VERSION не удалось — журнал выше"
