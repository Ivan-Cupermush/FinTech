import { addDays, diffDays } from './dates';
import type { TaskStatus } from './task';

/**
 * Капиллярная карта цели: задачи — узлы на оси времени, зависимости —
 * светящиеся капилляры между ними, в конце — сама цель. Здесь только
 * геометрия в долях (x — 0…1 по времени, lane — ряд вверх или вниз от
 * центральной линии); пиксели и анимацию рисуют сайт и приложение.
 */

export type CapNodeState = 'done' | 'active' | 'blocked' | 'overdue' | 'planned';

export interface CapTaskInput {
  id: string;
  title: string;
  status: TaskStatus;
  start_at: string | null;
  due_at: string | null;
  done_at: string | null;
  checkpoints?: readonly { status: string }[];
}

export interface CapNode {
  id: string;
  kind: 'task' | 'goal';
  title: string;
  /** Положение по времени: 0 — левый край шкалы, 1 — правый. */
  x: number;
  /** Ряд: 0 — центральная линия, отрицательные — выше, положительные — ниже. */
  lane: number;
  state: CapNodeState;
  /** На критическом пути цели. */
  critical: boolean;
  /** Дата, по которой узел стоит на шкале (YYYY-MM-DD). */
  date: string;
  /** Доля пройденных контрольных точек, 0…100; null — точек нет. */
  progress: number | null;
}

export interface CapLink {
  from: string;
  to: string;
  critical: boolean;
  /** Импульс гаснет, не дойдя до конца: путь упирается в блокировку или просрочку. */
  broken: boolean;
  /** Обе стороны уже выполнены — капилляр спокойный. */
  done: boolean;
}

export interface CapLayout {
  nodes: CapNode[];
  links: CapLink[];
  laneMin: number;
  laneMax: number;
  /** Сегодня на шкале, 0…1. */
  today: number;
  from: string;
  to: string;
  months: { label: string; x: number }[];
}

export interface CapInput {
  tasks: readonly CapTaskInput[];
  edges: readonly { from: string; to: string }[];
  critical_path: readonly string[];
  today: string;
  goal: { id: string; title: string; due_at: string | null };
  /** Минимальный зазор между узлами одного ряда, в долях шкалы. */
  minGap?: number;
  /** Сколько рядов можно занять вверх и вниз от центральной линии. */
  maxLanes?: number;
  /**
   * Насколько шкала «по порядку», а не по календарю: 0 — чистый календарь,
   * 1 — события через равные промежутки. По умолчанию 0,65: когда все задачи
   * в одном месяце, а цель через полгода, узлы не слипаются в кучу.
   */
  ordinal?: number;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function capNodeState(t: Pick<CapTaskInput, 'status' | 'due_at'>, today: string): CapNodeState {
  if (t.status === 'done') return 'done';
  if (t.status === 'blocked') return 'blocked';
  if (t.due_at && t.due_at < today) return 'overdue';
  if (t.status === 'in_progress' || t.status === 'review') return 'active';
  return 'planned';
}

const minIso = (a: string, b: string) => (a < b ? a : b);
const maxIso = (a: string, b: string) => (a > b ? a : b);

/**
 * Шкала времени: монотонная, но растянутая там, где событий много. Опорные
 * даты (события, края) стоят на смеси календарной и порядковой позиции,
 * между ними — линейно. Порядок дат сохраняется всегда.
 */
export function timeScale(lo: string, hi: string, events: readonly string[], ordinal: number): (iso: string) => number {
  const span = Math.max(diffDays(lo, hi), 1);
  const anchors = [...new Set([lo, hi, ...events.filter((d) => d > lo && d < hi)])].sort();
  const n = anchors.length;
  const at = anchors.map((d, i) => (1 - ordinal) * (diffDays(lo, d) / span) + ordinal * (i / (n - 1)));
  return (iso: string) => {
    if (iso <= lo) return 0;
    if (iso >= hi) return 1;
    let i = 1;
    while (anchors[i]! < iso) i++;
    const a = anchors[i - 1]!;
    const b = anchors[i]!;
    const k = diffDays(a, iso) / Math.max(diffDays(a, b), 1);
    return at[i - 1]! + (at[i]! - at[i - 1]!) * k;
  };
}

/** Порядок лучей от предпочтительного ряда: p, p−1, p+1, p−2, p+2… */
function laneOrder(p: number, max: number): number[] {
  const out: number[] = [p];
  for (let d = 1; out.length < max * 2 + 1 && d <= max * 2; d++) for (const l of [p - d, p + d]) if (Math.abs(l) <= max && !out.includes(l)) out.push(l);
  return out;
}

export function layoutCapillary(input: CapInput): CapLayout {
  const minGap = input.minGap ?? 0.08;
  const maxLanes = input.maxLanes ?? 3;
  const tasks = input.tasks.filter((t) => t.status !== 'cancelled');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const edges = input.edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of edges) {
    preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
    succs.set(e.from, [...(succs.get(e.from) ?? []), e.to]);
  }

