import { describe, expect, it } from 'vitest';
import {
  emptyPlanForm,
  formatRubShort,
  rubShortParts,
  factOfPlan,
  itemsText,
  parseItemsText,
  parseStepsText,
  planBar,
  planFormBody,
  planFormOf,
  salesTiles,
  stepsText,
  teamMemberLine,
  unitForFact,
  type PlanForm,
  type SalesMonth,
} from '../src';

const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const form = (over: Partial<PlanForm>): PlanForm => ({ ...emptyPlanForm(), ...over });

describe('пороги строками', () => {
  it('пишутся сверху вниз и читаются обратно', () => {
    const steps = [
      { from: 80, k: 0.5 },
      { from: 100, k: 1 },
    ];
    expect(stepsText(steps)).toBe('100: 1\n80: 0,5');
    expect(parseStepsText(stepsText(steps))).toEqual({ steps: [steps[1], steps[0]], error: null });
  });
  it('понимает разные разделители и проценты', () => {
    expect(parseStepsText('90% — 1; 80 0.5\nот 70: 0,3').steps).toEqual([
      { from: 90, k: 1 },
      { from: 80, k: 0.5 },
      { from: 70, k: 0.3 },
    ]);
  });
  it('пустой текст и непонятная строка — ошибка с номером строки', () => {
    expect(parseStepsText('  ').error).toBe('Добавьте хотя бы один порог');
    expect(parseStepsText('100: 1\nмного').error).toMatch(/^Строка 2:/);
  });
});

describe('позиции строками', () => {
  it('«название: точек», без числа — одна точка', () => {
    expect(parseItemsText('Курс Python-3: 5\nВебинар по Excel\nСеминар — 2 тт')).toEqual({
      items: [
        { name: 'Курс Python-3', need: 5 },
        { name: 'Вебинар по Excel', need: 1 },
        { name: 'Семинар', need: 2 },
      ],
      error: null,
    });
    expect(itemsText([{ name: 'Курс', need: 3 }])).toBe('Курс: 3');
  });
  it('пусто или слишком много позиций — ошибка', () => {
    expect(parseItemsText('').error).toBe('Добавьте хотя бы одну позицию');
    expect(parseItemsText(Array.from({ length: 31 }, (_, i) => `П${i}: 1`).join('\n')).error).toMatch(/не больше 30/);
  });
});

