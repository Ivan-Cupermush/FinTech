# Общие функции скриптов развёртывания offix на Linux.
# Подключается из других скриптов: . "$(dirname "$0")/common.sh"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[32mOK\033[0m  %s\n' "$*"; }
warn() { printf '\033[33m!!\033[0m  %s\n' "$*"; }
die() { printf '\033[31mXX  %s\033[0m\n' "$*" >&2; exit 1; }

# Значение из .env так же, как его читает сервер (process.loadEnvFile):
# кавычки вокруг значения снимаются, без кавычек всё после # — комментарий.
env_get() {
  local file="$1" key="$2" line value
  [[ -f "$file" ]] || return 0
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" | tail -1) || true
  [[ -n "$line" ]] || return 0
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  if [[ "$value" =~ ^\"(.*)\"[[:space:]]*$ || "$value" =~ ^\'(.*)\'[[:space:]]*$ ]]; then
    value="${BASH_REMATCH[1]}"
  else
    value="${value%%#*}"
    value="${value%"${value##*[![:space:]]}"}"
  fi
  printf '%s' "$value"
}

# Раскодировать %XX в строке (пароль в DATABASE_URL).
url_decode() { local s="${1//\\/\\\\}"; printf '%b' "${s//%/\\x}"; }

# Части DATABASE_URL: DB_USER DB_PASSWORD DB_HOST DB_PORT DB_NAME.
db_parts() {
  local url="${1:-postgres://offix:offix@localhost:5432/offix}"
  [[ "$url" =~ ^postgres(ql)?://([^:/@]+)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]+) ]] || die "DATABASE_URL не похож на postgres://пользователь:пароль@сервер:порт/база"
  DB_USER=$(url_decode "${BASH_REMATCH[2]}")
  DB_PASSWORD=$(url_decode "${BASH_REMATCH[4]}")
  DB_HOST="${BASH_REMATCH[5]}"
  DB_PORT="${BASH_REMATCH[7]:-5432}"
  DB_NAME=$(url_decode "${BASH_REMATCH[8]}")
}

# Адрес без пароля — для вывода на экран.
hide_password() { sed -E 's#(://[^:/@]+:)[^@]*@#\1***@#' <<<"$1"; }

# Хеш package-lock.json: npm ci только если он изменился с прошлой установки.
deps_changed() {
  local root="$1" stamp="$1/node_modules/.offix-lock-hash"
  [[ -f "$stamp" ]] || return 0
  [[ "$(sha256sum "$root/package-lock.json" | cut -d' ' -f1)" != "$(cat "$stamp")" ]]
}

deps_stamp() { sha256sum "$1/package-lock.json" | cut -d' ' -f1 > "$1/node_modules/.offix-lock-hash"; }

# Ждём, пока сервер ответит {"ok":true} на /api/health.
wait_health() {
  local port="$1" seconds="$2" deadline=$((SECONDS + $2))
  while ((SECONDS < deadline)); do
    if curl -fsS -m 5 "http://127.0.0.1:$port/api/health" 2>/dev/null | grep -q '"ok":true'; then
      ok "Сервер отвечает: http://127.0.0.1:$port/api/health"
      return 0
    fi
    sleep 2
  done
  return 1
}

# Что сообщает запущенный сервер о себе: версия, миграция, сайт, ffmpeg.
show_health() {
  local h
  h=$(curl -fsS -m 5 "http://127.0.0.1:$1/api/health" 2>/dev/null) || { warn "/api/health не отвечает"; return 0; }
  echo "    $h"
}

# Заменяет папку $1 на $2, предыдущая остаётся в $1-prev (для отката).
switch_folder() {
  local target="$1" next="$2"
  rm -rf "$target-prev"
  [[ -d "$target" ]] && mv "$target" "$target-prev"
  mv "$next" "$target"
}
