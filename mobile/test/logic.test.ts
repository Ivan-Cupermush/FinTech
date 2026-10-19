import { describe, expect, it } from 'vitest';
import { canTransitionTask, TASK_STATUSES, type Task } from '@offix/core';
import { dueText, greeting, taskActions, taskSections } from '../src/lib/logic';

const TODAY = '2026-10-19';
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: null,
  status: 'todo',
  assignee: null,
  team: null,
  unit: null,
  start_at: null,
  due_at: null,
  done_at: null,
  definition_of_done: null,
  blocker: null,
  goal_ids: [],
  depends_on: [],
  ...over,
});

describe('dueText', () => {
  it('просрочка, сегодня, завтра и будущее', () => {
    expect(dueText('2026-10-16', TODAY)).toEqual({ text: 'просрочено на 3 дня', overdue: true });
    expect(dueText(TODAY, TODAY).text).toBe('сегодня');
    expect(dueText('2026-10-20', TODAY).text).toBe('завтра');
    expect(dueText('2026-10-24', TODAY).text).toMatch(/через 5 дней/);
    expect(dueText(null, TODAY)).toEqual({ text: 'Без срока', overdue: false });
  });
  it('просрочка на 1 день — правильное склонение', () => {
    expect(dueText('2026-10-18', TODAY).text).toBe('просрочено на 1 день');
  });
});

describe('taskActions', () => {
  it('каждое действие — разрешённый переход ядра', () => {
    for (const s of TASK_STATUSES) for (const a of taskActions({ status: s })) expect(canTransitionTask(s, a.status)).toBe(true);
  });
  it('ровно одно главное действие там, где оно есть', () => {
    for (const s of ['todo', 'in_progress', 'blocked', 'review'] as const) expect(taskActions({ status: s }).filter((a) => a.primary)).toHaveLength(1);
  });
  it('у отменённой задачи действий нет', () => {
    expect(taskActions({ status: 'cancelled' })).toEqual([]);
  });
});

describe('taskSections', () => {
  it('блокеры и просрочка сверху, отменённые скрыты, пустые секции убраны', () => {
    const s = taskSections(
      [task('a', { status: 'in_progress', due_at: '2026-10-01' }), task('b', { status: 'blocked' }), task('c'), task('d', { status: 'cancelled' }), task('e', { status: 'review' })],
      TODAY,
    );
    expect(s.map((x) => [x.key, x.data.map((t) => t.id)])).toEqual([
      ['blocked', ['b']],
      ['overdue', ['a']],
      ['active', ['e']],
      ['todo', ['c']],
    ]);
  });
  it('задача не попадает в две секции', () => {
    const s = taskSections([task('a', { status: 'todo', due_at: '2026-10-01' })], TODAY);
    expect(s.flatMap((x) => x.data)).toHaveLength(1);
  });
});

it('приветствие по времени суток', () => {
  expect([3, 9, 14, 21].map(greeting)).toEqual(['Доброй ночи', 'Доброе утро', 'Добрый день', 'Добрый вечер']);
});