  // Дата узла: выполненная — когда сделали, остальные — срок, потом начало.
  // Без дат — сразу после самой поздней из предшествующих (или сегодня).
  const dates = new Map<string, string>();
  const dateOf = (id: string, seen = new Set<string>()): string => {
    const known = dates.get(id);
    if (known) return known;
    const t = byId.get(id)!;
    let d = (t.status === 'done' && t.done_at ? t.done_at.slice(0, 10) : null) ?? t.due_at ?? t.start_at;
    if (!d) {
      seen.add(id);
      const before = (preds.get(id) ?? []).filter((p) => !seen.has(p)).map((p) => dateOf(p, seen));
      d = before.length ? addDays(before.reduce(maxIso), 3) : input.today;
    }
    dates.set(id, d);
    return d;
  };
  for (const t of tasks) dateOf(t.id);

  const taskDates = [...dates.values()];
  const lastTask = taskDates.length ? taskDates.reduce(maxIso) : input.today;
  const goalDate = input.goal.due_at ? maxIso(input.goal.due_at, lastTask) : addDays(lastTask, 7);
  const lo = addDays([input.today, goalDate, ...taskDates].reduce(minIso), -4);
  const hi = addDays([input.today, goalDate, ...taskDates].reduce(maxIso), 4);
  const pos = timeScale(lo, hi, [input.today, goalDate, ...taskDates], input.ordinal ?? 0.65);

  const critical = new Set(input.critical_path.filter((id) => byId.has(id)));
  const lanes = new Map<number, number[]>();
  const placed = new Map<string, { x: number; lane: number }>();
  const free = (lane: number, x: number) => (lanes.get(lane) ?? []).every((o) => Math.abs(o - x) >= minGap - 1e-9);
  const put = (id: string, lane: number, x: number) => {
    lanes.set(lane, [...(lanes.get(lane) ?? []), x]);
    placed.set(id, { x, lane });
  };
  /** Ставит узел в ближайший свободный ряд; если всё занято — сдвигает вправо. */
  const place = (id: string, x: number, preferred: number) => {
    for (const lane of laneOrder(preferred, maxLanes)) if (free(lane, x)) return put(id, lane, x);
    let nx = x;
    while (!free(preferred, nx) && nx < 1 + minGap * tasks.length) nx += minGap / 2;
    put(id, preferred, nx);
  };

  // Сначала центральная линия — цель, потом критический путь, потом остальные слева направо.
  const goalX = pos(goalDate);
  put(input.goal.id, 0, goalX);
  const ordered = [...tasks].sort((a, b) => dates.get(a.id)!.localeCompare(dates.get(b.id)!) || a.id.localeCompare(b.id));
  for (const t of ordered.filter((t) => critical.has(t.id))) place(t.id, pos(dates.get(t.id)!), 0);
  for (const t of ordered) {
    if (critical.has(t.id)) continue;
    const x = pos(dates.get(t.id)!);
    const anchor = [...(preds.get(t.id) ?? []), ...(succs.get(t.id) ?? [])].map((p) => placed.get(p)).find(Boolean);
    // Ответвление от центральной линии уходит вверх, как приток.
    const preferred = anchor ? (anchor.lane === 0 ? -1 : anchor.lane) : -1;
    place(t.id, x, preferred);
  }
  // Сдвиги вправо могли вылезти за край — сжимаем всё обратно в 0…1.
  const maxX = Math.max(...[...placed.values()].map((p) => p.x), 1);
  const k = 1 / maxX;

