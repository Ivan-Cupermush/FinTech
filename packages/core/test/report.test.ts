import { describe, expect, it } from 'vitest';
import {
  REPORT_CSV_COLUMNS,
  buildReport,
  isReportPeriod,
  kpiLine,
  productMetrics,
  reportCsv,
  reportFileName,
  reportPeriodText,
  reportText,
  shiftIso,
  type GoalHistory,
  type ReportGoalInput,
  type ReportInput,
  type Risk,
} from '../src';

const NOW = '2026-10-19T12:00:00.000Z';
const ago = (days: number) => shiftIso(NOW, -days);

const risk = (severity: Risk['severity'], title: string, suggestion = 'Помогите исполнителю'): Risk => ({
  id: `${severity}:${title}`,
  kind: severity === 'info' ? 'no_measurement' : 'blocked',
  severity,
  title,
  explanation: `Пояснение: ${title}`,
  suggestion,
  task_ids: [],
});

const kpi = (obs: [daysAgo: number, value: number][], over: Partial<NonNullable<ReportGoalInput['kpi']>> = {}): NonNullable<ReportGoalInput['kpi']> => ({
  name: 'Время обработки заявки',
  unit: 'minutes',
  baseline: 40,
  target: 30,
  direction: 'decrease',
  observations: obs.map(([d, value]) => ({ value, observed_at: ago(d) })),
  ...over,
});

const goal = (id: string, over: Partial<ReportGoalInput> = {}): ReportGoalInput => ({
  id,
  title: `Цель ${id}`,
  status: 'active',
  owner_name: 'Ольга Смирнова',
  due_at: '2026-12-31',
  completed_at: null,
  kpi: null,
  risks: [],
  tasks: [],
  ...over,
});

function input(goals: ReportGoalInput[], over: Partial<ReportInput> = {}): ReportInput {
  const days = over.days ?? 30;
  const histories: GoalHistory[] = goals.map((g) => ({
    id: g.id,
    title: g.title,
    created_at: ago(60),
    activated_at: g.status === 'draft' ? null : ago(59),
    closed_at: g.status === 'active' ? null : (g.completed_at ?? ago(1)),
    kpi: g.kpi,
  }));
  const tasks = goals.flatMap((g) => g.tasks);
  return {
    company: 'Демо-университет',
    scope: 'company',
    author: 'Алексей Петров',
    at: NOW,
    days,
    goals,
    metrics: productMetrics({ goals: histories, events: [], tasks }, NOW, { windowDays: days }),
    ...over,
  };
}

describe('периоды отчёта', () => {
  it('только неделя, месяц и квартал', () => {
    expect(isReportPeriod(7)).toBe(true);
    expect(isReportPeriod(30)).toBe(true);
    expect(isReportPeriod(90)).toBe(true);
    expect(isReportPeriod(14)).toBe(false);
    expect(isReportPeriod('30')).toBe(false);
  });
  it('подпись периода: год пишем один раз, если он общий', () => {
    expect(reportPeriodText({ from: ago(30), at: NOW })).toBe('19 сентября — 19 октября 2026');
    expect(reportPeriodText({ from: '2025-12-20T12:00:00.000Z', at: '2026-01-19T12:00:00.000Z' })).toBe('20 декабря 2025 — 19 января 2026');
  });
  it('имя файла по дате отчёта', () => {
    expect(reportFileName({ at: NOW }, 'csv')).toBe('offix-otchet-2026-10-19.csv');
  });
});

describe('buildReport: какие цели попадают', () => {
  it('в работе и на паузе — да, черновик и отменённая — нет', () => {
    const r = buildReport(input([goal('a'), goal('b', { status: 'on_hold' }), goal('c', { status: 'draft' }), goal('d', { status: 'cancelled' })]));
    expect(r.goals.map((g) => g.id).sort()).toEqual(['a', 'b']);
  });
  it('завершённая — только если её завершили внутри периода', () => {
    const r = buildReport(
      input([goal('fresh', { status: 'completed', completed_at: ago(3) }), goal('old', { status: 'completed', completed_at: ago(45) })]),
    );
    expect(r.goals.map((g) => g.id)).toEqual(['fresh']);
    expect(r.goals[0]).toMatchObject({ health: 'done', completed_at: ago(3), top_risk: null });
  });
  it('квартал захватывает цель, завершённую полтора месяца назад', () => {
    const r = buildReport(input([goal('old', { status: 'completed', completed_at: ago(45) })], { days: 90 }));
    expect(r.goals).toHaveLength(1);
    expect(r.days).toBe(90);
    expect(r.from).toBe(ago(90));
  });
});

