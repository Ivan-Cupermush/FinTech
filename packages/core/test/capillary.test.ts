import { describe, expect, it } from 'vitest';
import { capillaryPath, capNodeState, layoutCapillary, needsBow, timeScale, type CapTaskInput } from '../src/capillary';
import { criticalPath } from '../src/schedule';

const TODAY = '2026-11-02';
const task = (id: string, over: Partial<CapTaskInput> = {}): CapTaskInput => ({ id, title: id, status: 'todo', start_at: null, due_at: null, done_at: null, ...over });
const goal = { id: 'G', title: 'Цель', due_at: '2026-12-20' };

describe('capNodeState', () => {
  it('выполнена, блок, просрочка, в работе, план', () => {
    expect(capNodeState({ status: 'done', due_at: '2026-10-01' }, TODAY)).toBe('done');
    expect(capNodeState({ status: 'blocked', due_at: '2026-12-01' }, TODAY)).toBe('blocked');
    expect(capNodeState({ status: 'in_progress', due_at: '2026-11-01' }, TODAY)).toBe('overdue');
    expect(capNodeState({ status: 'review', due_at: '2026-11-02' }, TODAY)).toBe('active');
    expect(capNodeState({ status: 'todo', due_at: null }, TODAY)).toBe('planned');
  });
});

