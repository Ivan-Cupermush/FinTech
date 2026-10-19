# offix

Система управления результатом для организаций: цель → KPI → дорожная карта → задачи. offix показывает, движется ли показатель, где теряется время и какой срок под угрозой. Сделано для FinTech Academy, трек «Эффективность 360».

Продукт, сценарии и UX-решения описаны в [docs/PRODUCT.md](docs/PRODUCT.md).

## Состав

| Папка | Что внутри |
|---|---|
| `packages/core` | Доменная логика без зависимостей: KPI и прогресс, правила целей, задачи, сроки и критический путь, риски A–D, оргструктура, права, аналитика, формы ответов API. Общая для сервера, сайта и приложения |
| `server` | API `/api/v1` на Express 5 и PostgreSQL: аудит, идемпотентность, изоляция компаний, демо-данные |
| `web` | Сайт и веб-приложение на React 19 и Vite |
| `mobile` | Приложение для iOS и Android на Expo (вне npm workspaces, ставится отдельно) |

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
cp server/.env.example server/.env    # DATABASE_URL, JWT_SECRET (от 32 символов), CORS_ORIGINS
npm run migrate -w server
npm run seed -w server                 # по желанию: демо-данные
npm run build -w server && npm start -w server
```

## Проверки

```bash
npm run typecheck && npm test          # ядро, сервер, сайт
npm run mobile:typecheck && npm run mobile:test
```

Тесты сервера идут на настоящей семантике PostgreSQL через PGlite: транзакции, ограничения, триггеры.