describe('форма показателя', () => {
  it('выручка по порогам: тело запроса с правилами', () => {
    const { body, errors } = planFormBody(form({ name: 'Выручка по курсам', plan: '400 000', bonus: '20000', fact_type: 'revenue', groups: 'КУРСЫ\nСЕМИНАРЫ', clients: 'non_key', steps: '100: 1\n90: 0,5', over: 'proportional' }));
    expect(errors).toEqual({});
    expect(body).toEqual({
      name: 'Выручка по курсам',
      unit: 'rub',
      plan: 400000,
      bonus: 20000,
      description: null,
      fact_rule: { type: 'revenue', groups: ['КУРСЫ', 'СЕМИНАРЫ'], clients: 'non_key', measure: 'revenue' },
      payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }, { from: 90, k: 0.5 }], over: 'proportional' },
    });
  });
  it('единица следует за правилом факта', () => {
    expect(unitForFact({ fact_type: 'revenue', measure: 'quantity', products_measure: 'revenue', unit: 'rub' })).toBe('count');
    expect(unitForFact({ fact_type: 'clients', measure: 'revenue', products_measure: 'revenue', unit: 'rub' })).toBe('clients');
    expect(unitForFact({ fact_type: 'products', measure: 'revenue', products_measure: 'clients', unit: 'rub' })).toBe('clients');
    expect(unitForFact({ fact_type: 'items', measure: 'revenue', products_measure: 'revenue', unit: 'rub' })).toBe('items');
    expect(unitForFact({ fact_type: 'manual', measure: 'revenue', products_measure: 'revenue', unit: 'percent' })).toBe('percent');
    expect(planFormBody(form({ name: 'Дистрибуция', fact_type: 'items', items: 'Курс: 3', payout_type: 'items', bonus: '5000' })).body?.unit).toBe('items');
  });
  it('процент от продаж: «3,5» → 0,035, порог в рублях', () => {
    const { body } = planFormBody(form({ name: 'Меридиан', fact_type: 'revenue', clients: 'key', payout_type: 'rate', rate: '3,5', min: '50 000' }));
    expect(body?.payout_rule).toEqual({ type: 'rate', rate: 0.035, min: 50000 });
  });
  it('ошибки — у тех полей, где их видно', () => {
    const { body, errors } = planFormBody(form({ name: '', plan: '', payout_type: 'threshold', steps: 'abc' }));
    expect(body).toBeNull();
    expect(errors.name).toBe('Назовите показатель');
    expect(errors.steps).toMatch(/^Строка 1/);
    expect(planFormBody(form({ name: 'X', payout_type: 'threshold', steps: '100: 1', plan: '' })).errors.plan).toBe('Для выплаты по порогам нужен план больше нуля');
    expect(planFormBody(form({ name: 'X', payout_type: 'rate', rate: '0' })).errors.rate).toMatch(/больше 0/);
    expect(planFormBody(form({ name: 'X', payout_type: 'none', fact_type: 'products', query: '' })).errors.query).toBe('Укажите товар или группу');
    expect(planFormBody(form({ name: 'X', payout_type: 'threshold', steps: '2000: 1', plan: '10' })).errors.steps).toBe('Порог — от 0 до 1000 % плана');
  });
  it('форма из показателя и обратно — те же правила', () => {
    const plan = {
      name: 'АКБ',
      unit: 'clients' as const,
      plan: 40,
      bonus: 7000,
      description: 'Без сети',
      fact_rule: { type: 'clients' as const, groups: ['КУРСЫ'], exclude_key: true, merge: ['ИП Орлова'] },
      payout_rule: { type: 'threshold' as const, steps: [{ from: 100, k: 1 }, { from: 85, k: 0.7 }], over: 'cap' as const },
    };
    const f = planFormOf(plan);
    expect(f.plan).toBe('40');
    expect(f.steps).toBe('100: 1\n85: 0,7');
    expect(planFormBody(f).body).toEqual({ ...plan });
    const rate = planFormOf({ ...plan, unit: 'rub', fact_rule: { type: 'manual' }, payout_rule: { type: 'rate', rate: 0.035, min: 0 } });
    expect([rate.rate, rate.min, rate.fact_type]).toEqual(['3,5', '', 'manual']);
    const items = planFormOf({ ...plan, unit: 'items', fact_rule: { type: 'items', items: [{ name: 'Курс', need: 2 }] }, payout_rule: { type: 'items' } });
    expect(items.items).toBe('Курс: 2');
    expect(planFormOf({ ...plan, fact_rule: { type: 'products', query: 'Python', measure: 'quantity' } })).toMatchObject({ query: 'Python', products_measure: 'quantity' });
  });
});

describe('полоса выполнения', () => {
  const rule = { type: 'threshold' as const, steps: [{ from: 90, k: 1 }], over: 'cap' as const };
  it('заполнение, прогноз и отметки порогов', () => {
    expect(planBar({ plan: 100, payout_rule: rule }, { percent: 45, forecast_percent: 80, marks: [90] })).toEqual({ fill: 45, forecast: 80, marks: [90], over: false });
  });
  it('перевыполнение упирается в край, прогноз ниже факта не рисуется', () => {
    expect(planBar({ plan: 100, payout_rule: rule }, { percent: 130, forecast_percent: 120, marks: [90] })).toEqual({ fill: 100, forecast: null, marks: [90], over: true });
  });
  it('у оклада и показателя без плана полосы нет', () => {
    expect(planBar({ plan: 0, payout_rule: rule }, { percent: 0, forecast_percent: null, marks: [] })).toBeNull();
    expect(planBar({ plan: 40000, payout_rule: { type: 'fixed' } }, { percent: 0, forecast_percent: null, marks: [] })).toBeNull();
  });
});

