import { describe, expect, it } from 'vitest';
import {
  buildReport,
  escapeHtml,
  isReportDue,
  isReportSchedule,
  lastReportSlot,
  nextReportSlot,
  productMetrics,
  reportMailHtml,
  reportMailSubject,
  reportSlotText,
  shiftIso,
  type ReportGoalInput,
  type Risk,
} from '../src';

const NOW = '2026-10-19T12:00:00.000Z'; // понедельник, 15:00 по Москве
const ago = (d: number) => shiftIso(NOW, -d);

const blocker: Risk = { id: 'b', kind: 'blocked', severity: 'critical', title: '«Автозаполнение» заблокирована', explanation: 'Нет доступа к справочнику.', suggestion: 'Дайте доступ', task_ids: [] };

function report(goals: ReportGoalInput[], days: 7 | 30 = 7) {
  return buildReport({
    company: 'Демо-университет',
    scope: 'company',
    author: 'Алексей Петров',
    at: NOW,
    days,
    goals,
    metrics: productMetrics({ goals: goals.map((g) => ({ id: g.id, title: g.title, created_at: ago(60), activated_at: ago(59), closed_at: null, kpi: g.kpi })), events: [], tasks: goals.flatMap((g) => g.tasks) }, NOW, { windowDays: days }),
  });
}

const goal = (id: string, over: Partial<ReportGoalInput> = {}): ReportGoalInput => ({
  id,
  title: `Цель ${id}`,
  status: 'active',
  owner_name: 'Ольга Смирнова',
  due_at: '2026-12-31',
  completed_at: null,
  kpi: { name: 'Время обработки', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease', observations: [{ value: 36.5, observed_at: ago(2) }] },
  risks: [],
  tasks: [],
  ...over,
});

describe('расписание отчёта', () => {
  it('частоты — только неделя и месяц', () => {
    expect(isReportSchedule('weekly')).toBe(true);
    expect(isReportSchedule('monthly')).toBe(true);
    expect(isReportSchedule('daily')).toBe(false);
  });

  it('неделя: понедельник 9:00 по Москве = 06:00 UTC', () => {
    expect(lastReportSlot('weekly', NOW)).toBe('2026-10-19T06:00:00.000Z');
    expect(nextReportSlot('weekly', NOW)).toBe('2026-10-26T06:00:00.000Z');
  });

  it('неделя: в понедельник до 9:00 последний слот — прошлый понедельник', () => {
    expect(lastReportSlot('weekly', '2026-10-19T05:59:00.000Z')).toBe('2026-10-12T06:00:00.000Z');
    expect(lastReportSlot('weekly', '2026-10-19T06:00:00.000Z')).toBe('2026-10-19T06:00:00.000Z');
  });

  it('неделя: воскресенье поздно вечером по Москве — ещё прошлая неделя', () => {
    // 25 октября 23:30 МСК = 20:30 UTC, воскресенье.
    expect(lastReportSlot('weekly', '2026-10-25T20:30:00.000Z')).toBe('2026-10-19T06:00:00.000Z');
    // 26 октября 00:30 МСК — уже понедельник, но до 9:00.
    expect(lastReportSlot('weekly', '2026-10-25T21:30:00.000Z')).toBe('2026-10-19T06:00:00.000Z');
  });

  it('месяц: 1-е число 9:00 по Москве, переход через год', () => {
    expect(lastReportSlot('monthly', NOW)).toBe('2026-10-01T06:00:00.000Z');
    expect(nextReportSlot('monthly', NOW)).toBe('2026-11-01T06:00:00.000Z');
    expect(lastReportSlot('monthly', '2027-01-01T05:00:00.000Z')).toBe('2026-12-01T06:00:00.000Z');
    expect(nextReportSlot('monthly', '2026-12-15T00:00:00.000Z')).toBe('2027-01-01T06:00:00.000Z');
  });

  it('пора слать — один раз за слот', () => {
    const since = '2026-10-12T06:00:30.000Z';
    expect(isReportDue('weekly', since, '2026-10-19T05:59:00.000Z')).toBe(false);
    expect(isReportDue('weekly', since, '2026-10-19T06:00:00.000Z')).toBe(true);
    expect(isReportDue('weekly', '2026-10-19T06:00:40.000Z', '2026-10-19T06:01:00.000Z')).toBe(false);
  });

  it('включили во вторник — первое письмо в понедельник, а не сразу', () => {
    const enabled = '2026-10-20T10:00:00.000Z';
    expect(isReportDue('weekly', enabled, '2026-10-21T10:00:00.000Z')).toBe(false);
    expect(isReportDue('weekly', enabled, '2026-10-26T06:00:00.000Z')).toBe(true);
  });

  it('подпись следующего письма', () => {
    expect(reportSlotText('2026-10-26T06:00:00.000Z', NOW)).toBe('понедельник, 26 октября, 9:00');
    expect(reportSlotText('2027-01-01T06:00:00.000Z', NOW)).toBe('пятница, 1 января 2027, 9:00');
  });
});

describe('письмо с отчётом', () => {
  it('экранирование HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('тема: компания, период', () => {
    expect(reportMailSubject(report([goal('a')]))).toBe('Отчёт offix · Демо-университет · неделя, 12 октября — 19 октября 2026');
  });

  it('разделы листа: главное, четыре цифры, решения, цели', () => {
    const html = reportMailHtml(report([goal('a', { risks: [blocker] }), goal('b')]));
    for (const s of ['Главное', 'Цели сдвинули KPI', 'Под угрозой', 'Закрыто задач', 'Снятие блокера', 'Нужно решение', 'Цели', 'Цель a', '→ Дайте доступ']) expect(html).toContain(s);
    expect(html).toContain('«Автозаполнение» заблокирована');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('без рисков — нет раздела «Нужно решение»', () => {
    expect(reportMailHtml(report([goal('a')]))).not.toContain('Нужно решение');
  });

  it('данные из целей не становятся разметкой', () => {
    const html = reportMailHtml(report([goal('x', { title: '<img src=x onerror=alert(1)>', owner_name: 'Ольга "<b>"', risks: [{ ...blocker, suggestion: '<script>alert(1)</script>' }] })]));
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('ссылки на цели и отчёт — только при адресе сайта', () => {
    const r = report([goal('g 1')]);
    expect(reportMailHtml(r)).not.toContain('href=');
    const html = reportMailHtml(r, { appUrl: 'https://offix.example/' });
    expect(html).toContain('href="https://offix.example/app/goals/g%201"');
    expect(html).toContain('href="https://offix.example/app/report?days=7"');
  });

  it('пустой период — понятная фраза вместо пустых цифр', () => {
    const html = reportMailHtml(report([]));
    expect(html).toContain('За период нет целей в работе');
    expect(html).not.toContain('Снятие блокера');
  });
});
