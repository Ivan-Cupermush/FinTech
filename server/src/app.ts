import compression from 'compression';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth/auth';
import type { Config } from './config';
import type { Db } from './db/db';
import { errorHandler, notFound } from './http/errors';
import { authRouter } from './routes/auth';
import { goalsRouter } from './routes/goals';
import { metricsRouter } from './routes/metrics';
import { reportRouter } from './routes/report';
import { notificationsRouter } from './routes/notifications';
import { orgRouter } from './routes/org';
import { pushRouter } from './routes/push';
import { roadmapRouter } from './routes/roadmap';
import { tasksRouter } from './routes/tasks';
import { usersRouter } from './routes/users';

export interface AppOptions {
  db: Db;
  config: Pick<Config, 'jwtSecret' | 'corsOrigins'>;
  now?: () => Date;
  rateLimit?: boolean;
}

export function createApp({ db, config, now = () => new Date(), rateLimit }: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
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
    res.json({ ok: true });
  });

  const v1 = express.Router();
  v1.use('/auth', authRouter(db, config.jwtSecret, { rateLimit }));
  v1.use(requireAuth(db, config.jwtSecret));
  v1.use('/users', usersRouter(db));
  v1.use('/org', orgRouter(db));
  v1.use('/goals', goalsRouter(db, now));
  v1.use('/tasks', tasksRouter(db, now));
  v1.use('/notifications', notificationsRouter(db));
  v1.use('/metrics', metricsRouter(db, now));
  v1.use('/report', reportRouter(db, now));
  v1.use('/push', pushRouter(db));
  v1.use('/', roadmapRouter(db, now));
  app.use('/api/v1', v1);
  app.use('/api', (_req, _res, next) => next(notFound('Метод не найден')));
  app.use(errorHandler);
  return app;
}
