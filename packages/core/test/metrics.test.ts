import { describe, expect, it } from 'vitest';
import {
  blockerStats,
  formatHours,
  isActiveAt,
  kpiFreshness,
  kpiMovement,
  launchRate,
  northStar,
  onTimeWindow,
  productMetrics,
  seriesTrend,
  shiftIso,
  valueAt,
  type GoalHistory,
  type KpiSeries,
  type StatusEvent,
} from '../src';

const NOW = '2026-10-19T12:00:00.000Z';
const ago = (days: number, h = 0) => shiftIso(NOW, -days + h / 24);

const decrease = (obs: [number, number][]): KpiSeries => ({
  baseline: 40,
  target: 30,
  direction: 'decrease',
  observations: obs.map(([d, value]) => ({ value, observed_at: ago(d) })),
});

const goal = (id: string, kpi: KpiSeries | null, over: Partial<GoalHistory> = {}): GoalHistory => ({
  id,
  title: `Цель ${id}`,
  created_at: ago(60),
  activated_at: ago(59),
  closed_at: null,
  kpi,
  ...over,
});

describe('valueAt', () => {
  const obs = [
    { value: 1, observed_at: ago(10) },
    { value: 3, observed_at: ago(2) },
    { value: 2, observed_at: ago(5) },
  ];
  it('берёт последний по времени замер, а не по порядку вставки', () => {
    expect(valueAt(obs, NOW)).toBe(3);
  });
  it('не заглядывает в будущее относительно момента', () => {
    expect(valueAt(obs, ago(4))).toBe(2);
    expect(valueAt(obs, ago(11))).toBeNull();
  });
  it('замер ровно в момент `at` учитывается', () => {
    expect(valueAt(obs, ago(5))).toBe(2);
  });
});

describe('isActiveAt', () => {
  it('черновик не активен никогда', () => {
    expect(isActiveAt({ activated_at: null, closed_at: null }, NOW)).toBe(false);
  });
  it('активна между запуском и закрытием', () => {
    const g = { activated_at: ago(20), closed_at: ago(5) };
    expect(isActiveAt(g, ago(25))).toBe(false);
    expect(isActiveAt(g, ago(10))).toBe(true);
    expect(isActiveAt(g, ago(5))).toBe(false);
    expect(isActiveAt(g, NOW)).toBe(false);
  });
});

describe('kpiMovement', () => {
  const from = ago(30);
  it('40 → 36,5 за окно — сдвинулся к цели на 35 п.п.', () => {
    const r = kpiMovement(decrease([[28, 40], [1, 36.5]]), from, NOW);
    expect(r.movement).toBe('improved');
    expect(r.delta).toBeCloseTo(35);
  });
  it('точка отсчёта — значение на начало окна, а не исходное', () => {
    const r = kpiMovement(decrease([[40, 35], [3, 35]]), from, NOW);
    expect(r).toEqual({ movement: 'flat', delta: 0 });
  });
  it('без замеров до окна отсчёт идёт от исходного значения', () => {
    expect(kpiMovement(decrease([[3, 38]]), from, NOW).movement).toBe('improved');
    expect(kpiMovement(decrease([[3, 40]]), from, NOW).movement).toBe('flat');
  });
  it('ухудшение не прячется', () => {
    const r = kpiMovement(decrease([[40, 36], [2, 39]]), from, NOW);
    expect(r.movement).toBe('worse');
    expect(r.delta).toBeCloseTo(-30);
  });
  it('нет замеров внутри окна — «нет свежих замеров», а не «без изменений»', () => {
    expect(kpiMovement(decrease([[45, 32]]), from, NOW)).toEqual({ movement: 'stale', delta: null });
    expect(kpiMovement(decrease([]), from, NOW).movement).toBe('stale');
  });
  it('замер ровно на границе окна относится к прошлому окну', () => {
    expect(kpiMovement(decrease([[30, 35]]), from, NOW).movement).toBe('stale');
  });
  it('удержанная достигнутая цель — успех', () => {
    expect(kpiMovement(decrease([[40, 29], [2, 30]]), from, NOW).movement).toBe('improved');
  });
  it('для роста формула та же', () => {
    const kpi: KpiSeries = { baseline: 100, target: 200, direction: 'increase', observations: [{ value: 150, observed_at: ago(3) }] };
    expect(kpiMovement(kpi, from, NOW)).toEqual({ movement: 'improved', delta: 50 });
  });
  it('удержание в диапазоне: в диапазоне — успех, вне — хуже', () => {
    const base = { baseline: 5, target: 5, direction: 'maintain' as const, range_min: 4, range_max: 6 };
    expect(kpiMovement({ ...base, observations: [{ value: 5.5, observed_at: ago(2) }] }, from, NOW).movement).toBe('improved');
    expect(kpiMovement({ ...base, observations: [{ value: 7, observed_at: ago(2) }] }, from, NOW).movement).toBe('worse');
  });
});

