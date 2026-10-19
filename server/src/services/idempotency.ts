import { createHash } from 'node:crypto';
import type { Queryable } from '../db/db';
import { conflict } from '../http/errors';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Повторная отправка с тем же Idempotency-Key возвращает тот же ответ, а не
 * создаёт дубликат. Ключ занимается в той же транзакции, что и создание:
 * параллельный дубль ждёт на уникальном ключе и получает сохранённый ответ.
 */
export async function withIdempotency(
  q: Queryable,
  opts: { userId: string; scope: string; key: string | undefined; body: unknown },
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (!opts.key) return run();
  const key = opts.key.slice(0, 100);
  const hash = createHash('sha256').update(JSON.stringify(opts.body ?? null)).digest('hex');
  const inserted = await q.query(
    `INSERT INTO idempotency_keys (user_id, scope, key, request_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING key`,
    [opts.userId, opts.scope, key, hash],
  );
  if (!inserted.rows.length) {
    const { rows } = await q.query<{ request_hash: string; status_code: number | null; response: unknown }>(
      `SELECT request_hash, status_code, response FROM idempotency_keys WHERE user_id = $1 AND scope = $2 AND key = $3`,
      [opts.userId, opts.scope, key],
    );
    const prev = rows[0]!;
    if (prev.request_hash !== hash) throw conflict('Этот ключ повторной отправки уже использован для другого запроса');
    if (prev.status_code === null) throw conflict('Запрос уже обрабатывается');
    return { status: prev.status_code, body: prev.response };
  }
  const res = await run();
  await q.query(`UPDATE idempotency_keys SET status_code = $4, response = $5 WHERE user_id = $1 AND scope = $2 AND key = $3`, [
    opts.userId,
    opts.scope,
    key,
    res.status,
    JSON.stringify(res.body),
  ]);
  return res;
}