describe('buildReport: состояние цели и риски', () => {
  const r = buildReport(
    input([
      goal('ok', { title: 'Б по плану', risks: [risk('info', 'Нет свежих измерений')] }),
      goal('warn', { title: 'В с риском', risks: [risk('warning', 'Задержка затрагивает 2 задачи')] }),
      goal('crit', { title: 'А под угрозой', risks: [risk('warning', 'Предупреждение'), risk('critical', 'Цель может не успеть к сроку', 'Пересоберите план')] }),
    ]),
  );
  it('сначала то, что под угрозой', () => {
    expect(r.goals.map((g) => g.health)).toEqual(['critical', 'warning', 'blind']);
  });
  it('без рисков и с замерами — по плану; KPI не измеряли — «нет замеров», а не «по плану»', () => {
    expect(buildReport(input([goal('a')])).goals[0]!.health).toBe('ok');
    const blind = buildReport(input([goal('a', { risks: [risk('info', 'Нет свежих измерений «Время»')] })]));
    expect(blind.goals[0]).toMatchObject({ health: 'blind', top_risk: { severity: 'info' } });
    expect(blind.decisions).toEqual([]);
    expect(blind.summary).toContain('У 1 цели нет свежих замеров KPI, прогресс неизвестен.');
    expect(blind.summary).not.toContain('Критических рисков нет, цели идут по плану.');
  });
  it('главный риск — самый серьёзный', () => {
    expect(r.goals[0]!.top_risk).toMatchObject({ severity: 'critical', title: 'Цель может не успеть к сроку', suggestion: 'Пересоберите план' });
    expect(r.goals[1]!.top_risk).toMatchObject({ severity: 'warning' });
  });
  it('решения руководства: критические первыми, без справочных', () => {
    expect(r.decisions.map((d) => [d.goal_id, d.severity])).toEqual([
      ['crit', 'critical'],
      ['warn', 'warning'],
      ['crit', 'warning'],
    ]);
    expect(r.decisions[0]!.goal_title).toBe('А под угрозой');
  });
  it('решений не больше пяти', () => {
    const many = buildReport(input([goal('x', { risks: Array.from({ length: 8 }, (_, i) => risk('warning', `Риск ${i}`)) })]));
    expect(many.decisions).toHaveLength(5);
  });
  it('у завершённой цели нет решений', () => {
    const done = buildReport(input([goal('d', { status: 'completed', completed_at: ago(2), risks: [risk('critical', 'Старый риск')] })]));
    expect(done.decisions).toEqual([]);
    expect(done.headline.health).toEqual({ critical: 0, warning: 0, blind: 0, ok: 0, done: 1 });
  });
});

describe('buildReport: KPI за период', () => {
  it('замеров до периода не было — началом считается исходное значение', () => {
    expect(buildReport(input([goal('a', { kpi: kpi([[5, 36]]) })])).goals[0]!.kpi).toMatchObject({ start: 40, current: 36, delta: 40 });
  });
  it('значение на начало периода, сейчас, путь и сдвиг', () => {
    const r = buildReport(input([goal('a', { kpi: kpi([[50, 38], [20, 36.5], [2, 35]]) })]));
    expect(r.goals[0]!.kpi).toMatchObject({ start: 38, current: 35, progress: 50, movement: 'improved', delta: 30, last_observed_at: ago(2) });
  });
  it('без замеров — нет данных, а не ноль', () => {
    const k = buildReport(input([goal('a', { kpi: kpi([]) })])).goals[0]!.kpi!;
    expect(k).toMatchObject({ start: 40, current: null, progress: null, state: 'no_data', movement: 'stale' });
  });
  it('ухудшение видно с минусом', () => {
    const k = buildReport(input([goal('a', { kpi: kpi([[40, 36], [5, 42]]) })])).goals[0]!.kpi!;
    expect(k.progress).toBe(-20);
    expect(k.movement).toBe('worse');
    expect(k.delta).toBe(-60);
  });
  it('замер из будущего не попадает в отчёт', () => {
    const k = buildReport(input([goal('a', { kpi: kpi([[10, 36], [-3, 30]]) })])).goals[0]!.kpi!;
    expect(k.current).toBe(36);
    expect(k.last_observed_at).toBe(ago(10));
  });
});

