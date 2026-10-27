import {
  activationChecklist,
  canActivateGoal,
  canBeGoalOwner,
  canEditGoal,
  canReadAudit,
  canRecordObservation,
  canViewGoal,
  kpiProgress,
  plannedChange,
  taskProgress,
  type CompanyRole,
  type Direction,
  type GoalAccessView,
  type GoalStatus,
  type GoalType,
  type OrgContext,
  type TaskStatus,
  type UnitId,
} from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import { inOrder, type Queryable } from '../db/db';
import { invalid, notFound } from '../http/errors';
import { allowedByFunction } from './functions';
import { loadOrg } from './org';

export interface GoalRow {
  id: string;
  company_id: string;
  parent_goal_id: string | null;
  title: string;
  description: string | null;
  goal_type: GoalType;
  owner_id: string | null;
  created_by: string;
  status: GoalStatus;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetricRow {
  id: string;
  goal_id: string;
  name: string;
  unit: UnitId;
  baseline: number;
  target_value: number;
  direction: Direction;
  range_min: number | null;
  range_max: number | null;
  is_primary: boolean;
  current_value: number | null;
  last_observed_at: string | null;
}

export interface LoadedGoal {
  row: GoalRow;
  access: GoalAccessView;
}

const GOAL_COLS = `g.id, g.company_id, g.parent_goal_id, g.title, g.description, g.goal_type, g.owner_id, g.created_by,
  g.status, g.due_at, g.created_at, g.updated_at`;

/** Цели компании с данными для проверки прав. Чужие компании не видны вовсе. */
export async function loadGoals(q: Queryable, companyId: string, ids?: string[]): Promise<LoadedGoal[]> {
  const params: unknown[] = [companyId];
  let where = 'g.company_id = $1';
  if (ids) {
    params.push(ids);
    where += ` AND g.id = ANY($2::uuid[])`;
  }
  const { rows } = await q.query<GoalRow & { unit_ids: string[] | null; participant_ids: string[] | null }>(
    `SELECT ${GOAL_COLS},
            (SELECT array_agg(unit_id) FROM goal_org_units u WHERE u.goal_id = g.id) AS unit_ids,
            (SELECT array_agg(user_id) FROM goal_participants p WHERE p.goal_id = g.id) AS participant_ids
       FROM goals g WHERE ${where}
      ORDER BY g.position, g.created_at`,
    params,
  );
  return rows.map(({ unit_ids, participant_ids, ...row }) => ({
    row,
    access: {
      id: row.id,
      type: row.goal_type,
      owner_id: row.owner_id,
      created_by: row.created_by,
      unit_ids: unit_ids ?? [],
      participant_ids: participant_ids ?? [],
    },
  }));
}

/**
 * Цель, доступная актору. Недоступная и несуществующая — одинаково 404:
 * знание UUID не даёт доступа и не подтверждает, что цель существует.
 * Подцель видна тому, кто видит родительскую цель.
 */
export async function getVisibleGoal(q: Queryable, actor: AuthedActor, goalId: string, org?: OrgContext) {
  const ctx = org ?? (await loadOrg(q, actor.company_id));
  const [goal] = await loadGoals(q, actor.company_id, [goalId]);
  if (!goal) throw notFound('Цель не найдена');
  if (!(await isVisible(q, actor, goal, ctx))) throw notFound('Цель не найдена');
  return { goal, org: ctx };
}

/** Вносить факт KPI: владелец цели — всегда, остальные — по роли или с функцией «Вносить измерения KPI». */
export async function canRecordKpi(q: Queryable, actor: AuthedActor, goal: LoadedGoal, org: OrgContext): Promise<boolean> {
  const access = await effectiveAccess(q, actor.company_id, goal);
  if (actor.role !== 'observer' && access.owner_id === actor.id) return true;
  return allowedByFunction(q, actor, 'kpi_record', { byRole: canRecordObservation(actor, access, org), unitIds: access.unit_ids, org });
}

async function isVisible(q: Queryable, actor: AuthedActor, goal: LoadedGoal, org: OrgContext): Promise<boolean> {
  if (canViewGoal(actor, goal.access, org)) return true;
  if (!goal.row.parent_goal_id) return false;
  const [parent] = await loadGoals(q, actor.company_id, [goal.row.parent_goal_id]);
  return !!parent && (await isVisible(q, actor, parent, org));
}

/** Подцель наследует подразделения и участников родительских целей. */
export async function effectiveAccess(q: Queryable, companyId: string, goal: LoadedGoal): Promise<GoalAccessView> {
  let cur = goal;
  const unitIds = new Set(goal.access.unit_ids);
  const participants = new Set(goal.access.participant_ids);
  const seen = new Set<string>();
  while (cur.row.parent_goal_id && !seen.has(cur.row.parent_goal_id)) {
    seen.add(cur.row.parent_goal_id);
    const [parent] = await loadGoals(q, companyId, [cur.row.parent_goal_id]);
    if (!parent) break;
    parent.access.unit_ids.forEach((u) => unitIds.add(u));
    parent.access.participant_ids.forEach((u) => participants.add(u));
    cur = parent;
  }
  return { ...goal.access, unit_ids: [...unitIds], participant_ids: [...participants] };
}

export async function loadMetrics(q: Queryable, goalIds: string[]): Promise<MetricRow[]> {
  if (!goalIds.length) return [];
  const { rows } = await q.query<MetricRow>(
    `SELECT m.id, m.goal_id, m.name, m.unit, m.baseline, m.target_value, m.direction, m.range_min, m.range_max, m.is_primary,
            o.value AS current_value, o.observed_at AS last_observed_at
       FROM goal_metrics m
       LEFT JOIN LATERAL (
         SELECT value, observed_at FROM goal_metric_observations WHERE metric_id = m.id ORDER BY observed_at DESC, created_at DESC LIMIT 1
       ) o ON TRUE
      WHERE m.goal_id = ANY($1::uuid[])
      ORDER BY m.is_primary DESC, m.created_at`,
    [goalIds],
  );
  return rows;
}

export function serializeMetric(m: MetricRow) {
  const p = kpiProgress({ baseline: m.baseline, target: m.target_value, direction: m.direction, range_min: m.range_min, range_max: m.range_max }, m.current_value);
  return {
    id: m.id,
    name: m.name,
    unit: m.unit,
    baseline: m.baseline,
    target: m.target_value,
    direction: m.direction,
    range_min: m.range_min,
    range_max: m.range_max,
    is_primary: m.is_primary,
    current_value: m.current_value,
    last_observed_at: m.last_observed_at,
    planned_change: plannedChange(m.baseline, m.target_value),
    progress: p,
  };
}

interface UserBrief {
  id: string;
  display_name: string;
  position: string | null;
}

export async function usersById(q: Queryable, ids: (string | null)[]): Promise<Map<string, UserBrief>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const { rows } = await q.query<UserBrief>(`SELECT id, display_name, position FROM users WHERE id = ANY($1::uuid[])`, [list]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** Карточка цели: KPI с фактом, прогресс без подмены, участники, права. */
export async function goalCard(q: Queryable, actor: AuthedActor, goal: LoadedGoal, org: OrgContext) {
  const access = await effectiveAccess(q, actor.company_id, goal);
  const [metrics, users, units, tasks, children] = await inOrder(
    () => loadMetrics(q, [goal.row.id]),
    () => usersById(q, [goal.row.owner_id, goal.row.created_by]),
    () => q.query<{ id: string; name: string; unit_type: string; role: string }>(
      `SELECT u.id, u.name, u.unit_type, gu.role FROM goal_org_units gu JOIN org_units u ON u.id = gu.unit_id WHERE gu.goal_id = $1 ORDER BY u.name`,
      [goal.row.id],
    ),
    () => q.query<{ status: TaskStatus }>(
      `SELECT t.status FROM tasks t WHERE t.id IN (
         SELECT task_id FROM goal_tasks WHERE goal_id = $1
         UNION SELECT gt.task_id FROM goal_tasks gt JOIN goals c ON c.id = gt.goal_id WHERE c.parent_goal_id = $1)`,
      [goal.row.id],
    ),
    () => q.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM goals WHERE parent_goal_id = $1 AND status <> 'cancelled'`, [goal.row.id]),
  );
  const serialized = metrics.map(serializeMetric);
  const primary = serialized[0];
  const owner = goal.row.owner_id ? users.get(goal.row.owner_id) ?? null : null;
  const creator = users.get(goal.row.created_by) ?? null;
  return {
    id: goal.row.id,
    title: goal.row.title,
    description: goal.row.description,
    type: goal.row.goal_type,
    status: goal.row.status,
    parent_goal_id: goal.row.parent_goal_id,
    owner,
    created_by: creator,
    due_at: goal.row.due_at,
    metrics: serialized,
    // Прогресс цели — по главному KPI. Без измерений — null, а не 0 и не цель.
    progress: primary?.progress.raw ?? null,
    task_progress: taskProgress(tasks.rows),
    units: units.rows,
    children_count: children.rows[0]?.n ?? 0,
    checklist: activationChecklist({ title: goal.row.title, type: goal.row.goal_type, owner_id: goal.row.owner_id, due_at: goal.row.due_at, metrics }),
    permissions: {
      edit: canEditGoal(actor, access, 'description', org),
      manage: canEditGoal(actor, access, 'metrics', org),
      activate: canActivateGoal(actor, access, org),
      record: canRecordObservation(actor, access, org),
      audit: canReadAudit(actor, access, org),
    },
    created_at: goal.row.created_at,
    updated_at: goal.row.updated_at,
  };
}

/** Владелец: существует в компании, активен, может владеть целью. */
export async function checkOwner(q: Queryable, companyId: string, ownerId: string): Promise<void> {
  const { rows } = await q.query<{ active: boolean; role: CompanyRole }>(
    `SELECT u.active, m.role FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $1 WHERE u.id = $2`,
    [companyId, ownerId],
  );
  const err = canBeGoalOwner(rows[0] ?? null);
  if (err) throw invalid('Не удалось сохранить цель', { owner_id: err });
}

/** Родитель не может быть самой целью или её потомком. Блокировка защищает от гонки двух переносов. */
export async function checkParent(q: Queryable, companyId: string, goalId: string | null, parentId: string): Promise<void> {
  await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`goal-tree:${companyId}`]);
  const { rows } = await q.query<{ id: string }>(`SELECT id FROM goals WHERE id = $1 AND company_id = $2`, [parentId, companyId]);
  if (!rows.length) throw invalid('Не удалось сохранить цель', { parent_goal_id: 'Родительская цель не найдена' });
  if (!goalId) return;
  if (goalId === parentId) throw invalid('Не удалось сохранить цель', { parent_goal_id: 'Цель не может быть подцелью самой себя' });
  const { rows: cyc } = await q.query<{ found: boolean }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_goal_id FROM goals WHERE id = $1
       UNION ALL SELECT g.id, g.parent_goal_id FROM goals g JOIN up ON g.id = up.parent_goal_id
     ) SELECT EXISTS (SELECT 1 FROM up WHERE id = $2) AS found`,
    [parentId, goalId],
  );
  if (cyc[0]?.found) throw invalid('Не удалось сохранить цель', { parent_goal_id: 'Нельзя сделать цель подцелью её же подцели' });
}

/** Подразделения цели должны принадлежать компании. */
export async function checkUnits(q: Queryable, companyId: string, unitIds: string[]): Promise<void> {
  if (!unitIds.length) return;
  const { rows } = await q.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM org_units WHERE company_id = $1 AND id = ANY($2::uuid[])`, [
    companyId,
    unitIds,
  ]);
  if ((rows[0]?.n ?? 0) !== new Set(unitIds).size) throw invalid('Не удалось сохранить цель', { unit_ids: 'Подразделение не найдено' });
}

export async function insertMetrics(
  q: Queryable,
  goalId: string,
  metrics: { name: string; unit: string; baseline: number; target: number; direction: string; range_min?: number | null; range_max?: number | null }[],
  primaryFirst: boolean,
): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, m] of metrics.entries()) {
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO goal_metrics (goal_id, name, unit, baseline, target_value, direction, range_min, range_max, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [goalId, m.name.trim(), m.unit, m.baseline, m.target, m.direction, m.range_min ?? null, m.range_max ?? null, primaryFirst && i === 0],
    );
    ids.push(rows[0]!.id);
  }
  return ids;
}
