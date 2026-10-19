import { addDays, diffDays, type ShiftProposal } from '@offix/core';
import type { Roadmap, Task } from '../../lib/types';

export interface RoadmapGroup {
  id: string;
  title: string;
  /** Подцель или «Задачи цели» — прямые задачи без подцели. */
  kind: 'subgoal' | 'direct';
  owner: string | null;
  due_at: string | null;
  done: number;
  total: number;
  tasks: Task[];
}

/** Дерево: цель → подцели → задачи. Задача, привязанная к нескольким подцелям, показывается в каждой. */
export function groupRoadmap(r: Roadmap): RoadmapGroup[] {
  const byId = new Map(r.tasks.map((t) => [t.id, t]));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((t): t is Task => !!t && t.status !== 'cancelled');
  const groups: RoadmapGroup[] = r.subgoals.map((s) => ({
    id: s.id,
    title: s.title,
    kind: 'subgoal',
    owner: s.owner?.display_name ?? null,
    due_at: s.due_at,
    done: s.task_progress.done,
    total: s.task_progress.total,
    tasks: sortTasks(pick(s.task_ids)),
  }));
  const direct = pick(r.direct_task_ids);
  if (direct.length)
    groups.push({
      id: 'direct',
      title: 'Задачи цели',
      kind: 'direct',
      owner: null,
      due_at: r.goal.due_at,
      done: direct.filter((t) => t.status === 'done').length,
      total: direct.length,
      tasks: sortTasks(direct),
    });
  return groups;
}

/** По сроку начала, затем по сроку окончания; без дат — в конец. */
export function sortTasks(tasks: Task[]): Task[] {
  const k = (t: Task) => t.start_at ?? t.due_at ?? '9999-12-31';
  return [...tasks].sort((a, b) => k(a).localeCompare(k(b)) || (a.due_at ?? '').localeCompare(b.due_at ?? ''));
}

export interface Scale {
  from: string;
  to: string;
  days: number;
  /** Позиция даты в процентах ширины дорожки. */
  pos: (iso: string) => number;
  /** Ширина отрезка [start; due] включительно, в процентах. */
  width: (start: string, due: string) => number;
  months: { label: string; left: number }[];
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Шкала таймлайна с запасом по краям, чтобы бары не прилипали к границам. */
export function buildScale(from: string, to: string, today: string, extra: string[] = []): Scale {
  const all = [from, to, today, ...extra];
  const min = addDays(all.reduce((a, b) => (a < b ? a : b)), -3);
  const max = addDays(all.reduce((a, b) => (a > b ? a : b)), 4);
  const days = Math.max(diffDays(min, max), 7);
  const pos = (iso: string) => (diffDays(min, iso) / days) * 100;
  const width = (start: string, due: string) => Math.max(((diffDays(start, due) + 1) / days) * 100, 0.8);
  const months: { label: string; left: number }[] = [];
  let [y, m] = min.split('-').map(Number) as [number, number];
  for (;;) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    if (first > max) break;
    if (first >= min) months.push({ label: `${MONTHS[m - 1]}${m === 1 ? ` ${y}` : ''}`, left: pos(first) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return { from: min, to: max, days, pos, width, months };
}

/** Предложения переноса из всех рисков, по задаче — самое позднее. */
export function collectProposals(r: Roadmap): Map<string, ShiftProposal> {
  const out = new Map<string, ShiftProposal>();
  for (const risk of r.risks)
    for (const p of risk.proposals ?? []) {
      const cur = out.get(p.task_id);
      if (!cur || p.to_due > cur.to_due) out.set(p.task_id, p);
    }
  return out;
}
