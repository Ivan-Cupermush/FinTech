import { kpiProgress } from '@offix/core';
import type { GoalCard, Metric, Roadmap, Task } from '../src/lib/types';

export const TODAY = '2026-10-19';

export function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Задача ${id}`,
    description: null,
    status: 'todo',
    assignee: { id: 'u-anna', display_name: 'Анна Королёва' },
    team: null,
    unit: null,
    start_at: null,
    due_at: null,
    done_at: null,
    definition_of_done: null,
    blocker: null,
    goal_ids: [],
    depends_on: [],
    permissions: { view: true, edit: true, status: true },
    ...over,
  };
}

export function metric(over: Partial<Metric> = {}): Metric {
  const base = { baseline: 40, target: 30, direction: 'decrease' as const, current_value: 36.5 as number | null, ...over };
  return {
    id: 'm1',
    name: 'Время согласования',
    unit: 'minutes',
    range_min: null,
    range_max: null,
    is_primary: true,
    last_observed_at: '2026-10-15T09:00:00.000Z',
    planned_change: -25,
    ...base,
    progress: over.progress ?? kpiProgress(base, base.current_value),
  };
}

export function goalCard(over: Partial<GoalCard> = {}): GoalCard {
  return {
    id: 'g1',
    title: 'Сократить время согласования заявки',
    description: 'Студенты ждут слишком долго',
    type: 'strategic',
    status: 'active',
    parent_goal_id: null,
    owner: { id: 'u-olga', display_name: 'Ольга Смирнова' },
    created_by: null,
    due_at: '2026-12-31',
    metrics: [metric()],
    progress: 35,
    task_progress: { done: 1, total: 3, percent: 33 },
    units: [{ id: 'unit-office', name: 'Учебный офис', unit_type: 'department', role: 'owner' }],
    children_count: 1,
    checklist: [
      { key: 'title', label: 'Название результата', done: true },
      { key: 'type', label: 'Тип цели', done: true },
      { key: 'owner', label: 'Владелец цели', done: true },
      { key: 'due', label: 'Срок достижения', done: true },
      { key: 'kpi', label: 'Измеримый KPI', done: true },
    ],
    permissions: { edit: true, manage: true, activate: true, record: true, audit: true },
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

export function roadmap(over: Partial<Roadmap> = {}): Roadmap {
  const tasks = [
    task('t1', { title: 'Описать процесс', status: 'done', start_at: '2026-10-01', due_at: '2026-10-05', done_at: '2026-10-05T10:00:00Z' }),
    task('t2', { title: 'Подключить API', status: 'blocked', start_at: '2026-10-06', due_at: '2026-10-16', blocker: { reason: 'technical', note: 'Нет доступа', since: '2026-10-16T09:00:00Z', next_step: null } }),
    task('t3', { title: 'Обучить сотрудников', start_at: '2026-10-17', due_at: '2026-10-24' }),
    task('t4', { title: 'Отменённая', status: 'cancelled' }),
  ];
  return {
    goal: goalCard(),
    subgoals: [
      {
        id: 'sg1',
        title: 'Автоматизировать заявку',
        status: 'active',
        due_at: '2026-11-30',
        owner: { id: 'u-igor', display_name: 'Игорь Волков' },
        metrics: [],
        task_ids: ['t2', 't3', 't4'],
        task_progress: { done: 0, total: 2 },
      },
    ],
    direct_task_ids: ['t1'],
    tasks,
    edges: [
      { from: 't1', to: 't2' },
      { from: 't2', to: 't3' },
    ],
    critical_path: ['t1', 't2', 't3'],
    risks: [
      {
        id: 'dep-t3',
        kind: 'dependency_delay',
        severity: 'warning',
        title: 'Задержка сдвигает «Обучить сотрудников»',
        explanation: '«Подключить API» не закончена вовремя',
        suggestion: 'Перенести срок на 4 дня',
        task_ids: ['t3'],
        proposals: [{ task_id: 't3', from_start: '2026-10-17', to_start: '2026-10-21', from_due: '2026-10-24', to_due: '2026-10-28', shift_days: 4, because: ['t2'] }],
      },
    ],
    timeline: { from: '2026-10-01', to: '2026-12-31', today: TODAY },
    analytics: { medianLeadHours: 30, medianWaitHours: 12, waitShare: 40, finished: 1, bottlenecks: [{ key: 'technical', hours: 72, share: 75 }, { key: 'review', hours: 24, share: 25 }], on_time_share: 100 },
    ...over,
  };
}
