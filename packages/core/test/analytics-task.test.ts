import { describe, expect, it } from 'vitest';
import { bottlenecks, processSummary, taskTimeline } from '../src/analytics';
import { canTransitionTask, isOverdue, onTimeShare, taskProgress } from '../src/task';
import { addDays, diffDays } from '../src/dates';

describe('задачи', () => {
  it('прогресс задач без отменённых', () => {
    expect(taskProgress([{ status: 'done' }, { status: 'todo' }, { status: 'cancelled' }])).toEqual({ done: 1, total: 2, percent: 50 });
    expect(taskProgress([]).percent).toBeNull();
  });
  it('просрочка', () => {
    expect(isOverdue({ id: 'a', status: 'todo', due_at: '2026-11-01' }, '2026-11-02')).toBe(true);
    expect(isOverdue({ id: 'a', status: 'done', due_at: '2026-11-01' }, '2026-11-02')).toBe(false);
    expect(isOverdue({ id: 'a', status: 'todo', due_at: '2026-11-02' }, '2026-11-02')).toBe(false);
  });
  it('доля в срок', () => {
    expect(
      onTimeShare([
        { id: 'a', status: 'done', due_at: '2026-11-05', done_at: '2026-11-05T18:00:00Z' },
        { id: 'b', status: 'done', due_at: '2026-11-05', done_at: '2026-11-07T10:00:00Z' },
        { id: 'c', status: 'todo', due_at: '2026-11-05' },
      ]),
    ).toBe(50);
    expect(onTimeShare([])).toBeNull();
  });
  it('переходы статусов задач', () => {
    expect(canTransitionTask('todo', 'in_progress')).toBe(true);
    expect(canTransitionTask('todo', 'done')).toBe(false);
    expect(canTransitionTask('blocked', 'in_progress')).toBe(true);
    expect(canTransitionTask('review', 'done')).toBe(true);
  });
});

describe('даты', () => {
  it('прибавляет дни через границу месяца и года', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(diffDays('2026-02-27', '2026-03-01')).toBe(2);
  });
});

describe('аналитика процессов', () => {
  const events = [
    { task_id: 'a', status: 'todo' as const, at: '2026-11-01T09:00:00Z' },
    { task_id: 'a', status: 'in_progress' as const, at: '2026-11-01T10:00:00Z' },
    { task_id: 'a', status: 'blocked' as const, at: '2026-11-01T12:00:00Z', blocked_reason: 'approval' as const },
    { task_id: 'a', status: 'in_progress' as const, at: '2026-11-02T12:00:00Z' },
    { task_id: 'a', status: 'review' as const, at: '2026-11-02T14:00:00Z' },
    { task_id: 'a', status: 'done' as const, at: '2026-11-02T18:00:00Z' },
    { task_id: 'b', status: 'in_progress' as const, at: '2026-11-03T10:00:00Z' },
    { task_id: 'b', status: 'blocked' as const, at: '2026-11-03T11:00:00Z', blocked_reason: 'data' as const },
  ];
  const tl = taskTimeline(events, '2026-11-03T16:00:00Z');

  it('считает часы в статусах', () => {
    const a = tl.find((t) => t.task_id === 'a')!;
    expect(a.hours.in_progress).toBe(4);
    expect(a.hours.blocked).toBe(24);
    expect(a.hours.review).toBe(4);
    expect(a.leadHours).toBe(33);
    expect(a.blockedBy.approval).toBe(24);
  });

  it('открытый интервал считается до «сейчас»', () => {
    const b = tl.find((t) => t.task_id === 'b')!;
    expect(b.blockedBy.data).toBe(5);
    expect(b.leadHours).toBeNull();
  });

  it('узкие места отсортированы по потерям', () => {
    const bn = bottlenecks(tl);
    expect(bn.map((x) => x.key)).toEqual(['approval', 'data', 'review']);
    expect(bn[0]!.share).toBe(73);
  });

  it('сводка процесса', () => {
    const s = processSummary(tl);
    expect(s.medianLeadHours).toBe(33);
    expect(s.finished).toBe(1);
    expect(s.waitShare).toBe(87);
  });
});
