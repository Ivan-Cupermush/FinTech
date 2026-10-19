import pg from 'pg';
import { TYPE_PARSERS, type Db, type Queryable } from './db';

for (const [oid, parse] of Object.entries(TYPE_PARSERS)) pg.types.setTypeParser(Number(oid), parse);

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10, options: '-c TimeZone=UTC' });
  const wrap = (c: pg.PoolClient | pg.Pool): Queryable => ({
    query: async <T>(sql: string, params?: unknown[]) => {
      const r = await c.query(sql, params as unknown[]);
      return { rows: r.rows as T[] };
    },
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
