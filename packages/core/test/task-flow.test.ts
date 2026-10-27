import { describe, expect, it } from 'vitest';
import {
  archiveNote,
  byLight,
  canArchive,
  canThank,
  inboxTaskAction,
  canTransitionKind,
  checkpointProgress,
  checkpointState,
  lightOf,
  lightsFromRisks,
  nextCheckpoint,
  shouldAutoArchive,
  taskCalendar,
  taskLight,
  taskMonthGrid,
  tasksForDay,
  TASK_ROLE_LABELS,
  validateCheckpoint,
  validateRequest,
  requestDuePresets,
  requestBadge,
  requestFrom,
  type Risk,
} from '../src';

const today = '2026-11-10';

describe('просьба и задача', () => {
  it('у просьбы нет приёмки: из работы сразу в «Выполнена»', () => {
    expect(canTransitionKind('request', 'in_progress', 'review')).toBe(false);
    expect(canTransitionKind('request', 'todo', 'done')).toBe(true);
    expect(canTransitionKind('task', 'in_progress', 'review')).toBe(true);
    expect(canTransitionKind('task', 'todo', 'done')).toBe(false);
  });

  it('поблагодарить может автор выполненной просьбы и один раз', () => {
    const r = { kind: 'request' as const, status: 'done' as const, created_by: 'a', thanked_at: null };
    expect(canThank(r, 'a')).toBe(true);
    expect(canThank(r, 'b')).toBe(false);
    expect(canThank({ ...r, thanked_at: '2026-11-10T10:00:00Z' }, 'a')).toBe(false);
    expect(canThank({ ...r, status: 'in_progress' }, 'a')).toBe(false);
    expect(canThank({ ...r, kind: 'task' }, 'a')).toBe(false);
  });

  it('подписи просьбы без склонения имён', () => {
    const r = { created_by: 'a', created_by_name: 'Игорь Лебедев', assignee: { id: 'b' } };
    expect(requestBadge(r, 'a')).toBe('Ваша просьба');
    expect(requestBadge(r, 'b')).toBe('Вас просят');
    expect(requestBadge(r, 'c')).toBe('Просьба');
    expect(requestFrom(r, 'b')).toBe('просит Игорь Лебедев');
    expect(requestFrom(r, 'a')).toBeNull();
    expect(requestFrom({ created_by: 'a', created_by_name: null }, 'b')).toBeNull();
  });

  it('наблюдатель стоит рядом с согласующим', () => {
    expect(TASK_ROLE_LABELS.watcher).toBe('Наблюдает');
    expect(Object.keys(TASK_ROLE_LABELS)).toEqual(['owner', 'executor', 'approver', 'watcher', 'contributor']);
  });
});

describe('контрольные точки', () => {
  it('состояние: пройдена, сорвана, срок прошёл, скоро, впереди', () => {
    expect(checkpointState({ status: 'done', due_at: '2026-11-01' }, today)).toBe('done');
    expect(checkpointState({ status: 'missed', due_at: '2026-11-20' }, today)).toBe('missed');
    expect(checkpointState({ status: 'pending', due_at: '2026-11-09' }, today)).toBe('late');
    expect(checkpointState({ status: 'pending', due_at: '2026-11-12' }, today)).toBe('soon');
    expect(checkpointState({ status: 'pending', due_at: '2026-11-20' }, today)).toBe('pending');
  });

  it('прогресс и ближайшая точка', () => {
    const list = [
      { status: 'done' as const, due_at: '2026-11-01' },
      { status: 'pending' as const, due_at: '2026-11-25' },
      { status: 'pending' as const, due_at: '2026-11-15' },
    ];
    expect(checkpointProgress(list)).toEqual({ done: 1, total: 3 });
    expect(nextCheckpoint(list)?.due_at).toBe('2026-11-15');
    expect(nextCheckpoint([])).toBeNull();
  });

  it('точка — не позже срока задачи и с названием', () => {
    expect(validateCheckpoint({ title: '  ', due_at: '2026-11-15' }, '2026-11-30')).toEqual({ title: 'Назовите контрольную точку' });
    expect(validateCheckpoint({ title: 'Стенд', due_at: '2026-12-15' }, '2026-11-30').due_at).toContain('не позже срока');
    expect(validateCheckpoint({ title: 'Стенд', due_at: '15.11.2026' }, null).due_at).toContain('ГГГГ-ММ-ДД');
    expect(validateCheckpoint({ title: 'Стенд', due_at: '2026-12-15' }, null)).toEqual({});
  });
});

