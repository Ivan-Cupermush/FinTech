import { Router } from 'express';
import { z } from 'zod';
import { commentPreview, extractMentions, isDiscussionEntity, unreadCount, validateComment, type CompanyRole, type Discussion, type DiscussionComment, type DiscussionEntity } from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Queryable, Db } from '../db/db';
import { forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { getVisibleGoal } from '../services/goals';
import { notify } from '../services/notify';
import { loadOrg } from '../services/org';
import { getVisibleTask } from '../services/tasks';

interface Entity {
  type: DiscussionEntity;
  id: string;
  title: string;
  goal_id: string | null;
  task_id: string | null;
  /** Кому интересны все комментарии: владелец цели, исполнитель и автор задачи. */
  watchers: string[];
}

/** Объект обсуждения, если человек его видит. Иначе — 404, как у самих целей и задач. */
async function openEntity(q: Queryable, actor: AuthedActor, type: DiscussionEntity, id: string): Promise<Entity> {
  if (type === 'goal') {
    const { goal } = await getVisibleGoal(q, actor, id);
    return { type, id, title: goal.row.title, goal_id: id, task_id: null, watchers: goal.row.owner_id ? [goal.row.owner_id] : [] };
  }
  const { task } = await getVisibleTask(q, actor, id, await loadOrg(q, actor.company_id));
  return { type, id, title: task.title, goal_id: task.goal_ids[0] ?? null, task_id: id, watchers: [task.assignee_id, task.created_by].filter((x): x is string => !!x) };
}

/** Видит ли сотрудник объект: упомянуть того, кто не видит цель, нельзя — иначе утечёт её название. */
async function canSee(q: Queryable, companyId: string, userId: string, type: DiscussionEntity, id: string): Promise<boolean> {
  const { rows } = await q.query<{ id: string; role: CompanyRole; display_name: string }>(
    `SELECT u.id, m.role, u.display_name FROM users u JOIN company_members m ON m.user_id = u.id WHERE u.id = $1 AND m.company_id = $2 AND u.active`,
    [userId, companyId],
  );
  const row = rows[0];
  if (!row) return false;
  try {
    await openEntity(q, { ...row, company_id: companyId }, type, id);
    return true;
  } catch {
    return false;
  }
}

const SELECT = `SELECT c.id, c.parent_id, c.body, c.author_id, u.display_name AS author_name, c.mention_ids, c.created_at
                  FROM comments c JOIN users u ON u.id = c.author_id`;

async function loadComments(q: Queryable, companyId: string, type: DiscussionEntity, id: string): Promise<DiscussionComment[]> {
  const { rows } = await q.query<DiscussionComment>(`${SELECT} WHERE c.company_id = $1 AND c.entity_type = $2 AND c.entity_id = $3 ORDER BY c.created_at, c.id`, [companyId, type, id]);
  return rows.map((r) => ({ ...r, mention_ids: r.mention_ids ?? [] }));
}

async function lastRead(q: Queryable, userId: string, type: DiscussionEntity, id: string): Promise<string | null> {
  const { rows } = await q.query<{ last_read_at: string }>(`SELECT last_read_at FROM comment_reads WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3`, [userId, type, id]);
  return rows[0]?.last_read_at ?? null;
}

async function markRead(q: Queryable, actor: AuthedActor, type: DiscussionEntity, id: string, at?: string) {
  await q.query(
    `INSERT INTO comment_reads (user_id, company_id, entity_type, entity_id, last_read_at) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
     ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET last_read_at = GREATEST(comment_reads.last_read_at, EXCLUDED.last_read_at)`,
    [actor.id, actor.company_id, type, id, at ?? null],
  );
}

const params = (req: { params: Record<string, string | undefined> }): { type: DiscussionEntity; id: string } => {
  const type = req.params.type;
  if (!isDiscussionEntity(type)) throw notFound('Обсуждение не найдено');
  return { type, id: idParam(req.params.id) };
};

const postSchema = z.object({ body: z.string().max(10_000), parent_id: z.string().nullable().optional() });

/**
 * Обсуждение цели или задачи: `/discussions/goal/:id`, `/discussions/task/:id`.
 * Видит обсуждение тот, кто видит объект. Пишут все, кроме наблюдателя.
 * Упомянутые, автор комментария, на который ответили, и «хозяева» объекта
 * получают уведомление типа comment — его подхватывают «Входящие» и push.
 */
export function discussionsRouter(db: Db): Router {
  const r = Router();

  r.get('/:type/:id', async (req, res) => {
    const actor = actorOf(req);
    const { type, id } = params(req);
    await openEntity(db, actor, type, id);
    const comments = await loadComments(db, actor.company_id, type, id);
    const read = await lastRead(db, actor.id, type, id);
    const ids = [...new Set(comments.flatMap((c) => c.mention_ids))];
    const people = ids.length ? (await db.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])`, [ids])).rows : [];
    const data: Discussion = { comments, unread: unreadCount(comments, actor.id, read), last_read_at: read, can_comment: actor.role !== 'observer', people };
    res.json({ data });
  });

  r.get('/:type/:id/summary', async (req, res) => {
    const actor = actorOf(req);
    const { type, id } = params(req);
    await openEntity(db, actor, type, id);
    const comments = await loadComments(db, actor.company_id, type, id);
    res.json({ data: { total: comments.length, unread: unreadCount(comments, actor.id, await lastRead(db, actor.id, type, id)) } });
  });

  r.post('/:type/:id/read', async (req, res) => {
    const actor = actorOf(req);
    const { type, id } = params(req);
    await openEntity(db, actor, type, id);
    await markRead(db, actor, type, id);
    res.status(204).end();
  });

  r.post('/:type/:id', async (req, res) => {
    const actor = actorOf(req);
    const { type, id } = params(req);
    const body = parseBody(postSchema, req.body);
    const err = validateComment(body.body);
    if (err) throw invalid('Не удалось отправить комментарий', { body: err });
    if (body.parent_id && !isUuid(body.parent_id)) throw invalid('Не удалось отправить комментарий', { parent_id: 'Комментарий, на который вы отвечаете, не найден' });
    const text = body.body.trim();

    const data = await db.tx(async (q) => {
      const entity = await openEntity(q, actor, type, id);
      if (actor.role === 'observer') throw forbidden('Наблюдатель не может комментировать');
      let parentAuthor: string | null = null;
      if (body.parent_id) {
        const p = await q.query<{ author_id: string }>(`SELECT author_id FROM comments WHERE id = $1 AND company_id = $2 AND entity_type = $3 AND entity_id = $4`, [body.parent_id, actor.company_id, type, id]);
        if (!p.rows[0]) throw invalid('Не удалось отправить комментарий', { parent_id: 'Комментарий, на который вы отвечаете, не найден' });
        parentAuthor = p.rows[0].author_id;
      }

      const people = (
        await q.query<{ id: string; display_name: string }>(
          `SELECT u.id, u.display_name FROM users u JOIN company_members m ON m.user_id = u.id WHERE m.company_id = $1 AND u.active`,
          [actor.company_id],
        )
      ).rows;
      const mentioned: string[] = [];
      for (const uid of extractMentions(text, people)) {
        if (uid !== actor.id && (await canSee(q, actor.company_id, uid, type, id))) mentioned.push(uid);
      }

      const { rows } = await q.query<{ id: string; created_at: string }>(
        `INSERT INTO comments (company_id, entity_type, entity_id, author_id, body, parent_id, mention_ids) VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[]) RETURNING id, created_at`,
        [actor.company_id, type, id, actor.id, text, body.parent_id ?? null, mentioned],
      );
      const created = rows[0]!;

      // Каждому — одно уведомление, самое точное: упоминание, затем ответ, затем «новый комментарий».
      const preview = `${actor.display_name}: ${commentPreview(text)}`;
      const where = `«${entity.title}»`;
      const sent = new Set<string>([actor.id]);
      const send = async (userId: string, title: string) => {
        if (sent.has(userId)) return;
        sent.add(userId);
        await notify(q, { company_id: actor.company_id, user_id: userId, kind: 'comment', title, body: preview, goal_id: entity.goal_id, task_id: entity.task_id }, actor.id);
      };
      for (const uid of mentioned) await send(uid, `Вас упомянули в обсуждении ${where}`);
      if (parentAuthor) await send(parentAuthor, `Ответ на ваш комментарий: ${where}`);
      for (const uid of entity.watchers) await send(uid, `Новый комментарий: ${where}`);

      // Своё сообщение прочитано.
      await markRead(q, actor, type, id, created.created_at);
      const comment: DiscussionComment = {
        id: created.id,
        parent_id: body.parent_id ?? null,
        body: text,
        author_id: actor.id,
        author_name: actor.display_name,
        mention_ids: mentioned,
        created_at: created.created_at,
      };
      return comment;
    });
    res.status(201).json({ data });
  });

  return r;
}
