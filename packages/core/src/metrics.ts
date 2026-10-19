import type { StatusEvent } from './analytics';
import { formatNumber } from './format';
import { kpiProgress, type Direction, type Observation } from './kpi';
import { plural } from './units';

/**
 * Продуктовые метрики offix (docs/PRODUCT.md, раздел 9). Всё считается из
 * данных, которые и так есть: замеров KPI, истории статусов задач и журнала
 * целей. Ручных отчётов нет, поэтому цифре можно верить, а каждую точку
 * графика можно пересчитать «как это выглядело в тот день».
 */

const DAY_MS = 86_400_000;
const EPS = 1e-9;

export interface KpiSeries {
  baseline: number;
  target: number;
  direction: Direction;
  range_min?: number | null;
  range_max?: number | null;
  observations: readonly Observation[];
}

export interface GoalHistory {
  id: string;
  title: string;
  /** Подцель без своего KPI — норма: её эффект виден через родителя. */
  parent_id?: string | null;
  created_at: string;
  /** Первый запуск в работу. null — цель ещё не запускали. */
  activated_at: string | null;
  /** Когда цель перестала быть активной (завершена, отменена, на паузе). */
  closed_at: string | null;
  /** Основной KPI цели. */
  kpi: KpiSeries | null;
}

export interface TaskOutcome {
  due_at: string | null;
  done_at: string | null;
}

export type Movement = 'improved' | 'flat' | 'worse' | 'stale';

export const MOVEMENT_LABELS: Record<Movement, string> = {
  improved: 'Сдвинулся к цели',
  flat: 'Без изменений',
  worse: 'Хуже, чем был',
  stale: 'Нет свежих замеров',
};

export function shiftIso(at: string, days: number): string {
  return new Date(Date.parse(at) + days * DAY_MS).toISOString();
}

const share = (part: number, total: number) => (total ? Math.round((part / total) * 100) : null);

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Значение показателя на момент `at`: последний замер не позже этого момента. */
export function valueAt(obs: readonly Observation[], at: string): number | null {
  const t = Date.parse(at);
  let best: Observation | null = null;
  for (const o of obs) {
    const ot = Date.parse(o.observed_at);
    if (ot <= t && (!best || ot > Date.parse(best.observed_at))) best = o;
  }
  return best ? best.value : null;
}

export function isActiveAt(g: Pick<GoalHistory, 'activated_at' | 'closed_at'>, at: string): boolean {
  if (!g.activated_at) return false;
  const t = Date.parse(at);
  return Date.parse(g.activated_at) <= t && (!g.closed_at || Date.parse(g.closed_at) > t);
}

/**
 * Как изменился KPI за окно (from, to]. Без замеров внутри окна вывод сделать
 * нельзя, поэтому «нет свежих замеров», а не «без изменений». Точка отсчёта —
 * значение на начало окна, а если замеров раньше не было — исходное значение.
 * Для «удерживать в диапазоне» успех — быть в диапазоне в конце окна.
 */
export function kpiMovement(kpi: KpiSeries, from: string, to: string): { movement: Movement; delta: number | null } {
  const f = Date.parse(from);
  const t = Date.parse(to);
  const inWindow = kpi.observations.some((o) => {
    const ot = Date.parse(o.observed_at);
    return ot > f && ot <= t;
  });
  if (!inWindow) return { movement: 'stale', delta: null };
  const end = kpiProgress(kpi, valueAt(kpi.observations, to));
  if (kpi.direction === 'maintain') {
    return { movement: end.state === 'in_range' ? 'improved' : 'worse', delta: null };
  }
  const startValue = valueAt(kpi.observations, from);
  const startRaw = startValue === null ? 0 : (kpiProgress(kpi, startValue).raw ?? 0);
  const endRaw = end.raw ?? 0;
  const delta = endRaw - startRaw;
  // Достигнутая и удержанная цель — тоже результат, а не «без изменений».
  if (endRaw >= 100 - EPS && startRaw >= 100 - EPS) return { movement: 'improved', delta };
  if (delta > EPS) return { movement: 'improved', delta };
  if (delta < -EPS) return { movement: 'worse', delta };
  return { movement: 'flat', delta };
}

export interface NorthStarItem {
  id: string;
  title: string;
  movement: Movement;
  /** Изменение прогресса в процентных пунктах за окно. */
  delta: number | null;
}

