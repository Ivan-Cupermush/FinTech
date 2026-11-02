# Песочница offix для жюри

Университет с готовыми целями, задачами, чатами, базой знаний и шестью сотрудниками.
Продажи и выплаты выключены в «Функциях компании», как сделал бы ректор; включить их
можно там же. На странице входа — карточка «Песочница для жюри»: щелчок по человеку
сразу входит под ним.

Одна команда запуска из корня собранного offix:

```bash
npm run sandbox        # = cd server && OFFIX_SANDBOX=1 NODE_ENV=production node dist/index.js
```

Сервер отдаёт API и сайт на одном порту (по умолчанию 4000). При первом запуске он
заводит песочницу; при следующих видит, что она уже есть, и ничего не трогает, поэтому
всё, что гости изменили, переживает перезапуск. Без `OFFIX_SANDBOX=1` ничего из этого
нет: ни карточки на входе, ни университета.

## Входы

Пароль совпадает с логином. В поле «Логин или почта» вводится просто логин.

| Логин | Пароль | Кто | Роль | Что посмотреть |
|---|---|---|---|---|
| `rector` | `rector` | Алексей Звездин, ректор | владелец | весь университет, «Функции компании» |
| `prorector` | `prorector` | Игорь Цифров, проректор по цифровизации | руководитель | IT и автоматизация заявок |
| `office` | `office` | Ольга Дедлайнова, руководитель учебного офиса | руководитель | цель «заявка за 30 минут», команда |
| `method` | `method` | Сергей Методкин, методист | сотрудник | регламенты, разбор заявок, база знаний |
| `spec` | `spec` | Анна Заявкина, специалист по заявкам | сотрудник | свои задачи, чаты, отчёт за день |
| `guest` | `guest` | Учёный совет | наблюдатель | только смотрит: прогресс целей и отчёт |

Входы общие для всех гостей, поэтому у них нельзя сменить почту, пароль и имя, выйти на
всех устройствах, сбросить пароль, сменить роль или отключить вход: один гость не
сломает вход следующему. Всё остальное работает как в настоящем offix, включая
выключение и включение разделов у `rector`. Интеграции с 1С и Moodle ходят только во
встроенные поддельные системы, а не в настоящие.

## Что нужно

- Сервер: Linux, Node.js 22 или новее, nginx. Хватает 1 CPU и 2 ГБ памяти: offix занимает
  около 400 МБ после запуска и до 850 МБ под нагрузкой.
- База: встроенная PGlite в папке (`DATABASE_URL=pglite:/var/lib/offix/pgdata`), ставить
  PostgreSQL не нужно. Если PostgreSQL уже есть, укажите `DATABASE_URL=postgres://…`.
- Машина для сборки: любая с Node.js 22 и 4 ГБ памяти. Собирать на маленьком сервере
  не стоит, сборка сайта требует больше памяти, чем там свободно.

> **Чего не делать на сервере 147.45.43.34.** Там же работают VPN и сайт свадьбы (nginx
> по голому IP). Песочница добавляет только свой server-блок по имени
> `offix.147-45-43-34.sslip.io` и не трогает другие сайты, `default_server` и
> настройки SSH. Скрипт `deploy/vps/setup.sh` там **не запускать**: он меняет SSH,
> брандмауэр и fail2ban.

## 1. Собрать (на своей машине)

Из корня репозитория:

```bash
deploy/sandbox/pack.sh
```

Скрипт выполняет `npm ci && npm run build` и складывает в `offix-sandbox.tgz` (около 2 МБ)
то, что нужно серверу: собранный сервер `server/dist` (ядро `@offix/core` встроено в
него), собранный сайт `web/dist`, `package.json` и `package-lock.json` рабочих
пространств и папку `deploy/sandbox`. Зависимостей (`node_modules`) в архиве нет, их
сервер ставит сам по lock-файлу.

## 2. Скопировать

```bash
scp offix-sandbox.tgz root@147.45.43.34:/tmp/
```

## 3. Поставить на сервере

Все команды ниже выполняются на сервере от root.

