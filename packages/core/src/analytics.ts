import { hoursBetween } from './dates';
import type { BlockerReason, TaskStatus } from './task';

/** Запись истории статуса задачи. */
export interface StatusEvent {
  task_id: string;
  status: TaskStatus;
  at: string;
  blocked_reason?: BlockerReason | null;
  unit_id?: string | null;
}

export interface TaskTimeline {
  task_id: string;
  /** Часы в каждом статусе. */
  hours: Partial<Record<TaskStatus, number>>;
  /** Часы блокировки по причинам. */
  blockedBy: Partial<Record<BlockerReason, number>>;
  leadHours: number | null;
}

/**
 * Разбирает историю статусов: сколько задача провела в работе, в ожидании,
 * на приёмке. Последний открытый интервал считаем до `now`.
 */
export function taskTimeline(events: readonly StatusEvent[], now: string): TaskTimeline[] {
  const groups = new Map<string, StatusEvent[]>();
  for (const e of events) groups.set(e.task_id, [...(groups.get(e.task_id) ?? []), e]);
  const out: TaskTimeline[] = [];
  for (const [task_id, list] of groups) {
    const sorted = [...list].sort((a, b) => (a.at < b.at ? -1 : 1));
    const hours: Partial<Record<TaskStatus, number>> = {};
    const blockedBy: Partial<Record<BlockerReason, number>> = {};
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]!;
      if (cur.status === 'done' || cur.status === 'cancelled') continue;
      const end = sorted[i + 1]?.at ?? now;
      const h = Math.max(0, hoursBetween(cur.at, end));
      hours[cur.status] = (hours[cur.status] ?? 0) + h;
      if (cur.status === 'blocked') {
        const r = cur.blocked_reason ?? 'other';
        blockedBy[r] = (blockedBy[r] ?? 0) + h;
      }
    }
    const done = sorted.find((e) => e.status === 'done');
    out.push({ task_id, hours, blockedBy, leadHours: done ? hoursBetween(sorted[0]!.at, done.at) : null });
  }
  return out;
}

export interface Bottleneck {
  key: string;
  hours: number;
  share: number;
}

/** «Где теряется время»: суммарные часы ожидания по причинам, доля от всего ожидания. */
export function bottlenecks(timelines: readonly TaskTimeline[]): Bottleneck[] {
  const total = new Map<string, number>();
  for (const t of timelines) {
    for (const [k, v] of Object.entries(t.blockedBy)) total.set(k, (total.get(k) ?? 0) + (v ?? 0));
    if (t.hours.review) total.set('review', (total.get('review') ?? 0) + t.hours.review);
  }
  const sum = [...total.values()].reduce((a, b) => a + b, 0);
  return [...total.entries()]
    .map(([key, hours]) => ({ key, hours, share: sum ? Math.round((hours / sum) * 100) : 0 }))
    .sort((a, b) => b.hours - a.hours);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Сводка процесса: медиана lead time и ожидания, доля времени в ожидании. */
export function processSummary(timelines: readonly TaskTimeline[]) {
  const leads = timelines.map((t) => t.leadHours).filter((v): v is number => v !== null);
  const waits = timelines.map((t) => (t.hours.blocked ?? 0) + (t.hours.review ?? 0));
  const work = timelines.map((t) => t.hours.in_progress ?? 0);
  const waitSum = waits.reduce((a, b) => a + b, 0);
  const workSum = work.reduce((a, b) => a + b, 0);
  return {
    medianLeadHours: median(leads),
    medianWaitHours: median(waits),
    waitShare: waitSum + workSum ? Math.round((waitSum / (waitSum + workSum)) * 100) : null,
    finished: leads.length,
  };
}
