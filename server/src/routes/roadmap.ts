import { Router } from 'express';
import { z } from 'zod';
import {
  analyzeRisks,
  bottlenecks,
  canEditGoal,
  canViewGoal,
  criticalPath,
  isValidIsoDate,
  onTimeShare,
  processSummary,
  taskTimeline,
  todayIso,
  type Dependency,
  type Risk,
  type StatusEvent,
} from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { forbidden, invalid } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { audit } from '../services/audit';
import { effectiveAccess, getVisibleGoal, goalCard, loadGoals, loadMetrics, serializeMetric, type LoadedGoal } from '../services/goals';
import { notify } from '../services/notify';
import { loadOrg } from '../services/org';
import { loadTasks, serializeTask, taskPermissions, type TaskRow } from '../services/tasks';

/** Задачи цели и её подцелей (одна задача может быть в нескольких — без дублей). */
async function roadmapTasks(q: Queryable, companyId: string, goalIds: string[]) {
  const tasks = await loadTasks(q, companyId, `t.id IN (SELECT task_id FROM goal_tasks WHERE goal_id = ANY($2::uuid[]))`, [goalIds]);
  const edges = await q.query<Dependency>(
    `SELECT from_task_id AS "from", to_task_id AS "to" FROM task_dependencies WHERE company_id = $1 AND to_task_id = ANY($2::uuid[]) AND from_task_id = ANY($2::uuid[])`,
    [companyId, tasks.map((t) => t.id)],
  );
  return { tasks, edges: edges.rows };
}

function riskTasks(tasks: TaskRow[]) {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    start_at: t.start_at,
    due_at: t.due_at,
    done_at: t.done_at,
    blocked_reason: t.blocked_reason,
    blocked_note: t.blocked_note,
    blocked_since: t.blocked_since,
    assignee_name: t.assignee_name,
  }));
}

export async function goalRisks(q: Queryable, companyId: string, goal: LoadedGoal, today: string) {
  const children = await q.query<{ id: string }>(`SELECT id FROM goals WHERE parent_goal_id = $1 AND status <> 'cancelled'`, [goal.row.id]);
  const goalIds = [goal.row.id, ...children.rows.map((c) => c.id)];
  const { tasks, edges } = await roadmapTasks(q, companyId, goalIds);
  const metrics = await loadMetrics(q, [goal.row.id]);
  const risks = analyzeRisks({
    goal: { status: goal.row.status, due_at: goal.row.due_at },
    tasks: riskTasks(tasks),
    edges,
    metrics: metrics.map((m) => ({ id: m.id, name: m.name, baseline: m.baseline, target: m.target_value, direction: m.direction, range_min: m.range_min, range_max: m.range_max, current_value: m.current_value, last_observed_at: m.last_observed_at })),
    today,
  });
  return { risks, tasks, edges, goalIds, metrics };
}

async function visibleGoals(q: Queryable, actor: AuthedActor) {
  const org = await loadOrg(q, actor.company_id);
  const all = await loadGoals(q, actor.company_id);
  const byId = new Map(all.map((g) => [g.row.id, g]));
  const visible = all.filter((g) => {
    let cur: LoadedGoal | undefined = g;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.row.id)) {
      seen.add(cur.row.id);
      if (canViewGoal(actor, cur.access, org)) return true;
      cur = cur.row.parent_goal_id ? byId.get(cur.row.parent_goal_id) : undefined;
    }
    return false;
  });
  return { org, visible };
}

