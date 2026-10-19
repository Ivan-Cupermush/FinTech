import { Router } from 'express';
import { z } from 'zod';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { parseBody } from '../http/validate';

export function notificationsRouter(db: Db): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const { rows } = await db.query(
      `SELECT id, kind, title, body, goal_id, task_id, read_at, created_at FROM notifications
        WHERE user_id = $1 AND company_id = $2 ORDER BY created_at DESC LIMIT 100`,
      [actor.id, actor.company_id],
    );
    res.json({ data: rows });
  });
  /** Отметить прочитанными: конкретные или все. */
  r.post('/read', async (req, res) => {
    const actor = actorOf(req);
    const { ids } = parseBody(z.object({ ids: z.array(z.string().uuid()).max(500).optional() }), req.body);
    await db.query(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND company_id = $2 AND read_at IS NULL AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))`,
      [actor.id, actor.company_id, ids ?? null],
    );
    res.status(204).end();
  });
  return r;
}
