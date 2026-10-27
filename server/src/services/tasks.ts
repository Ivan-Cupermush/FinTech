import { canEditGoal, canViewGoal, managedScope, memberUnits, AUTO_ARCHIVE_DAYS, type CheckpointStatus, type OrgContext, type TaskKind, type TaskStatus, type BlockerReason } from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import type { Queryable } from '../db/db';
import { notFound } from '../http/errors';
import { audit } from './audit';
import { effectiveAccess, loadGoals } from './goals';

export interface TaskRow {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  team_unit_id: string | null;
  team_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  start_at: string | null;
  due_at: string | null;
  done_at: string | null;
  definition_of_done: string | null;
  blocked_reason: BlockerReason | null;
  blocked_note: string | null;
  blocked_since: string | null;
  next_step: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  kind: TaskKind;
  thanked_at: string | null;
  closed_at: string | null;
  archived_at: string | null;
  archived_by_name: string | null;
  unarchived_at: string | null;
  goal_ids: string[];
  participant_ids: string[];
  watcher_ids: string[];
  approver_ids: string[];
  /** Участники, кроме наблюдателей: они ведут статус. */
  doer_ids: string[];
  depends_on: string[];
  checkpoints: { id: string; title: string; due_at: string; status: CheckpointStatus }[];
}

export const TASK_SELECT = `
  SELECT t.id, t.company_id, t.title, t.description, t.status, t.assignee_id, au.display_name AS assignee_name,
         t.team_unit_id, tu.name AS team_name, t.unit_id, uu.name AS unit_name,
         t.start_at, t.due_at, t.done_at, t.definition_of_done, t.blocked_reason, t.blocked_note, t.blocked_since, t.next_step,
         t.created_by, cu.display_name AS created_by_name, t.created_at, t.updated_at,
         t.kind, t.thanked_at, t.closed_at, t.archived_at, abu.display_name AS archived_by_name, t.unarchived_at,
         COALESCE((SELECT array_agg(goal_id) FROM goal_tasks gt WHERE gt.task_id = t.id), '{}') AS goal_ids,
         COALESCE((SELECT array_agg(DISTINCT user_id) FROM task_participants p WHERE p.task_id = t.id), '{}') AS participant_ids,
         COALESCE((SELECT array_agg(user_id) FROM task_participants p WHERE p.task_id = t.id AND p.role = 'watcher'), '{}') AS watcher_ids,
         COALESCE((SELECT array_agg(user_id) FROM task_participants p WHERE p.task_id = t.id AND p.role = 'approver'), '{}') AS approver_ids,
         COALESCE((SELECT array_agg(DISTINCT user_id) FROM task_participants p WHERE p.task_id = t.id AND p.role <> 'watcher'), '{}') AS doer_ids,
         COALESCE((SELECT array_agg(from_task_id) FROM task_dependencies d WHERE d.to_task_id = t.id), '{}') AS depends_on,
         COALESCE((SELECT json_agg(json_build_object('id', c.id, 'title', c.title, 'due_at', to_char(c.due_at, 'YYYY-MM-DD'), 'status', c.status) ORDER BY c.due_at, c.created_at)
                     FROM task_checkpoints c WHERE c.task_id = t.id), '[]') AS checkpoints
    FROM tasks t
    LEFT JOIN users cu ON cu.id = t.created_by
    LEFT JOIN users abu ON abu.id = t.archived_by
    LEFT JOIN users au ON au.id = t.assignee_id
    LEFT JOIN org_units tu ON tu.id = t.team_unit_id
    LEFT JOIN org_units uu ON uu.id = t.unit_id`;

export async function loadTasks(q: Queryable, companyId: string, where = 'TRUE', params: unknown[] = []): Promise<TaskRow[]> {
  const { rows } = await q.query<TaskRow>(`${TASK_SELECT} WHERE t.company_id = $1 AND (${where}) ORDER BY t.due_at NULLS LAST, t.created_at`, [companyId, ...params]);
  return rows;
}

export interface TaskPermissions {
  view: boolean;
  edit: boolean;
  status: boolean;
  /** Отметить контрольную точку: автор, согласующий, наблюдатель; в просьбе — ещё исполнитель. */
  mark: boolean;
}

/**
 * Права на задачу. Видят: исполнитель, автор, участники, руководители узла
 * задачи, команда задачи и все, кто видит связанную цель. Менять поля —
 * автор, руководитель узла, тот, кто управляет целью. Статус — ещё исполнитель.
 */
