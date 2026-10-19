import { addDays, diffDays, maxDate } from './dates';
import { isClosed, type TaskLike } from './task';

/** Связь «finish-to-start»: задача `to` начинается после завершения `from`. */
export interface Dependency {
  from: string;
  to: string;
}

function adjacency(edges: readonly Dependency[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    list.push(e.to);
    out.set(e.from, list);
  }
  return out;
}

/** Есть ли путь from → … → to. */
export function hasPath(edges: readonly Dependency[], from: string, to: string): boolean {
  const adj = adjacency(edges);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of adj.get(cur) ?? []) stack.push(n);
  }
  return false;
}

/** Создаст ли новая связь цикл (включая связь задачи с самой собой). */
export function wouldCreateCycle(edges: readonly Dependency[], from: string, to: string): boolean {
  return from === to || hasPath(edges, to, from);
}

/** Топологический порядок. Бросает ошибку при цикле. */
export function topoSort(ids: readonly string[], edges: readonly Dependency[]): string[] {
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const adj = adjacency(edges.filter((e) => indeg.has(e.from) && indeg.has(e.to)));
  for (const list of adj.values()) for (const to of list) indeg.set(to, (indeg.get(to) ?? 0) + 1);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const n of adj.get(cur) ?? []) {
      const d = (indeg.get(n) ?? 0) - 1;
      indeg.set(n, d);
      if (d === 0) queue.push(n);
    }
  }
  if (order.length !== ids.length) throw new Error('Зависимости задач образуют цикл');
  return order;
}

/**
 * Ожидаемая дата завершения задачи: закрытая — по факту, просроченная — не
 * раньше сегодняшнего дня (раз ещё не готова, раньше завтра не закончится).
 */
export function expectedFinish(t: TaskLike, today: string): string | null {
  if (t.status === 'done') return (t.done_at ?? t.due_at ?? today).slice(0, 10);
  if (t.status === 'cancelled') return null;
  if (!t.due_at) return null;
  return t.due_at < today ? today : t.due_at;
}

export interface ShiftProposal {
  task_id: string;
  from_start: string | null;
  to_start: string;
  from_due: string | null;
  to_due: string;
  shift_days: number;
  /** Задачи, из-за которых нужен сдвиг. */
  because: string[];
}

/**
 * Сценарий А: задержка задачи сдвигает зависимые. Система НЕ переносит сроки
 * сама — возвращает предложение, руководитель подтверждает (ТЗ 2.5).
 * Длительность каждой задачи сохраняется.
 */
export function proposeShifts(tasks: readonly TaskLike[], edges: readonly Dependency[], today: string): ShiftProposal[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const order = topoSort(
    tasks.map((t) => t.id),
    edges,
  );
  const finish = new Map<string, string | null>();
  const proposals: ShiftProposal[] = [];
  const preds = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
  }
  for (const id of order) {
    const t = byId.get(id)!;
    let fin = expectedFinish(t, today);
    if (!isClosed(t) && t.due_at) {
      let earliestStart: string | null = null;
      const blamed: string[] = [];
      for (const p of preds.get(id) ?? []) {
        const pf = finish.get(p);
        if (!pf) continue;
        const candidate = addDays(pf, 1);
        if (!earliestStart || candidate > earliestStart) earliestStart = candidate;
      }
      const plannedStart = t.start_at ?? t.due_at;
      if (earliestStart && t.status === 'todo' && earliestStart > plannedStart) {
        const shift = diffDays(plannedStart, earliestStart);
        for (const p of preds.get(id) ?? []) {
          const pf = finish.get(p);
          if (pf && addDays(pf, 1) > plannedStart) blamed.push(p);
        }
        const toDue = addDays(t.due_at, shift);
        proposals.push({
          task_id: id,
          from_start: t.start_at ?? null,
          to_start: t.start_at ? addDays(t.start_at, shift) : earliestStart,
          from_due: t.due_at,
          to_due: toDue,
          shift_days: shift,
          because: blamed,
        });
        fin = maxDate(toDue, fin ?? toDue);
      }
    }
    finish.set(id, fin);
  }
  return proposals;
}

/**
 * Критический путь: самая длинная по времени цепочка зависимых задач.
 * Её задержка = задержка всей цели. Длительность задачи — дни от start до due
 * включительно (без start — 1 день).
 */
export function criticalPath(tasks: readonly TaskLike[], edges: readonly Dependency[]): string[] {
  const open = tasks.filter((t) => t.status !== 'cancelled');
  const ids = open.map((t) => t.id);
  const byId = new Map(open.map((t) => [t.id, t]));
  const inSet = edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const order = topoSort(ids, inSet);
  const dur = (t: TaskLike) => (t.start_at && t.due_at ? Math.max(1, diffDays(t.start_at, t.due_at) + 1) : 1);
  const best = new Map<string, { len: number; prev: string | null }>();
  const preds = new Map<string, string[]>();
  for (const e of inSet) preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
  for (const id of order) {
    const t = byId.get(id)!;
    let len = dur(t);
    let prev: string | null = null;
    for (const p of preds.get(id) ?? []) {
      const pb = best.get(p)!;
      if (pb.len + dur(t) > len) {
        len = pb.len + dur(t);
        prev = p;
      }
    }
    best.set(id, { len, prev });
  }
  let end: string | null = null;
  let max = 0;
  for (const [id, b] of best) {
    if (b.len > max) {
      max = b.len;
      end = id;
    }
  }
  // Одиночная задача без связей — не «путь».
  if (!end || !best.get(end)!.prev) return [];
  const path: string[] = [];
  let cur: string | null = end;
  while (cur) {
    path.unshift(cur);
    cur = best.get(cur)!.prev;
  }
  return path;
}

/** Все задачи, которые прямо или транзитивно ждут данную. */
export function downstream(edges: readonly Dependency[], id: string): string[] {
  const adj = adjacency(edges);
  const seen = new Set<string>();
  const stack = [...(adj.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(adj.get(cur) ?? []));
  }
  return [...seen];
}
