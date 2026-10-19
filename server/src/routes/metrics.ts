import { Router } from 'express';
import { productMetrics, type Direction, type GoalHistory, type StatusEvent } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { visibleGoals } from './roadmap';

interface HistoryRow {
  goal_id: string;
  activated_at: string | null;
  closed_at: string | null;
}

/**
 * Продуктовые метрики по целям, которые видит человек. Руководитель видит
 * эффект своих подразделений, администратор — всей компании. Всё считается из
 * замеров, истории задач и журнала: ручного ввода цифр здесь нет.
 */
export function metricsRouter(db: Db, now: () => Date): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const { visible } = await visibleGoals(db, actor);
    const goalIds = visible.map((g) => g.row.id);

    // Запуск и закрытие берём из журнала. Для целей, заведённых до журнала
    // (импорт, демо), запуском считаем создание: так метрика не занижается.
    const history = await db.query<HistoryRow>(
      `SELECT g.id AS goal_id,
              COALESCE(
                (SELECT MIN(a.created_at) FROM audit_events a
                  WHERE a.goal_id = g.id AND a.entity_id = g.id
                    AND ((a.event_type = 'goal.status_changed' AND a.new_values->>'status' = 'active')
                      OR (a.event_type = 'goal.created' AND a.new_values->>'status' = 'active'))),
                CASE WHEN g.status IN ('active', 'completed', 'on_hold') THEN g.created_at END
              ) AS activated_at,
              CASE WHEN g.status IN ('completed', 'cancelled', 'on_hold') THEN
                COALESCE(
                  (SELECT MAX(a.created_at) FROM audit_events a
                    WHERE a.goal_id = g.id AND a.entity_id = g.id AND a.event_type = 'goal.status_changed' AND a.new_values->>'status' = g.status),
                  g.updated_at)
              END AS closed_at
         FROM goals g WHERE g.company_id = $1 AND g.id = ANY($2::uuid[])`,
      [actor.company_id, goalIds],
    );
    const historyById = new Map(history.rows.map((h) => [h.goal_id, h]));
    // Журнал пишет время базы, расчёт идёт на время приложения. При расхождении
    // часов событие «из будущего» считаем случившимся сейчас.
    const at = now().toISOString();
    const clamp = (v: string | null | undefined) => (v && v > at ? at : (v ?? null));

    const metrics = await db.query<{ id: string; goal_id: string; baseline: number; target_value: number; direction: Direction; range_min: number | null; range_max: number | null }>(
      `SELECT DISTINCT ON (goal_id) id, goal_id, baseline, target_value, direction, range_min, range_max
         FROM goal_metrics WHERE goal_id = ANY($1::uuid[])
        ORDER BY goal_id, is_primary DESC, created_at`,
      [goalIds],
    );
    const obs = await db.query<{ metric_id: string; value: number; observed_at: string }>(
      `SELECT metric_id, value, observed_at FROM goal_metric_observations WHERE metric_id = ANY($1::uuid[])`,
      [metrics.rows.map((m) => m.id)],
    );

    const goals: GoalHistory[] = visible.map((g) => {
      const h = historyById.get(g.row.id);
      const m = metrics.rows.find((x) => x.goal_id === g.row.id);
      return {
        id: g.row.id,
        title: g.row.title,
        parent_id: g.row.parent_goal_id,
        created_at: clamp(g.row.created_at)!,
        activated_at: clamp(h?.activated_at),
        closed_at: clamp(h?.closed_at),
        kpi: m
          ? {
              baseline: m.baseline,
              target: m.target_value,
              direction: m.direction,
              range_min: m.range_min,
              range_max: m.range_max,
              observations: obs.rows.filter((o) => o.metric_id === m.id),
            }
          : null,
      };
    });

    const tasks = await db.query<{ id: string; due_at: string | null; done_at: string | null }>(
      `SELECT DISTINCT t.id, t.due_at, t.done_at FROM tasks t JOIN goal_tasks gt ON gt.task_id = t.id
        WHERE t.company_id = $1 AND gt.goal_id = ANY($2::uuid[]) AND t.status <> 'cancelled'`,
      [actor.company_id, goalIds],
    );
    const events = await db.query<StatusEvent>(
      `SELECT task_id, status, blocked_reason, at FROM task_status_events WHERE task_id = ANY($1::uuid[]) ORDER BY at`,
      [tasks.rows.map((t) => t.id)],
    );

    const data = productMetrics({ goals, events: events.rows, tasks: tasks.rows }, at);
    res.json({ data: { ...data, scope: actor.role === 'owner' || actor.role === 'admin' ? 'company' : 'visible' } });
  });

  return r;
}