```bash
node -v    # нужна v22 или новее; если Node нет или он старый:
# curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs

# Отдельный пользователь без входа и папки: код в /opt/offix, данные в /var/lib/offix.
id offix 2>/dev/null || useradd --system --home /var/lib/offix --shell /usr/sbin/nologin offix
mkdir -p /opt/offix /var/lib/offix
chown offix:offix /var/lib/offix && chmod 700 /var/lib/offix

tar -xzf /tmp/offix-sandbox.tgz -C /opt/offix
cd /opt/offix && npm ci --omit=dev -w server --no-audit --no-fund

# Настройки: JWT_SECRET — случайная строка, без него сервер не запустится.
cp deploy/sandbox/sandbox.env.example server/.env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" server/.env
chown offix:offix server/.env && chmod 600 server/.env
```

Проверить вручную, до службы (Ctrl+C останавливает):

```bash
cd /opt/offix && sudo -u offix npm run sandbox
# в другом окне:
curl -s http://127.0.0.1:4000/health
curl -s http://127.0.0.1:4000/api/v1/auth/sandbox | head -c 200
```

В журнале должно появиться «Песочница готова: входы rector, prorector, office, method,
spec, guest (пароль = логин)».

## 4. Служба systemd

```bash
cp /opt/offix/deploy/sandbox/offix-sandbox.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now offix-sandbox
systemctl status offix-sandbox --no-pager
journalctl -u offix-sandbox -n 30 --no-pager
```

Служба запускается от `offix`, пишет только в `/var/lib/offix`, перезапускается при сбое
и ограничена 1,3 ГБ памяти, чтобы не мешать VPN и другим сайтам. Если `node` стоит не в
`/usr/bin` (проверьте `command -v node`), поправьте `ExecStart` в файле службы.

Если на сервере нет подкачки (`swapon --show` ничего не выводит), стоит добавить 1 ГБ:

```bash
fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 5. nginx

Файл `nginx-offix.conf` — отдельный server-блок только для имени
`offix.147-45-43-34.sslip.io`. Сначала посмотрите, что уже есть, и ничего чужого не
меняйте:

```bash
ls /etc/nginx/sites-enabled /etc/nginx/conf.d
grep -rn "connection_upgrade" /etc/nginx    # если map уже объявлен — уберите его из нашего файла
```

```bash
cp /opt/offix/deploy/sandbox/nginx-offix.conf /etc/nginx/sites-available/offix
ln -s /etc/nginx/sites-available/offix /etc/nginx/sites-enabled/offix
# Без sites-available: cp /opt/offix/deploy/sandbox/nginx-offix.conf /etc/nginx/conf.d/offix.conf
nginx -t && systemctl reload nginx
```

`nginx -t` проверяет все сайты сразу. Если он ругается, `reload` не выполняйте:
действующие сайты продолжат работать по старым настройкам. Удалите нашу ссылку
(`rm /etc/nginx/sites-enabled/offix`) и разберитесь с ошибкой.

Проверка снаружи:

```bash
curl -sI http://offix.147-45-43-34.sslip.io/login | head -1   # HTTP/1.1 200 OK
curl -sI http://147.45.43.34/ | head -1                        # сайт свадьбы отвечает, как и раньше
```

Ссылка для жюри: **http://offix.147-45-43-34.sslip.io**. Имя `sslip.io` само указывает на
147.45.43.34, настраивать DNS не нужно.

## Обновить

На своей машине снова `deploy/sandbox/pack.sh` и `scp`, затем на сервере:

```bash
tar -xzf /tmp/offix-sandbox.tgz -C /opt/offix      # server/.env и данные не затрагиваются
cd /opt/offix && npm ci --omit=dev -w server --no-audit --no-fund
systemctl restart offix-sandbox
```

Новые миграции базы применяются при запуске, данные песочницы сохраняются.

## Начать песочницу заново

Если гости всё перепутали и нужен чистый университет:

```bash
systemctl stop offix-sandbox
rm -rf /var/lib/offix/pgdata /var/lib/offix/uploads
systemctl start offix-sandbox      # заведёт песочницу с нуля
```

## Убрать

```bash
systemctl disable --now offix-sandbox
rm /etc/systemd/system/offix-sandbox.service /etc/nginx/sites-enabled/offix /etc/nginx/sites-available/offix
nginx -t && systemctl reload nginx
rm -rf /opt/offix /var/lib/offix && userdel offix
```