describe('buildReport: задачи', () => {
  const tasks = [
    { id: 't1', status: 'done' as const, due_at: '2026-10-10', done_at: ago(9) },
    { id: 't2', status: 'done' as const, due_at: '2026-08-01', done_at: ago(60) },
    { id: 't3', status: 'blocked' as const, due_at: '2026-11-01', done_at: null },
    { id: 't4', status: 'in_progress' as const, due_at: '2026-10-01', done_at: null },
    { id: 't5', status: 'cancelled' as const, due_at: null, done_at: null },
  ];
  it('счётчики по цели: отменённые не считаются', () => {
    const r = buildReport(input([goal('a', { tasks })]));
    expect(r.goals[0]!.tasks).toEqual({ done: 2, total: 4, done_in_period: 1, blocked: 1, overdue: 1 });
  });
  it('общая задача двух целей в шапке считается один раз', () => {
    const r = buildReport(input([goal('a', { tasks }), goal('b', { tasks: [tasks[0]!] })]));
    expect(r.headline.tasks_done).toBe(1);
    expect(r.headline.on_time).toBe(100);
  });
});

describe('главное за период', () => {
  it('эффект, угроза, задачи и завершённые цели', () => {
    const r = buildReport(
      input([
        goal('a', { title: 'Сократить время обработки заявки', kpi: kpi([[50, 38], [2, 35]]), tasks: [{ id: 't1', status: 'done', due_at: '2026-10-30', done_at: ago(3) }] }),
        goal('b', { title: 'Сократить срок договоров', kpi: kpi([[50, 38]]), risks: [risk('critical', '«Согласование» заблокирована')] }),
        goal('c', { title: 'Запустить личный кабинет', status: 'completed', completed_at: ago(4) }),
      ]),
    );
    expect(r.summary).toEqual([
      '1 из 2 целей с KPI сдвинула показатель к цели.',
      'Под угрозой 1 цель: «Сократить срок договоров». «Согласование» заблокирована.',
      'Закрыта 1 задача, 100 % в срок.',
      'Завершена цель «Запустить личный кабинет».',
    ]);
  });
  it('ни одна цель не сдвинулась — так и пишем, без «0 из 2»', () => {
    const r = buildReport(input([goal('a', { kpi: kpi([[50, 38]]) }), goal('b', { kpi: kpi([]) })]));
    expect(r.summary[0]).toBe('Ни одна из 2 целей с KPI не сдвинула показатель к цели.');
  });
  it('без рисков — спокойная формулировка', () => {
    const r = buildReport(input([goal('a', { kpi: kpi([[2, 35]]) })]));
    expect(r.summary).toEqual(['1 из 1 цели с KPI сдвинула показатель к цели.', 'Критических рисков нет, цели идут по плану.', 'За период не закрыто ни одной задачи.']);
  });
  it('только предупреждения', () => {
    const r = buildReport(input([goal('a', { risks: [risk('warning', 'x')] }), goal('b', { risks: [risk('warning', 'y')] })]));
    expect(r.summary[1]).toBe('Критических рисков нет, у 2 целей есть предупреждения.');
  });
  it('несколько целей под угрозой — первая по имени и «ещё N»', () => {
    const r = buildReport(input([goal('a', { title: 'Альфа', risks: [risk('critical', 'Срыв')] }), goal('b', { title: 'Бета', risks: [risk('critical', 'Срыв')] })]));
    expect(r.summary[1]).toBe('Под угрозой 2 цели: «Альфа» и ещё 1. Срыв.');
  });
  it('целей нет — пустая сводка, без «0 из 0»', () => {
    expect(buildReport(input([])).summary).toEqual([]);
  });
});

