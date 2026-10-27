import { describe, expect, it } from 'vitest';
import { validateSaleEntry } from '@offix/core';
import { heroColors, heroStatColor, SECTION_VARIANTS } from '../src/lib/fx';
import {
  defaultSalesView,
  emptyEntry,
  employeeTaskFigures,
  entryBody,
  entryDayPresets,
  isSalesTable,
  payoutScale,
  planFactEditable,
  salesHeroStats,
  salesQs,
  salesToday,
  sk,
  teamHeroStats,
} from '../src/lib/sales';

const plain = (s: string | number) => String(s).replace(/ /g, ' ');
const shown = (x: { value: string | number; unit?: string }) => plain(x.unit ? `${x.value} ${x.unit}` : x.value);

const plan = (over: Record<string, unknown> = {}) => ({
  plan: 400000,
  payout_rule: { type: 'threshold' as const, steps: [{ from: 100, k: 1 }], over: 'cap' as const },
  calc: { percent: 50 },
  ...over,
});

describe('ключи и запросы продаж', () => {
  it('ключи те же, что на сайте: свой месяц — «me», чужой — по id', () => {
    expect(sk.month('2026-10')).toEqual(['sales', 'month', 'me', '2026-10']);
    expect(sk.month('2026-10', 'u1')).toEqual(['sales', 'month', 'u1', '2026-10']);
    expect(sk.team('2026-10')).toEqual(['sales', 'team', '2026-10']);
    expect(sk.employee('u1', '2026-10')).toEqual(['sales', 'employee', 'u1', '2026-10']);
    expect(sk.entries('2026-10')).toEqual(['sales', 'entries', 'me', '2026-10']);
    for (const k of [sk.month('x'), sk.team('x'), sk.employee('a', 'x'), sk.entries('x')]) expect(k[0]).toBe(sk.all[0]);
  });
  it('пустые параметры не пишем, значения кодируем', () => {
    expect(salesQs({ user: undefined, month: '2026-10' })).toBe('?month=2026-10');
    expect(salesQs({ user: 'a b', month: '2026-10' })).toBe('?user=a%20b&month=2026-10');
    expect(salesQs({ month: '' })).toBe('');
  });
  it('«сегодня» — по Москве: поздним вечером UTC в Москве уже завтра', () => {
    expect(salesToday(new Date('2026-10-31T22:30:00Z'))).toBe('2026-11-01');
    expect(salesToday(new Date('2026-10-31T20:00:00Z'))).toBe('2026-10-31');
  });
});

describe('шапка продаж', () => {
  it('выручка по отчётам коротко, клиенты и среднее выполнение плана', () => {
    const s = salesHeroStats({ plans: [plan({ calc: { percent: 120 } }), plan({ calc: { percent: 90 } })] as never, stats: { revenue: 562_400, clients: 14 } as never, entries: { count: 0, amount: 0, quantity: 0 } });
    expect(s.map((x) => [x.label, shown(x), x.tone])).toEqual([
      ['выручка', '562 тыс. ₽', undefined],
      ['клиентов', '14', undefined],
      ['плана', '105 %', 'good'],
    ]);
  });
  it('без отчётов — продажи вручную; без плана и продаж — прочерки', () => {
    const manual = salesHeroStats({ plans: [plan({ calc: { percent: 40 } })] as never, stats: null, entries: { count: 3, amount: 86_862, quantity: 3 } });
    expect(manual.map((x) => [x.label, shown(x), x.tone])).toEqual([
      ['вручную', '86 862 ₽', undefined],
      ['клиентов', '—', undefined],
      ['плана', '40 %', 'warn'],
    ]);
    const empty = salesHeroStats({ plans: [], stats: null, entries: { count: 0, amount: 0, quantity: 0 } });
    expect(empty.map((x) => x.value)).toEqual(['—', '—', '—']);
    expect(empty[0]!.label).toBe('выручка');
  });
  it('оклад в среднее выполнение не входит', () => {
    const s = salesHeroStats({ plans: [plan({ payout_rule: { type: 'fixed' }, calc: { percent: 0 } }), plan({ calc: { percent: 80 } })] as never, stats: null, entries: { count: 0, amount: 0, quantity: 0 } });
    expect(plain(s[2]!.value)).toBe('80 %');
    expect(s[2]!.tone).toBeUndefined();
  });
  it('команда: люди, выручка и прогноз выплат', () => {
    const s = teamHeroStats({ members: [{}, {}] as never, totals: { revenue: 1_064_000, now: 0, forecast: 98_500, max: 0 } });
    expect(s.map((x) => `${x.label}: ${shown(x)}`)).toEqual(['в команде: 2', 'выручка: 1,06 млн ₽', 'прогноз выплат: 98 500 ₽']);
    expect(s[1]).toMatchObject({ value: '1,06', unit: 'млн\u00a0₽' });
  });
  it('у раздела продаж своя шапка, хорошая цифра — светло-зелёная', () => {
    expect(SECTION_VARIANTS).toContain('sales');
    expect(heroColors('sales')[2]).toBe('#ffd84a');
    expect(heroStatColor('good')).not.toBe(heroStatColor(undefined));
  });
});

