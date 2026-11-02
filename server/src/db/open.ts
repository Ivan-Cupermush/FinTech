import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from './db';
import { createPgDb } from './pg';

/**
 * Встроенная база в папке вместо PostgreSQL: DATABASE_URL=pglite:/var/lib/offix/pgdata
 * (или pglite:./data/pgdata — от папки запуска). Для маленького сервера на
 * 1 ядро и 2 ГБ, где ставить PostgreSQL ради песочницы — лишнее. Один процесс,
 * запросы по очереди; данные остаются после перезапуска.
 */
export function pgliteDir(url: string): string | null {
  const m = /^pglite:(?:\/\/)?(.+)$/.exec(url.trim());
  return m ? resolve(m[1]!) : null;
}

/** Адрес базы для журнала — без пароля. */
export const safeDbUrl = (url: string) => url.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1***@');

export async function openDb(url: string): Promise<Db> {
  const dir = pgliteDir(url);
  if (!dir) return createPgDb(url);
  // Загружаем PGlite только когда он нужен: с PostgreSQL сервер его не трогает.
  mkdirSync(dir, { recursive: true });
  const { createPgliteDb } = await import('./pglite');
  return createPgliteDb(dir);
}
