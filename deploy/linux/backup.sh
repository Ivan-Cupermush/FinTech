#!/usr/bin/env bash
# Резервная копия offix: база PostgreSQL (pg_dump, формат custom — восстановление pg_restore)
# и загруженные файлы (rsync «только добавить»: удалённое на сервере в копии остаётся).
# Хранилище kusok копирует сам сервер (он держит его на запись) в $BACKUP_DIR/kusok:
# скрипт просит об этом после дампа базы, и сервер снимает копию в течение 10 минут.
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
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done
[[ -n "$BACKUP_DIR" ]] || die "Укажите --backup-dir"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || die "--keep-days должен быть числом"

ENV_FILE="$DIR/server/.env"
uploads_dir() {
  local u; u=$(env_get "$ENV_FILE" UPLOADS_DIR)
  if [[ -z "$u" ]]; then echo "$DIR/server/data/uploads"; elif [[ "$u" != /* ]]; then echo "$DIR/server/$u"; else echo "$u"; fi
}

if [[ $INSTALL_TIMER -eq 1 ]]; then
  [[ $EUID -eq 0 ]] || die "Запустите от root"
  [[ -f "$ENV_FILE" ]] || die "Нет $ENV_FILE"
  # Копию kusok пишет служба offix — папка её. Тот же владелец, что у папки загрузок.
  KB="$BACKUP_DIR/kusok"
  install -d -m 700 "$KB"
  OWNER=$(stat -c %U "$(uploads_dir)" 2>/dev/null || echo offix)
  id "$OWNER" >/dev/null 2>&1 && chown "$OWNER": "$KB"
  if [[ -z "$(env_get "$ENV_FILE" KUSOK_BACKUP_DIR)" ]]; then
    printf '\n# Копия хранилища kusok: снимает сам сервер ночью и по просьбе backup.sh\nKUSOK_BACKUP_DIR=%s\n' "$KB" >> "$ENV_FILE"
    systemctl try-restart offix 2>/dev/null || true
    ok "KUSOK_BACKUP_DIR=$KB добавлен в server/.env, offix перезапущен"
  fi
  if id "$OWNER" >/dev/null 2>&1 && ! runuser -u "$OWNER" -- test -w "$KB"; then
    warn "$OWNER не может писать в $KB: откройте ему путь (chmod o+x на родительские папки)"
  fi
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

[[ -f "$ENV_FILE" ]] || die "Нет $ENV_FILE"
db_parts "$(env_get "$ENV_FILE" DATABASE_URL)"
UPLOADS=$(uploads_dir)
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
  # Хранилище kusok копируется своим экспортом (ниже): rsync мог бы взять его посреди записи.
  if command -v rsync >/dev/null; then rsync -a --exclude=/kusok/ "$UPLOADS/" "$BACKUP_DIR/uploads/"; else
    for d in "$UPLOADS"/*; do [[ "$(basename "$d")" == kusok ]] && continue; cp -a --update=none "$d" "$BACKUP_DIR/uploads/" 2>/dev/null || cp -a -n "$d" "$BACKUP_DIR/uploads/"; done
  fi
  ok "Скопированы в $BACKUP_DIR/uploads"
else
  warn "Папки $UPLOADS нет — файлов ещё не загружали"
fi

# kusok: копию снимает сервер — второй процесс открыть хранилище не может, пока оно открыто
# на запись. Просим после дампа базы, чтобы в копии были все файлы, на которые ссылается дамп.
if [[ -d "$UPLOADS/kusok" ]]; then
  step "Хранилище kusok"
  KB=$(env_get "$ENV_FILE" KUSOK_BACKUP_DIR)
  if [[ -n "$KB" && "$KB" != /* ]]; then KB="$DIR/server/$KB"; fi
  if [[ -z "$KB" ]]; then
    warn "KUSOK_BACKUP_DIR не задан — файлы из kusok в копию не попадают. Включить: sudo bash $0 --backup-dir $BACKUP_DIR --install-timer"
  elif [[ ! -d "$KB" ]]; then
    warn "Нет папки $KB — запустите с --install-timer, чтобы её создать"
  else
    touch "$KB/request"
    ok "Сервер снимет копию в $KB/store в течение 10 минут (итог — $KB/last.json)"
    if [[ ! -f "$KB/last.json" ]]; then
      warn "Копий kusok ещё не было: проверьте завтра $KB/last.json и journalctl -u offix | grep storage"
    elif [[ -n "$(find "$KB/last.json" -mmin +2880)" ]]; then
      warn "Последняя копия kusok старше двух суток: $(cat "$KB/last.json"). Смотрите journalctl -u offix | grep storage"
    fi
  fi
fi
