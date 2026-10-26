import compression from 'compression';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth/auth';
import { loadUploadsConfig, type Config, type UploadsConfig } from './config';
import type { Db } from './db/db';
import { errorHandler, notFound } from './http/errors';
import type { FetchLike } from './services/integrations';
import { noRealtime, type Realtime } from './realtime/hub';
import { messagePushHook } from './services/chat-jobs';
import type { PushSender } from './services/push';
import type { ChatPushMessage } from '@offix/core';
import { createMediaStore, type MediaStore } from './services/media';
import { chatsRouter } from './routes/chats';
import { filesPublicRouter, filesRouter } from './routes/files';
import { messagesRouter } from './routes/messages';
import { authRouter } from './routes/auth';
import { discussionsRouter } from './routes/discussions';
import { goalsRouter } from './routes/goals';
import { integrationsRouter } from './routes/integrations';
import { metricsRouter } from './routes/metrics';
import { reportRouter } from './routes/report';
import { notificationsRouter } from './routes/notifications';
import { notesRouter } from './routes/notes';
import { orgRouter } from './routes/org';
import { pushRouter } from './routes/push';
import { roadmapRouter } from './routes/roadmap';
import { tasksRouter } from './routes/tasks';
import { templatesRouter } from './routes/templates';
import { usersRouter } from './routes/users';
import { accountRouter } from './routes/account';
import { contactsRouter } from './routes/contacts';
import { myNotesRouter } from './routes/my-notes';
import { qrPublicRouter } from './routes/qr';

export interface AppOptions {
  db: Db;
  config: Pick<Config, 'jwtSecret' | 'corsOrigins'> & { mail?: Pick<Config['mail'], 'enabled'>; uploads?: UploadsConfig };
  now?: () => Date;
  rateLimit?: boolean;
  /** Запросы интеграций в 1С и Moodle; в тестах и демо — поддельные системы. */
  integrationFetch?: FetchLike;
  /** События в реальном времени; без сокета — молчат. */
  realtime?: Realtime;
  /** Push о сообщениях в чатах; не задан — не шлём. */
  messagePush?: PushSender<ChatPushMessage>;
  /** Хранилище файлов; не задано — создаётся по config.uploads (или UPLOADS_DIR). */
  media?: MediaStore;
}

export function createApp({ db, config, now = () => new Date(), rateLimit, integrationFetch = fetch, realtime = noRealtime, messagePush, media }: AppOptions): Express {
  const store = media ?? createMediaStore(config.uploads ?? loadUploadsConfig(), config.jwtSecret);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // API отдаёт JSON и файлы: страниц нет, исполнять нечего. Файлы и превью
  // ставят свой заголовок (sandbox) и разрешают встраивание с сайта и из приложения.
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    // Без ffmpeg у видео нет обложки, а голосовые из браузера не перекодируются.
    res.json({ ok: true, media: { ffmpeg: await store.hasFfmpeg(), max_upload_bytes: store.maxBytes } });
  });

  const v1 = express.Router();
  // Вход по QR опрашивается часто — свой лимит, до общего лимита /auth.
  v1.use('/auth/qr', qrPublicRouter(db, config.jwtSecret, now, { rateLimit }));
  v1.use('/auth', authRouter(db, config.jwtSecret, { rateLimit }));
  // Файлы по подписанной ссылке и превью — без заголовка Authorization (<img>, <video>).
  v1.use('/files', filesPublicRouter(db, store, now));
  v1.use(requireAuth(db, config.jwtSecret));
  const mediaCtx = { store, now };
  v1.use('/files', filesRouter(db, mediaCtx, realtime));
  v1.use('/users', usersRouter(db, realtime));
  v1.use('/account', accountRouter(db, config.jwtSecret, now, realtime));
  v1.use('/contacts', contactsRouter(db, realtime));
  v1.use('/org', orgRouter(db));
  v1.use('/goals', goalsRouter(db, now));
  v1.use('/tasks', tasksRouter(db, now, mediaCtx));
  v1.use('/notifications', notificationsRouter(db));
  v1.use('/metrics', metricsRouter(db, now));
  v1.use('/report', reportRouter(db, now, { mailAvailable: !!config.mail?.enabled }));
  v1.use('/push', pushRouter(db));
  v1.use('/templates', templatesRouter(db, now));
  v1.use('/discussions', discussionsRouter(db, mediaCtx));
  v1.use('/notes', notesRouter(db));
  v1.use('/integrations', integrationsRouter(db, now, integrationFetch));
  const chatDeps = { db, now, rt: realtime, media: mediaCtx, onMessage: messagePush ? messagePushHook(db, messagePush, realtime, now) : undefined };
  v1.use('/chats', chatsRouter(chatDeps));
  v1.use('/messages', messagesRouter(chatDeps));
  v1.use('/my-notes', myNotesRouter(chatDeps));
  v1.use('/', roadmapRouter(db, now));
  app.use('/api/v1', v1);
  app.use('/api', (_req, _res, next) => next(notFound('Метод не найден')));
  app.use(errorHandler);
  return app;
}