describe('архив', () => {
  const closed = { status: 'done' as const, done_at: '2026-11-05T10:00:00Z', closed_at: null, archived_at: null, unarchived_at: null };

  it('выполненная задача уходит в архив через три дня', () => {
    expect(shouldAutoArchive(closed, '2026-11-08T09:00:00Z')).toBe(false);
    expect(shouldAutoArchive(closed, '2026-11-08T10:00:00Z')).toBe(true);
    expect(shouldAutoArchive({ ...closed, status: 'in_progress' }, '2026-11-20T10:00:00Z')).toBe(false);
    expect(shouldAutoArchive({ ...closed, archived_at: '2026-11-09T00:00:00Z' }, '2026-11-20T10:00:00Z')).toBe(false);
  });

  it('вернули из архива после закрытия — сама больше не уходит; закрыли снова — уходит', () => {
    expect(shouldAutoArchive({ ...closed, unarchived_at: '2026-11-09T00:00:00Z' }, '2026-11-20T10:00:00Z')).toBe(false);
    expect(shouldAutoArchive({ ...closed, unarchived_at: '2026-11-04T00:00:00Z' }, '2026-11-20T10:00:00Z')).toBe(true);
    expect(shouldAutoArchive({ ...closed, status: 'cancelled', done_at: null, closed_at: '2026-11-01T00:00:00Z' }, '2026-11-05T00:00:00Z')).toBe(true);
  });

  it('руками в архив — только закрытую', () => {
    expect(canArchive({ status: 'in_progress', archived_at: null })).toContain('выполненные и отменённые');
    expect(canArchive({ status: 'done', archived_at: null })).toBeNull();
    expect(canArchive({ status: 'done', archived_at: '2026-11-01T00:00:00Z' })).toBe('Задача уже в архиве');
  });

  it('подпись архива: кто убрал или автоматически', () => {
    expect(archiveNote({ archived_at: '2026-11-10T08:00:00Z', archived_by_name: 'Ольга' }, today)).toBe('Убрана в архив сегодня · Ольга');
    expect(archiveNote({ archived_at: '2026-11-07T08:00:00Z', archived_by_name: null }, today)).toBe('Убрана в архив 3 дня назад автоматически — через 3 дня после закрытия');
    expect(archiveNote({ archived_at: null }, today)).toBeNull();
  });
});

describe('календарь задач', () => {
  const tasks = [
    { id: '1', status: 'todo' as const, due_at: '2026-11-05' },
    { id: '2', status: 'done' as const, due_at: '2026-11-05' },
    { id: '3', status: 'in_progress' as const, due_at: '2026-11-12' },
    { id: '4', status: 'cancelled' as const, due_at: '2026-11-12' },
    { id: '5', status: 'todo' as const, due_at: '2026-12-01' },
    { id: '6', status: 'todo' as const, due_at: null },
  ];

  it('дни месяца со сроками и просрочкой', () => {
    expect(taskCalendar(tasks, '2026-11', today)).toEqual([
      { date: '2026-11-05', count: 2, late: 1 },
      { date: '2026-11-12', count: 1, late: 0 },
    ]);
  });

  it('сетка месяца несёт число задач и просрочку', () => {
    const grid = taskMonthGrid('2026-11', taskCalendar(tasks, '2026-11', today), { today, selected: '2026-11-12' });
    const cells = grid.flat();
    expect(grid).toHaveLength(6);
    expect(cells.find((c) => c.date === '2026-11-05')).toMatchObject({ count: 2, late: 1 });
    expect(cells.find((c) => c.date === '2026-11-12')).toMatchObject({ count: 1, late: 0, selected: true });
    expect(cells.find((c) => c.date === today)?.today).toBe(true);
  });

  it('задачи дня, а без дня — неделя от сегодня', () => {
    expect(tasksForDay(tasks, '2026-11-05', today).map((t) => t.id)).toEqual(['1', '2']);
    expect(tasksForDay(tasks, null, today).map((t) => t.id)).toEqual(['3']);
  });
});

