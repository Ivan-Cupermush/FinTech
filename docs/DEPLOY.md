# offix на сервере: развёртывание, обновление, приложение

Документ для того, кто ставит и обслуживает offix. Скрипты лежат в `deploy/`:

| Папка | Что внутри |
|---|---|
| `deploy/linux/` | установка на Linux-сервер (`install.sh`), обновление, откат, резервные копии |
| `deploy/vps/` | «входная дверь» на VPS: HTTPS (Caddy), брандмауэр, защита SSH, туннель из офиса |
| `deploy/windows/` | сервер в офисе на Windows: служба, обновление, откат, копии, туннель к VPS, диагностика |
| `deploy/measure/` | замер скорости сайта с разных сетей |
| `mobile/eas.json`, `mobile/app.config.ts` | сборка приложения в EAS |

> **Состояние.** Скрипты проверены тестами (`server/test/deploy.test.ts`) и локальным запуском
> сборки, но ни разу не запускались на настоящем сервере: его адрес и доступы ещё не получены.
> Первый запуск — по этому документу, с резервной копией до любых изменений.

---

## 1. Как устроено

```
Браузер / приложение ──HTTPS──► Caddy (сертификаты сам)          ← на VPS
                                   │
           ┌───────────────────────┴──────────────────────┐
   сервер на этом же VPS                      SSH-туннель из офиса (исходящий)
   (--upstream local)                         (--upstream tunnel)
           └───────────────────────┬──────────────────────┘
                                   ▼
                 Node: служба «offix» (127.0.0.1:4000)
                 ├─ /                сайт (web/dist, собранный)
                 ├─ /api/v1/*        API
                 ├─ /socket.io/*     чаты и события в реальном времени
                 └─ /health          проверка: база, версия, миграция
                                   │
                                   ▼
                        PostgreSQL (127.0.0.1:5432)
```

- **Один процесс и один порт** на сайт, API, файлы и сокеты: нет CORS, нет второго адреса,
  нет dev-сервера Vite в продакшене. Сайт сервер отдаёт сам, если `NODE_ENV=production`
  и сайт собран (`web/dist`) — или из папки `WEB_DIST_DIR`.
- Сервер слушает только `127.0.0.1` (`HOST=127.0.0.1`): снаружи к нему не попасть в обход Caddy.
- Файлы сборки с хешем в имени кэшируются браузером на год, `index.html` — никогда: после
  обновления люди сразу получают новую версию, а открытые вкладки догружают старые части
  (скрипт обновления оставляет их рядом с новыми).
- У страниц сайта своя политика безопасности (CSP): скрипты только свои, запросы и сокет —
  только на этот же адрес, встраивание сайта в чужие страницы запрещено. У API — строже:
  `default-src 'none'`.
- Миграции базы применяет сам сервер при запуске. Они только добавляют таблицы и столбцы,
  поэтому откат кода не требует отката базы.

### Проверка `/health`

`GET /health` и `GET /api/health` (без входа):

```json
{"ok":true,"status":"ok","database":"ok","version":"6362de1","migration":"0011_sales.sql","site":true,"media":{"ffmpeg":true,"max_upload_bytes":209715200}}
```

- `version` — коммит, из которого собран сервер (файл `server/dist/VERSION`); `dev` — запуск из исходников.
- `migration` — последняя применённая миграция (имя последнего файла в `server/src/db/migrations`).
- `site: false` — сервер отдаёт только API: проверьте `NODE_ENV=production` и `WEB_DIST_DIR`.
- `media.ffmpeg: false` — ffmpeg не найден: у видео нет обложек, голосовые с сайта не перекодируются.
- База не отвечает — ответ **503** с `"database":"error"`: Caddy, скрипт обновления и мониторинг видят сбой.

---

## 2. Что нужно от сервера