describe('плитки и строки', () => {
  const month = (over: Partial<SalesMonth>): Pick<SalesMonth, 'plans' | 'totals' | 'stats' | 'entries'> => ({
    plans: [{} as SalesMonth['plans'][number]],
    totals: { fixed: 40000, now: 61000, forecast: 70000, max: 70000, file: null },
    stats: null,
    entries: { count: 0, amount: 0, quantity: 0 },
    ...over,
  });
  it('сейчас, прогноз и выручка; прогноз на максимуме — зелёный', () => {
    const tiles = salesTiles(
      month({ stats: { revenue: 351500, clients: 12, per_day: 0, quantity: 0, as_of: '2026-10-18', elapsed: 18, days: 31, work_elapsed: 15, work_days: 27, reports: 2 } }),
    );
    expect(tiles.map((t) => [t.label, plain(t.value), t.tone])).toEqual([
      ['Заработано сейчас', '61 000 ₽', undefined],
      ['Прогноз к концу месяца', '70 000 ₽', 'good'],
      ['Выручка за месяц', '351 500 ₽', undefined],
      ['Клиентов с продажами', '12', undefined],
    ]);
  });
  it('по файлу KPI — одна сумма к выплате; без отчётов — продажи вручную', () => {
    const tiles = salesTiles(month({ totals: { fixed: 0, now: 0, forecast: 0, max: 0, file: 82000 }, entries: { count: 3, amount: 36000, quantity: 3 } }));
    expect(tiles.map((t) => [t.label, plain(t.value)])).toEqual([
      ['К выплате по файлу KPI', '82 000 ₽'],
      ['Продажи вручную', '36 000 ₽'],
    ]);
    expect(salesTiles(month({ plans: [] }))).toEqual([]);
  });
  it('строка участника команды', () => {
    expect(plain(teamMemberLine({ plans: 3, percent: 97.3, stats: { revenue: 351500 } as never, entries: { count: 0, amount: 0 } }))).toBe('Выручка 351 500 ₽ · 97 % плана в среднем');
    expect(plain(teamMemberLine({ plans: 0, percent: null, stats: null, entries: { count: 2, amount: 9000 } }))).toBe('Вручную 9 000 ₽ · плана нет');
  });
  it('факт из плана', () => {
    expect(plain(factOfPlan({ fact: 12, plan: 40, unit: 'clients' }))).toBe('12 кл. из 40 кл.');
    expect(plain(factOfPlan({ fact: 9, plan: 0, unit: 'count' }))).toBe('9 шт');
  });
});

describe('короткие суммы для плиток', () => {
  it('до 100 тысяч — полностью, дальше тысячи, миллионы и миллиарды', () => {
    expect(plain(formatRubShort(86862))).toBe('86 862 ₽');
    expect(plain(formatRubShort(499500))).toBe('500 тыс. ₽');
    expect(plain(formatRubShort(1062000))).toBe('1,06 млн ₽');
    expect(plain(formatRubShort(25_400_000))).toBe('25,4 млн ₽');
    expect(plain(formatRubShort(312_000_000))).toBe('312 млн ₽');
    expect(plain(formatRubShort(2_500_000_000))).toBe('2,5 млрд ₽');
    expect(plain(formatRubShort(-150000))).toBe('−150 тыс. ₽');
  });
  it('число и единица отдельно', () => {
    expect(rubShortParts(562500)).toEqual({ value: '563', unit: 'тыс.\u00a0₽' });
    expect(rubShortParts(9999.6)).toEqual({ value: '10\u00a0000', unit: '₽' });
  });
});