describe('светофор задачи — это риск', () => {
  it('закрытая задача без цвета', () => {
    expect(taskLight({ id: '1', title: 'x', status: 'done', due_at: '2026-11-01' }, today)).toBeNull();
  });

  it('блокировка: три дня и больше или на критическом пути — красный', () => {
    const t = { id: '1', title: 'x', status: 'blocked' as const, blocked_reason: 'data' as const, blocked_since: '2026-11-09T10:00:00Z' };
    expect(taskLight(t, today)).toEqual({ light: 'yellow', reason: 'Заблокирована 1 день: не хватает данных' });
    expect(taskLight({ ...t, blocked_since: '2026-11-06T10:00:00Z' }, today)?.light).toBe('red');
    expect(taskLight(t, today, { critical: true })?.light).toBe('red');
  });

  it('просрочка — жёлтый, на критическом пути — красный', () => {
    const t = { id: '1', title: 'x', status: 'in_progress' as const, due_at: '2026-11-08' };
    expect(taskLight(t, today)).toEqual({ light: 'yellow', reason: 'Просрочена на 2 дня' });
    expect(taskLight(t, today, { critical: true })).toEqual({ light: 'red', reason: 'Просрочена на 2 дня — на критическом пути' });
  });

  it('сорванная точка и «срок завтра, а не начата» — жёлтый; иначе зелёный', () => {
    const base = { id: '1', title: 'x', status: 'in_progress' as const, due_at: '2026-11-30' };
    expect(taskLight({ ...base, checkpoints: [{ status: 'pending', due_at: '2026-11-09' }] }, today)?.reason).toBe('Контрольная точка не пройдена в срок');
    expect(taskLight({ ...base, checkpoints: [{ status: 'missed', due_at: '2026-11-20' }, { status: 'pending', due_at: '2026-11-01' }] }, today)?.reason).toBe('2 контрольные точки не пройдены в срок');
    expect(taskLight({ ...base, status: 'todo', due_at: '2026-11-11' }, today)?.reason).toBe('Срок завтра, а работа не начата');
    expect(taskLight(base, today)).toEqual({ light: 'green', reason: 'Срок 30 ноября' });
  });

  it('задача из API: блокировка объектом blocker даёт тот же цвет', () => {
    const t = { id: '1', title: 'x', status: 'blocked' as const, blocker: { reason: 'technical' as const, since: '2026-11-05T10:00:00Z' } };
    expect(lightOf(t, today)).toEqual({ light: 'red', reason: 'Заблокирована 5 дней: техническая проблема' });
    expect(lightOf({ id: '2', title: 'y', status: 'in_progress', due_at: '2026-11-30', blocker: null }, today)?.light).toBe('green');
  });

  it('сортировка: красные, жёлтые, зелёные, закрытые', () => {
    const list = [
      { id: 'g', title: 'x', status: 'in_progress' as const, due_at: '2026-11-30' },
      { id: 'd', title: 'x', status: 'done' as const, due_at: '2026-11-01' },
      { id: 'r', title: 'x', status: 'blocked' as const, blocked_since: '2026-11-01T00:00:00Z' },
      { id: 'y', title: 'x', status: 'in_progress' as const, due_at: '2026-11-09' },
    ];
    expect(byLight(list, today).map((t) => t.id)).toEqual(['r', 'y', 'g', 'd']);
  });

  it('по рискам цели задача получает цвет самого серьёзного риска', () => {
    const risks = [
      { id: 'a', kind: 'overdue', severity: 'warning', title: '', explanation: '', suggestion: '', task_ids: ['t1', 't2'] },
      { id: 'b', kind: 'goal_deadline', severity: 'critical', title: '', explanation: '', suggestion: '', task_ids: ['t2'] },
    ] satisfies Risk[];
    const m = lightsFromRisks(risks);
    expect(m.get('t1')).toBe('yellow');
    expect(m.get('t2')).toBe('red');
    expect(m.has('t3')).toBe(false);
  });
});

