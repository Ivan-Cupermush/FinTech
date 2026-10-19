import { Router } from 'express';
import { z } from 'zod';
import {
  BLOCKER_LABELS,
  BLOCKER_REASONS,
  canEditGoal,
  canTransitionTask,
  isValidIsoDate,
  TASK_STATUS_LABELS,
  wouldCreateCycle,
  type TaskStatus,
} from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { conflict, forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { audit, diff } from '../services/audit';
import { effectiveAccess, getVisibleGoal } from '../services/goals';
import { notify } from '../services/notify';
import { loadOrg } from '../services/org';
import { getVisibleTask, loadTasks, serializeTask, taskPermissions } from '../services/tasks';

const dateField = z.string().max(30).nullable().optional();

const createSchema = z.object({
  title: z.string().max(10_000),
  description: z.string().max(100_000).nullable().optional(),
  assignee_id: z.string().nullable().optional(),
  team_unit_id: z.string().nullable().optional(),
  unit_id: z.string().nullable().optional(),
  start_at: dateField,
  due_at: dateField,
  definition_of_done: z.string().max(100_000).nullable().optional(),
  goal_id: z.string().nullable().optional(),
  depends_on: z.array(z.string()).max(50).optional(),
  participants: z.array(z.object({ user_id: z.string(), role: z.enum(['owner', 'executor', 'approver', 'contributor']) })).max(50).optional(),
});

const patchSchema = createSchema.omit({ goal_id: true, depends_on: true, participants: true }).partial();

const MSG = 'Не удалось сохранить задачу';

function validateTaskFields(b: z.infer<typeof patchSchema>, errors: Record<string, string>) {
  if (b.title !== undefined) {
    const t = b.title.trim();
    if (!t) errors.title = 'Введите название задачи';
    else if (t.length > 200) errors.title = 'Название — не длиннее 200 символов';
  }
  if (b.description && b.description.length > 5000) errors.description = 'Описание слишком длинное';
  if (b.definition_of_done && b.definition_of_done.length > 2000) errors.definition_of_done = 'Критерий готовности — не длиннее 2000 символов';
  for (const k of ['start_at', 'due_at'] as const) {
    const v = b[k];
    if (v && !isValidIsoDate(v)) errors[k] = 'Укажите дату в формате ГГГГ-ММ-ДД';
  }
  for (const k of ['assignee_id', 'team_unit_id', 'unit_id'] as const) {
    const v = b[k];
    if (v && !isUuid(v)) errors[k] = k === 'assignee_id' ? 'Исполнитель не найден' : 'Подразделение не найдено';
  }
}

async function checkRefs(q: Queryable, companyId: string, b: { assignee_id?: string | null; team_unit_id?: string | null; unit_id?: string | null }, errors: Record<string, string>) {
  if (b.assignee_id) {
    const { rows } = await q.query(
      `SELECT 1 FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $1 WHERE u.id = $2 AND u.active AND m.role <> 'observer'`,
      [companyId, b.assignee_id],
    );
    if (!rows.length) errors.assignee_id = 'Нельзя назначить выбранного исполнителя';
  }
  for (const k of ['team_unit_id', 'unit_id'] as const) {
    const v = b[k];
    if (!v) continue;
    const { rows } = await q.query(`SELECT 1 FROM org_units WHERE id = $1 AND company_id = $2 AND status = 'active'`, [v, companyId]);
    if (!rows.length) errors[k] = 'Подразделение не найдено';
  }
}

async function addDependency(q: Queryable, actor: AuthedActor, fromId: string, toId: string) {
  await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`task-deps:${actor.company_id}`]);
  const { rows: exists } = await q.query(`SELECT 1 FROM tasks WHERE id = $1 AND company_id = $2`, [fromId, actor.company_id]);
  if (!exists.length) throw invalid(MSG, { depends_on: 'Задача, от которой зависит эта, не найдена' });
  const { rows } = await q.query<{ from: string; to: string }>(
    `SELECT from_task_id AS "from", to_task_id AS "to" FROM task_dependencies WHERE company_id = $1`,
    [actor.company_id],
  );
  if (wouldCreateCycle(rows, fromId, toId)) throw invalid(MSG, { depends_on: 'Такая зависимость создаст замкнутый круг: задачи будут ждать друг друга' });
  await q.query(`INSERT INTO task_dependencies (company_id, from_task_id, to_task_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [actor.company_id, fromId, toId]);
}

export function tasksRouter(db: Db, now: () => Date): Router {
  const r = Router();

  /** Мои задачи и задачи, которые я вижу. ?mine=1 — где я исполнитель. */
  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const org = await loadOrg(db, actor.company_id);
    const { mine, status, goal } = req.query as Record<string, string | undefined>;
    const where: string[] = ['TRUE'];
    const params: unknown[] = [];
    if (mine === '1') {
      params.push(actor.id);
      where.push(`t.assignee_id = $${params.length + 1}`);
    }
    if (status) {
      params.push(status);
      where.push(`t.status = $${params.length + 1}`);
    }
    if (goal && isUuid(goal)) {
      params.push(goal);
      where.push(`t.id IN (SELECT task_id FROM goal_tasks WHERE goal_id = $${params.length + 1})`);
    }
    const all = await loadTasks(db, actor.company_id, where.join(' AND '), params);
    const out = [];
    for (const t of all) {
      const p = await taskPermissions(db, actor, t, org);
      if (p.view) out.push(serializeTask(t, p));
    }
    res.json({ data: out });
  });

  r.post('/', async (req, res) => {
    const actor = actorOf(req);
    if (actor.role === 'observer') throw forbidden('Наблюдатель не может создавать задачи');
    const body = parseBody(createSchema, req.body);
    const errors: Record<string, string> = {};
    validateTaskFields(body, errors);
    if (body.start_at && body.due_at && isValidIsoDate(body.start_at) && isValidIsoDate(body.due_at) && body.start_at > body.due_at) {
      errors.due_at = 'Срок не может быть раньше даты начала';
    }
    if (Object.keys(errors).length) throw invalid(MSG, errors);
    const data = await db.tx(async (q) => {
      const org = await loadOrg(q, actor.company_id);
      await checkRefs(q, actor.company_id, body, errors);
      if (Object.keys(errors).length) throw invalid(MSG, errors);
      if (body.goal_id) {
        if (!isUuid(body.goal_id)) throw notFound('Цель не найдена');
        const { goal } = await getVisibleGoal(q, actor, body.goal_id, org);
        if (!canEditGoal(actor, await effectiveAccess(q, actor.company_id, goal), 'metrics', org)) throw forbidden('Недостаточно прав, чтобы добавлять задачи в эту цель');
      }
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO tasks (company_id, title, description, assignee_id, team_unit_id, unit_id, start_at, due_at, definition_of_done, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          actor.company_id,
          body.title.trim(),
          body.description?.trim() || null,
          body.assignee_id ?? null,
          body.team_unit_id ?? null,
          body.unit_id ?? null,
          body.start_at || null,
          body.due_at || null,
          body.definition_of_done?.trim() || null,
          actor.id,
        ],
      );
      const id = rows[0]!.id;
      await q.query(`INSERT INTO task_status_events (task_id, status, actor_id, at) VALUES ($1, 'todo', $2, $3)`, [id, actor.id, now().toISOString()]);
      if (body.goal_id) await q.query(`INSERT INTO goal_tasks (goal_id, task_id, linked_by) VALUES ($1, $2, $3)`, [body.goal_id, id, actor.id]);
      for (const dep of body.depends_on ?? []) {
        if (!isUuid(dep)) throw invalid(MSG, { depends_on: 'Задача, от которой зависит эта, не найдена' });
        await addDependency(q, actor, dep, id);
      }
      for (const p of body.participants ?? []) {
        if (!isUuid(p.user_id)) throw invalid(MSG, { participants: 'Участник не найден' });
        const e: Record<string, string> = {};
        await checkRefs(q, actor.company_id, { assignee_id: p.user_id }, e);
        if (e.assignee_id) throw invalid(MSG, { participants: 'Участник не найден' });
        await q.query(`INSERT INTO task_participants (task_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, p.user_id, p.role]);
      }
      await audit(q, { company_id: actor.company_id, entity_type: 'task', entity_id: id, goal_id: body.goal_id ?? null, actor_id: actor.id, event_type: 'task.created', new_values: body });
      if (body.assignee_id) await notify(q, { company_id: actor.company_id, user_id: body.assignee_id, kind: 'task_assigned', title: `Новая задача: «${body.title.trim()}»`, task_id: id, goal_id: body.goal_id ?? null }, actor.id);
      const { task, perms } = await getVisibleTask(q, actor, id, await loadOrg(q, actor.company_id));
      return serializeTask(task, perms);
    });
    res.status(201).json({ data });
  });

  r.get('/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const org = await loadOrg(db, actor.company_id);
    const { task, perms } = await getVisibleTask(db, actor, id, org);
    const history = await db.query(
      `SELECT e.status, e.blocked_reason, e.note, e.at, u.display_name AS actor_name
         FROM task_status_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.task_id = $1 ORDER BY e.at, e.id`,
      [id],
    );
    const deps = await db.query<{ id: string; title: string; status: TaskStatus; due_at: string | null; direction: string }>(
      `SELECT t.id, t.title, t.status, t.due_at, 'before' AS direction FROM task_dependencies d JOIN tasks t ON t.id = d.from_task_id WHERE d.to_task_id = $1
       UNION ALL
       SELECT t.id, t.title, t.status, t.due_at, 'after' FROM task_dependencies d JOIN tasks t ON t.id = d.to_task_id WHERE d.from_task_id = $1`,
      [id],
    );
    const participants = await db.query(
      `SELECT p.user_id, p.role, u.display_name FROM task_participants p JOIN users u ON u.id = p.user_id WHERE p.task_id = $1 ORDER BY p.role`,
      [id],
    );
    res.json({ data: { ...serializeTask(task, perms), history: history.rows, dependencies: deps.rows, participants: participants.rows } });
  });

  r.patch('/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(patchSchema, req.body);
    const data = await db.tx(async (q) => {
      const org = await loadOrg(q, actor.company_id);
      const { task, perms } = await getVisibleTask(q, actor, id, org);
      if (!perms.edit) throw forbidden('Недостаточно прав для изменения задачи');
      const errors: Record<string, string> = {};
      validateTaskFields(body, errors);
      const next = {
        title: body.title?.trim() ?? task.title,
        description: body.description === undefined ? task.description : body.description?.trim() || null,
        assignee_id: body.assignee_id === undefined ? task.assignee_id : body.assignee_id,
        team_unit_id: body.team_unit_id === undefined ? task.team_unit_id : body.team_unit_id,
        unit_id: body.unit_id === undefined ? task.unit_id : body.unit_id,
        start_at: body.start_at === undefined ? task.start_at : body.start_at || null,
        due_at: body.due_at === undefined ? task.due_at : body.due_at || null,
        definition_of_done: body.definition_of_done === undefined ? task.definition_of_done : body.definition_of_done?.trim() || null,
      };
      if (next.start_at && next.due_at && !errors.start_at && !errors.due_at && next.start_at > next.due_at) errors.due_at = 'Срок не может быть раньше даты начала';
      if (Object.keys(errors).length) throw invalid(MSG, errors);
      await checkRefs(q, actor.company_id, { assignee_id: body.assignee_id, team_unit_id: body.team_unit_id, unit_id: body.unit_id }, errors);
      if (Object.keys(errors).length) throw invalid(MSG, errors);
      const changes = diff(task as unknown as Record<string, unknown>, next);
      if (changes) {
        await q.query(
          `UPDATE tasks SET title = $2, description = $3, assignee_id = $4, team_unit_id = $5, unit_id = $6, start_at = $7, due_at = $8, definition_of_done = $9, updated_at = NOW() WHERE id = $1`,
          [id, next.title, next.description, next.assignee_id, next.team_unit_id, next.unit_id, next.start_at, next.due_at, next.definition_of_done],
        );
        await audit(q, { company_id: actor.company_id, entity_type: 'task', entity_id: id, goal_id: task.goal_ids[0] ?? null, actor_id: actor.id, event_type: 'task.updated', old_values: changes.old, new_values: changes.new });
        if (next.assignee_id && next.assignee_id !== task.assignee_id) {
          await notify(q, { company_id: actor.company_id, user_id: next.assignee_id, kind: 'task_assigned', title: `Новая задача: «${next.title}»`, task_id: id }, actor.id);
        }
      }
      const fresh = await getVisibleTask(q, actor, id, org);
      return serializeTask(fresh.task, fresh.perms);
    });
    res.json({ data });
  });

  /**
   * Смена статуса. Блокировка требует причину — руководитель видит, чем
   * помочь. Выход из блокировки очищает причину, история остаётся в событиях.
   */
  r.post('/:id/status', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(
      z.object({
        status: z.enum(['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled']),
        blocked_reason: z.string().max(20).optional(),
        blocked_note: z.string().max(500).nullable().optional(),
        next_step: z.string().max(500).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
      }),
      req.body,
    );
    const data = await db.tx(async (q) => {
      const org = await loadOrg(q, actor.company_id);
      const { task, perms } = await getVisibleTask(q, actor, id, org);
      if (!perms.status) throw forbidden('Недостаточно прав для изменения статуса');
      const from = task.status;
      const to = body.status;
      if (from === to && to !== 'blocked') throw conflict(`Задача уже в статусе «${TASK_STATUS_LABELS[to]}»`);
      if (from !== to && !canTransitionTask(from, to)) throw conflict(`Нельзя перевести задачу из «${TASK_STATUS_LABELS[from]}» в «${TASK_STATUS_LABELS[to]}»`);
      if ((to === 'cancelled' || (from === 'done' && to === 'in_progress')) && !perms.edit) throw forbidden('Отменить или вернуть задачу в работу может её автор или руководитель');
      const at = now().toISOString();
      if (to === 'blocked') {
        if (!body.blocked_reason || !(BLOCKER_REASONS as readonly string[]).includes(body.blocked_reason)) {
          throw invalid('Укажите причину блокировки', { blocked_reason: 'Выберите, что мешает: так руководитель поймёт, чем помочь' });
        }
        await q.query(
          `UPDATE tasks SET status = 'blocked', blocked_reason = $2, blocked_note = $3, next_step = $4,
                  blocked_since = CASE WHEN status = 'blocked' THEN blocked_since ELSE $5::timestamptz END, updated_at = NOW() WHERE id = $1`,
          [id, body.blocked_reason, body.blocked_note?.trim() || null, body.next_step?.trim() || null, at],
        );
      } else {
        await q.query(
          `UPDATE tasks SET status = $2::varchar, blocked_reason = NULL, blocked_note = NULL, blocked_since = NULL, next_step = NULL,
                  done_at = CASE WHEN $2::varchar = 'done' THEN $3::timestamptz ELSE NULL END, updated_at = NOW() WHERE id = $1`,
          [id, to, at],
        );
      }
      await q.query(`INSERT INTO task_status_events (task_id, status, blocked_reason, note, actor_id, at) VALUES ($1, $2, $3, $4, $5, $6)`, [
        id,
        to,
        to === 'blocked' ? body.blocked_reason : null,
        body.note?.trim() || body.blocked_note?.trim() || null,
        actor.id,
        at,
      ]);
      await audit(q, {
        company_id: actor.company_id,
        entity_type: 'task',
        entity_id: id,
        goal_id: task.goal_ids[0] ?? null,
        actor_id: actor.id,
        event_type: 'task.status_changed',
        old_values: { status: from },
        new_values: { status: to, ...(to === 'blocked' ? { blocked_reason: body.blocked_reason, blocked_note: body.blocked_note ?? null } : {}) },
      });
      if (to === 'blocked') {
        // О блокировке узнают автор задачи и владельцы связанных целей — те, кто может помочь.
        const recipients = new Set<string>([task.created_by]);
        if (task.goal_ids.length) {
          const owners = await q.query<{ owner_id: string | null }>(`SELECT owner_id FROM goals WHERE id = ANY($1::uuid[])`, [task.goal_ids]);
          owners.rows.forEach((o) => o.owner_id && recipients.add(o.owner_id));
        }
        for (const uid of recipients) {
          await notify(
            q,
            {
              company_id: actor.company_id,
              user_id: uid,
              kind: 'task_blocked',
              title: `«${task.title}» заблокирована`,
              body: `${BLOCKER_LABELS[body.blocked_reason as keyof typeof BLOCKER_LABELS]}${body.blocked_note ? `: ${body.blocked_note}` : ''}`,
              task_id: id,
              goal_id: task.goal_ids[0] ?? null,
            },
            actor.id,
          );
        }
      }
      const fresh = await getVisibleTask(q, actor, id, org);
      return serializeTask(fresh.task, fresh.perms);
    });
    res.json({ data });
  });

  r.post('/:id/dependencies', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const { depends_on } = parseBody(z.object({ depends_on: z.string() }), req.body);
    const data = await db.tx(async (q) => {
      const org = await loadOrg(q, actor.company_id);
      const { perms } = await getVisibleTask(q, actor, id, org);
      if (!perms.edit) throw forbidden('Недостаточно прав для изменения зависимостей');
      if (!isUuid(depends_on)) throw invalid(MSG, { depends_on: 'Задача, от которой зависит эта, не найдена' });
      await addDependency(q, actor, depends_on, id);
      await audit(q, { company_id: actor.company_id, entity_type: 'task', entity_id: id, actor_id: actor.id, event_type: 'task.dependency_added', new_values: { depends_on } });
      const fresh = await getVisibleTask(q, actor, id, org);
      return serializeTask(fresh.task, fresh.perms);
    });
    res.status(201).json({ data });
  });

  r.delete('/:id/dependencies/:fromId', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const fromId = idParam(req.params.fromId);
    await db.tx(async (q) => {
      const org = await loadOrg(q, actor.company_id);
      const { perms } = await getVisibleTask(q, actor, id, org);
      if (!perms.edit) throw forbidden('Недостаточно прав для изменения зависимостей');
      const del = await q.query(`DELETE FROM task_dependencies WHERE from_task_id = $1 AND to_task_id = $2 AND company_id = $3 RETURNING to_task_id`, [fromId, id, actor.company_id]);
      if (!del.rows.length) throw notFound('Зависимость не найдена');
      await audit(q, { company_id: actor.company_id, entity_type: 'task', entity_id: id, actor_id: actor.id, event_type: 'task.dependency_removed', old_values: { depends_on: fromId } });
    });
    res.status(204).end();
  });

  return r;
}
