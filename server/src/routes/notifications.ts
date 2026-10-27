import { Router } from 'express';
import { z } from 'zod';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { invalid } from '../http/errors';
import { idParam, parseBody } from '../http/validate';

/**
 * Кто прислал и что за запрос: имя автора — для строки «Ольга просит…»,
 * статус запроса заметки — чтобы кнопки «Поделиться / Отказать» не висели
 * у уже отвеченного; состояние просьбы — для «Взять в работу» и «Спасибо»
 * прямо во «Входящих».
 */
const SELECT = `n.id, n.kind, n.title, n.body, n.goal_id, n.task_id, n.read_at, n.created_at, n.data,
  n.actor_id, a.display_name AS actor_name, a.avatar_url AS actor_avatar_url,
  CASE WHEN n.kind = 'note_request' THEN (SELECT r.status FROM note_share_requests r WHERE r.id::text = n.data->>'request_id') END AS request_status,
  CASE WHEN n.kind IN ('task_request', 'task_done') THEN (
    SELECT json_build_object('kind', t.kind, 'status', t.status, 'thanked', t.thanked_at IS NOT NULL, 'mine', t.created_by = n.user_id, 'assignee', t.assignee_id = n.user_id)
      FROM tasks t WHERE t.id = n.task_id) END AS task_state`;

const listQuery = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  unread: z.enum(['1', 'true']).optional(),
});

const unreadCount = (db: Db, userId: string, companyId: string) =>
  db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND company_id = $2 AND read_at IS NULL`, [userId, companyId]).then((r) => r.rows[0]!.count);

export function notificationsRouter(db: Db): Router {
  const r = Router();

  /** Лента: новые сверху, страницами по времени (?before=ISO). */
  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const q = listQuery.safeParse(req.query);
    if (!q.success) throw invalid('Некорректный фильтр', { before: 'Время в формате ISO' });
    const { rows } = await db.query(
      `SELECT ${SELECT} FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
        WHERE n.user_id = $1 AND n.company_id = $2 AND ($3::timestamptz IS NULL OR n.created_at < $3::timestamptz) AND (NOT $5 OR n.read_at IS NULL)
        ORDER BY n.created_at DESC, n.id DESC LIMIT $4`,
      [actor.id, actor.company_id, q.data.before ?? null, q.data.limit, !!q.data.unread],
    );
    res.json({ data: rows });
  });

  r.get('/unread-count', async (req, res) => {
    const actor = actorOf(req);
    res.json({ data: { count: await unreadCount(db, actor.id, actor.company_id) } });
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

  /** Очистить ленту: прочитанные или все. */
  r.delete('/', async (req, res) => {
    const actor = actorOf(req);
    const onlyRead = req.query.read === '1';
    await db.query(`DELETE FROM notifications WHERE user_id = $1 AND company_id = $2 AND (NOT $3 OR read_at IS NOT NULL)`, [actor.id, actor.company_id, onlyRead]);
    res.status(204).end();
  });

  r.delete('/:id', async (req, res) => {
    const actor = actorOf(req);
    await db.query(`DELETE FROM notifications WHERE id = $1 AND user_id = $2 AND company_id = $3`, [idParam(req.params.id), actor.id, actor.company_id]);
    res.status(204).end();
  });

  return r;
}
