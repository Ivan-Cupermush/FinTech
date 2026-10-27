import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { QrPollResult } from '@offix/core';
import { issueToken } from '../auth/auth';
import type { Db } from '../db/db';
import { notFound } from '../http/errors';
import { parseBody } from '../http/validate';
import { audit } from '../services/audit';
import { createQrLogin, findQr, isExpired, sameHash, sha256 } from '../services/qr';

const limiter = (limit: number): RequestHandler =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Слишком много запросов. Подождите минуту' } }),
  });

const pollSchema = z.object({ token: z.string().max(100), secret: z.string().min(20).max(100) });

/**
 * Публичная часть входа по QR: `/auth/qr` (новый код) и `/auth/qr/poll`
 * (сайт ждёт подтверждения). Свои лимиты: сайт опрашивает статус раз в
 * полторы секунды, общий лимит входа для этого слишком строгий.
 */
export function qrPublicRouter(db: Db, secret: string, now: () => Date, opts: { rateLimit?: boolean } = {}): Router {
  const r = Router();
  const on = opts.rateLimit !== false;

  r.post('/', ...(on ? [limiter(30)] : []), async (req, res) => {
    const data = await createQrLogin(db, now(), { userAgent: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? null });
    res.status(201).json({ data });
  });

  r.post('/poll', ...(on ? [limiter(120)] : []), async (req, res) => {
    const body = parseBody(pollSchema, req.body);
    const at = now();
    const row = await findQr(db, body.token);
    // Чужой secret — как будто кода нет: не подтверждаем, что код существует.
    if (!row || !sameHash(row.secret_hash, sha256(body.secret))) throw notFound('Код не найден');
    let out: QrPollResult;
    if (row.status === 'declined') out = { status: 'declined' };
    else if (row.status === 'used') out = { status: 'expired' };
    else if (row.status === 'approved') {
      // Забрать вход можно ровно один раз и только пока код жив.
      const claimed = await db.tx(async (q) => {
        const c = await q.query<{ id: string }>(`UPDATE qr_logins SET status = 'used' WHERE id = $1 AND status = 'approved' AND expires_at > $2 RETURNING id`, [row.id, at.toISOString()]);
        if (!c.rows.length) return null;
        const { rows } = await q.query<{ id: string; display_name: string; role: string; company_id: string; company_name: string }>(
          `SELECT u.id, u.display_name, m.role, c.id AS company_id, c.name AS company_name
             FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $2 JOIN companies c ON c.id = m.company_id
            WHERE u.id = $1 AND u.active`,
          [row.user_id, row.company_id],
        );
        const u = rows[0];
        if (!u) return null;
        await q.query(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [u.id, at.toISOString()]);
        await audit(q, { company_id: u.company_id, entity_type: 'member', entity_id: u.id, actor_id: u.id, event_type: 'login.qr', new_values: { ip: row.ip } });
        return { token: await issueToken(q, secret, u.id, u.company_id), u };
      });
      out = claimed
        ? { status: 'approved', token: claimed.token, user: { id: claimed.u.id, display_name: claimed.u.display_name, role: claimed.u.role }, company: { id: claimed.u.company_id, name: claimed.u.company_name } }
        : { status: 'expired' };
    } else if (isExpired(row, at)) out = { status: 'expired' };
    else if (row.status === 'scanned' && row.user_id) {
      const name = (await db.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [row.user_id])).rows[0]?.display_name ?? '';
      out = { status: 'scanned', user: { display_name: name } };
    } else out = { status: 'pending' };
    res.json({ data: out });
  });

  return r;
}
