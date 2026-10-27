#!/usr/bin/env bash
# Резервная копия offix: база PostgreSQL (pg_dump, формат custom — восстановление pg_restore)
# и загруженные файлы (rsync «только добавить»: удалённое на сервере в копии остаётся).
# Адрес базы и папка файлов — из server/.env; пароль базы передаётся pg_dump через
# переменную окружения и в список процессов не попадает.
#
#   sudo bash deploy/linux/backup.sh --backup-dir /var/backups/offix
#   sudo bash deploy/linux/backup.sh --backup-dir /var/backups/offix --install-timer   # каждый день в 03:30
# Копию лучше держать на другом диске, а ещё лучше — дополнительно вне сервера.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/common.sh"

DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR=""
KEEP_DAYS=30
INSTALL_TIMER=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --keep-days) KEEP_DAYS="$2"; shift 2 ;;
    --install-timer) INSTALL_TIMER=1; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done
[[ -n "$BACKUP_DIR" ]] || die "Укажите --backup-dir"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || die "--keep-days должен быть числом"

if [[ $INSTALL_TIMER -eq 1 ]]; then
  [[ $EUID -eq 0 ]] || die "Запустите от root"
  cat > /etc/systemd/system/offix-backup.service <<UNIT
[Unit]
Description=offix — резервная копия базы и файлов
[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $SCRIPT_DIR/backup.sh --dir $DIR --backup-dir $BACKUP_DIR --keep-days $KEEP_DAYS
UNIT
  cat > /etc/systemd/system/offix-backup.timer <<UNIT
[Unit]
Description=offix — резервная копия каждый день в 03:30
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now offix-backup.timer >/dev/null
  ok "Ежедневная копия в 03:30 → $BACKUP_DIR (проверка: systemctl list-timers offix-backup)"
  exit 0
fi

ENV_FILE="$DIR/server/.env"
[[ -f "$ENV_FILE" ]] || die "Нет $ENV_FILE"
db_parts "$(env_get "$ENV_FILE" DATABASE_URL)"
UPLOADS=$(env_get "$ENV_FILE" UPLOADS_DIR)
if [[ -z "$UPLOADS" ]]; then UPLOADS="$DIR/server/data/uploads"; elif [[ "$UPLOADS" != /* ]]; then UPLOADS="$DIR/server/$UPLOADS"; fi
command -v pg_dump >/dev/null || die "pg_dump не найден: apt-get install postgresql-client"

install -d -m 700 "$BACKUP_DIR/db" "$BACKUP_DIR/uploads"
FILE="$BACKUP_DIR/db/$DB_NAME-$(date +%Y%m%d-%H%M).dump"
step "Дамп базы $DB_NAME ($DB_HOST:$DB_PORT)"
PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -F c -f "$FILE" "$DB_NAME"
chmod 600 "$FILE"
ok "$FILE ($(du -h "$FILE" | cut -f1))"
find "$BACKUP_DIR/db" -name '*.dump' -mtime +"$KEEP_DAYS" -delete

step "Файлы ($UPLOADS)"
if [[ -d "$UPLOADS" ]]; then
  if command -v rsync >/dev/null; then rsync -a "$UPLOADS/" "$BACKUP_DIR/uploads/"; else cp -a --update=none "$UPLOADS/." "$BACKUP_DIR/uploads/" 2>/dev/null || cp -a -n "$UPLOADS/." "$BACKUP_DIR/uploads/"; fi
  ok "Скопированы в $BACKUP_DIR/uploads"
else
  warn "Папки $UPLOADS нет — файлов ещё не загружали"
fi