- Linux (Ubuntu 22.04/24.04) или Windows Server 2019+ / Windows 10+.
- 2 ядра, 4 ГБ памяти, 20 ГБ диска + место под файлы людей. Для помощника базы знаний на
  нейросети (Ollama) — ещё 8 ГБ памяти; без неё работает встроенный поиск с ответом цитатами.
- Node.js 22, PostgreSQL 14+, ffmpeg, git.
- Для доступа из интернета — домен и VPS с внешним IP (вариант 4.1) или туннель Cloudflare (4.2 Б).

## 3. Настройки `server/.env`

Сервер читает `server/.env` сам при запуске; переменные, заданные службе, важнее файла.
Полный образец с пояснениями — `server/.env.example`. Главное для продакшена:

| Настройка | Значение | Зачем |
|---|---|---|
| `NODE_ENV` | `production` | сервер отдаёт сайт, проверяет длину `JWT_SECRET` |
| `HOST` | `127.0.0.1` | порт не виден снаружи, только через Caddy или туннель |
| `PORT` | `4000` | порт сервера |
| `DATABASE_URL` | `postgres://offix:<пароль>@127.0.0.1:5432/offix` | база |
| `JWT_SECRET` | 64 случайных символа, **только буквы и цифры** | подпись входа; `#` обрезает ключ — всё после него комментарий |
| `UPLOADS_DIR` | `/var/lib/offix/uploads` или `D:\offix-files` | файлы людей — вне папки с кодом |
| `FFMPEG_DIR` | `/usr/bin` или `C:\ffmpeg\bin` | служба не видит PATH пользователя |
| `APP_URL` | `https://offix.example.ru` | ссылки в письмах |

Новый ключ: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
После смены `JWT_SECRET` все один раз войдут заново.

---

## 4. Установка

### 4.1. Linux-сервер (VPS) — offix и HTTPS на одной машине

От root на свежем Ubuntu:

```bash
git clone https://github.com/Ivan-Cupermush/FinTech.git /opt/offix
sudo bash /opt/offix/deploy/linux/install.sh --app-url https://offix.example.ru
sudo bash /opt/offix/deploy/vps/setup.sh --domains "offix.example.ru" --email admin@example.ru --upstream local
```

`install.sh` ставит Node.js 22, PostgreSQL, ffmpeg; создаёт пользователя `offix`, базу с
случайным паролем и `server/.env` со сгенерированным `JWT_SECRET` (права 600); регистрирует
службу systemd `offix` (только чтение системы, запись — лишь в папку файлов) и собирает
первую версию. `setup.sh` настраивает Caddy с сертификатами, брандмауэр (открыты 22, 80, 443),
fail2ban, вход по SSH только по ключу (если ключ администратора уже есть) и автоматические
обновления безопасности.

Перед `setup.sh` запись `A` домена должна указывать на IP сервера. Посмотреть, какой
конфигурацией Caddy станет, ничего не меняя: добавьте `--print-caddyfile` (root не нужен).

Проверка: `sudo offix-status`, `journalctl -u offix -n 50`, `curl -s 127.0.0.1:4000/health`.

### 4.2. Windows-сервер в офисе

Ниже `C:\offix` — папка с репозиторием. PowerShell **от имени администратора**.

1. Программы: Node.js 22 LTS, Git, PostgreSQL, NSSM (`winget install NSSM.NSSM`), ffmpeg:

   ```powershell
   Invoke-WebRequest https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip -OutFile $env:TEMP\ffmpeg.zip
   Expand-Archive $env:TEMP\ffmpeg.zip -DestinationPath C:\ffmpeg-tmp
   Move-Item (Get-ChildItem C:\ffmpeg-tmp)[0].FullName C:\ffmpeg
   ```

2. База: в PostgreSQL создать пользователя `offix` с длинным случайным паролем и базу `offix`.
3. `server\.env` по образцу `server\.env.example` (раздел 3).
4. Служба и первая сборка:

   ```powershell
   cd C:\offix
   powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1 -StopOldProcesses
   powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1 -SkipPull
   ```

   `install-service.ps1` проверяет `.env` (ключ из образца, `#` в ключе, пароль базы из
   образца, `HOST`) и регистрирует службу `Offix`: автозапуск после PostgreSQL, перезапуск при
   падении, журнал `logs\server.log` с ротацией. Проверка: `http://127.0.0.1:4000` на сервере.