export interface NorthStar {
  /** Доля активных целей с KPI, у которых показатель сдвинулся к цели. */
  value: number | null;
  counts: Record<Movement, number>;
  total: number;
  /** Активные цели верхнего уровня без KPI: их нельзя оценить, и это само по себе сигнал. */
  without_kpi: number;
  items: NorthStarItem[];
}

/** Северная звезда: доля активных целей, чей KPI сдвинулся к цели за окно. */
export function northStar(goals: readonly GoalHistory[], at: string, windowDays = 30): NorthStar {
  const from = shiftIso(at, -windowDays);
  const active = goals.filter((g) => isActiveAt(g, at));
  const counts: Record<Movement, number> = { improved: 0, flat: 0, worse: 0, stale: 0 };
  const items: NorthStarItem[] = [];
  let withoutKpi = 0;
  for (const g of active) {
    if (!g.kpi) {
      if (!g.parent_id) withoutKpi++;
      continue;
    }
    const { movement, delta } = kpiMovement(g.kpi, from, at);
    counts[movement]++;
    items.push({ id: g.id, title: g.title, movement, delta });
  }
  const order: Record<Movement, number> = { worse: 0, stale: 1, flat: 2, improved: 3 };
  items.sort((a, b) => order[a.movement] - order[b.movement] || a.title.localeCompare(b.title, 'ru'));
  return {
    value: share(counts.improved, items.length),
    counts,
    total: items.length,
    without_kpi: withoutKpi,
    items,
  };
}

export interface Freshness {
  /** Доля KPI активных целей с замером не старше maxAgeDays. */
  value: number | null;
  fresh: number;
  total: number;
  max_age_days: number;
  stale: { id: string; title: string; last_observed_at: string | null }[];
}

export function kpiFreshness(goals: readonly GoalHistory[], at: string, maxAgeDays = 14): Freshness {
  const t = Date.parse(at);
  const stale: Freshness['stale'] = [];
  let fresh = 0;
  let total = 0;
  for (const g of goals) {
    if (!g.kpi || !isActiveAt(g, at)) continue;
    total++;
    let last: string | null = null;
    for (const o of g.kpi.observations) {
      if (Date.parse(o.observed_at) <= t && (!last || o.observed_at > last)) last = o.observed_at;
    }
    if (last && t - Date.parse(last) <= maxAgeDays * DAY_MS) fresh++;
    else stale.push({ id: g.id, title: g.title, last_observed_at: last });
  }
  // Сначала те, где замеров не было вовсе, затем самые старые.
  stale.sort((a, b) => (a.last_observed_at ?? '').localeCompare(b.last_observed_at ?? ''));
  return { value: share(fresh, total), fresh, total, max_age_days: maxAgeDays, stale };
}

export interface Launch {
  /** Доля целей, запущенных в работу не позже чем через N дней после создания. */
  value: number | null;
  launched: number;
  total: number;
  within_days: number;
  median_days: number | null;
}

/**
 * Активация: успевают ли цели дойти от черновика до работы. Цель, созданная
 * меньше N дней назад и ещё не запущенная, в расчёт не идёт: у неё есть время.
 */
export function launchRate(goals: readonly GoalHistory[], at: string, withinDays = 7): Launch {
  const t = Date.parse(at);
  const days: number[] = [];
  let launched = 0;
  let total = 0;
  for (const g of goals) {
    const created = Date.parse(g.created_at);
    if (created > t) continue;
    const activated = g.activated_at && Date.parse(g.activated_at) <= t ? Date.parse(g.activated_at) : null;
    if (activated === null && t - created < withinDays * DAY_MS) continue;
    total++;
    if (activated !== null) {
      const d = Math.max(0, (activated - created) / DAY_MS);
      days.push(d);
      if (d <= withinDays) launched++;
    }
  }
  const m = median(days);
  return { value: share(launched, total), launched, total, within_days: withinDays, median_days: m === null ? null : Math.round(m * 10) / 10 };
}

export interface BlockerStats {
  /** Медиана часов от блокера до снятия по блокерам, снятым за окно. */
  median_hours: number | null;
  resolved: number;
  /** Блокеры, открытые на момент `at`. */
  open: number;
  oldest_open_hours: number | null;
}