  const nodes: CapNode[] = ordered.map((t) => {
    const p = placed.get(t.id)!;
    const cps = t.checkpoints ?? [];
    return {
      id: t.id,
      kind: 'task',
      title: t.title,
      x: p.x * k,
      lane: p.lane,
      state: capNodeState(t, input.today),
      critical: critical.has(t.id),
      date: dates.get(t.id)!,
      progress: t.status === 'done' ? 100 : cps.length ? Math.round((cps.filter((c) => c.status === 'done').length / cps.length) * 100) : null,
    };
  });
  const stateOf = new Map(nodes.map((n) => [n.id, n.state]));
  const sinks = nodes.filter((n) => !(succs.get(n.id) ?? []).length);
  const anyLate = nodes.some((n) => n.state === 'blocked' || n.state === 'overdue');
  nodes.push({
    id: input.goal.id,
    kind: 'goal',
    title: input.goal.title,
    x: goalX * k,
    lane: 0,
    state: nodes.length && nodes.every((n) => n.state === 'done') ? 'done' : anyLate ? 'overdue' : 'planned',
    critical: critical.size > 0,
    date: goalDate,
    progress: nodes.length ? Math.round((nodes.filter((n) => n.state === 'done').length / nodes.length) * 100) : null,
  });

  const path = input.critical_path.filter((id) => critical.has(id));
  const step = new Set(path.slice(1).map((id, i) => `${path[i]}>${id}`));
  const late = (s: CapNodeState | undefined) => s === 'blocked' || s === 'overdue';
  const links: CapLink[] = [
    ...edges.map((e) => ({ from: e.from, to: e.to })),
    ...sinks.map((s) => ({ from: s.id, to: input.goal.id })),
  ].map((e) => ({
    ...e,
    critical: step.has(`${e.from}>${e.to}`) || (e.to === input.goal.id && path[path.length - 1] === e.from),
    broken: late(stateOf.get(e.from)) || late(stateOf.get(e.to)),
    done: stateOf.get(e.from) === 'done' && stateOf.get(e.to) === 'done',
  }));

  const usedLanes = nodes.map((n) => n.lane);
  const months: { label: string; x: number }[] = [];
  let [y, m] = lo.split('-').map(Number) as [number, number];
  // Начало шкалы посреди месяца: подписываем и его, если до следующего есть место.
  const startDay = Number(lo.slice(8, 10));
  if (startDay > 1 && startDay <= 20) months.push({ label: `${MONTHS[m - 1]}${m === 1 ? ` ${y}` : ''}`, x: 0 });
  for (;;) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    if (first > hi) break;
    if (first >= lo) months.push({ label: `${MONTHS[m - 1]}${m === 1 ? ` ${y}` : ''}`, x: pos(first) * k });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return {
    nodes,
    links,
    laneMin: Math.min(0, ...usedLanes),
    laneMax: Math.max(0, ...usedLanes),
    today: pos(input.today) * k,
    from: lo,
    to: hi,
    months,
  };
}

/**
 * Капилляр между двумя точками: кубическая кривая с горизонтальными
 * касательными, как сосуд, плавно меняющий ряд.
 */
export function capillaryPath(x1: number, y1: number, x2: number, y2: number, bow = 0): string {
  const f = (v: number) => Math.round(v * 10) / 10;
  const dx = Math.max(Math.abs(x2 - x1) * 0.5, 24);
  // bow выгибает сосуд дугой — чтобы он обходил узлы своего же ряда, а не шёл сквозь них.
  return `M${f(x1)} ${f(y1)} C${f(x1 + dx)} ${f(y1 + bow)} ${f(x2 - dx)} ${f(y2 + bow)} ${f(x2)} ${f(y2)}`;
}

/** Нужно ли выгнуть капилляр: в его ряду между концами стоят другие узлы. */
export function needsBow(layout: Pick<CapLayout, 'nodes'>, from: string, to: string): boolean {
  const a = layout.nodes.find((n) => n.id === from);
  const b = layout.nodes.find((n) => n.id === to);
  if (!a || !b || a.lane !== b.lane) return false;
  const [lo, hi] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
  return layout.nodes.some((n) => n.lane === a.lane && n.id !== from && n.id !== to && n.x > lo && n.x < hi);
}
