import { PGlite } from '@electric-sql/pglite';
import { TYPE_PARSERS, type Db, type Queryable } from './db';

/** Встроенный Postgres для тестов и демо без установки СУБД. */
export async function createPgliteDb(): Promise<Db> {
  const lite = new PGlite({ parsers: TYPE_PARSERS });
  await lite.exec("SET TIME ZONE 'UTC'");
  const wrap = (c: { query: PGlite['query'] }): Queryable => ({
    query: async <T>(sql: string, params?: unknown[]) => {
      const r = await c.query<T>(sql, params as unknown[]);
      return { rows: r.rows };
    },
  });
  return {
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn(wrap(t))),
    close: () => lite.close(),
  };
}
