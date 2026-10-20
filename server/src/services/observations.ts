import { kpiProgress, observationDay } from '@offix/core';
import type { Queryable } from '../db/db';
import { audit } from './audit';
import { loadMetrics, serializeMetric } from './goals';
import { notify } from './notify';

type MetricRow = Awaited<ReturnType<typeof loadMetrics>>[number];

/**
 * Дни (по Москве), за которые у KPI уже есть замер. KPI блокируется до конца
 * транзакции, чтобы параллельный импорт или синхронизация не добавили тот же
 * день дважды.
 */
export async function lockObservationDays(q: Queryable, metricId: string): Promise<Set<string>> {
  await q.query(`SELECT id FROM goal_metrics WHERE id = $1 FOR UPDATE`, [metricId]);
  const { rows } = await q.query<{ observed_at: Date | string }>(`SELECT observed_at FROM goal_metric_observations WHERE metric_id = $1`, [metricId]);
  return new Set(rows.map((r) => observationDay(new Date(r.observed_at))));
}

export interface AddObservations {
  companyId: string;
  goalId: string;
  goalOwnerId: string | null;
  metric: MetricRow;
  rows: { at: string; value: number }[];
  source: 'import' | 'integration';
  /** Кто внёс. У синхронизации по расписанию — никто. */
  actorId: string | null;
  note: string | null;
  /** Уже заблокированные дни из lockObservationDays; иначе загрузим сами. */
  days?: Set<string>;
  /** Что добавить в запись журнала: например, какая интеграция. */
  auditExtra?: Record<string, unknown>;
}

/**
 * Пачка замеров в KPI — общий путь импорта из таблиц и интеграций. За день
 * один замер: дни, где он уже есть, пропускаются. Пишет журнал и, если KPI
 * впервые достиг цели, уведомляет владельца цели.
 */
export async function addObservations(q: Queryable, o: AddObservations) {
  const days = o.days ?? (await lockObservationDays(q, o.metric.id));
  const fresh = o.rows.filter((r) => {
    const day = observationDay(r.at);
    return days.has(day) ? false : (days.add(day), true);
  });
  for (const r of fresh) {
    await q.query(`INSERT INTO goal_metric_observations (metric_id, value, observed_at, source, recorded_by, note) VALUES ($1, $2, $3, $4, $5, $6)`, [
      o.metric.id,
      r.value,
      r.at,
      o.source,
      o.actorId,
      o.note,
    ]);
  }
  const skipped = o.rows.length - fresh.length;
  const m = o.metric;
  const before = kpiProgress({ baseline: m.baseline, target: m.target_value, direction: m.direction, range_min: m.range_min, range_max: m.range_max }, m.current_value);
  const [reloaded] = (await loadMetrics(q, [o.goalId])).filter((x) => x.id === m.id);
  const metric = serializeMetric(reloaded!);
  if (fresh.length) {
    const sorted = fresh.map((r) => observationDay(r.at)).sort();
    await audit(q, {
      company_id: o.companyId,
      entity_type: 'metric',
      entity_id: m.id,
      goal_id: o.goalId,
      actor_id: o.actorId,
      event_type: o.source === 'import' ? 'metric.imported' : 'metric.synced',
      new_values: { count: fresh.length, skipped, from: sorted[0], to: sorted.at(-1), ...o.auditExtra },
    });
    if (metric.progress.state === 'achieved' && before.state !== 'achieved' && o.goalOwnerId) {
      await notify(q, { company_id: o.companyId, user_id: o.goalOwnerId, kind: 'kpi_achieved', title: `KPI «${m.name}» достиг цели`, goal_id: o.goalId }, o.actorId);
    }
  }
  return { imported: fresh.length, skipped, metric };
}
