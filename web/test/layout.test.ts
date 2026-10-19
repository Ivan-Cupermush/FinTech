import { describe, expect, it } from 'vitest';
import { buildScale, collectProposals, groupRoadmap, sortTasks } from '../src/features/goals/roadmapLayout';
import { groupTasks } from '../src/features/tasks/TasksPage';
import { groupByDay } from '../src/features/notifications/NotificationsPage';
import { roadmap, task, TODAY } from './fixtures';

describe('groupRoadmap', () => {
  it('подцели идут первыми, прямые задачи — отдельной группой в конце', () => {
    const g = groupRoadmap(roadmap());
    expect(g.map((x) => x.title)).toEqual(['Автоматизировать заявку', 'Задачи цели']);
    expect(g[1]!.kind).toBe('direct');
  });
  it('отменённые задачи в карту не попадают', () => {
    const g = groupRoadmap(roadmap());
    expect(g[0]!.tasks.map((t) => t.id)).toEqual(['t2', 't3']);
  });
  it('без прямых задач группы «Задачи цели» нет', () => {
    expect(groupRoadmap(roadmap({ direct_task_ids: [] })).map((x) => x.id)).toEqual(['sg1']);
  });
  it('задача, которой нет среди видимых, пропускается без ошибки', () => {
    const r = roadmap();
    r.subgoals[0]!.task_ids.push('hidden');
    expect(groupRoadmap(r)[0]!.tasks).toHaveLength(2);
  });
});

describe('sortTasks', () => {
  it('по началу, потом по сроку; без дат — в конце', () => {
    const list = sortTasks([task('c'), task('b', { due_at: '2026-10-10' }), task('a', { start_at: '2026-10-01', due_at: '2026-10-20' })]);
    expect(list.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildScale', () => {
  it('добавляет поля по краям и раскладывает даты в проценты', () => {
    const s = buildScale('2026-10-01', '2026-10-31', TODAY);
    expect(s.from).toBe('2026-09-28');
    expect(s.to).toBe('2026-11-04');
    expect(s.pos(s.from)).toBe(0);
    expect(s.pos(s.to)).toBeCloseTo(100);
    expect(s.pos(TODAY)).toBeGreaterThan(50);
  });
  it('однодневная задача видна — ширина не нулевая', () => {
    const s = buildScale('2026-10-01', '2026-10-31', TODAY);
    expect(s.width('2026-10-10', '2026-10-10')).toBeGreaterThan(0);
  });
  it('учитывает предложенные переносы за пределами плана', () => {
    const s = buildScale('2026-10-01', '2026-10-10', '2026-10-05', ['2026-11-20']);
    expect(s.to >= '2026-11-20').toBe(true);
  });
  it('подписи месяцев — в порядке, с годом у января', () => {
    const s = buildScale('2026-11-15', '2027-02-10', '2026-11-20');
    expect(s.months.map((m) => m.label)).toEqual(['дек', 'янв 2027', 'фев']);
    const lefts = s.months.map((m) => m.left);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
  });
  it('пустой план всё равно даёт минимум неделю шкалы', () => {
    expect(buildScale(TODAY, TODAY, TODAY).days).toBeGreaterThanOrEqual(7);
  });
});

describe('collectProposals', () => {
  it('по задаче берётся самый поздний предложенный срок', () => {
    const r = roadmap();
    r.risks.push({ ...r.risks[0]!, id: 'x', proposals: [{ ...r.risks[0]!.proposals![0]!, to_due: '2026-11-02' }] });
    expect(collectProposals(r).get('t3')!.to_due).toBe('2026-11-02');
  });
  it('риски без предложений ничего не добавляют', () => {
    expect(collectProposals(roadmap({ risks: [] })).size).toBe(0);
  });
});

describe('groupTasks', () => {
  it('блокеры первыми, просрочка отдельно, отменённые скрыты', () => {
    const g = groupTasks(
      [
        task('a', { status: 'in_progress', due_at: '2026-10-01' }),
        task('b', { status: 'blocked', due_at: '2026-10-01' }),
        task('c', { status: 'todo' }),
        task('d', { status: 'cancelled' }),
        task('e', { status: 'done', due_at: '2026-10-01' }),
      ],
      TODAY,
    );
    expect(g.map((x) => [x.key, x.items.map((t) => t.id)])).toEqual([
      ['blocked', ['b']],
      ['overdue', ['a']],
      ['todo', ['c']],
      ['done', ['e']],
    ]);
  });
  it('внутри группы — по сроку, без срока в конце', () => {
    const g = groupTasks([task('a', { due_at: '2026-12-01' }), task('b'), task('c', { due_at: '2026-11-01' })], TODAY);
    expect(g[0]!.items.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('groupByDay', () => {
  const n = (id: string, at: string) => ({ id, kind: 'comment', title: id, body: null, goal_id: null, task_id: null, read_at: null, created_at: at });
  it('«Сегодня» и даты, подряд идущие дни склеиваются', () => {
    const g = groupByDay([n('1', '2026-10-19T10:00:00Z'), n('2', '2026-10-19T08:00:00Z'), n('3', '2026-10-17T08:00:00Z')], TODAY);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([
      ['Сегодня', 2],
      ['17 октября', 1],
    ]);
  });
});
