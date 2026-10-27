import { Router } from 'express';
import { z } from 'zod';
import { canEditGoal, noteExcerpt, searchWords, validateNote, type Note, type NoteSummary } from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { forbidden, invalid, notFound } from '../http/errors';
import { allowedByFunction } from '../services/functions';
import { idParam, isUuid, parseBody } from '../http/validate';
import { effectiveAccess, getVisibleGoal } from '../services/goals';
import { visibleGoals } from './roadmap';

const MSG = 'Не удалось сохранить заметку';

const createSchema = z.object({ title: z.string().max(1000), body: z.string().max(100_000).default(''), goal_id: z.string().nullable().optional() });
const patchSchema = z.object({ title: z.string().max(1000).optional(), body: z.string().max(100_000).optional() });

interface NoteRow {
  id: string;
  title: string;
  body: string;
  goal_id: string | null;
  goal_title: string | null;
  created_by: string;
  author_name: string;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT n.id, n.title, n.body, n.goal_id, g.title AS goal_title, n.created_by, a.display_name AS author_name,
                       e.display_name AS updated_by_name, n.created_at, n.updated_at
                  FROM notes n
                  JOIN users a ON a.id = n.created_by
                  LEFT JOIN users e ON e.id = n.updated_by
                  LEFT JOIN goals g ON g.id = n.goal_id`;

/**
 * Править заметку может её автор, администратор, тот, кому включили «Вести
 * базу знаний», а для заметки цели — ещё и тот, кто управляет целью.
 * Наблюдатель только читает.
 */
async function canEdit(q: Queryable, actor: AuthedActor, n: Pick<NoteRow, 'created_by' | 'goal_id'>): Promise<boolean> {
  if (actor.role === 'observer') return false;
  if (n.created_by === actor.id || actor.role === 'owner' || actor.role === 'admin') return true;
  // Функция «Вести базу знаний»: руководитель включил — можно править и чужие статьи.
  if (await allowedByFunction(q, actor, 'knowledge_manage', { byRole: false })) return true;
  if (!n.goal_id) return false;
  const { goal, org } = await getVisibleGoal(q, actor, n.goal_id);
  return canEditGoal(actor, await effectiveAccess(q, actor.company_id, goal), 'description', org);
}

/** Заметка, если человек её видит: общую — все в компании, заметку цели — кто видит цель. */
async function visibleNote(q: Queryable, actor: AuthedActor, id: string): Promise<NoteRow> {
  const { rows } = await q.query<NoteRow>(`${SELECT} WHERE n.id = $1 AND n.company_id = $2`, [id, actor.company_id]);
  const n = rows[0];
  if (!n) throw notFound('Заметка не найдена');
  if (n.goal_id) {
    try {
      await getVisibleGoal(q, actor, n.goal_id);
    } catch {
      throw notFound('Заметка не найдена');
    }
  }
  return n;
}

const toNote = async (q: Queryable, actor: AuthedActor, n: NoteRow): Promise<Note> => ({
  id: n.id,
  title: n.title,
  body: n.body,
  goal_id: n.goal_id,
  goal_title: n.goal_title,
  author_id: n.created_by,
  author_name: n.author_name,
  updated_by_name: n.updated_by_name,
  created_at: n.created_at,
  updated_at: n.updated_at,
  can_edit: await canEdit(q, actor, n),
});

/**
 * Заметки и база знаний: `GET /notes?q=&goal_id=&scope=company`. Поиск — по
 * словам в заголовке и тексте, каждое слово должно найтись.
 */
export function notesRouter(db: Db): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const { q: query = '', goal_id, scope } = req.query as Record<string, string | undefined>;
    const words = searchWords(String(query));
    const { visible } = await visibleGoals(db, actor);
    const goalIds = visible.map((g) => g.row.id);
    const where: string[] = ['n.company_id = $1', '(n.goal_id IS NULL OR n.goal_id = ANY($2::uuid[]))'];
    const args: unknown[] = [actor.company_id, goalIds];
    if (goal_id) {
      if (!isUuid(goal_id) || !goalIds.includes(goal_id)) throw notFound('Цель не найдена');
      args.push(goal_id);
      where.push(`n.goal_id = $${args.length}`);
    } else if (scope === 'company') where.push('n.goal_id IS NULL');
    for (const w of words) {
      args.push(`%${w}%`);
      where.push(`(lower(n.title) LIKE $${args.length} OR lower(n.body) LIKE $${args.length})`);
    }
    const { rows } = await db.query<NoteRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY n.updated_at DESC, n.id LIMIT 200`, args);
    const data: NoteSummary[] = rows.map((n) => ({
      id: n.id,
      title: n.title,
      excerpt: noteExcerpt(n.body, words[0] ?? ''),
      goal_id: n.goal_id,
      goal_title: n.goal_title,
      author_name: n.author_name,
      updated_at: n.updated_at,
    }));
    res.json({ data });
  });

  r.get('/:id', async (req, res) => {
    const actor = actorOf(req);
    const n = await visibleNote(db, actor, idParam(req.params.id));
    res.json({ data: await toNote(db, actor, n) });
  });

  r.post('/', async (req, res) => {
    const actor = actorOf(req);
    if (actor.role === 'observer') throw forbidden('Наблюдатель не может создавать заметки');
    const body = parseBody(createSchema, req.body);
    const errors = validateNote(body);
    if (body.goal_id && !isUuid(body.goal_id)) errors.goal_id = 'Цель не найдена';
    if (Object.keys(errors).length) throw invalid(MSG, errors);
    const data = await db.tx(async (q) => {
      if (body.goal_id) await getVisibleGoal(q, actor, body.goal_id);
      const { rows } = await q.query<{ id: string }>(`INSERT INTO notes (company_id, goal_id, title, body, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
        actor.company_id,
        body.goal_id ?? null,
        body.title.trim(),
        body.body,
        actor.id,
      ]);
      return toNote(q, actor, await visibleNote(q, actor, rows[0]!.id));
    });
    res.status(201).json({ data });
  });

  r.patch('/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(patchSchema, req.body);
    const data = await db.tx(async (q) => {
      const n = await visibleNote(q, actor, id);
      if (!(await canEdit(q, actor, n))) throw forbidden('Недостаточно прав, чтобы изменить заметку');
      const next = { title: body.title ?? n.title, body: body.body ?? n.body };
      const errors = validateNote(next);
      if (Object.keys(errors).length) throw invalid(MSG, errors);
      await q.query(`UPDATE notes SET title = $2, body = $3, updated_by = $4, updated_at = NOW() WHERE id = $1`, [id, next.title.trim(), next.body, actor.id]);
      return toNote(q, actor, await visibleNote(q, actor, id));
    });
    res.json({ data });
  });

  r.delete('/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    await db.tx(async (q) => {
      const n = await visibleNote(q, actor, id);
      if (!(await canEdit(q, actor, n))) throw forbidden('Недостаточно прав, чтобы удалить заметку');
      await q.query(`DELETE FROM notes WHERE id = $1`, [id]);
    });
    res.status(204).end();
  });

  return r;
}