#### Доступ из интернета

**Вариант А (рекомендуется): VPS + туннель из офиса.** Люди заходят на VPS (Caddy), сервер в
офисе сам подключается к VPS исходящим SSH-туннелем. В офисе не открывается ни одного входящего
порта, IP офиса нигде не публикуется: атака на сайт бьёт по VPS, а не по каналу компании.

```bash
# на VPS
sudo bash setup.sh --domains "offix.example.ru" --email admin@example.ru
```

Скрипт напечатает команду для офиса:

```powershell
powershell -ExecutionPolicy Bypass -File C:\offix\deploy\windows\install-tunnel.ps1 -VpsHost <IP> -HostKey "ssh-ed25519 AAAA..."
```

Она создаст ключ офиса и покажет команду `sudo offix-allow-office '...'` для VPS. Ключ может
только открыть обратный проброс на один порт VPS — без командной строки и других пробросов.
Туннель — служба `OffixTunnel`, переподключается сама.

**Вариант Б: туннель Cloudflare.** `deploy\windows\cloudflared-config.example.yml` →
`C:\cloudflared\config.yml`, все адреса ведут на `http://127.0.0.1:4000`. Часть российских
провайдеров ограничивает соединения с Cloudflare (маленькие ответы проходят, большие обрываются),
поэтому для людей в России надёжнее вариант А.

> Проброс 80/443 на роутере офиса не используем: атака на опубликованный IP офиса забивает
> интернет-канал всей компании.

---

## 5. Обновление и откат

| | Linux | Windows |
|---|---|---|
| Обновить из `main` | `sudo bash deploy/linux/update.sh` | `deploy\windows\update.ps1` |
| Собрать то, что в папке | `update.sh --skip-pull` | `update.ps1 -SkipPull` |
| Откатить | `sudo bash deploy/linux/rollback.sh` | `deploy\windows\rollback.ps1` |

Обновление: `git merge --ff-only` (правки на сервере не затираются молча) → `npm ci`, только если
изменился `package-lock.json` → сборка сайта и сервера в `dist-next` рядом с работающими →
подмена папок → перезапуск → ожидание `/api/health` до 90 секунд. Простой — секунды.
Предыдущая версия остаётся в `dist-prev`. На Linux, если новая версия не ответила, скрипт сам
возвращает прежнюю и печатает журнал; на Windows — пробует запустить службу на прежней версии,
откат — `rollback.ps1`. Неудачная версия после отката лежит в `dist-failed`.

На Windows при изменившихся зависимостях служба останавливается на время `npm ci`: Windows не
даёт заменить загруженные модули (`sharp`).

---

## 6. Резервные копии

```bash
sudo bash deploy/linux/backup.sh --backup-dir /var/backups/offix --install-timer
```
```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -BackupDir D:\offix-backup -Register
```

Каждый день в 03:30: дамп базы (`pg_dump -F c`, хранится 30 дней) и копия загруженных файлов
в режиме «только добавить». Адрес базы берётся из `DATABASE_URL`, пароль передаётся `pg_dump`
через переменную окружения и не попадает в список процессов. Копию лучше держать на другом
диске и дополнительно вне сервера.

Восстановление:

```bash
sudo systemctl stop offix
sudo -u postgres dropdb offix && sudo -u postgres createdb -O offix offix
sudo -u postgres pg_restore -d offix --no-owner --role=offix /var/backups/offix/db/offix-20261027-0330.dump
sudo rsync -a /var/backups/offix/uploads/ /var/lib/offix/uploads/
sudo systemctl start offix
```

Раз в месяц проверяйте, что копия читается: `pg_restore -l файл.dump | head`.

