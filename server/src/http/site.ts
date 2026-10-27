import express, { type Router } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** web/dist рядом с сервером: из исходников (server/src/http) и из сборки (server/dist) — один и тот же путь. */
const DEFAULT_WEB_DIST = [new URL('../../../web/dist', import.meta.url), new URL('../../web/dist', import.meta.url)].map((u) => fileURLToPath(u));

/**
 * Где лежит собранный сайт. WEB_DIST_DIR — явный путь («off» — не отдавать);
 * без него сайт отдаётся только в продакшене и только если web/dist собран.
 * null — сервер отдаёт одно API (в разработке сайт открывают через Vite).
 */
export function resolveWebDist(env: NodeJS.ProcessEnv = process.env, candidates = DEFAULT_WEB_DIST): string | null {
  const explicit = env.WEB_DIST_DIR?.trim();
  if (explicit === 'off') return null;
  if (explicit) return resolve(explicit);
  if (env.NODE_ENV !== 'production') return null;
  return candidates.find((d) => existsSync(join(d, 'index.html'))) ?? null;
}

/**
 * Политика для страниц сайта. Скрипты только свои; стили — свои и встроенные
 * (стекло и 3D задают их на лету); картинки и видео — свои, data: и blob:
 * (карты преломления стекла, превью до отправки); запросы и сокет — на этот же адрес.
 */
export const SITE_CSP: Record<string, string[]> = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  mediaSrc: ["'self'", 'blob:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'", 'data:', 'blob:'],
  workerSrc: ["'self'", 'blob:'],
  frameSrc: ["'self'", 'blob:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

/**
 * Собранный сайт с того же сервера и порта, что и API: один адрес для прокси,
 * без CORS. Файлы с хешем в имени (assets) кэшируются на год, index.html — никогда:
 * после обновления люди сразу получают новую версию. Любой другой адрес, который
 * ждёт страницу, получает index.html — маршруты разбирает сам сайт.
 */
export function siteRouter(dir: string): Router {
  const index = join(dir, 'index.html');
  const router = express.Router();
  router.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: SITE_CSP },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  router.use('/assets', express.static(join(dir, 'assets'), { immutable: true, maxAge: '365d', index: false, redirect: false }));
  // Потерянный файл сборки — честный 404, а не страница вместо скрипта.
  router.use('/assets', (_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  router.use(express.static(dir, { index: false, maxAge: '1h', redirect: false }));
  router.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index, (err) => err && next(err));
  });
  return router;
}
