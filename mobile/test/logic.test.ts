import { describe, expect, it } from 'vitest';
import { canTransitionKind, canTransitionTask, findTemplate, TASK_STATUSES, type Task } from '@offix/core';
import { dueText, effectRoute, greeting, pushCard, sparkSegments, taskActions, taskSections, tasksStats, TASK_SCOPES, TASK_SCOPE_EMPTY, templateDueChoices, templateKpiText, discussionLine, discussionStats, inboxStats, pulseStats, pushSummary } from '../src/lib/logic';

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
  kind: 'task',
  thanked_at: null,
  archived: null,
  checkpoints: [],
  watcher_ids: [],
  created_by: 'u1',
  created_by_name: null,
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
  it('у просьбы нет приёмки: из работы — сразу «Выполнено»', () => {
    expect(taskActions({ status: 'in_progress', kind: 'request' }).map((a) => [a.status, a.label, a.primary])).toEqual([
      ['done', 'Выполнено', true],
      ['blocked', 'Есть блокер', false],
    ]);
    for (const s of TASK_STATUSES) for (const a of taskActions({ status: s, kind: 'request' })) expect(canTransitionKind('request', s, a.status)).toBe(true);
  });
});

describe('вкладки задач', () => {
  it('те же запросы, что на сайте, и у каждой — своё пустое состояние', () => {
    expect(TASK_SCOPES.map((s) => [s.value, s.filter])).toEqual([
      ['mine', 'mine=1'],
      ['all', ''],
      ['requests', 'created=1&kind=request'],
      ['watching', 'watching=1'],
      ['archive', 'archived=1'],
    ]);
    for (const s of TASK_SCOPES) expect(TASK_SCOPE_EMPTY[s.value].title).toBeTruthy();
  });
  it('шапка: в работе, с блокером, просрочены — тревожные подсвечены', () => {
    const stats = tasksStats([task('a', { status: 'in_progress' }), task('b', { status: 'blocked' }), task('c', { status: 'todo', due_at: '2026-10-10' }), task('d', { status: 'done', due_at: '2026-10-01' })], TODAY);
    expect(stats.map((s) => [s.label, s.value, s.tone])).toEqual([
      ['в работе', 1, undefined],
      ['с блокером', 1, 'bad'],
      ['просрочены', 1, 'warn'],
    ]);
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
  it('внутри секции — по светофору: сорванная точка выше задачи по плану', () => {
    const s = taskSections([task('ok', { status: 'in_progress', due_at: '2026-10-25' }), task('cp', { status: 'in_progress', due_at: '2026-10-30', checkpoints: [{ id: 'c', title: 'x', due_at: '2026-10-15', status: 'pending' }] })], TODAY);
    expect(s[0]!.data.map((t) => t.id)).toEqual(['cp', 'ok']);
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

describe('шаблоны целей', () => {
  it('KPI шаблона одной строкой', () => {
    expect(templateKpiText(findTemplate('application-time')!)).toBe('40 → 30 мин');
    expect(templateKpiText(findTemplate('student-nps')!)).toBe('15 → 35 п.');
  });
  it('срок «по плану» первым, даты без повторов', () => {
    const c = templateDueChoices({ plan_days: 73 }, TODAY);
    expect(c[0]).toEqual({ label: 'По плану', value: '2026-12-31' });
    // 19 октября + 73 дня = 31 декабря — совпадает с «Конец квартала»/«Конец года», повтор убран.
    expect(new Set(c.map((d) => d.value)).size).toBe(c.length);
    expect(c.map((d) => d.value)).toEqual(['2026-12-31', '2026-10-31']);
  });
});

describe('строка «Обсуждение»', () => {
  it('пусто — приглашение', () => {
    expect(discussionLine(undefined)).toEqual({ text: 'Пока нет комментариев — задайте вопрос здесь, а не в мессенджере', unread: 0 });
    expect(discussionLine({ total: 0, unread: 0 }).unread).toBe(0);
  });
  it('число комментариев и новых с согласованием', () => {
    expect(discussionLine({ total: 1, unread: 0 }).text).toBe('1 комментарий');
    expect(discussionLine({ total: 5, unread: 2 })).toEqual({ text: '5 комментариев · 2 новых', unread: 2 });
    expect(discussionLine({ total: 21, unread: 1 }).text).toBe('21 комментарий · 1 новый');
  });
});

describe('pulseStats', () => {
  it('в шапке Пульса — критичные риски, просьбы о помощи и мои задачи', () => {
    const s = pulseStats({
      risks: [{ severity: 'critical' }, { severity: 'warning' }, { severity: 'critical' }] as never,
      help_needed: [{}] as never,
      my_tasks: [{}, {}, {}, {}] as never,
    });
    expect(s.map((x) => x.value)).toEqual([2, 1, 4]);
    expect(s.map((x) => x.label)).toEqual(['под угрозой', 'ждут помощи', 'мои задачи']);
    expect(s[0]!.tone).toBe('bad');
  });
  it('ноль угроз не подсвечивается', () => {
    expect(pulseStats({ risks: [], help_needed: [], my_tasks: [] }).every((x) => !x.tone)).toBe(true);
  });
});

describe('шапки экранов', () => {
  it('«Входящие»: непрочитанные, блокеры среди них и обсуждения', () => {
    const s = inboxStats([
      { kind: 'task_blocked', read_at: null },
      { kind: 'task_blocked', read_at: '2026-10-20T10:00:00Z' },
      { kind: 'comment', read_at: null },
      { kind: 'goal_assigned', read_at: null },
    ]);
    expect(s.map((x) => x.value)).toEqual([3, 1, 1]);
    expect(s[1]!.tone).toBe('bad');
    expect(inboxStats([{ kind: 'comment', read_at: '2026-10-20' }])[1]!.tone).toBeUndefined();
  });
  it('обсуждение: комментарии, участники без повторов и новые', () => {
    const s = discussionStats([{ author_id: 'a' }, { author_id: 'b' }, { author_id: 'a' }], 2);
    expect(s.map((x) => x.value)).toEqual([3, 2, 2]);
  });
  it('настройки push коротко говорят, что включено', () => {
    expect(pushSummary({ muted: [], quiet_hours: true }, 1)).toBe('Все темы включены · ночью тихо.');
    expect(pushSummary({ muted: ['comments'], quiet_hours: false }, 2)).toBe('Включено 4 из 5 тем.');
    expect(pushSummary({ muted: [], quiet_hours: true }, 0)).toMatch(/не привязан/);
  });
});
