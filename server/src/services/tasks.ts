import { canEditGoal, canViewGoal, managedScope, memberUnits, type OrgContext, type TaskStatus, type BlockerReason } from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import type { Queryable } from '../db/db';
import { notFound } from '../http/errors';
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
  created_at: string;
  updated_at: string;
  goal_ids: string[];
  participant_ids: string[];
  depends_on: string[];
}

export const TASK_SELECT = `
  SELECT t.id, t.company_id, t.title, t.description, t.status, t.assignee_id, au.display_name AS assignee_name,
         t.team_unit_id, tu.name AS team_name, t.unit_id, uu.name AS unit_name,
         t.start_at, t.due_at, t.done_at, t.definition_of_done, t.blocked_reason, t.blocked_note, t.blocked_since, t.next_step,
         t.created_by, t.created_at, t.updated_at,
         COALESCE((SELECT array_agg(goal_id) FROM goal_tasks gt WHERE gt.task_id = t.id), '{}') AS goal_ids,
         COALESCE((SELECT array_agg(DISTINCT user_id) FROM task_participants p WHERE p.task_id = t.id), '{}') AS participant_ids,
         COALESCE((SELECT array_agg(from_task_id) FROM task_dependencies d WHERE d.to_task_id = t.id), '{}') AS depends_on
    FROM tasks t
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
}

/**
 * Права на задачу. Видят: исполнитель, автор, участники, руководители узла
 * задачи, команда задачи и все, кто видит связанную цель. Менять поля —
 * автор, руководитель узла, тот, кто управляет целью. Статус — ещё исполнитель.
 */
export async function taskPermissions(q: Queryable, actor: AuthedActor, t: TaskRow, org: OrgContext): Promise<TaskPermissions> {
  if (actor.role === 'owner' || actor.role === 'admin') return { view: true, edit: true, status: true };
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
  const status = !observer && (edit || t.assignee_id === actor.id || t.participant_ids.includes(actor.id));
  const view = edit || status || goalView || inManagedUnit || assigneeManaged || [t.unit_id, t.team_unit_id].some((u) => !!u && member.has(u));
  return { view, edit, status };
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
    created_by: t.created_by,
    created_at: t.created_at,
    updated_at: t.updated_at,
    ...(perms ? { permissions: perms } : {}),
  };
}