describe('northStar', () => {
  const goals = [
    goal('a', decrease([[28, 40], [1, 36.5]])),
    goal('b', decrease([[40, 38], [2, 39]])),
    goal('c', decrease([])),
    goal('d', null),
    goal('sub', null, { parent_id: 'a' }),
    goal('draft', decrease([[1, 30]]), { activated_at: null }),
    goal('closed', decrease([[1, 30]]), { closed_at: ago(3) }),
  ];
  const ns = northStar(goals, NOW);
  it('считает только активные цели с KPI; подцель без KPI — не сигнал', () => {
    expect(ns.total).toBe(3);
    expect(ns.without_kpi).toBe(1);
  });
  it('доля целей, сдвинувшихся к цели', () => {
    expect(ns.counts).toEqual({ improved: 1, flat: 0, worse: 1, stale: 1 });
    expect(ns.value).toBe(33);
  });
  it('сначала то, что требует внимания: хуже, затем без замеров', () => {
    expect(ns.items.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
  it('пустая компания — null, а не 0 %', () => {
    expect(northStar([], NOW).value).toBeNull();
    expect(northStar([goal('x', null)], NOW)).toMatchObject({ value: null, total: 0, without_kpi: 1 });
  });
  it('окно задаётся параметром', () => {
    expect(northStar([goal('a', decrease([[20, 38]]))], NOW, 7).counts.stale).toBe(1);
  });
});

describe('kpiFreshness', () => {
  it('замер старше 14 дней — устаревший', () => {
    const r = kpiFreshness([goal('a', decrease([[3, 39]])), goal('b', decrease([[20, 39]])), goal('c', decrease([]))], NOW);
    expect(r).toMatchObject({ value: 33, fresh: 1, total: 3, max_age_days: 14 });
    expect(r.stale.map((s) => s.id)).toEqual(['c', 'b']);
    expect(r.stale[0]!.last_observed_at).toBeNull();
  });
  it('ровно 14 дней — ещё свежий', () => {
    expect(kpiFreshness([goal('a', decrease([[14, 39]]))], NOW).value).toBe(100);
  });
  it('не учитывает замеры после момента расчёта', () => {
    expect(kpiFreshness([goal('a', decrease([[1, 39]]))], ago(10)).value).toBe(0);
  });
  it('нет активных целей с KPI — null', () => {
    expect(kpiFreshness([goal('a', decrease([[1, 39]]), { activated_at: null })], NOW).value).toBeNull();
  });
});

describe('launchRate', () => {
  it('доля целей, запущенных за 7 дней, и медиана', () => {
    const r = launchRate(
      [
        goal('fast', null, { created_at: ago(30), activated_at: ago(29) }),
        goal('slow', null, { created_at: ago(30), activated_at: ago(10) }),
        goal('stuck', null, { created_at: ago(30), activated_at: null }),
      ],
      NOW,
    );
    expect(r).toEqual({ value: 33, launched: 1, total: 3, within_days: 7, median_days: 10.5 });
  });
  it('свежий черновик не портит метрику: у него ещё есть время', () => {
    expect(launchRate([goal('new', null, { created_at: ago(2), activated_at: null })], NOW)).toMatchObject({ value: null, total: 0 });
  });
  it('свежая и уже запущенная цель засчитывается сразу', () => {
    expect(launchRate([goal('new', null, { created_at: ago(2), activated_at: ago(1) })], NOW)).toMatchObject({ value: 100, total: 1 });
  });
  it('будущее относительно момента расчёта не учитывается', () => {
    const g = goal('g', null, { created_at: ago(30), activated_at: ago(5) });
    expect(launchRate([g], ago(20))).toMatchObject({ launched: 0, total: 1 });
    expect(launchRate([g], ago(40)).total).toBe(0);
  });
});

describe('blockerStats', () => {
  const ev = (task: string, d: number, status: StatusEvent['status'], h = 0): StatusEvent => ({ task_id: task, status, at: ago(d, h) });
  const events = [
    ev('a', 20, 'in_progress'),
    ev('a', 17, 'blocked'),
    ev('a', 15, 'in_progress'),
    ev('b', 9, 'blocked'),
    ev('b', 9, 'blocked', 5),
    ev('b', 6, 'in_progress'),
    ev('c', 4, 'blocked'),
    ev('old', 50, 'blocked'),
    ev('old', 45, 'done'),
  ];
  it('медиана по блокерам, снятым за окно; повторный «blocked» не начинает новый эпизод', () => {
    expect(blockerStats(events, NOW)).toEqual({ median_hours: 60, resolved: 2, open: 1, oldest_open_hours: 96 });
  });
  it('блокер, снятый до окна, в медиану не входит', () => {
    expect(blockerStats(events, NOW, 10).resolved).toBe(1);
  });
  it('на прошлую дату открытый тогда блокер считается открытым', () => {
    expect(blockerStats(events, ago(7))).toMatchObject({ open: 1, resolved: 1, oldest_open_hours: 48 });
  });
  it('без блокеров — null', () => {
    expect(blockerStats([], NOW)).toEqual({ median_hours: null, resolved: 0, open: 0, oldest_open_hours: null });
  });
});

describe('onTimeWindow', () => {
  const tasks = [
    { due_at: '2026-10-10', done_at: '2026-10-10T18:00:00.000Z' },
    { due_at: '2026-10-10', done_at: '2026-10-12T09:00:00.000Z' },
    { due_at: null, done_at: '2026-10-12T09:00:00.000Z' },
    { due_at: '2026-10-10', done_at: null },
    { due_at: '2026-08-01', done_at: '2026-08-01T09:00:00.000Z' },
  ];
  it('в срок — закрыта в день срока или раньше', () => {
    expect(onTimeWindow(tasks, NOW)).toEqual({ value: 50, on_time: 1, total: 2 });
  });
  it('задачи вне окна не учитываются', () => {
    expect(onTimeWindow(tasks, NOW, 5).total).toBe(0);
  });
});

describe('productMetrics', () => {
  const input = {
    goals: [goal('a', decrease([[28, 40], [14, 38], [1, 36.5]]))],
    events: [{ task_id: 't', status: 'blocked' as const, at: ago(10) }, { task_id: 't', status: 'in_progress' as const, at: ago(8) }],
    tasks: [{ due_at: '2026-10-15', done_at: '2026-10-14T10:00:00.000Z' }],
  };
  const m = productMetrics(input, NOW);
  it('собирает все метрики на один момент', () => {
    expect(m.at).toBe(NOW);
    expect(m.window_days).toBe(30);
    expect(m.north_star.value).toBe(100);
    expect(m.freshness.value).toBe(100);
    expect(m.blockers.median_hours).toBe(48);
    expect(m.on_time.value).toBe(100);
  });
  it('ряд — 8 недельных точек, последняя совпадает с текущим значением', () => {
    expect(m.series.at).toHaveLength(8);
    expect(m.series.at[7]).toBe(NOW);
    expect(m.series.at[6]).toBe(ago(7));
    expect(m.series.north_star[7]).toBe(m.north_star.value);
    expect(m.series.blocker_hours[7]).toBe(48);
  });
  it('в прошлом точка считается по данным того дня', () => {
    // 6 недель назад цель уже шла, но замеров ещё не было.
    expect(m.series.north_star[1]).toBe(0);
    expect(m.series.freshness[1]).toBe(0);
    expect(m.series.blocker_hours[0]).toBeNull();
  });
  it('число недель настраивается', () => {
    expect(productMetrics(input, NOW, { weeks: 3 }).series.at).toHaveLength(3);
  });
});

describe('formatHours и seriesTrend', () => {
  it('часы до двух суток, дальше дни', () => {
    expect(formatHours(null)).toBe('—');
    expect(formatHours(0.4)).toBe('< 1\u00a0ч');
    expect(formatHours(36)).toBe('36\u00a0ч');
    expect(formatHours(48)).toBe('2\u00a0дня');
    expect(formatHours(60)).toBe('2,5\u00a0дня');
    expect(formatHours(120)).toBe('5\u00a0дней');
    expect(formatHours(24 * 21)).toBe('21\u00a0день');
  });
  it('тренд — разница первой и последней известной точки', () => {
    expect(seriesTrend([null, 20, null, 50])).toEqual({ delta: 30, steps: 2 });
    expect(seriesTrend([null, 20, 50, null])).toEqual({ delta: 30, steps: 1 });
    expect(seriesTrend([null, 20])).toBeNull();
    expect(seriesTrend([])).toBeNull();
  });
});