---

## 7. Приложение: сборка в EAS

Конфигурация — `mobile/eas.json` (профили `preview` и `production`) и `mobile/app.config.ts`:
основа из `app.json`, а ключ проекта и адрес сервера приходят из окружения сборки. Настоящих
ключей в репозитории нет.

| Переменная | Где задать | Что это |
|---|---|---|
| `EAS_PROJECT_ID` | EAS → Environment variables | UUID проекта на expo.dev; без него push на телефоны не включаются |
| `EXPO_PUBLIC_API_URL` | EAS → Environment variables (`preview`, `production`) | адрес сервера компании по умолчанию, `https://…`; человек может сменить его при входе |
| `EXPO_OWNER` | там же, если проект не личный | аккаунт или организация на expo.dev |
| `APP_VERSION` | при выпуске | версия для магазинов, `1.2.0` |

Первый раз (на компьютере разработчика, `npm i -g eas-cli`):

```bash
cd mobile
eas login
eas init        # создаст проект на expo.dev и напечатает его UUID
# для каждого окружения: --environment preview и --environment production
eas env:create --environment production --name EAS_PROJECT_ID --value <UUID>
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://offix.example.ru
```

`eas init` попросит вписать UUID в конфигурацию — вместо этого он задаётся переменной
`EAS_PROJECT_ID`. Конфигурацию EAS читает и на компьютере, откуда запускают сборку, поэтому
там те же две переменные нужны в окружении (`export EAS_PROJECT_ID=… EXPO_PUBLIC_API_URL=…`).

Сборки:

```bash
eas build -p android --profile preview      # APK для установки по ссылке (проверка)
eas build -p android --profile production   # пакет для RuStore / Google Play, номер сборки растёт сам
eas build -p ios --profile production       # нужен Apple Developer
eas submit -p android --profile production  # черновик во внутреннем треке Google Play
```

Сборки `preview` и `production` **не соберутся** без https-адреса сервера: релизные Android
и iOS не ходят по http, и приложение молча не открыло бы ни одного экрана. Ошибку видно сразу,
а не после установки.

Push на телефоны: в `server/.env` — `PUSH_ENABLED=1` (и `EXPO_ACCESS_TOKEN`, если в проекте
expo.dev включена защита push); для Android — ключ FCM в `eas credentials` (Android → Push
Notifications). Без `EAS_PROJECT_ID` в сборке приложение не регистрирует телефон и push не шлёт.

---

## 8. «У кого-то не открывается» — что собрать

1. С сервера: `diagnose.ps1 > diag.txt` (Windows) или `sudo offix-status` и
   `journalctl -u offix -n 100` (Linux). В выводе диагностики нет паролей: адрес базы — без
   пароля, секреты — только длина.
2. С устройства, где не открывается (и где открывается — для сравнения):
   `https://<адрес>/health`; главная (если белый экран — F12 → «Сеть», скриншот красных строк);
   какая сеть (провайдер Wi-Fi, мобильный оператор, VPN); `nslookup <адрес>`.
3. Замер с разных сетей: `bash deploy/measure/measure.sh https://<адрес>`
   (или `measure.ps1`) — медиана соединения, TLS, первого байта и ошибки.

---

## 9. Безопасность — чек-лист

- Наружу открыты только 80/443 и SSH по ключу (Linux) или ничего (Windows за туннелем).
- Сервер offix и PostgreSQL слушают только `127.0.0.1`; пароль базы длинный и случайный.
- `server/.env` — не в git, права только у владельца (`install.sh` ставит 600).
- `JWT_SECRET` — свой, не из образца (`install-service.ps1` не даст запустить с образцом).
- Пароли интеграций (1С, Moodle) хранятся зашифрованными; API не возвращает их даже частично.
- Резервные копии каждый день, проверка восстановления раз в месяц.
- Обновления ОС ставятся сами (Linux: unattended-upgrades с перезагрузкой в 04:30), Node.js — LTS.
