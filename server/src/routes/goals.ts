import { Router } from 'express';
import { z } from 'zod';
import {
  canActivateGoal,
  canCreateGoal,
  canEditGoal,
  canReadAudit,
  canRecordObservation,
  canTransition,
  canViewGoal,
  checkUnitRange,
  GOAL_STATUS_LABELS,
  IMPORT_MAX_ROWS,
  kpiProgress,
  observationDay,
  todayIso,
  validateGoal,
  validateMetric,
  type GoalField,
  type GoalStatus,
} from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { conflict, forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { audit, diff } from '../services/audit';
import {
  checkOwner,
  checkParent,
  checkUnits,
  effectiveAccess,
  getVisibleGoal,
  goalCard,
  insertMetrics,
  loadGoals,
  loadMetrics,
  serializeMetric,
} from '../services/goals';
import { withIdempotency } from '../services/idempotency';
import { notify } from '../services/notify';
import { loadOrg } from '../services/org';

const metricSchema = z.object({
  name: z.string().max(1000),
  unit: z.string().max(30),
  baseline: z.number(),
  target: z.number(),
  direction: z.string().max(20),
  range_min: z.number().nullable().optional(),
  range_max: z.number().nullable().optional(),
});

const unitRef = z.object({ unit_id: z.string(), role: z.enum(['owner', 'executor', 'approver', 'contributor']).default('contributor') });

const createSchema = z.object({
  title: z.string().max(10_000).optional(),
  description: z.string().max(100_000).nullable().optional(),
  type: z.string().max(30).optional(),
  owner_id: z.string().nullable().optional(),
  due_at: z.string().max(30).nullable().optional(),
  status: z.enum(['draft', 'active']).default('draft'),
  parent_goal_id: z.string().nullable().optional(),
  units: z.array(unitRef).max(50).optional(),
  metrics: z.array(metricSchema).max(10).optional(),
});

const patchSchema = z.object({
  title: z.string().max(10_000).optional(),
  description: z.string().max(100_000).nullable().optional(),
  type: z.string().max(30).optional(),
  owner_id: z.string().nullable().optional(),
  due_at: z.string().max(30).nullable().optional(),
  parent_goal_id: z.string().nullable().optional(),
});

const VALIDATION_MESSAGE = 'Не удалось сохранить цель';

export function goalsRouter(db: Db, now: () => Date): Router {
  const r = Router();
  const today = () => todayIso(now());

  /** Список целей, которые видит актор, с KPI и прогрессом. */
  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const org = await loadOrg(db, actor.company_id);
    const all = await loadGoals(db, actor.company_id);
    const byId = new Map(all.map((g) => [g.row.id, g]));
    const visible = all.filter((g) => {
      let cur: typeof g | undefined = g;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.row.id)) {
        seen.add(cur.row.id);
        if (canViewGoal(actor, cur.access, org)) return true;
        cur = cur.row.parent_goal_id ? byId.get(cur.row.parent_goal_id) : undefined;
      }
      return false;
    });
    const { status, type, owner, parent, scope } = req.query as Record<string, string | undefined>;
    let list = visible;
    if (status) list = list.filter((g) => g.row.status === status);
    if (type) list = list.filter((g) => g.row.goal_type === type);
    if (owner === 'me') list = list.filter((g) => g.row.owner_id === actor.id);
    else if (owner && isUuid(owner)) list = list.filter((g) => g.row.owner_id === owner);
    if (parent === 'root' || scope === 'top') list = list.filter((g) => !g.row.parent_goal_id || !visible.some((v) => v.row.id === g.row.parent_goal_id));
    else if (parent && isUuid(parent)) list = list.filter((g) => g.row.parent_goal_id === parent);
    const metrics = await loadMetrics(
      db,
      list.map((g) => g.row.id),
    );
    const tasks = await db.query<{ goal_id: string; status: string; due_at: string | null }>(
      `SELECT gt.goal_id, t.status, t.due_at FROM goal_tasks gt JOIN tasks t ON t.id = gt.task_id WHERE gt.goal_id = ANY($1::uuid[])
       UNION ALL
       SELECT c.parent_goal_id, t.status, t.due_at FROM goals c JOIN goal_tasks gt ON gt.goal_id = c.id JOIN tasks t ON t.id = gt.task_id
        WHERE c.parent_goal_id = ANY($1::uuid[])`,
      [list.map((g) => g.row.id)],
    );
    const owners = await db.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])`, [
      list.map((g) => g.row.owner_id).filter(Boolean),
    ]);
    const ownerMap = new Map(owners.rows.map((o) => [o.id, o]));
    const t = today();
    res.json({
      data: list.map((g) => {
        const ms = metrics.filter((m) => m.goal_id === g.row.id).map(serializeMetric);
        const ts = tasks.rows.filter((x) => x.goal_id === g.row.id);
        const done = ts.filter((x) => x.status === 'done').length;
        const counted = ts.filter((x) => x.status !== 'cancelled').length;
        return {
          id: g.row.id,
          title: g.row.title,
          type: g.row.goal_type,
          status: g.row.status,
          parent_goal_id: g.row.parent_goal_id,
          owner: g.row.owner_id ? ownerMap.get(g.row.owner_id) ?? null : null,
          due_at: g.row.due_at,
          primary_metric: ms[0] ?? null,
          progress: ms[0]?.progress.raw ?? null,
          task_progress: { done, total: counted, percent: counted ? Math.round((done / counted) * 100) : null },
          blocked: ts.filter((x) => x.status === 'blocked').length,
          overdue: ts.filter((x) => x.due_at && x.due_at < t && x.status !== 'done' && x.status !== 'cancelled').length,
          updated_at: g.row.updated_at,
        };
      }),
    });
  });

  /** Создание цели с KPI одним запросом: цель, KPI и аудит — в одной транзакции. */
  r.post('/', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(createSchema, req.body);
    const type = body.type ?? '';
    if (!canCreateGoal(actor, type || 'operational')) throw forbidden('Недостаточно прав для создания цели');
    const errors = validateGoal(body, body.status === 'active' ? 'active' : 'draft', today());
    for (const k of ['owner_id', 'parent_goal_id'] as const) {
      if (body[k] && !isUuid(body[k])) errors[k] = k === 'owner_id' ? 'Нельзя назначить выбранного владельца' : 'Родительская цель не найдена';
    }
    if (Object.keys(errors).length) throw invalid(VALIDATION_MESSAGE, errors);

    const out = await db.tx((q) =>
      withIdempotency(q, { userId: actor.id, scope: 'goals.create', key: req.header('Idempotency-Key'), body }, async () => {
        const org = await loadOrg(q, actor.company_id);
        if (body.owner_id) await checkOwner(q, actor.company_id, body.owner_id);
        if (body.parent_goal_id) {
          await checkParent(q, actor.company_id, null, body.parent_goal_id);
          await getVisibleGoal(q, actor, body.parent_goal_id, org);
        }
        const unitIds = (body.units ?? []).map((u) => u.unit_id);
        if (unitIds.some((u) => !isUuid(u))) throw invalid(VALIDATION_MESSAGE, { unit_ids: 'Подразделение не найдено' });
        await checkUnits(q, actor.company_id, unitIds);
        // Сотрудник без прав руководителя создаёт личную цель только для себя.
        if (actor.role === 'member' && body.owner_id && body.owner_id !== actor.id) {
          throw forbidden('Личную цель можно создать только для себя');
        }
        const { rows } = await q.query<{ id: string }>(
          `INSERT INTO goals (company_id, parent_goal_id, title, description, goal_type, owner_id, created_by, status, due_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            actor.company_id,
            body.parent_goal_id ?? null,
            body.title!.trim(),
            body.description?.trim() || null,
            type,
            body.owner_id ?? null,
            actor.id,
            body.status,
            body.due_at || null,
          ],
        );
        const goalId = rows[0]!.id;
        for (const u of body.units ?? []) {
          await q.query(`INSERT INTO goal_org_units (goal_id, unit_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [goalId, u.unit_id, u.role]);
        }
        await insertMetrics(q, goalId, body.metrics ?? [], true);
        await audit(q, {
          company_id: actor.company_id,
          entity_type: 'goal',
          entity_id: goalId,
          goal_id: goalId,
          actor_id: actor.id,
          event_type: 'goal.created',
          new_values: { ...body, title: body.title!.trim() },
        });
        if (body.owner_id) {
          await notify(q, { company_id: actor.company_id, user_id: body.owner_id, kind: 'goal_assigned', title: `Вы владелец цели «${body.title!.trim()}»`, goal_id: goalId }, actor.id);
        }
        const [goal] = await loadGoals(q, actor.company_id, [goalId]);
        return { status: 201, body: { data: await goalCard(q, actor, goal!, await loadOrg(q, actor.company_id)) } };
      }),
    );
    res.status(out.status).json(out.body);
  });

  r.get('/:id', async (req, res) => {
    const actor = actorOf(req);
    const { goal, org } = await getVisibleGoal(db, actor, idParam(req.params.id));
    res.json({ data: await goalCard(db, actor, goal, org) });
  });

  /** Изменение полей. Права проверяются по каждому полю, в аудит — старое и новое значение. */
  r.patch('/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(patchSchema, req.body);
    const data = await db.tx(async (q) => {
      const { goal, org } = await getVisibleGoal(q, actor, id);
      const access = await effectiveAccess(q, actor.company_id, goal);
      const fields = Object.keys(body) as GoalField[];
      for (const f of fields) if (!canEditGoal(actor, access, f, org)) throw forbidden('Недостаточно прав для изменения цели');
      if (goal.row.status === 'cancelled') throw conflict('Отменённую цель нельзя изменить');
      const merged = {
        title: body.title ?? goal.row.title,
        description: body.description === undefined ? goal.row.description : body.description,
        type: body.type ?? goal.row.goal_type,
        owner_id: body.owner_id === undefined ? goal.row.owner_id : body.owner_id,
        due_at: body.due_at === undefined ? goal.row.due_at : body.due_at,
      };
      const metrics = await loadMetrics(q, [id]);
      const mode = goal.row.status === 'draft' ? 'draft' : 'active';
      const errors = validateGoal(
        { ...merged, metrics: metrics.map((m) => ({ name: m.name, unit: m.unit, baseline: m.baseline, target: m.target_value, direction: m.direction, range_min: m.range_min, range_max: m.range_max })) },
        mode,
        today(),
      );
      // Срок уже идущей цели в прошлом не ломает её редактирование, если срок не меняли.
      if (body.due_at === undefined && errors.due_at === 'Срок должен быть не раньше текущей даты') delete errors.due_at;
      if (merged.owner_id && !isUuid(merged.owner_id)) errors.owner_id = 'Нельзя назначить выбранного владельца';
      if (Object.keys(errors).length) throw invalid(VALIDATION_MESSAGE, errors);
      if (body.owner_id && body.owner_id !== goal.row.owner_id) await checkOwner(q, actor.company_id, body.owner_id);
      if (body.parent_goal_id !== undefined && body.parent_goal_id !== goal.row.parent_goal_id) {
        if (body.parent_goal_id) {
          if (!isUuid(body.parent_goal_id)) throw invalid(VALIDATION_MESSAGE, { parent_goal_id: 'Родительская цель не найдена' });
          await checkParent(q, actor.company_id, id, body.parent_goal_id);
        }
      }
      const next = {
        title: merged.title.trim(),
        description: merged.description?.trim() || null,
        goal_type: merged.type,
        owner_id: merged.owner_id ?? null,
        due_at: merged.due_at || null,
        parent_goal_id: body.parent_goal_id === undefined ? goal.row.parent_goal_id : body.parent_goal_id,
      };
      const changes = diff(goal.row as unknown as Record<string, unknown>, next);
      if (changes) {
        await q.query(
          `UPDATE goals SET title = $2, description = $3, goal_type = $4, owner_id = $5, due_at = $6, parent_goal_id = $7, updated_at = NOW() WHERE id = $1`,
          [id, next.title, next.description, next.goal_type, next.owner_id, next.due_at, next.parent_goal_id],
        );
        await audit(q, { company_id: actor.company_id, entity_type: 'goal', entity_id: id, goal_id: id, actor_id: actor.id, event_type: 'goal.updated', old_values: changes.old, new_values: changes.new });
        if (next.owner_id && next.owner_id !== goal.row.owner_id) {
          await notify(q, { company_id: actor.company_id, user_id: next.owner_id, kind: 'goal_assigned', title: `Вы владелец цели «${next.title}»`, goal_id: id }, actor.id);
        }
      }
      const [fresh] = await loadGoals(q, actor.company_id, [id]);
      return goalCard(q, actor, fresh!, org);
    });
    res.json({ data });
  });

  async function changeStatus(actorReq: Parameters<typeof actorOf>[0], id: string, to: GoalStatus) {
    const actor = actorOf(actorReq);
    return db.tx(async (q) => {
      const { goal, org } = await getVisibleGoal(q, actor, id);
      const access = await effectiveAccess(q, actor.company_id, goal);
      if (!canActivateGoal(actor, access, org)) throw forbidden('Недостаточно прав для изменения статуса цели');
      const from = goal.row.status;
      if (from === to) throw conflict(`Цель уже в статусе «${GOAL_STATUS_LABELS[to]}»`);
      if (!canTransition(from, to)) throw conflict(`Нельзя перевести цель из статуса «${GOAL_STATUS_LABELS[from]}» в «${GOAL_STATUS_LABELS[to]}»`);
      if (to === 'active') {
        const metrics = await loadMetrics(q, [id]);
        const errors = validateGoal(
          {
            title: goal.row.title,
            description: goal.row.description,
            type: goal.row.goal_type,
            owner_id: goal.row.owner_id,
            due_at: goal.row.due_at,
            metrics: metrics.map((m) => ({ name: m.name, unit: m.unit, baseline: m.baseline, target: m.target_value, direction: m.direction, range_min: m.range_min, range_max: m.range_max })),
          },
          'active',
          today(),
        );
        // Возобновление после паузы не требует переносить срок, если он ещё не прошёл (проверено выше).
        if (Object.keys(errors).length) throw invalid('Цель нельзя запустить: заполните обязательные поля', errors);
        if (goal.row.owner_id) await checkOwner(q, actor.company_id, goal.row.owner_id);
      }
      await q.query(`UPDATE goals SET status = $2, updated_at = NOW() WHERE id = $1`, [id, to]);
      await audit(q, { company_id: actor.company_id, entity_type: 'goal', entity_id: id, goal_id: id, actor_id: actor.id, event_type: 'goal.status_changed', old_values: { status: from }, new_values: { status: to } });
      if (to === 'active' && goal.row.owner_id) {
        await notify(q, { company_id: actor.company_id, user_id: goal.row.owner_id, kind: 'goal_activated', title: `Цель «${goal.row.title}» запущена`, goal_id: id }, actor.id);
      }
      const [fresh] = await loadGoals(q, actor.company_id, [id]);
      return goalCard(q, actor, fresh!, org);
    });
  }

  r.post('/:id/activate', async (req, res) => {
    res.json({ data: await changeStatus(req, idParam(req.params.id), 'active') });
  });

  r.post('/:id/status', async (req, res) => {
    const { status } = parseBody(z.object({ status: z.enum(['draft', 'active', 'on_hold', 'completed', 'cancelled']) }), req.body);
    res.json({ data: await changeStatus(req, idParam(req.params.id), status) });
  });

  /** Подцель — та же цель с родителем: наследует участников и права родителя. */
  r.post('/:id/children', async (req, res) => {
    const actor = actorOf(req);
    const parentId = idParam(req.params.id);
    const body = parseBody(createSchema.omit({ parent_goal_id: true }), req.body);
    const data = await db.tx(async (q) => {
      const { goal: parent, org } = await getVisibleGoal(q, actor, parentId);
      const access = await effectiveAccess(q, actor.company_id, parent);
      if (!canEditGoal(actor, access, 'metrics', org)) throw forbidden('Недостаточно прав для добавления подцели');
      const input = { ...body, type: body.type || parent.row.goal_type };
      const errors = validateGoal(input, 'draft', today());
      if (input.due_at && parent.row.due_at && input.due_at > parent.row.due_at) errors.due_at = 'Срок подцели не может быть позже срока цели';
      if (body.owner_id && !isUuid(body.owner_id)) errors.owner_id = 'Нельзя назначить выбранного владельца';
      if (Object.keys(errors).length) throw invalid(VALIDATION_MESSAGE, errors);
      if (body.owner_id) await checkOwner(q, actor.company_id, body.owner_id);
      const unitIds = (body.units ?? []).map((u) => u.unit_id);
      if (unitIds.some((u) => !isUuid(u))) throw invalid(VALIDATION_MESSAGE, { unit_ids: 'Подразделение не найдено' });
      await checkUnits(q, actor.company_id, unitIds);
      const pos = await q.query<{ n: number }>(`SELECT COALESCE(MAX(position), 0)::int + 1 AS n FROM goals WHERE parent_goal_id = $1`, [parentId]);
      // Подцель живёт вместе с целью: в работе, если цель в работе и у подцели есть владелец и срок.
      const status = parent.row.status === 'active' && body.owner_id && body.due_at ? 'active' : 'draft';
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO goals (company_id, parent_goal_id, title, description, goal_type, owner_id, created_by, status, due_at, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [actor.company_id, parentId, input.title!.trim(), input.description?.trim() || null, input.type, body.owner_id ?? null, actor.id, status, body.due_at || null, pos.rows[0]!.n],
      );
      const id = rows[0]!.id;
      for (const u of body.units ?? []) await q.query(`INSERT INTO goal_org_units (goal_id, unit_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, u.unit_id, u.role]);
      await insertMetrics(q, id, body.metrics ?? [], true);
      await audit(q, { company_id: actor.company_id, entity_type: 'goal', entity_id: id, goal_id: id, actor_id: actor.id, event_type: 'goal.created', new_values: { ...input, parent_goal_id: parentId } });
      await audit(q, { company_id: actor.company_id, entity_type: 'goal', entity_id: parentId, goal_id: parentId, actor_id: actor.id, event_type: 'goal.child_added', new_values: { child_id: id, title: input.title!.trim() } });
      const [fresh] = await loadGoals(q, actor.company_id, [id]);
      return goalCard(q, actor, fresh!, org);
    });
    res.status(201).json({ data });
  });

  /** KPI: добавить показатель. */
  r.post('/:id/metrics', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(metricSchema, req.body);
    const data = await db.tx(async (q) => {
      const { goal, org } = await getVisibleGoal(q, actor, id);
      if (!canEditGoal(actor, await effectiveAccess(q, actor.company_id, goal), 'metrics', org)) throw forbidden('Недостаточно прав для изменения KPI');
      const errors = validateMetric(body);
      if (Object.keys(errors).length) throw invalid('Не удалось сохранить KPI', errors);
      const existing = await loadMetrics(q, [id]);
      const [mid] = await insertMetrics(q, id, [body], existing.length === 0);
      await audit(q, { company_id: actor.company_id, entity_type: 'metric', entity_id: mid!, goal_id: id, actor_id: actor.id, event_type: 'metric.created', new_values: body });
      const [m] = (await loadMetrics(q, [id])).filter((x) => x.id === mid);
      return serializeMetric(m!);
    });
    res.status(201).json({ data });
  });

  r.patch('/:id/metrics/:mid', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const mid = idParam(req.params.mid);
    const body = parseBody(metricSchema.partial(), req.body);
    const data = await db.tx(async (q) => {
      const { goal, org } = await getVisibleGoal(q, actor, id);
      if (!canEditGoal(actor, await effectiveAccess(q, actor.company_id, goal), 'metrics', org)) throw forbidden('Недостаточно прав для изменения KPI');
      const [m] = (await loadMetrics(q, [id])).filter((x) => x.id === mid);
      if (!m) throw notFound('KPI не найден');
      const before: Record<string, unknown> & { name: string } = { name: m.name, unit: m.unit, baseline: m.baseline, target: m.target_value, direction: m.direction, range_min: m.range_min, range_max: m.range_max };
      const next = { ...before, ...body } as { name: string; unit: string; baseline: number; target: number; direction: string; range_min?: number | null; range_max?: number | null };
      const errors = validateMetric(next);
      if (Object.keys(errors).length) throw invalid('Не удалось сохранить KPI', errors);
      await q.query(
        `UPDATE goal_metrics SET name = $2, unit = $3, baseline = $4, target_value = $5, direction = $6, range_min = $7, range_max = $8, updated_at = NOW() WHERE id = $1`,
        [mid, next.name.trim(), next.unit, next.baseline, next.target, next.direction, next.range_min ?? null, next.range_max ?? null],
      );
      const changes = diff(before, next);
      if (changes) await audit(q, { company_id: actor.company_id, entity_type: 'metric', entity_id: mid, goal_id: id, actor_id: actor.id, event_type: 'metric.updated', old_values: changes.old, new_values: changes.new });
      const [fresh] = (await loadMetrics(q, [id])).filter((x) => x.id === mid);
      return serializeMetric(fresh!);
    });
    res.json({ data });
  });

  /** Факт: новое измерение KPI. Исходное и целевое значения при этом не меняются. */
  r.post('/:id/metrics/:mid/observations', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const mid = idParam(req.params.mid);
    const body = parseBody(z.object({ value: z.number(), observed_at: z.string().max(40).optional(), note: z.string().max(1000).nullable().optional() }), req.body);
    const data = await db.tx(async (q) => {
      const { goal, org } = await getVisibleGoal(q, actor, id);
      if (!canRecordObservation(actor, await effectiveAccess(q, actor.company_id, goal), org)) throw forbidden('Недостаточно прав для внесения измерений');
      if (goal.row.status === 'cancelled') throw conflict('В отменённую цель нельзя вносить измерения');
      const [m] = (await loadMetrics(q, [id])).filter((x) => x.id === mid);
      if (!m) throw notFound('KPI не найден');
      const errors: Record<string, string> = {};
      if (!Number.isFinite(body.value)) errors.value = 'Укажите числовое значение';
      else {
        const e = checkUnitRange(m.unit, body.value);
        if (e) errors.value = e;
      }
      let observedAt = now().toISOString();
      if (body.observed_at) {
        const t = Date.parse(body.observed_at);
        if (Number.isNaN(t)) errors.observed_at = 'Некорректная дата измерения';
        else if (t > now().getTime() + 60_000) errors.observed_at = 'Измерение не может быть из будущего';
        else observedAt = new Date(t).toISOString();
      }
      if (Object.keys(errors).length) throw invalid('Не удалось сохранить измерение', errors);
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO goal_metric_observations (metric_id, value, observed_at, recorded_by, note) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mid, body.value, observedAt, actor.id, body.note?.trim() || null],
      );
      await audit(q, { company_id: actor.company_id, entity_type: 'metric', entity_id: mid, goal_id: id, actor_id: actor.id, event_type: 'metric.observed', new_values: { value: body.value, observed_at: observedAt } });
      const before = kpiProgress({ baseline: m.baseline, target: m.target_value, direction: m.direction, range_min: m.range_min, range_max: m.range_max }, m.current_value);
      const [fresh] = (await loadMetrics(q, [id])).filter((x) => x.id === mid);
      const after = serializeMetric(fresh!);
      if (after.progress.state === 'achieved' && before.state !== 'achieved' && goal.row.owner_id) {
        await notify(q, { company_id: actor.company_id, user_id: goal.row.owner_id, kind: 'kpi_achieved', title: `KPI «${m.name}» достиг цели`, goal_id: id }, actor.id);
      }
      return { observation_id: rows[0]!.id, metric: after };
    });
    res.status(201).json({ data });
  });

  /**
   * Импорт замеров из таблицы. За один день у KPI — один замер: строки за дни,
   * где замер уже есть, пропускаются, поэтому повторный импорт файла ничего
   * не задваивает. Всё в одной транзакции: либо добавлены все строки, либо ни одной.
   */
  r.post('/:id/metrics/:mid/observations/import', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const mid = idParam(req.params.mid);
    const body = parseBody(
      z.object({
        rows: z.array(z.object({ observed_at: z.string().max(40), value: z.number() })).min(1).max(IMPORT_MAX_ROWS),
        note: z.string().max(1000).nullable().optional(),
      }),
      req.body,
    );
    const out = await db.tx((q) =>
      withIdempotency(q, { userId: actor.id, scope: 'metrics.import', key: req.header('Idempotency-Key'), body: { id, mid, ...body } }, async () => {
        const { goal, org } = await getVisibleGoal(q, actor, id);
        if (!canRecordObservation(actor, await effectiveAccess(q, actor.company_id, goal), org)) throw forbidden('Недостаточно прав для внесения измерений');
        if (goal.row.status === 'cancelled') throw conflict('В отменённую цель нельзя вносить измерения');
        const [m] = (await loadMetrics(q, [id])).filter((x) => x.id === mid);
        if (!m) throw notFound('KPI не найден');

        const errors: Record<string, string> = {};
        const rows: { at: string; day: string; value: number }[] = [];
        body.rows.forEach((row, i) => {
          const label = `Строка ${i + 1}`;
          const t = Date.parse(row.observed_at);
          if (!Number.isFinite(row.value)) errors[`rows.${i}.value`] = `${label}: укажите числовое значение`;
          else {
            const e = checkUnitRange(m.unit, row.value);
            if (e) errors[`rows.${i}.value`] = `${label}: ${e}`;
          }
          if (Number.isNaN(t)) errors[`rows.${i}.observed_at`] = `${label}: некорректная дата измерения`;
          else if (t > now().getTime() + 60_000) errors[`rows.${i}.observed_at`] = `${label}: измерение не может быть из будущего`;
          else {
            const at = new Date(t).toISOString();
            rows.push({ at, day: observationDay(at), value: row.value });
          }
        });
        if (Object.keys(errors).length) throw invalid(`Не удалось импортировать замеры: ${Object.values(errors)[0]}`, errors);

        // Блокируем KPI, чтобы параллельный импорт не добавил тот же день дважды.
        await q.query(`SELECT id FROM goal_metrics WHERE id = $1 FOR UPDATE`, [mid]);
        const existing = await q.query<{ observed_at: Date | string }>(`SELECT observed_at FROM goal_metric_observations WHERE metric_id = $1`, [mid]);
        const days = new Set(existing.rows.map((r) => observationDay(new Date(r.observed_at))));
        const fresh = rows.filter((r) => (days.has(r.day) ? false : (days.add(r.day), true)));
        const note = body.note?.trim() || null;
        for (const r of fresh) {
          await q.query(
            `INSERT INTO goal_metric_observations (metric_id, value, observed_at, source, recorded_by, note) VALUES ($1, $2, $3, 'import', $4, $5)`,
            [mid, r.value, r.at, actor.id, note],
          );
        }
        const skipped = body.rows.length - fresh.length;
        const before = kpiProgress({ baseline: m.baseline, target: m.target_value, direction: m.direction, range_min: m.range_min, range_max: m.range_max }, m.current_value);
        const [reloaded] = (await loadMetrics(q, [id])).filter((x) => x.id === mid);
        const metric = serializeMetric(reloaded!);
        if (fresh.length) {
          const sorted = fresh.map((r) => r.day).sort();
          await audit(q, {
            company_id: actor.company_id,
            entity_type: 'metric',
            entity_id: mid,
            goal_id: id,
            actor_id: actor.id,
            event_type: 'metric.imported',
            new_values: { count: fresh.length, skipped, from: sorted[0], to: sorted.at(-1) },
          });
          if (metric.progress.state === 'achieved' && before.state !== 'achieved' && goal.row.owner_id) {
            await notify(q, { company_id: actor.company_id, user_id: goal.row.owner_id, kind: 'kpi_achieved', title: `KPI «${m.name}» достиг цели`, goal_id: id }, actor.id);
          }
        }
        return { status: fresh.length ? 201 : 200, body: { data: { imported: fresh.length, skipped, metric } } };
      }),
    );
    res.status(out.status).json(out.body);
  });

  r.get('/:id/metrics/:mid/observations', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const mid = idParam(req.params.mid);
    await getVisibleGoal(db, actor, id);
    const { rows } = await db.query(
      `SELECT o.id, o.value, o.observed_at, o.source, o.note, u.display_name AS recorded_by
         FROM goal_metric_observations o JOIN goal_metrics m ON m.id = o.metric_id
         LEFT JOIN users u ON u.id = o.recorded_by
        WHERE m.id = $1 AND m.goal_id = $2 ORDER BY o.observed_at`,
      [mid, id],
    );
    res.json({ data: rows });
  });

  /** Подразделения цели. */
  r.put('/:id/units', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(z.object({ units: z.array(unitRef).max(50) }), req.body);
    const data = await db.tx(async (q) => {
      const { goal, org } = await getVisibleGoal(q, actor, id);
      if (!canEditGoal(actor, await effectiveAccess(q, actor.company_id, goal), 'metrics', org)) throw forbidden('Недостаточно прав для изменения участников цели');
      const ids = body.units.map((u) => u.unit_id);
      if (ids.some((u) => !isUuid(u))) throw invalid(VALIDATION_MESSAGE, { unit_ids: 'Подразделение не найдено' });
      await checkUnits(q, actor.company_id, ids);
      const before = await q.query<{ unit_id: string; role: string }>(`SELECT unit_id, role FROM goal_org_units WHERE goal_id = $1 ORDER BY unit_id`, [id]);
      await q.query(`DELETE FROM goal_org_units WHERE goal_id = $1`, [id]);
      for (const u of body.units) await q.query(`INSERT INTO goal_org_units (goal_id, unit_id, role) VALUES ($1, $2, $3) ON CONFLICT (goal_id, unit_id) DO UPDATE SET role = EXCLUDED.role`, [id, u.unit_id, u.role]);
      await audit(q, { company_id: actor.company_id, entity_type: 'goal', entity_id: id, goal_id: id, actor_id: actor.id, event_type: 'goal.units_changed', old_values: before.rows, new_values: body.units });
      const [fresh] = await loadGoals(q, actor.company_id, [id]);
      return goalCard(q, actor, fresh!, await loadOrg(q, actor.company_id));
    });
    res.json({ data });
  });

  /** Привязать существующую задачу — без копирования. */
  r.post('/:id/tasks', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const { task_id } = parseBody(z.object({ task_id: z.string() }), req.body);
    await db.tx(async (q) => {
      const { goal, org } = await getVisibleGoal(q, actor, id);
      if (!canEditGoal(actor, await effectiveAccess(q, actor.company_id, goal), 'metrics', org)) throw forbidden('Недостаточно прав для привязки задач');
      if (!isUuid(task_id)) throw notFound('Задача не найдена');
      const t = await q.query(`SELECT id FROM tasks WHERE id = $1 AND company_id = $2`, [task_id, actor.company_id]);
      if (!t.rows.length) throw notFound('Задача не найдена');
      const ins = await q.query(`INSERT INTO goal_tasks (goal_id, task_id, linked_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING task_id`, [id, task_id, actor.id]);
      if (ins.rows.length) await audit(q, { company_id: actor.company_id, entity_type: 'goal', entity_id: id, goal_id: id, actor_id: actor.id, event_type: 'goal.task_linked', new_values: { task_id } });
    });
    res.status(204).end();
  });

  r.delete('/:id/tasks/:taskId', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const taskId = idParam(req.params.taskId);
    await db.tx(async (q) => {
      const { goal, org } = await getVisibleGoal(q, actor, id);
      if (!canEditGoal(actor, await effectiveAccess(q, actor.company_id, goal), 'metrics', org)) throw forbidden('Недостаточно прав для изменения задач цели');
      const del = await q.query(`DELETE FROM goal_tasks WHERE goal_id = $1 AND task_id = $2 RETURNING task_id`, [id, taskId]);
      if (!del.rows.length) throw notFound('Задача не привязана к цели');
      await audit(q, { company_id: actor.company_id, entity_type: 'goal', entity_id: id, goal_id: id, actor_id: actor.id, event_type: 'goal.task_unlinked', old_values: { task_id: taskId } });
    });
    res.status(204).end();
  });

  r.get('/:id/audit', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const { goal, org } = await getVisibleGoal(db, actor, id);
    if (!canReadAudit(actor, await effectiveAccess(db, actor.company_id, goal), org)) throw forbidden('Недостаточно прав для просмотра истории');
    const { rows } = await db.query(
      `SELECT a.id, a.event_type, a.entity_type, a.entity_id, a.old_values, a.new_values, a.created_at,
              u.display_name AS actor_name
         FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.goal_id = $1 AND a.company_id = $2 ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
      [id, actor.company_id],
    );
    res.json({ data: rows });
  });

  r.get('/:id/comments', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    await getVisibleGoal(db, actor, id);
    const { rows } = await db.query(
      `SELECT c.id, c.body, c.created_at, u.id AS author_id, u.display_name AS author_name
         FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.entity_type = 'goal' AND c.entity_id = $1 AND c.company_id = $2 ORDER BY c.created_at`,
      [id, actor.company_id],
    );
    res.json({ data: rows });
  });

  r.post('/:id/comments', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const { body } = parseBody(z.object({ body: z.string().max(4000) }), req.body);
    if (!body.trim()) throw invalid('Не удалось отправить комментарий', { body: 'Напишите комментарий' });
    if (actor.role === 'observer') throw forbidden('Наблюдатель не может комментировать');
    const data = await db.tx(async (q) => {
      const { goal } = await getVisibleGoal(q, actor, id);
      const { rows } = await q.query<{ id: string; created_at: string }>(
        `INSERT INTO comments (company_id, entity_type, entity_id, author_id, body) VALUES ($1, 'goal', $2, $3, $4) RETURNING id, created_at`,
        [actor.company_id, id, actor.id, body.trim()],
      );
      if (goal.row.owner_id) await notify(q, { company_id: actor.company_id, user_id: goal.row.owner_id, kind: 'comment', title: `Новый комментарий к цели «${goal.row.title}»`, body: `${actor.display_name}: ${body.trim().slice(0, 180)}`, goal_id: id }, actor.id);
      return { id: rows[0]!.id, body: body.trim(), created_at: rows[0]!.created_at, author_id: actor.id, author_name: actor.display_name };
    });
    res.status(201).json({ data });
  });

  return r;
}
