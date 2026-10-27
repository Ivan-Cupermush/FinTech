# offix

Система управления результатом для организаций: цель → KPI → дорожная карта → задачи. offix показывает, движется ли показатель, где теряется время и какой срок под угрозой. Сделано для FinTech Academy, трек «Эффективность 360».

Продукт, сценарии и UX-решения описаны в [docs/PRODUCT.md](docs/PRODUCT.md), установка на сервер и сборка приложения — в [docs/DEPLOY.md](docs/DEPLOY.md).

## Состав

| Папка | Что внутри |
|---|---|
| `packages/core` | Доменная логика без зависимостей: KPI и прогресс, правила целей, задачи, сроки и критический путь, риски A–D, оргструктура, права, аналитика, продуктовые метрики («Эффект»), импорт замеров из таблиц, шаблоны целей для вузов, обсуждения с @упоминаниями, заметки и разбор markdown, отчёт для руководства (сборка, CSV, текст), формы ответов API. Общая для сервера, сайта и приложения |
| `server` | API `/api/v1` на Express 5 и PostgreSQL: аудит, идемпотентность, изоляция компаний, демо-данные |
| `web` | Сайт и веб-приложение на React 19 и Vite |
| `mobile` | Приложение для iOS и Android на Expo (вне npm workspaces, ставится отдельно); сборка в EAS — `eas.json`, `app.config.ts` |
| `deploy` | Скрипты установки и обновления: Linux-сервер, VPS с HTTPS и туннелем из офиса, Windows-служба, резервные копии |

## Быстрый старт

Нужен Node.js 22.

```bash
npm install
npm run dev:demo      # API на :4000 с демо-университетом в памяти, без PostgreSQL
npm run dev:web       # сайт на :5173, запросы /api проксируются на :4000
```

Демо-вход: `olga@offix.demo` (руководитель офиса), `director@offix.demo`, `dima@offix.demo`, `anna@offix.demo`, `rector@offix.demo` (наблюдатель). Пароль у всех `offix-demo`, на странице входа есть кнопки «в один клик».

Приложение:

```bash
npm run mobile:install
EXPO_PUBLIC_API_URL=http://<IP-компьютера>:4000 npm run mobile:start   # открыть в Expo Go или в эмуляторе
```

Адрес сервера можно поменять и на экране входа.

## Сервер с PostgreSQL

```bash
cp server/.env.example server/.env    # DATABASE_URL, JWT_SECRET (от 32 символов)
npm run migrate -w server
npm run seed -w server                 # по желанию: демо-данные
npm run build -w web && npm run build -w server
NODE_ENV=production npm start -w server   # сайт и API на одном порту :4000, проверка — /health
```

Сервер читает `server/.env` сам. С `NODE_ENV=production` он отдаёт собранный сайт (`web/dist`) с того же порта, что и API, поэтому прокси нужен один адрес. Службы, HTTPS, обновление без простоя, откат и резервные копии — в [docs/DEPLOY.md](docs/DEPLOY.md).

### Отчёт на почту

Подписка «Присылать на почту» на странице «Отчёт» сохраняется всегда, а письма уходят, только если в `server/.env` заданы `REPORT_MAIL_ENABLED=1`, `SMTP_URL` (например `smtps://user:password@smtp.yandex.ru:465`) и `MAIL_FROM`. `APP_URL` — адрес сайта для ссылок в письме, необязательно. Сервер раз в минуту проверяет, кому пора: по понедельникам или 1-го числа в 9:00 по Москве.

### Push-уведомления

Выключены, пока в `server/.env` не задано `PUSH_ENABLED=1`. Отправка идёт через Expo Push API; если в проекте Expo включена защита push, укажите `EXPO_ACCESS_TOKEN`. Приложению нужен `projectId` EAS (переменная `EAS_PROJECT_ID` при сборке, см. [docs/DEPLOY.md](docs/DEPLOY.md#7-приложение-сборка-в-eas)) и сборка разработки или релиз: в Expo Go удалённые push на Android не работают. Без них телефон не привязывается, а уведомления по-прежнему видны во «Входящих».

### Помощник базы знаний

Работает сразу, без настройки: встроенный поиск по смыслу находит фрагменты статей и документов, а ответ собирается из цитат со ссылками. Чтобы ответы писала нейросеть, поставьте [Ollama](https://ollama.com) на свой сервер, скачайте модели (`ollama pull nomic-embed-text` и `ollama pull qwen2.5:7b`) и задайте в `server/.env` `KNOWLEDGE_AI=ollama`. Необязательно: `OLLAMA_URL` (по умолчанию `http://localhost:11434`), `OLLAMA_EMBED_MODEL`, `OLLAMA_CHAT_MODEL`, `OLLAMA_TIMEOUT_MS`. Если в PostgreSQL установлено расширение pgvector, миграция включит его сама и поиск пойдёт в базе; без него близость считает сервер. Когда Ollama недоступна, помощник отвечает цитатами и пишет об этом под ответом, а документы перечитываются нейросетью, как только она вернётся.

## Проверки

```bash
npm run typecheck && npm test          # ядро, сервер, сайт
npm run mobile:typecheck && npm run mobile:test
```

Тесты сервера идут на настоящей семантике PostgreSQL через PGlite: транзакции, ограничения, триггеры.