export function roadmapRouter(db: Db, now: () => Date): Router {
  const r = Router();
  const today = () => todayIso(now());

  /**
   * Рабочее пространство цели: цель, подцели с задачами, зависимости,
   * критический путь, риски с объяснениями и аналитика процесса.
   */
  r.get('/goals/:id/roadmap', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const { goal, org } = await getVisibleGoal(db, actor, id);
    const t = today();
    const { risks, tasks, edges } = await goalRisks(db, actor.company_id, goal, t);
    const children = (await loadGoals(db, actor.company_id)).filter((g) => g.row.parent_goal_id === id && g.row.status !== 'cancelled');
    const childMetrics = await loadMetrics(db, children.map((c) => c.row.id));
    const links = await db.query<{ goal_id: string; task_id: string }>(`SELECT goal_id, task_id FROM goal_tasks WHERE goal_id = ANY($1::uuid[])`, [[id, ...children.map((c) => c.row.id)]]);
    const users = await db.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])`, [children.map((c) => c.row.owner_id).filter(Boolean)]);
    const userMap = new Map(users.rows.map((u) => [u.id, u]));
    const visibleTasks = [];
    for (const task of tasks) {
      const perms = await taskPermissions(db, actor, task, org);
      visibleTasks.push(serializeTask(task, perms));
    }
    const events = await db.query<StatusEvent>(
      `SELECT task_id, status, blocked_reason, at FROM task_status_events WHERE task_id = ANY($1::uuid[]) ORDER BY at`,
      [tasks.map((x) => x.id)],
    );
    const timelines = taskTimeline(events.rows, now().toISOString());
    const dates = tasks.flatMap((x) => [x.start_at, x.due_at]).filter((d): d is string => !!d);
    if (goal.row.due_at) dates.push(goal.row.due_at);
    const subgoals = children.map((c) => {
      const taskIds = links.rows.filter((l) => l.goal_id === c.row.id).map((l) => l.task_id);
      const own = tasks.filter((x) => taskIds.includes(x.id) && x.status !== 'cancelled');
      return {
        id: c.row.id,
        title: c.row.title,
        status: c.row.status,
        due_at: c.row.due_at,
        owner: c.row.owner_id ? userMap.get(c.row.owner_id) ?? null : null,
        metrics: childMetrics.filter((m) => m.goal_id === c.row.id).map(serializeMetric),
        task_ids: taskIds,
        task_progress: { done: own.filter((x) => x.status === 'done').length, total: own.length },
      };
    });
    const direct = links.rows.filter((l) => l.goal_id === id).map((l) => l.task_id);
    res.json({
      data: {
        goal: await goalCard(db, actor, goal, org),
        subgoals,
        direct_task_ids: direct,
        tasks: visibleTasks,
        edges,
        critical_path: criticalPath(tasks, edges),
        risks,
        timeline: { from: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : t, to: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : t, today: t },
        analytics: {
          ...processSummary(timelines),
          bottlenecks: bottlenecks(timelines),
          on_time_share: onTimeShare(tasks),
        },
      },
    });
  });

  /**
   * Применить перенос сроков, который предложила система. Руководитель
   * подтверждает явно: без этого запроса сроки не меняются.
   */
  r.post('/goals/:id/reschedule', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(z.object({ changes: z.array(z.object({ task_id: z.string(), start_at: z.string().nullable().optional(), due_at: z.string() })).min(1).max(100) }), req.body);
    const data = await db.tx(async (q) => {
      const { goal, org } = await getVisibleGoal(q, actor, id);
      if (!canEditGoal(actor, await effectiveAccess(q, actor.company_id, goal), 'due_at', org)) throw forbidden('Переносить сроки может руководитель цели');
      const { tasks } = await goalRisks(q, actor.company_id, goal, today());
      const byId = new Map(tasks.map((t) => [t.id, t]));
      for (const c of body.changes) {
        const task = isUuid(c.task_id) ? byId.get(c.task_id) : undefined;
        if (!task) throw invalid('Не удалось перенести сроки', { task_id: 'Задача не относится к этой цели' });
        if (!isValidIsoDate(c.due_at) || (c.start_at && !isValidIsoDate(c.start_at))) throw invalid('Не удалось перенести сроки', { due_at: 'Укажите дату в формате ГГГГ-ММ-ДД' });
        if (c.start_at && c.start_at > c.due_at) throw invalid('Не удалось перенести сроки', { due_at: 'Срок не может быть раньше даты начала' });
        const start = c.start_at === undefined ? task.start_at : c.start_at;
        await q.query(`UPDATE tasks SET start_at = $2, due_at = $3, updated_at = NOW() WHERE id = $1`, [task.id, start, c.due_at]);
        await audit(q, { company_id: actor.company_id, entity_type: 'task', entity_id: task.id, goal_id: id, actor_id: actor.id, event_type: 'task.rescheduled', old_values: { start_at: task.start_at, due_at: task.due_at }, new_values: { start_at: start, due_at: c.due_at } });
        if (task.assignee_id) await notify(q, { company_id: actor.company_id, user_id: task.assignee_id, kind: 'reschedule', title: `Новый срок задачи «${task.title}»`, body: `Срок перенесён на ${c.due_at}`, task_id: task.id, goal_id: id }, actor.id);
      }
      return { updated: body.changes.length };
    });
    res.json({ data });
  });

  /**
   * Пульс: главный экран. Цели с прогрессом, риски по всем целям (сначала
   * критические), мои задачи и «кому нужна помощь» — блокеры в моей зоне.
   */
  r.get('/dashboard', async (req, res) => {
    const actor = actorOf(req);
    const t = today();
    const { org, visible } = await visibleGoals(db, actor);
    const active = visible.filter((g) => g.row.status === 'active' && !g.row.parent_goal_id);
    const metrics = await loadMetrics(db, active.map((g) => g.row.id));
    const allRisks: (Risk & { goal_id: string; goal_title: string })[] = [];
    const goals = [];
    for (const g of active) {
      const { risks, tasks } = await goalRisks(db, actor.company_id, g, t);
      allRisks.push(...risks.map((x) => ({ ...x, goal_id: g.row.id, goal_title: g.row.title })));
      const counted = tasks.filter((x) => x.status !== 'cancelled');
      const m = metrics.filter((x) => x.goal_id === g.row.id).map(serializeMetric)[0] ?? null;
      goals.push({
        id: g.row.id,
        title: g.row.title,
        type: g.row.goal_type,
        due_at: g.row.due_at,
        primary_metric: m,
        progress: m?.progress.raw ?? null,
        task_progress: { done: counted.filter((x) => x.status === 'done').length, total: counted.length },
        risk_level: risks.some((x) => x.severity === 'critical') ? 'critical' : risks.some((x) => x.severity === 'warning') ? 'warning' : 'ok',
      });
    }
    const myTasks = await loadTasks(db, actor.company_id, `t.assignee_id = $2 AND t.status NOT IN ('done', 'cancelled')`, [actor.id]);
    const blocked = await loadTasks(db, actor.company_id, `t.status = 'blocked'`);
    const helpNeeded = [];
    for (const task of blocked) {
      const p = await taskPermissions(db, actor, task, org);
      if (p.edit && task.assignee_id !== actor.id) helpNeeded.push(serializeTask(task));
    }
    const unread = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND company_id = $2 AND read_at IS NULL`, [actor.id, actor.company_id]);
    const severity = { critical: 0, warning: 1, info: 2 } as const;
    res.json({
      data: {
        today: t,
        goals,
        risks: allRisks.sort((a, b) => severity[a.severity] - severity[b.severity]).slice(0, 12),
        my_tasks: myTasks.map((x) => serializeTask(x)),
        help_needed: helpNeeded,
        unread_notifications: unread.rows[0]?.n ?? 0,
        drafts: visible.filter((g) => g.row.status === 'draft' && (g.row.created_by === actor.id || g.row.owner_id === actor.id)).map((g) => ({ id: g.row.id, title: g.row.title })),
      },
    });
  });

  return r;
}
