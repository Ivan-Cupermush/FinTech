#!/usr/bin/env bash
# offix на Linux-сервере (Ubuntu 22.04/24.04): Node.js 22, PostgreSQL, ffmpeg,
# служба systemd «offix» (API и сайт на одном порту, только 127.0.0.1) и первая сборка.
#
# Запуск (от root, из папки с кодом или с --repo):
#   sudo bash deploy/linux/install.sh
#   sudo bash install.sh --repo https://github.com/<владелец>/<репозиторий>.git --dir /opt/offix
# Параметры:
#   --repo URL       откуда взять код, если в --dir его ещё нет
#   --branch NAME    ветка (main)
#   --dir PATH       куда поставить (/opt/offix; по умолчанию — репозиторий, где лежит скрипт)
#   --port N         порт сервера на 127.0.0.1 (4000)
#   --database-url   своя база вместо локального PostgreSQL (postgres://…)
#   --app-url URL    адрес сайта для ссылок в письмах (https://offix.example.ru)
# Повторный запуск безопасен: .env и база не пересоздаются, служба обновляется.
# Снаружи сайт открывают через Caddy: deploy/vps/setup.sh --upstream local.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/common.sh"

REPO=""
BRANCH="main"
DIR=""
PORT=4000
DATABASE_URL=""
APP_URL=""
SERVICE_USER="offix"
DATA_DIR="/var/lib/offix"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --database-url) DATABASE_URL="$2"; shift 2 ;;
    --app-url) APP_URL="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Запустите от root: sudo bash install.sh ..."
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port должен быть числом"
if [[ -z "$DIR" ]]; then
  if [[ -z "$REPO" && -f "$SCRIPT_DIR/../../package.json" ]]; then DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"; else DIR="/opt/offix"; fi
fi
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || warn "Скрипт проверен на Ubuntu, у вас ${PRETTY_NAME:-неизвестная система}"
export DEBIAN_FRONTEND=noninteractive

PKGS=(git curl ca-certificates gnupg openssl ffmpeg rsync postgresql-client)
[[ -n "$DATABASE_URL" ]] || PKGS+=(postgresql)
step "Пакеты: ${PKGS[*]}"
apt-get update -q
apt-get -y -q install "${PKGS[@]}"
ok "Пакеты установлены"

step "Node.js 22"
NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get -y -q install nodejs
fi
ok "Node.js $(node -v)"

step "Пользователь службы ($SERVICE_USER) и папка данных"
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -m 750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR" "$DATA_DIR/uploads"
ok "Файлы людей — в $DATA_DIR/uploads"

step "Код в $DIR"
if [[ ! -f "$DIR/package.json" ]]; then
  [[ -n "$REPO" ]] || die "В $DIR нет кода. Укажите --repo URL"
  install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$DIR"
  sudo -u "$SERVICE_USER" git clone --branch "$BRANCH" "$REPO" "$DIR"
fi
# Код принадлежит служебному пользователю: сборка и git — от его имени, не от root.
chown -R "$SERVICE_USER:$SERVICE_USER" "$DIR"
ok "$(sudo -u "$SERVICE_USER" git -C "$DIR" log -1 --format='%h %s')"

ENV_FILE="$DIR/server/.env"
if [[ -z "$DATABASE_URL" ]]; then
  step "PostgreSQL: база offix"
  systemctl enable --now postgresql >/dev/null
  if [[ -f "$ENV_FILE" ]]; then
    ok "server/.env уже есть — база и пароль не меняются"
  else
    DB_PASS=$(openssl rand -hex 16)
    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='offix'" | grep -q 1; then
      sudo -u postgres psql -q -c "ALTER ROLE offix WITH LOGIN PASSWORD '$DB_PASS'"
    else
      sudo -u postgres psql -q -c "CREATE ROLE offix WITH LOGIN PASSWORD '$DB_PASS'"
    fi
    sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='offix'" | grep -q 1 || sudo -u postgres createdb -O offix offix
    DATABASE_URL="postgres://offix:$DB_PASS@127.0.0.1:5432/offix"
    ok "База offix, пользователь offix (пароль — только в server/.env)"
  fi
fi

step "Настройки server/.env"
if [[ -f "$ENV_FILE" ]]; then
  ok "Уже есть — не трогаю. Проверьте NODE_ENV=production и HOST=127.0.0.1"
else
  JWT_SECRET=$(openssl rand -hex 32)
  umask 077
  cat > "$ENV_FILE" <<ENV
# Создано deploy/linux/install.sh. Все настройки — в server/.env.example.
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
UPLOADS_DIR=$DATA_DIR/uploads
FFMPEG_DIR=/usr/bin
APP_URL=$APP_URL
ENV
  umask 022
  ok "Создан: секрет токенов сгенерирован, сервер слушает только 127.0.0.1:$PORT"
fi
chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"
PORT=$(env_get "$ENV_FILE" PORT); PORT=${PORT:-4000}

step "Служба systemd offix"
cat > /etc/systemd/system/offix.service <<UNIT
# Создано deploy/linux/install.sh
[Unit]
Description=offix — сервер и сайт (порт $PORT)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$DIR/server
ExecStart=$(command -v node) dist/index.js
Restart=on-failure
RestartSec=5
# SIGTERM: сервер дописывает запросы и закрывает базу (до 15 с).
KillSignal=SIGTERM
TimeoutStopSec=20
# Служба видит систему только для чтения, писать может лишь в папку файлов.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable offix >/dev/null
ok "offix.service: автозапуск, перезапуск при падении, журнал — journalctl -u offix"

step "Первая сборка и запуск"
bash "$SCRIPT_DIR/update.sh" --dir "$DIR" --skip-pull

printf '\n\033[1;32m===== Готово =====\033[0m\n'
cat <<TXT

offix работает на 127.0.0.1:$PORT (снаружи не виден).
HTTPS для людей:  sudo bash $DIR/deploy/vps/setup.sh --domains "offix.example.ru" --email admin@example.ru --upstream local
Обновление:       sudo bash $DIR/deploy/linux/update.sh
Откат:            sudo bash $DIR/deploy/linux/rollback.sh
Резервные копии:  sudo bash $DIR/deploy/linux/backup.sh --backup-dir /var/backups/offix --install-timer
TXT
