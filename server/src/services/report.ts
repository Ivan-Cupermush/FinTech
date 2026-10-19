import { buildReport, productMetrics, todayIso, type Report, type ReportGoalInput, type ReportPeriod } from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import type { Queryable } from '../db/db';
import { goalRisks } from '../routes/roadmap';
import { loadMetricsInput } from './metrics';

const REPORTED = new Set(['active', 'on_hold', 'completed']);

/**
 * Отчёт в зоне видимости человека: руководитель получает свои цели,
 * владелец и администратор — всю компанию. Один и тот же для сайта,
 * приложения и письма по расписанию.
 */
export async function buildActorReport(q: Queryable, actor: AuthedActor, days: ReportPeriod, now: Date): Promise<Report> {
  const at = now.toISOString();
  const today = todayIso(now);
  const input = await loadMetricsInput(q, actor, at);
  const visibleIds = new Set(input.visible.map((g) => g.row.id));
  // Верхний уровень для человека — цели, родителя которых он не видит.
  const top = input.visible.filter((g) => REPORTED.has(g.row.status) && !(g.row.parent_goal_id && visibleIds.has(g.row.parent_goal_id)));

  const people = await q.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])`, [
    [actor.id, ...top.map((g) => g.row.owner_id).filter((id): id is string => !!id)],
  ]);
  const nameOf = new Map(people.rows.map((u) => [u.id, u.display_name]));
  const company = await q.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [actor.company_id]);

  const goals: ReportGoalInput[] = [];
  for (const g of top) {
    const { risks, tasks } = await goalRisks(q, actor.company_id, g, today);
    const history = input.goals.find((h) => h.id === g.row.id);
    const meta = input.kpis.find((k) => k.goal_id === g.row.id);
    goals.push({
      id: g.row.id,
      title: g.row.title,
      status: g.row.status,
      owner_name: g.row.owner_id ? (nameOf.get(g.row.owner_id) ?? null) : null,
      due_at: g.row.due_at,
      completed_at: g.row.status === 'completed' ? (history?.closed_at ?? null) : null,
      kpi: history?.kpi && meta ? { ...history.kpi, name: meta.name, unit: meta.unit } : null,
      risks,
      tasks: tasks.map((t) => ({ id: t.id, status: t.status, due_at: t.due_at, done_at: t.done_at })),
    });
  }

  return buildReport({
    company: company.rows[0]?.name ?? '',
    scope: actor.role === 'owner' || actor.role === 'admin' ? 'company' : 'visible',
    author: nameOf.get(actor.id) ?? '',
    at,
    days,
    goals,
    metrics: productMetrics(input, at, { windowDays: days, weeks: 1 }),
  });
}
