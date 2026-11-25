#!/usr/bin/env bash
# Offline PGlite + uploads snapshot. See docs/PGLITE-RECOVERY.md.
set -euo pipefail
umask 077

die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 2 ]] || die 'Использование: backup-pglite.sh ИМЯ.service /абсолютный/путь/к/данным'
service=$1
data=$2
[[ "$service" =~ ^[a-zA-Z0-9_.@-]+\.service$ ]] || die 'Укажите точное имя службы с .service'
[[ "$data" = /* && -d "$data" && ! -L "$data" ]] || die 'Нужна существующая папка данных, без символической ссылки'
[[ -n "${RESTIC_REPOSITORY:-}" ]] || die 'Задайте RESTIC_REPOSITORY'
[[ -n "${RESTIC_PASSWORD_FILE:-}" && -f "$RESTIC_PASSWORD_FILE" ]] || die 'Задайте RESTIC_PASSWORD_FILE'
command -v restic >/dev/null || die 'Не найдена restic'
command -v systemctl >/dev/null || die 'Не найдена systemctl'
command -v realpath >/dev/null || die 'Не найдена realpath'

data=$(realpath -e -- "$data")
[[ "$data" != / && -d "$data/pgdata" && ! -L "$data/pgdata" ]] || die 'В папке нужна настоящая подпапка pgdata'
[[ -d "$data/uploads" && ! -L "$data/uploads" ]] || die 'В папке нужна настоящая подпапка uploads (даже пустая)'
links=$(find "$data" -type l -print -quit) || die 'Не удалось проверить данные на символические ссылки'
[[ -z "$links" ]] || die 'В данных есть символические ссылки: сначала разберите их расположение'
password=$(realpath -e -- "$RESTIC_PASSWORD_FILE")
[[ "$password" != "$data" && "$password" != "$data/"* ]] || die 'Файл пароля должен лежать вне копируемых данных'
if [[ "$RESTIC_REPOSITORY" = /* ]]; then
  repository=$(realpath -m -- "$RESTIC_REPOSITORY")
  [[ "$repository" != "$data" && "$repository" != "$data/"* ]] || die 'Репозиторий копий должен лежать вне данных'
else
  [[ "$RESTIC_REPOSITORY" =~ ^(sftp:|rest:|s3:|b2:|azure:|gs:|rclone:) ]] || die 'Для локального репозитория укажите абсолютный путь'
fi

load=$(systemctl show "$service" --property=LoadState --value) || die 'Не удалось проверить службу'
active=$(systemctl show "$service" --property=ActiveState --value) || die 'Не удалось проверить состояние службы'
sub=$(systemctl show "$service" --property=SubState --value) || die 'Не удалось проверить состояние службы'
[[ "$load" = loaded && "$active" = inactive && "$sub" = dead ]] || die 'Служба должна существовать и быть полностью остановлена'

printf 'Копируем %s в зашифрованный репозиторий restic. Служба %s остановлена.\n' "$data" "$service"
printf 'Оператор обязан убедиться, что других процессов записи нет и автозапуск отключён.\n'
restic backup --tag offix-pglite-offline -- "$data"
printf 'Копия записана. Проверьте восстановление по docs/PGLITE-RECOVERY.md.\n'
