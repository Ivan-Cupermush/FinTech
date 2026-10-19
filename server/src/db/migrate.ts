import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db';

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // В исходниках — рядом (src/db/migrations), в сборке — dist/migrations.
  for (const d of [join(here, 'migrations'), join(here, '..', 'migrations')]) if (existsSync(d)) return d;
  throw new Error('Не найдена папка миграций');
}

/** Применяет SQL-миграции по порядку, каждую в своей транзакции. */
export async function migrate(db: Db, dir = migrationsDir()): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await db.tx(async (q) => {
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    });
    applied.push(f);
  }
  return applied;
}

/** Делит SQL на выражения по «;», не разрезая тела функций в $$…$$. */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inDollar = false;
  const lines = sql.split('\n').filter((l) => !l.trim().startsWith('--'));
  const text = lines.join('\n');
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('$$', i)) {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    const ch = text[i]!;
    if (ch === ';' && !inDollar) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