describe('факт показателя на телефоне', () => {
  const manual = { source: 'manual' as const, fact_rule: { type: 'manual' as const }, payout_rule: { type: 'threshold' as const, steps: [], over: 'cap' as const } };
  const can = (o: { edit?: boolean; fact?: boolean }) => ({ can: { edit: false, fact: false, kpi_file: false, add_entry: true, team: false, reports: false, ...o } });
  it('отмечает руководитель или сотрудник, которому разрешено', () => {
    expect(planFactEditable(can({ edit: true }), manual)).toBe(true);
    expect(planFactEditable(can({ fact: true }), manual)).toBe(true);
    expect(planFactEditable(can({}), manual)).toBe(false);
  });
  it('факт из отчётов 1С, файла KPI и у оклада не правится', () => {
    const boss = can({ edit: true });
    expect(planFactEditable(boss, { ...manual, source: 'file' })).toBe(false);
    expect(planFactEditable(boss, { ...manual, fact_rule: { type: 'revenue', groups: [], clients: 'all', measure: 'revenue' } as never })).toBe(false);
    expect(planFactEditable(boss, { ...manual, payout_rule: { type: 'fixed' } })).toBe(false);
  });
});

describe('выплата и задачи', () => {
  it('шкала: доли от максимума, прогноз не меньше «сейчас», не больше 100', () => {
    expect(payoutScale({ now: 10_000, forecast: 25_000, max: 50_000, file: null })).toEqual({ now: 20, forecast: 50 });
    expect(payoutScale({ now: 30_000, forecast: 20_000, max: 50_000, file: null })).toEqual({ now: 60, forecast: 60 });
    expect(payoutScale({ now: 0, forecast: 80_000, max: 50_000, file: null })).toEqual({ now: 0, forecast: 100 });
  });
  it('по файлу KPI и без максимума шкалы нет', () => {
    expect(payoutScale({ now: 1, forecast: 1, max: 10, file: 27_000 })).toBeNull();
    expect(payoutScale({ now: 0, forecast: 0, max: 0, file: null })).toBeNull();
  });
  it('задачи сотрудника: просрочки и блокеры подсвечены, только если есть', () => {
    expect(employeeTaskFigures({ open: 5, overdue: 2, blocked: 0, done_30d: 11 })).toEqual([
      { label: 'в работе', value: 5, bad: false },
      { label: 'просрочены', value: 2, bad: true },
      { label: 'с блокером', value: 0, bad: false },
      { label: 'сделано за 30 дней', value: 11, bad: false },
    ]);
  });
});

describe('отчёт 1С с телефона', () => {
  it('принимаем Excel и CSV в любом регистре', () => {
    for (const n of ['Отчёт.xlsx', 'report.XLS', ' продажи.csv ']) expect(isSalesTable(n)).toBe(true);
    for (const n of ['отчёт.pdf', 'xlsx', 'report.xlsx.zip', 'фото.jpg']) expect(isSalesTable(n)).toBe(false);
  });
});

describe('запись продажи', () => {
  const today = '2026-10-27';
  it('пустая форма: одна штука, сегодня, первый показатель', () => {
    expect(emptyEntry(today, 'p1')).toEqual({ product: '', client: '', quantity: '1', amount: '', sold_on: today, note: '', plan_id: 'p1' });
    expect(emptyEntry(today, null).plan_id).toBe('');
  });
  it('быстрые даты: сегодня, вчера, позавчера — через границу месяца', () => {
    expect(entryDayPresets('2026-11-01').map((d) => d.value)).toEqual(['2026-11-01', '2026-10-31', '2026-10-30']);
    expect(entryDayPresets(today).map((d) => d.label)).toEqual(['Сегодня', 'Вчера', 'Позавчера']);
  });
  it('тело запроса: «не прибавлять» — null, чужому сотруднику — с его id', () => {
    const v = { ...emptyEntry(today, null), product: 'Курс', amount: '45 000' };
    expect(entryBody(v)).toMatchObject({ plan_id: null, user_id: undefined, product: 'Курс' });
    expect(entryBody({ ...v, plan_id: 'p1' }, 'u2')).toMatchObject({ plan_id: 'p1', user_id: 'u2' });
  });
  it('форма проходит ту же проверку, что на сервере: сумма с пробелами, дата не из будущего', () => {
    const ok = validateSaleEntry({ ...emptyEntry(today, null), product: ' Курс  Python ', amount: '45 000,50' }, today);
    expect(ok.entry).toMatchObject({ product: 'Курс Python', amount: 45000.5, quantity: 1, sold_on: today, client: null });
    const bad = validateSaleEntry({ ...emptyEntry(today, null), sold_on: '2026-10-28', quantity: '0' }, today);
    expect(bad.errors).toMatchObject({ product: 'Укажите товар или услугу', quantity: 'Количество — больше нуля', sold_on: 'Продажа не может быть в будущем' });
  });
});

describe('с какой вкладки открыть продажи', () => {
  const can = (team: boolean) => ({ edit: false, fact: false, kpi_file: false, add_entry: true, team, reports: team });
  const empty = { plans: [], stats: null, entries: { count: 0, amount: 0, quantity: 0 } };
  it('руководитель без своего плана и продаж — сразу команда', () => {
    expect(defaultSalesView({ ...empty, can: can(true) })).toBe('team');
  });
  it('свой план, отчёты или продажи — свой месяц; без команды — всегда свой месяц', () => {
    expect(defaultSalesView({ ...empty, plans: [{}] as never, can: can(true) })).toBe('month');
    expect(defaultSalesView({ ...empty, stats: {} as never, can: can(true) })).toBe('month');
    expect(defaultSalesView({ ...empty, entries: { count: 1, amount: 10, quantity: 1 }, can: can(true) })).toBe('month');
    expect(defaultSalesView({ ...empty, can: can(false) })).toBe('month');
  });
});