describe('кнопки во «Входящих»', () => {
  const state = { kind: 'request' as const, status: 'todo' as const, thanked: false, mine: false, assignee: true };
  it('исполнитель берёт новую просьбу в работу прямо из уведомления', () => {
    expect(inboxTaskAction({ kind: 'task_request', task_state: state })).toEqual({ action: 'start', note: null });
    expect(inboxTaskAction({ kind: 'task_request', task_state: { ...state, status: 'in_progress' } })).toEqual({ action: null, note: 'В работе' });
    expect(inboxTaskAction({ kind: 'task_request', task_state: { ...state, status: 'done', thanked: true } }).note).toBe('Выполнено · вас поблагодарили');
  });

  it('автор благодарит за выполненную просьбу один раз', () => {
    const done = { ...state, status: 'done' as const, mine: true, assignee: false };
    expect(inboxTaskAction({ kind: 'task_done', task_state: done })).toEqual({ action: 'thank', note: null });
    expect(inboxTaskAction({ kind: 'task_done', task_state: { ...done, thanked: true } })).toEqual({ action: null, note: 'Вы поблагодарили' });
    expect(inboxTaskAction({ kind: 'task_done', task_state: { ...done, status: 'in_progress' } }).note).toBe('Просьбу вернули в работу');
  });

  it('за задачу и без состояния — кнопок нет', () => {
    expect(inboxTaskAction({ kind: 'task_done', task_state: { ...state, kind: 'task', status: 'done', mine: true } }).action).toBeNull();
    expect(inboxTaskAction({ kind: 'comment' })).toEqual({ action: null, note: null });
  });
});

describe('форма просьбы', () => {
  const ok = { title: 'Подпишите приказ', assignee_id: 'u2', due_at: '2026-11-12' };
  it('кого и о чём — обязательно; себе нельзя', () => {
    expect(validateRequest(ok, 'u1', today)).toEqual({});
    expect(validateRequest({ ...ok, title: ' ', assignee_id: null }, 'u1', today)).toEqual({ title: 'Напишите, о чём просите', assignee_id: 'Выберите, кого просите' });
    expect(validateRequest({ ...ok, assignee_id: 'u1' }, 'u1', today).assignee_id).toBe('Просьбу отправляют коллеге, а не себе');
  });
  it('быстрые сроки: «к пятнице» — только в начале недели', () => {
    // 10 ноября 2026 — вторник.
    expect(requestDuePresets(today)).toEqual([
      { label: 'Сегодня', value: '2026-11-10' },
      { label: 'Завтра', value: '2026-11-11' },
      { label: 'К пятнице', value: '2026-11-13' },
      { label: 'Через неделю', value: '2026-11-17' },
    ]);
    expect(requestDuePresets('2026-11-12').map((p) => p.label)).toEqual(['Сегодня', 'Завтра', 'Через неделю']);
  });
  it('срок — не в прошлом, точки — не позже срока', () => {
    expect(validateRequest({ ...ok, due_at: '2026-11-09' }, 'u1', today).due_at).toBe('Срок уже прошёл — выберите сегодня или позже');
    expect(validateRequest({ ...ok, due_at: null }, 'u1', today)).toEqual({});
    expect(validateRequest({ ...ok, checkpoints: [{ title: 'Черновик', due_at: '2026-11-11' }, { title: 'Итог', due_at: '2026-11-20' }] }, 'u1', today)).toEqual({ 'checkpoints.1': 'Контрольная точка — не позже срока задачи' });
  });
});