/** Скорость реакции: сколько живёт блокер. Эпизод заканчивается любым другим статусом. */
export function blockerStats(events: readonly StatusEvent[], at: string, windowDays = 30): BlockerStats {
  const t = Date.parse(at);
  const f = t - windowDays * DAY_MS;
  const byTask = new Map<string, StatusEvent[]>();
  for (const e of events) {
    if (Date.parse(e.at) > t) continue;
    byTask.set(e.task_id, [...(byTask.get(e.task_id) ?? []), e]);
  }
  const resolved: number[] = [];
  const open: number[] = [];
  for (const list of byTask.values()) {
    const sorted = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let since: number | null = null;
    for (const e of sorted) {
      const et = Date.parse(e.at);
      if (e.status === 'blocked') {
        if (since === null) since = et;
      } else if (since !== null) {
        if (et > f) resolved.push((et - since) / 3_600_000);
        since = null;
      }
    }
    if (since !== null) open.push((t - since) / 3_600_000);
  }
  const m = median(resolved);
  return {
    median_hours: m === null ? null : Math.round(m),
    resolved: resolved.length,
    open: open.length,
    oldest_open_hours: open.length ? Math.round(Math.max(...open)) : null,
  };
}

export interface OnTime {
  /** Доля задач, закрытых за окно не позже срока. */
  value: number | null;
  on_time: number;
  total: number;
}

export function onTimeWindow(tasks: readonly TaskOutcome[], at: string, windowDays = 30): OnTime {
  const t = Date.parse(at);
  const f = t - windowDays * DAY_MS;
  let onTime = 0;
  let total = 0;
  for (const task of tasks) {
    if (!task.done_at || !task.due_at) continue;
    const d = Date.parse(task.done_at);
    if (d <= f || d > t) continue;
    total++;
    if (task.done_at.slice(0, 10) <= task.due_at) onTime++;
  }
  return { value: share(onTime, total), on_time: onTime, total };
}

export interface ProductMetricsInput {
  goals: readonly GoalHistory[];
  events: readonly StatusEvent[];
  tasks: readonly TaskOutcome[];
}

export interface ProductMetrics {
  at: string;
  window_days: number;
  north_star: NorthStar;
  freshness: Freshness;
  launch: Launch;
  blockers: BlockerStats;
  on_time: OnTime;
  /** Значения метрик на конец каждой из последних недель, старые слева. */
  series: {
    at: string[];
    north_star: (number | null)[];
    freshness: (number | null)[];
    blocker_hours: (number | null)[];
    on_time: (number | null)[];
  };
}

export function productMetrics(input: ProductMetricsInput, at: string, opts: { windowDays?: number; weeks?: number } = {}): ProductMetrics {
  const windowDays = opts.windowDays ?? 30;
  const weeks = Math.max(1, opts.weeks ?? 8);
  const points = Array.from({ length: weeks }, (_, i) => shiftIso(at, -7 * (weeks - 1 - i)));
  return {
    at,
    window_days: windowDays,
    north_star: northStar(input.goals, at, windowDays),
    freshness: kpiFreshness(input.goals, at),
    launch: launchRate(input.goals, at),
    blockers: blockerStats(input.events, at, windowDays),
    on_time: onTimeWindow(input.tasks, at, windowDays),
    series: {
      at: points,
      north_star: points.map((p) => northStar(input.goals, p, windowDays).value),
      freshness: points.map((p) => kpiFreshness(input.goals, p).value),
      blocker_hours: points.map((p) => blockerStats(input.events, p, windowDays).median_hours),
      on_time: points.map((p) => onTimeWindow(input.tasks, p, windowDays).value),
    },
  };
}

/** Длительность для плиток с точностью до десятой дня: «36 ч», «2,5 дня», «5 дней». */
export function formatHours(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return '—';
  if (h < 1) return '< 1\u00a0ч';
  if (h < 48) return `${Math.round(h)}\u00a0ч`;
  const d = Math.round((h / 24) * 10) / 10;
  return `${formatNumber(d, 1)}\u00a0${plural(d, ['день', 'дня', 'дней'])}`;
}

/**
 * Насколько изменилась метрика между первой и последней известной точкой ряда
 * и сколько шагов (недель) между ними: тренд «за 8 недель» при данных за 4
 * был бы неправдой.
 */
export function seriesTrend(values: readonly (number | null)[]): { delta: number; steps: number } | null {
  const first = values.findIndex((v) => v !== null);
  let last = -1;
  values.forEach((v, i) => {
    if (v !== null) last = i;
  });
  if (first < 0 || last <= first) return null;
  return { delta: values[last]! - values[first]!, steps: last - first };
}
