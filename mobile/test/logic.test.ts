import { describe, expect, it } from 'vitest';
import { canTransitionTask, TASK_STATUSES, type Task } from '@offix/core';
import { dueText, effectRoute, greeting, pushCard, sparkSegments, taskActions, taskSections } from '../src/lib/logic';

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

describe('effectRoute', () => {
  it('шаг ведёт на экран приложения', () => {
    expect(effectRoute({ kind: 'goal', id: 'g1' })).toBe('/goal/g1');
    expect(effectRoute({ kind: 'blocked_tasks' })).toBe('/tasks');
    expect(effectRoute({ kind: 'goals' })).toBe('/goals');
  });
});

describe('sparkSegments', () => {
  it('пропуски рвут линию, точки ложатся по всей ширине', () => {
    const segs = sparkSegments([0, 100, null, 50], 300, 46, 100);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual([{ x: 0, y: 43 }, { x: 100, y: 3 }]);
    expect(segs[1]).toEqual([{ x: 300, y: 23 }]);
  });
  it('значения за пределами шкалы прижимаются к краю', () => {
    expect(sparkSegments([150, -10], 10, 46, 100)[0]!.map((p) => p.y)).toEqual([3, 43]);
  });
  it('без данных — пусто; одна точка — по центру', () => {
    expect(sparkSegments([null, null], 100, 40)).toEqual([]);
    expect(sparkSegments([5], 100, 40)[0]![0]!.x).toBe(50);
  });
  it('отступ по краям не даёт обрезать крайние точки', () => {
    expect(sparkSegments([1, 2], 100, 40, 2, 0, 5)[0]!.map((p) => p.x)).toEqual([5, 95]);
  });
});

describe('pushCard', () => {
  it('разрешение ещё не спрашивали — включить по кнопке', () => {
    expect(pushCard('undetermined')).toMatchObject({ action: 'enable', label: 'Включить' });
  });
  it('запрещено — ведём в настройки телефона', () => {
    expect(pushCard('denied')).toMatchObject({ action: 'settings', label: 'Открыть настройки' });
  });
  it('включено — можно настроить темы и тихие часы', () => {
    const c = pushCard('granted');
    expect(c).toMatchObject({ action: 'configure', label: 'Настроить' });
    expect(c.text).toContain('22:00');
  });
  it('веб и симулятор — без кнопки', () => {
    const c = pushCard('unsupported');
    expect(c.action).toBeNull();
    expect(c.label).toBeUndefined();
  });
  it('у каждого действия есть подпись', () => {
    for (const perm of ['granted', 'denied', 'undetermined', 'unsupported'] as const) {
      const c = pushCard(perm);
      expect(c.title.length).toBeGreaterThan(0);
      if (c.action) expect(c.label).toBeTruthy();
    }
  });
});
