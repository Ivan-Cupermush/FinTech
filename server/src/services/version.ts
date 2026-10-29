import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Версия запущенного кода для /health: OFFIX_VERSION, иначе файл VERSION рядом
 * со сборкой (его пишет build.mjs — короткий хеш коммита), иначе «dev».
 * По ней скрипт обновления и диагностика видят, что служба запустила новую сборку.
 */
export function buildVersion(env: NodeJS.ProcessEnv = process.env, file = fileURLToPath(new URL('./VERSION', import.meta.url))): string {
  const fromEnv = env.OFFIX_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(file, 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}