describe('kpiLine', () => {
  const base = buildReport(input([goal('a', { kpi: kpi([[2, 36.5]]) })])).goals[0]!.kpi!;
  it('было → сейчас, цель', () => {
    expect(kpiLine(base).replace(/ /g, ' ')).toBe('40 → 36,5 мин, цель 30');
  });
  it('без замеров', () => {
    expect(kpiLine({ ...base, current: null }).replace(/ /g, ' ')).toBe('нет замеров, цель 30 мин');
  });
  it('удержание в диапазоне', () => {
    const k = { ...base, unit: 'percent' as const, direction: 'maintain' as const, range_min: 95, range_max: 100, target: 98, current: 97 };
    expect(kpiLine(k).replace(/ /g, ' ')).toBe('97 %, держим 95–100 %');
  });
});

describe('reportText', () => {
  const r = buildReport(
    input([
      goal('a', { title: 'Сократить время обработки заявки', kpi: kpi([[50, 38], [2, 35]]), tasks: [{ id: 't1', status: 'done', due_at: '2026-10-30', done_at: ago(3) }] }),
      goal('b', { title: 'Ускорить адаптацию', risks: [risk('critical', '«Доступы» заблокирована', 'Помогите Ивану')] }),
    ]),
  );
  const text = reportText(r);
  it('шапка, главное, решения, цели и работа', () => {
    expect(text.split('\n').slice(0, 2)).toEqual(['Отчёт offix · Демо-университет', '19 сентября — 19 октября 2026']);
    expect(text).toContain('Главное\n• 1 из 1 цели с KPI сдвинула показатель к цели.');
    expect(text).toContain('Нужно решение\n1. Ускорить адаптацию: «Доступы» заблокирована. Помогите Ивану.');
    expect(text).toContain('• Сократить время обработки заявки — По плану · Время обработки заявки: 40 → 35 мин, цель 30 · 50 % пути, +30 п.п. за период');
    expect(text).toContain('• Ускорить адаптацию — Под угрозой · без KPI');
    expect(text.trim().split('\n').at(-1)).toBe('Работа: задач закрыто 1, в срок 100 %.');
  });
  it('без неразрывных пробелов: мессенджеры их ломают', () => {
    expect(text).not.toMatch(/ /);
  });
  it('руководитель видит пометку о зоне', () => {
    expect(reportText({ ...r, scope: 'visible' }).split('\n')[1]).toBe('19 сентября — 19 октября 2026 · цели вашей зоны');
  });
});

describe('reportCsv', () => {
  const r = buildReport(
    input([
      goal('a', { title: 'Сократить время; обработки "заявки"', kpi: kpi([[50, 38], [2, 36.5]]) }),
      goal('b', { title: '=HYPERLINK("http://x")', owner_name: null, due_at: null }),
    ]),
  );
  const csv = reportCsv(r);
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  it('BOM, CRLF и шапка на русском', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(lines[0]).toBe(REPORT_CSV_COLUMNS.join(';'));
  });
  it('числа с запятой, текст с «;» и кавычками экранирован', () => {
    const row = lines.find((l) => l.startsWith('"Сократить'))!;
    expect(row.startsWith('"Сократить время; обработки ""заявки"""')).toBe(true);
    expect(row).toContain(';мин;40;38;36,5;30;35;');
  });
  it('формулы не исполняются, пустые значения — пустые ячейки', () => {
    const row = lines.find((l) => l.includes('HYPERLINK'))!;
    expect(row.startsWith(`"'=HYPERLINK(""http://x"")";;;По плану;;;`)).toBe(true);
  });
  it('столбцов столько же, сколько в шапке', () => {
    // Строка без «;» внутри текста: можно считать разделители напрямую.
    const plain = buildReport(input([goal('c', { kpi: kpi([[2, 36.5]]) })]));
    const row = reportCsv(plain).replace(/^﻿/, '').split('\r\n')[1]!;
    expect(row.split(';')).toHaveLength(REPORT_CSV_COLUMNS.length);
  });
});
