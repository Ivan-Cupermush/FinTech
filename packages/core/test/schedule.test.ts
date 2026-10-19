import { describe, expect, it } from 'vitest';
import { criticalPath, downstream, expectedFinish, hasPath, proposeShifts, topoSort, wouldCreateCycle } from '../src/schedule';
import type { TaskLike } from '../src/task';

const today = '2026-11-10';

describe('граф зависимостей', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ];
  it('находит путь', () => {
    expect(hasPath(edges, 'a', 'c')).toBe(true);
    expect(hasPath(edges, 'c', 'a')).toBe(false);
  });
  it('запрещает цикл', () => {
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(edges, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(edges, 'a', 'c')).toBe(false);
  });
  it('топологическая сортировка', () => {
    expect(topoSort(['c', 'b', 'a'], edges)).toEqual(['a', 'b', 'c']);
  });
  it('цикл в данных — ошибка', () => {
    expect(() => topoSort(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).toThrow(/цикл/);
  });
  it('находит всех ожидающих', () => {
    expect(downstream(edges, 'a').sort()).toEqual(['b', 'c']);
  });
});

describe('expectedFinish', () => {
  it('выполненная — по факту', () => {
    expect(expectedFinish({ id: 'a', status: 'done', due_at: '2026-11-01', done_at: '2026-11-03T10:00:00Z' }, today)).toBe('2026-11-03');
  });
  it('просроченная — не раньше сегодня', () => {
    expect(expectedFinish({ id: 'a', status: 'in_progress', due_at: '2026-11-01' }, today)).toBe(today);
  });
  it('отменённая не влияет', () => {
    expect(expectedFinish({ id: 'a', status: 'cancelled', due_at: '2026-11-01' }, today)).toBeNull();
  });
});

describe('proposeShifts — сценарий А', () => {
  const tasks: TaskLike[] = [
    { id: 'it', status: 'in_progress', start_at: '2026-11-01', due_at: '2026-11-05' },
    { id: 'qa', status: 'todo', start_at: '2026-11-06', due_at: '2026-11-08' },
    { id: 'rollout', status: 'todo', start_at: '2026-11-09', due_at: '2026-11-12' },
  ];
  const edges = [
    { from: 'it', to: 'qa' },
    { from: 'qa', to: 'rollout' },
  ];

  it('задержка IT сдвигает проверку и внедрение с сохранением длительности', () => {
    const p = proposeShifts(tasks, edges, today);
    expect(p).toHaveLength(2);
    const qa = p.find((x) => x.task_id === 'qa')!;
    expect(qa.to_start).toBe('2026-11-11');
    expect(qa.to_due).toBe('2026-11-13');
    expect(qa.shift_days).toBe(5);
    expect(qa.because).toEqual(['it']);
    const rollout = p.find((x) => x.task_id === 'rollout')!;
    expect(rollout.to_start).toBe('2026-11-14');
    expect(rollout.to_due).toBe('2026-11-17');
    expect(rollout.because).toEqual(['qa']);
  });

  it('если всё в срок — предложений нет', () => {
    expect(proposeShifts(tasks, edges, '2026-11-02')).toEqual([]);
  });

  it('не трогает уже начатые задачи', () => {
    const started = tasks.map((t) => (t.id === 'qa' ? { ...t, status: 'in_progress' as const } : t));
    const p = proposeShifts(started, edges, today);
    expect(p.find((x) => x.task_id === 'qa')).toBeUndefined();
  });

  it('берёт самого позднего предшественника', () => {
    const t2: TaskLike[] = [
      { id: 'a', status: 'done', due_at: '2026-11-05', done_at: '2026-11-04T00:00:00Z' },
      { id: 'b', status: 'in_progress', due_at: '2026-11-07' },
      { id: 'c', status: 'todo', start_at: '2026-11-06', due_at: '2026-11-07' },
    ];
    const p = proposeShifts(t2, [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }], '2026-11-01');
    expect(p[0]).toMatchObject({ task_id: 'c', to_start: '2026-11-08', because: ['b'] });
  });

  it('задача без срока не ломает расчёт', () => {
    const t3: TaskLike[] = [
      { id: 'a', status: 'in_progress', due_at: null },
      { id: 'b', status: 'todo', due_at: '2026-11-08' },
    ];
    expect(proposeShifts(t3, [{ from: 'a', to: 'b' }], today)).toEqual([]);
  });
});

describe('criticalPath', () => {
  it('выбирает самую длинную цепочку', () => {
    const tasks: TaskLike[] = [
      { id: 'a', status: 'todo', start_at: '2026-11-01', due_at: '2026-11-03' },
      { id: 'b', status: 'todo', start_at: '2026-11-04', due_at: '2026-11-10' },
      { id: 'c', status: 'todo', start_at: '2026-11-04', due_at: '2026-11-04' },
      { id: 'd', status: 'todo', start_at: '2026-11-11', due_at: '2026-11-12' },
    ];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'd' },
    ];
    expect(criticalPath(tasks, edges)).toEqual(['a', 'b', 'd']);
  });
  it('без связей пути нет', () => {
    expect(criticalPath([{ id: 'a', status: 'todo' }], [])).toEqual([]);
  });
  it('отменённые задачи не входят', () => {
    const tasks: TaskLike[] = [
      { id: 'a', status: 'cancelled', start_at: '2026-11-01', due_at: '2026-11-30' },
      { id: 'b', status: 'todo', start_at: '2026-11-01', due_at: '2026-11-02' },
      { id: 'c', status: 'todo', start_at: '2026-11-03', due_at: '2026-11-04' },
    ];
    expect(criticalPath(tasks, [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }])).toEqual(['b', 'c']);
  });
});