export async function taskPermissions(q: Queryable, actor: AuthedActor, t: TaskRow, org: OrgContext): Promise<TaskPermissions> {
  if (actor.role === 'owner' || actor.role === 'admin') return { view: true, edit: true, status: true, mark: true };
  const managed = managedScope(org.units, org.memberships, actor.id);
  const member = memberUnits(org.memberships, actor.id);
  const inManagedUnit = [t.unit_id, t.team_unit_id].some((u) => !!u && managed.has(u));
  const assigneeManaged =
    !!t.assignee_id && org.memberships.some((m) => m.user_id === t.assignee_id && managed.has(m.unit_id));
  let goalView = false;
  let goalManage = false;
  if (t.goal_ids.length) {
    const goals = await loadGoals(q, actor.company_id, t.goal_ids);
    for (const g of goals) {
      const access = await effectiveAccess(q, actor.company_id, g);
      if (canViewGoal(actor, access, org)) goalView = true;
      if (canEditGoal(actor, access, 'metrics', org)) goalManage = true;
    }
  }
  const observer = actor.role === 'observer';
  const edit = !observer && (t.created_by === actor.id || (actor.role === 'manager' && (inManagedUnit || assigneeManaged)) || goalManage);
  // Наблюдатель видит задачу и отмечает точки, но статус не меняет: работу принимает согласующий.
  const status = !observer && (edit || t.assignee_id === actor.id || t.doer_ids.includes(actor.id));
  const mark = !observer && (edit || t.watcher_ids.includes(actor.id) || t.approver_ids.includes(actor.id) || (t.kind === 'request' && t.assignee_id === actor.id));
  const view = edit || status || mark || goalView || inManagedUnit || assigneeManaged || t.participant_ids.includes(actor.id) || [t.unit_id, t.team_unit_id].some((u) => !!u && member.has(u));
  return { view, edit, status, mark };
}

export async function getVisibleTask(q: Queryable, actor: AuthedActor, id: string, org: OrgContext) {
  const [task] = await loadTasks(q, actor.company_id, 't.id = $2', [id]);
  if (!task) throw notFound('Задача не найдена');
  const perms = await taskPermissions(q, actor, task, org);
  if (!perms.view) throw notFound('Задача не найдена');
  return { task, perms };
}

export function serializeTask(t: TaskRow, perms?: TaskPermissions) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    assignee: t.assignee_id ? { id: t.assignee_id, display_name: t.assignee_name } : null,
    team: t.team_unit_id ? { id: t.team_unit_id, name: t.team_name } : null,
    unit: t.unit_id ? { id: t.unit_id, name: t.unit_name } : null,
    start_at: t.start_at,
    due_at: t.due_at,
    done_at: t.done_at,
    definition_of_done: t.definition_of_done,
    blocker: t.status === 'blocked' ? { reason: t.blocked_reason, note: t.blocked_note, since: t.blocked_since, next_step: t.next_step } : null,
    goal_ids: t.goal_ids,
    depends_on: t.depends_on,
    kind: t.kind,
    thanked_at: t.thanked_at,
    archived: t.archived_at ? { at: t.archived_at, by_name: t.archived_by_name } : null,
    checkpoints: t.checkpoints,
    watcher_ids: t.watcher_ids,
    created_by: t.created_by,
    created_by_name: t.created_by_name,
    created_at: t.created_at,
    updated_at: t.updated_at,
    ...(perms ? { permissions: perms } : {}),
  };
}

/**
 * Архив сам: выполненные и отменённые задачи через 3 дня после закрытия.
 * Задачу, которую вернули из архива, сама больше не убираем, пока её не
 * закроют снова. Идёт перед чтением списка — отдельного планировщика не нужно.
 */
export async function sweepArchive(q: Queryable, companyId: string, now: Date, days = AUTO_ARCHIVE_DAYS): Promise<string[]> {
  const { rows } = await q.query<{ id: string }>(
    `UPDATE tasks SET archived_at = $2, archived_by = NULL
      WHERE company_id = $1 AND archived_at IS NULL AND status IN ('done', 'cancelled') AND closed_at IS NOT NULL
        AND closed_at <= $2::timestamptz - make_interval(days => $3::int)
        AND (unarchived_at IS NULL OR unarchived_at < closed_at)
      RETURNING id`,
    [companyId, now.toISOString(), days],
  );
  for (const r of rows) {
    await audit(q, { company_id: companyId, entity_type: 'task', entity_id: r.id, actor_id: null, event_type: 'task.archived', new_values: { auto: true, after_days: days } });
  }
  return rows.map((r) => r.id);
}
