import { Router } from 'express';
import { z } from 'zod';
import { GOAL_TEMPLATES, applyTemplate, canCreateGoal, findTemplate, todayIso, validateGoal, type FieldErrors } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { forbidden, invalid, notFound } from '../http/errors';
import { isUuid, parseBody } from '../http/validate';
import { audit } from '../services/audit';
import { checkOwner, checkUnits, goalCard, insertMetrics, loadGoals } from '../services/goals';
import { withIdempotency } from '../services/idempotency';
import { notify } from '../services/notify';
import { loadOrg } from '../services/org';

const applySchema = z.object({
  owner_id: z.string(),
  due_at: z.string().max(30),
  baseline: z.number().optional(),
  target: z.number().optional(),
  unit_ids: z.array(z.string()).max(20).optional(),
});

const MSG = 'Не удалось создать цель из шаблона';
/** Ошибки ядра → поля запроса. */
const FIELD: Record<string, string> = { 'metrics.0.baseline': 'baseline', 'metrics.0.target': 'target' };

/**
 * Шаблоны целей для вузов. Каталог — общий из ядра; применение одной
 * транзакцией создаёт черновик цели с KPI, подцели и задачи с зависимостями.
 * Права — как у создания цели: сотрудник без роли руководителя не может
 * поставить операционную или стратегическую цель и из шаблона.
 */
export function templatesRouter(db: Db, now: () => Date): Router {
  const r = Router();

  r.get('/', (_req, res) => {
    res.json({ data: GOAL_TEMPLATES });
  });

  r.post('/:key/apply', async (req, res) => {
    const actor = actorOf(req);
    const t = findTemplate(String(req.params.key));
    if (!t) throw notFound('Шаблон не найден');
    if (!canCreateGoal(actor, t.type)) throw forbidden('Недостаточно прав для создания цели');
    const body = parseBody(applySchema, req.body);
    const today = todayIso(now());
    const plan = applyTemplate(t, { owner_id: body.owner_id, due_at: body.due_at, today, baseline: body.baseline, target: body.target });

    const errors: FieldErrors = {};
    for (const [k, v] of Object.entries(validateGoal(plan.goal, 'active', today))) errors[FIELD[k] ?? k] = v;
    if (!isUuid(body.owner_id)) errors.owner_id = 'Нельзя назначить выбранного владельца';
    const unitIds = body.unit_ids ?? [];
    if (unitIds.some((u) => !isUuid(u))) errors.unit_ids = 'Подразделение не найдено';
    if (Object.keys(errors).length) throw invalid(MSG, errors);

    const out = await db.tx((q) =>
      withIdempotency(q, { userId: actor.id, scope: `templates.apply:${t.key}`, key: req.header('Idempotency-Key'), body }, async () => {
        await checkOwner(q, actor.company_id, body.owner_id);
        await checkUnits(q, actor.company_id, unitIds);
        const g = plan.goal;
        const at = now().toISOString();
        const insertGoal = async (title: string, description: string | null, parentId: string | null, position: number) => {
          const { rows } = await q.query<{ id: string }>(
            `INSERT INTO goals (company_id, parent_goal_id, title, description, goal_type, owner_id, created_by, status, due_at, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9) RETURNING id`,
            [actor.company_id, parentId, title, description, g.type, g.owner_id, actor.id, g.due_at, position],
          );
          return rows[0]!.id;
        };

        const goalId = await insertGoal(g.title, g.description, null, 0);
        for (const u of unitIds) await q.query(`INSERT INTO goal_org_units (goal_id, unit_id, role) VALUES ($1, $2, 'executor') ON CONFLICT DO NOTHING`, [goalId, u]);
        await insertMetrics(q, goalId, g.metrics, true);
        await audit(q, {
          company_id: actor.company_id,
          entity_type: 'goal',
          entity_id: goalId,
          goal_id: goalId,
          actor_id: actor.id,
          event_type: 'goal.created',
          new_values: { ...g, units: unitIds, template: t.key },
        });

        const subgoalIds = new Map<string, string>();
        for (const [i, s] of plan.subgoals.entries()) {
          const id = await insertGoal(s.title, null, goalId, i + 1);
          subgoalIds.set(s.key, id);
          await audit(q, { company_id: actor.company_id, entity_type: 'goal', entity_id: id, goal_id: id, actor_id: actor.id, event_type: 'goal.created', new_values: { title: s.title, parent_goal_id: goalId, template: t.key } });
          await audit(q, { company_id: actor.company_id, entity_type: 'goal', entity_id: goalId, goal_id: goalId, actor_id: actor.id, event_type: 'goal.child_added', new_values: { child_id: id, title: s.title } });
        }

        const taskIds = new Map<string, string>();
        for (const k of plan.tasks) {
          const linkTo = k.subgoal ? subgoalIds.get(k.subgoal)! : goalId;
          const { rows } = await q.query<{ id: string }>(
            `INSERT INTO tasks (company_id, title, start_at, due_at, definition_of_done, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [actor.company_id, k.title, k.start_at, k.due_at, k.definition_of_done, actor.id],
          );
          const id = rows[0]!.id;
          taskIds.set(k.key, id);
          await q.query(`INSERT INTO task_status_events (task_id, status, actor_id, at) VALUES ($1, 'todo', $2, $3)`, [id, actor.id, at]);
          await q.query(`INSERT INTO goal_tasks (goal_id, task_id, linked_by) VALUES ($1, $2, $3)`, [linkTo, id, actor.id]);
          // Зависимости шаблона указывают только на более ранние задачи — цикла быть не может.
          for (const d of k.depends_on) {
            await q.query(`INSERT INTO task_dependencies (company_id, from_task_id, to_task_id) VALUES ($1, $2, $3)`, [actor.company_id, taskIds.get(d), id]);
          }
          await audit(q, {
            company_id: actor.company_id,
            entity_type: 'task',
            entity_id: id,
            goal_id: linkTo,
            actor_id: actor.id,
            event_type: 'task.created',
            new_values: { title: k.title, start_at: k.start_at, due_at: k.due_at, depends_on: k.depends_on.map((d) => taskIds.get(d)), template: t.key },
          });
        }

        await notify(q, { company_id: actor.company_id, user_id: g.owner_id, kind: 'goal_assigned', title: `Вы владелец цели «${g.title}»`, goal_id: goalId }, actor.id);
        const [goal] = await loadGoals(q, actor.company_id, [goalId]);
        return { status: 201, body: { data: await goalCard(q, actor, goal!, await loadOrg(q, actor.company_id)) } };
      }),
    );
    res.status(out.status).json(out.body);
  });

  return r;
}