describe('layoutCapillary', () => {
  // A → B → D (длинная цепочка) и A → C (короткая ветка).
  const tasks = [
    task('A', { status: 'done', start_at: '2026-10-01', due_at: '2026-10-10', done_at: '2026-10-09T12:00:00Z' }),
    task('B', { status: 'in_progress', start_at: '2026-10-11', due_at: '2026-11-15', checkpoints: [{ status: 'done' }, { status: 'open' }, { status: 'open' }, { status: 'done' }] }),
    task('C', { start_at: '2026-10-11', due_at: '2026-11-14' }),
    task('D', { status: 'blocked', start_at: '2026-11-16', due_at: '2026-12-10' }),
    task('X', { status: 'cancelled', due_at: '2026-11-01' }),
  ];
  const edges = [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'D' },
    { from: 'A', to: 'C' },
    { from: 'X', to: 'D' },
  ];
  const cp = criticalPath(tasks.map((t) => ({ ...t })), edges);
  const L = layoutCapillary({ tasks, edges, critical_path: cp, today: TODAY, goal });
  const n = (id: string) => L.nodes.find((x) => x.id === id)!;

  it('критический путь из ядра и он лежит на центральной линии', () => {
    expect(cp).toEqual(['A', 'B', 'D']);
    for (const id of cp) {
      expect(n(id).critical).toBe(true);
      expect(n(id).lane).toBe(0);
    }
    expect(n('C').critical).toBe(false);
  });

  it('отменённые задачи не рисуются, цель — последний узел', () => {
    expect(L.nodes.map((x) => x.id)).toEqual(['A', 'C', 'B', 'D', 'G']);
    expect(n('G').kind).toBe('goal');
    expect(L.links.some((l) => l.from === 'X' || l.to === 'X')).toBe(false);
  });

  it('узлы идут по времени слева направо, всё в пределах 0…1', () => {
    expect(n('A').x).toBeLessThan(n('B').x);
    expect(n('B').x).toBeLessThan(n('D').x);
    expect(n('D').x).toBeLessThanOrEqual(n('G').x);
    for (const x of L.nodes) {
      expect(x.x).toBeGreaterThanOrEqual(0);
      expect(x.x).toBeLessThanOrEqual(1);
    }
    expect(L.today).toBeGreaterThan(n('A').x);
    expect(L.today).toBeLessThan(n('B').x);
  });

  it('узлы рядом по времени не налезают: ветка уходит в соседний ряд', () => {
    // C на день раньше B — в одном ряду они бы слиплись.
    expect(n('C').lane).not.toBe(n('B').lane);
    expect(n('C').lane).toBe(-1);
    expect(L.laneMin).toBe(-1);
    expect(L.laneMax).toBe(0);
  });

  it('выполненная задача стоит по дате выполнения; прогресс — по контрольным точкам', () => {
    expect(n('A').date).toBe('2026-10-09');
    expect(n('A').progress).toBe(100);
    expect(n('B').progress).toBe(50);
    expect(n('C').progress).toBeNull();
  });

  it('капилляры: критические шаги, концы к цели, гаснущий импульс у блокировки', () => {
    const link = (a: string, b: string) => L.links.find((l) => l.from === a && l.to === b)!;
    expect(link('A', 'B').critical).toBe(true);
    expect(link('B', 'D').critical).toBe(true);
    expect(link('A', 'C').critical).toBe(false);
    expect(link('D', 'G').critical).toBe(true);
    expect(link('C', 'G').critical).toBe(false);
    expect(link('B', 'D').broken).toBe(true);
    expect(link('D', 'G').broken).toBe(true);
    expect(link('A', 'B').broken).toBe(false);
    expect(L.links.filter((l) => l.to === 'G').map((l) => l.from).sort()).toEqual(['C', 'D']);
  });

  it('цель: есть блокировка — тревожная, прогресс — доля выполненных задач', () => {
    expect(n('G').state).toBe('overdue');
    expect(n('G').progress).toBe(25);
  });

  it('месяцы шкалы по порядку и с подписями', () => {
    expect(L.months.map((m) => m.label)).toEqual(['окт', 'ноя', 'дек']);
    for (let i = 1; i < L.months.length; i++) expect(L.months[i]!.x).toBeGreaterThan(L.months[i - 1]!.x);
  });

  it('задачи без дат встают сразу после предшественников', () => {
    const r = layoutCapillary({ tasks: [task('P', { due_at: '2026-11-20' }), task('Q')], edges: [{ from: 'P', to: 'Q' }], critical_path: [], today: TODAY, goal: { ...goal, due_at: null } });
    const q = r.nodes.find((x) => x.id === 'Q')!;
    expect(q.date).toBe('2026-11-23');
    expect(r.nodes.find((x) => x.kind === 'goal')!.date).toBe('2026-11-30');
  });

  it('много задач в один день — разные ряды, не больше заданного, и без наложений', () => {
    const many = Array.from({ length: 9 }, (_, i) => task(`T${i}`, { due_at: '2026-11-10' }));
    const r = layoutCapillary({ tasks: many, edges: [], critical_path: [], today: TODAY, goal, maxLanes: 2, minGap: 0.05 });
    const ts = r.nodes.filter((x) => x.kind === 'task');
    for (const a of ts) {
      expect(Math.abs(a.lane)).toBeLessThanOrEqual(2);
      for (const b of ts) if (a !== b && a.lane === b.lane) expect(Math.abs(a.x - b.x)).toBeGreaterThan(0.02);
    }
  });

  it('узлов больше, чем помещается: шкала растягивается, и после растяжения зазор в ряду — не меньше minGap', () => {
    const many = Array.from({ length: 20 }, (_, i) => task(`T${i}`, { due_at: '2026-11-10' }));
    const minGap = 0.2;
    const r = layoutCapillary({ tasks: many, edges: [], critical_path: [], today: TODAY, goal, maxLanes: 2, minGap });
    expect(r.stretch).toBeGreaterThan(1);
    const all = r.nodes;
    for (const a of all) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThanOrEqual(1);
      for (const b of all) if (a !== b && a.lane === b.lane) expect(Math.abs(a.x - b.x) * r.stretch).toBeGreaterThanOrEqual(minGap - 1e-9);
    }
  });

  it('всё помещается — растягивать не нужно', () => {
    const r = layoutCapillary({ tasks: [task('A', { due_at: '2026-11-05' }), task('B', { due_at: '2026-11-20' })], edges: [], critical_path: [], today: TODAY, goal });
    expect(r.stretch).toBe(1);
  });

  it('пустая цель — только узел цели', () => {
    const r = layoutCapillary({ tasks: [], edges: [], critical_path: [], today: TODAY, goal });
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]!.progress).toBeNull();
    expect(r.links).toEqual([]);
  });

  it('путь капилляра — кривая с горизонтальными касательными', () => {
    expect(capillaryPath(0, 10, 100, 50)).toBe('M0 10 C50 10 50 50 100 50');
    expect(capillaryPath(0, 0, 10, 0)).toBe('M0 0 C24 0 -14 0 10 0');
    expect(capillaryPath(0, 10, 100, 10, -30)).toBe('M0 10 C50 -20 50 -20 100 10');
  });

  it('капилляр через узел своего ряда выгибается дугой', () => {
    const nodes = [
      { id: 'a', x: 0.1, lane: -1 },
      { id: 'b', x: 0.4, lane: -1 },
      { id: 'c', x: 0.7, lane: -1 },
      { id: 'd', x: 0.5, lane: 0 },
    ] as never;
    expect(needsBow({ nodes }, 'a', 'c')).toBe(true);
    expect(needsBow({ nodes }, 'a', 'b')).toBe(false);
    expect(needsBow({ nodes }, 'a', 'd')).toBe(false);
  });
});

describe('timeScale', () => {
  const events = ['2026-10-10', '2026-10-12', '2026-10-14'];
  it('чистый календарь — линейно', () => {
    const f = timeScale('2026-10-01', '2026-12-30', events, 0);
    expect(f('2026-10-01')).toBe(0);
    expect(f('2026-12-30')).toBe(1);
    expect(f('2026-10-31')).toBeCloseTo(30 / 90);
  });
  it('с порядком — плотные события раздвигаются, порядок сохраняется', () => {
    const lin = timeScale('2026-10-01', '2026-12-30', events, 0);
    const mix = timeScale('2026-10-01', '2026-12-30', events, 0.65);
    expect(mix('2026-10-14') - mix('2026-10-10')).toBeGreaterThan(lin('2026-10-14') - lin('2026-10-10'));
    let prev = -1;
    for (let d = 0; d <= 90; d += 3) {
      const iso = new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10);
      const x = mix(iso);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });
  it('за краями — 0 и 1', () => {
    const f = timeScale('2026-10-01', '2026-12-30', events, 0.5);
    expect(f('2026-01-01')).toBe(0);
    expect(f('2027-05-01')).toBe(1);
  });
});
