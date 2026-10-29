import { describe, expect, it } from 'vitest';
import {
  amountThresholdFromName,
  averagePercent,
  computeFact,
  conditionOf,
  coverageOf,
  coverageText,
  defaultRules,
  formatRub,
  guessFactRule,
  matchPeople,
  maxPayout,
  mergedClientsFromName,
  parseFactRule,
  parseKpiSheet,
  parsePatterns,
  parsePayoutRule,
  parseSalesReport,
  PATH_SEP,
  payoutFor,
  planCalc,
  plansLine,
  planTone,
  ruleMarks,
  ruleText,
  salesPeriodText,
  salesStats,
  salesTotals,
  salesValueText,
  thresholdsFromName,
  validatePlanInput,
  validateSaleEntry,
  type KpiMetric,
  type ReportLine,
  type SalesPlanRow,
} from '../src';
import { kpiRows, mayClients, reportSheet } from './sales-fixtures';

/** Неразрывные пробелы в тексте → обычные, чтобы ожидания читались. */
const sp = (s: string | null) => (s ?? '').replace(/ /g, ' ');

function linesOf(period: string, manager: string, scale = 1): ReportLine[] {
  const out: ReportLine[] = [];
  for (const b of parseSalesReport(reportSheet(period, mayClients(scale))).blocks) {
    if (b.manager !== manager) continue;
    out.push({ client_name: b.client, kind: 'total', group_path: '', name: b.client, quantity: b.quantity, revenue: b.revenue });
    for (const n of b.nodes) out.push({ client_name: b.client, kind: n.kind, group_path: n.path.join(PATH_SEP), name: n.name, quantity: n.quantity, revenue: n.revenue });
  }
  return out;
}

const lines = linesOf('01.05.2026 - 15.05.2026', 'Смирнова Анна');
const noLists = { key: [], merge: [] };
const lists = { key: ['ИП Соколова Д.И.'], merge: [] };
const metrics = parseKpiSheet(kpiRows({ name: 'Анна' })).metrics;
const metric = (re: RegExp) => metrics.find((m) => re.test(m.name))!;
const fact = (re: RegExp, l: { key: string[]; merge: string[] } = noLists) => computeFact(defaultRules(metric(re)).fact, lines, l);

describe('продажи: факт по отчётам', () => {
  it('выручка с ключевыми клиентами и без них', () => {
    expect(fact(/без ЕП/)!.value).toBe(72000);
    expect(fact(/Есть Подод/)!.value).toBe(0);
    expect(fact(/без ЕП/, lists)!.value).toBe(47000);
    expect(fact(/Есть Подод/, lists)).toEqual({ value: 25000, details: { clients: 2 } });
  });

  it('бренды — по группам товаров, без двойного счёта вложенных групп', () => {
    expect(fact(/Балтика, руб/)!.value).toBe(51000);
    expect(fact(/ОПХ/)!.value).toBe(18000);
    // Точная группа из отчёта вместо слова.
    const draft = computeFact({ type: 'revenue', groups: ['ПИВО › Пиво разливное › Россия › Драфт Балтика'], clients: 'all', measure: 'revenue' }, lines, noLists);
    expect(draft!.value).toBe(32000);
    // Штуки вместо рублей.
    expect(computeFact({ type: 'revenue', groups: ['балтика'], clients: 'all', measure: 'quantity' }, lines, noLists)!.value).toBe(55);
  });

  it('АКБ: точки с продажами, задвоенные — одна точка, ключевые не считаются', () => {
    // 6 клиентов, две точки Егоровой — одна (из названия показателя).
    expect(fact(/АКБ/)!.value).toBe(5);
    expect(fact(/АКБ/, lists)).toMatchObject({ value: 3, details: { excluded_key: 2 } });
    // Задвоенные из общего списка компании.
    const all = computeFact({ type: 'clients', groups: [], exclude_key: false, merge: [] }, lines, { key: [], merge: ['ИП Егорова'] });
    expect(all!.value).toBe(5);
  });

  it('дистрибуция: позиции по названиям товаров (Стаут = Stout, Крон = Krone, «0» ≠ «0,5»)', () => {
    const r = fact(/Дистра/)!;
    expect(r.value).toBe(3);
    expect(r.details.items).toEqual([
      { name: 'Балтика Стаут кег', need: 1, count: 1, done: true },
      { name: 'Крон Бланш', need: 1, count: 1, done: true },
      { name: 'Балтика Хеллес', need: 1, count: 2, done: true },
      { name: 'Балтика 0 any', need: 2, count: 1, done: false },
    ]);
  });

  it('товар по названию: выручка, штуки и точки', () => {
    expect(computeFact({ type: 'products', query: 'Балтика Stout', measure: 'quantity' }, lines, noLists)).toEqual({ value: 2, details: {} });
    expect(computeFact({ type: 'products', query: 'Бочкарев', measure: 'clients' }, lines, noLists)).toEqual({ value: 2, details: { clients: 2 } });
    expect(computeFact({ type: 'products', query: 'Бочкарев', measure: 'revenue' }, lines, noLists)!.value).toBe(18000);
    // Группа, подходящая под запрос, считается один раз — без вложенных строк.
    expect(computeFact({ type: 'products', query: 'Фасовка Heineken', measure: 'revenue' }, lines, noLists)!.value).toBe(18000);
    expect(computeFact({ type: 'manual' }, lines, noLists)).toBeNull();
  });

  it('новые показатели — по словам в названиях групп товаров', () => {
    const groups = ['ПИВО', 'СИДР, МЕДОВУХА', 'Сидр Фасовка', 'Драфт Heineken', 'Фасовка МПК'];
    expect(guessFactRule('План Сидр, руб (порог 90%)', groups)).toEqual({ type: 'revenue', groups: ['сидр'], clients: 'all', measure: 'revenue' });
    expect(guessFactRule('Сидр, шт', groups)).toMatchObject({ measure: 'quantity' });
    expect(guessFactRule('Новые ТТ МПК', groups)).toMatchObject({ type: 'clients', groups: ['мпк'] });
    expect(guessFactRule('План звонков', groups)).toBeNull();
  });
});

describe('продажи: правила выплаты', () => {
  it('пороги из названия, коэффициент, сверх плана', () => {
    const r = defaultRules(metric(/Балтика, руб/)).payout;
    expect(r).toEqual({ type: 'threshold', steps: [{ from: 90, k: 1 }, { from: 80, k: 0.5 }], over: 'proportional' });
    expect(payoutFor(r, { plan: 100000, fact: 79999, bonus: 12000 })).toBe(0);
    expect(payoutFor(r, { plan: 100000, fact: 85000, bonus: 12000 })).toBe(6000);
    expect(payoutFor(r, { plan: 100000, fact: 90000, bonus: 12000 })).toBe(12000);
    expect(payoutFor(r, { plan: 100000, fact: 103250, bonus: 12000 })).toBe(12390);
    expect(payoutFor(r, { plan: 0, fact: 1, bonus: 12000 })).toBe(0);
    expect(sp(ruleText(r, 12000))).toBe('от 90 % — 12 000 ₽, 80–90 % — 6 000 ₽ (× 0,5), сверх плана — пропорционально');
    expect(ruleMarks(r, 100000)).toEqual([80, 90]);
    expect(maxPayout(r, 100000, 12000)).toBe(12000);
  });

  it('процент от продаж с порогом в рублях', () => {
    const ep = defaultRules(metric(/Есть Подод/)).payout;
    expect(ep).toEqual({ type: 'rate', rate: 0.035, min: 20000 });
    expect(payoutFor(ep, { plan: 40000, fact: 19999, bonus: 1400 })).toBe(0);
    expect(payoutFor(ep, { plan: 40000, fact: 30000, bonus: 1400 })).toBe(1050);
    expect(sp(ruleText(ep, 1400))).toBe('3,5 % от продаж, если продано от 20 000 ₽');
    expect(ruleMarks(ep, 40000)).toEqual([50]);
    expect(maxPayout(ep, 40000, 1400)).toBe(1400);
  });

  it('АКБ, позиции, фиксированная и без выплаты', () => {
    expect(payoutFor(defaultRules(metric(/АКБ/)).payout, { plan: 4, fact: 5, bonus: 5000 })).toBe(5000);
    expect(payoutFor({ type: 'items' }, { plan: 4, fact: 3, bonus: 5000, done: 3, total: 4 })).toBe(3750);
    expect(payoutFor({ type: 'items' }, { plan: 4, fact: 3, bonus: 5000 })).toBe(0);
    expect(payoutFor({ type: 'fixed' }, { plan: 30000, fact: 0, bonus: 30000 })).toBe(30000);
    expect(payoutFor({ type: 'none' }, { plan: 1, fact: 1, bonus: 1 })).toBe(0);
    expect(sp(ruleText({ type: 'items' }, 5000, 4))).toBe('5 000 ₽ делится между позициями: по 1 250 ₽ за каждую');
    expect(ruleText({ type: 'fixed' }, 1)).toBe('фиксированная выплата');
    expect(ruleText({ type: 'none' }, 1)).toBe('');
    expect(maxPayout({ type: 'none' }, 1, 1)).toBe(0);
  });

  it('правила по умолчанию для показателей файла', () => {
    expect(defaultRules(metric(/Оклад/))).toEqual({ fact: { type: 'manual' }, payout: { type: 'fixed' } });
    expect(defaultRules(metric(/АКБ/)).fact).toEqual({ type: 'clients', groups: [], exclude_key: true, merge: ['Егорова', 'Морозов'] });
    expect(defaultRules(metric(/Дистра/))).toMatchObject({ fact: { type: 'items' }, payout: { type: 'items' } });
    const noItems: KpiMetric = { ...metric(/Дистра/), items: [] };
    expect(defaultRules(noItems)).toMatchObject({ fact: { type: 'manual' }, payout: { type: 'threshold', over: 'cap' } });
    expect(defaultRules({ name: 'План Сидр, руб', kind: 'other', fixed: false, rate: null, items: [] }, ['СИДР, МЕДОВУХА']).fact).toMatchObject({ type: 'revenue', groups: ['сидр'] });
    expect(defaultRules({ name: 'План звонков', kind: 'other', fixed: false, rate: null, items: [] })).toEqual({
      fact: { type: 'manual' },
      payout: { type: 'threshold', steps: [{ from: 100, k: 1 }], over: 'cap' },
    });
  });

  it('пороги, рубли и задвоенные из названий', () => {
    expect(thresholdsFromName('План (Порог 90%, при выполнении 80-90% кэф 0,5; 70–80% коэф. 0,3)')).toEqual([
      { from: 90, k: 1 },
      { from: 80, k: 0.5 },
      { from: 70, k: 0.3 },
    ]);
    expect(thresholdsFromName('План продаж')).toEqual([]);
    expect(amountThresholdFromName('Продажи (Порог 200 000 руб)')).toBe(200000);
    expect(amountThresholdFromName('Продажи (Порог 90%)')).toBe(0);
    expect(mergedClientsFromName('АКБ (без учета ЕП и задвоенных: Егорова, Морозов и пр)')).toEqual(['Егорова', 'Морозов']);
    expect(mergedClientsFromName('АКБ')).toEqual([]);
    expect(conditionOf('План ОПХ, руб (порог 90%, При выполнении 80-90% кэф 0,5)')).toBe('порог 90%, При выполнении 80-90% кэф 0,5');
    expect(conditionOf('Оклад')).toBeNull();
  });
});

describe('продажи: проверка правил из запроса', () => {
  it('факт', () => {
    expect(parseFactRule({ type: 'manual' })).toEqual({ value: { type: 'manual' } });
    expect(parseFactRule({ type: 'revenue', groups: [' сидр ', 'сидр', ''], clients: 'x' })).toEqual({ value: { type: 'revenue', groups: ['сидр'], clients: 'all', measure: 'revenue' } });
    expect(parseFactRule({ type: 'clients', exclude_key: true, merge: ['Егорова'] })).toEqual({ value: { type: 'clients', groups: [], exclude_key: true, merge: ['Егорова'] } });
    expect(parseFactRule({ type: 'products', query: '  ', measure: 'clients' }).error).toMatch(/товар/);
    expect(parseFactRule({ type: 'products', query: 'Курс', measure: 'clients' }).value).toEqual({ type: 'products', query: 'Курс', measure: 'clients' });
    expect(parseFactRule({ type: 'items', items: [] }).error).toMatch(/позицию/);
    expect(parseFactRule({ type: 'items', items: [{ name: 'Курс', need: 0 }] }).error).toMatch(/от 1/);
    expect(parseFactRule({ type: 'items', items: [{ name: 'Курс', need: '3' }] }).value).toEqual({ type: 'items', items: [{ name: 'Курс', need: 3 }] });
    expect(parseFactRule({ type: 'revenue', groups: 'сидр' }).error).toMatch(/список/);
    expect(parseFactRule({ type: 'nope' }).error).toBeTruthy();
    expect(parseFactRule(null).error).toBeTruthy();
  });

  it('выплата', () => {
    expect(parsePayoutRule({ type: 'fixed' })).toEqual({ value: { type: 'fixed' } });
    expect(parsePayoutRule({ type: 'threshold', steps: [] }).error).toMatch(/порог/);
    expect(parsePayoutRule({ type: 'threshold', steps: [{ from: 70, k: 0.7 }, { from: 90, k: 1 }], over: 'cap' })).toEqual({
      value: { type: 'threshold', steps: [{ from: 90, k: 1 }, { from: 70, k: 0.7 }], over: 'cap' },
    });
    expect(parsePayoutRule({ type: 'threshold', steps: [{ from: 90, k: 1 }, { from: 90, k: 2 }] }).error).toMatch(/повторяться/);
    expect(parsePayoutRule({ type: 'threshold', steps: [{ from: 90, k: 11 }] }).error).toMatch(/Коэффициент/);
    expect(parsePayoutRule({ type: 'rate', rate: 0.035 })).toEqual({ value: { type: 'rate', rate: 0.035, min: 0 } });
    expect(parsePayoutRule({ type: 'rate', rate: 2 }).error).toMatch(/Процент/);
    expect(parsePayoutRule({ type: 'rate', rate: 0.1, min: -1 }).error).toMatch(/отрицательным/);
    expect(parsePayoutRule('fixed').error).toBeTruthy();
  });

  it('показатель целиком и частично', () => {
    const ok = validatePlanInput({ name: '  Курсы   ДПО ', unit: 'rub', plan: '1 000 000', bonus: 20000, fact_rule: { type: 'manual' }, payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }] } });
    expect(ok.errors).toEqual({});
    expect(ok.input).toMatchObject({ name: 'Курсы ДПО', unit: 'rub', plan: 1000000, bonus: 20000 });
    const bad = validatePlanInput({ name: '', unit: 'kg', plan: -1, bonus: 'x', fact_rule: { type: 'items', items: [{ name: 'A', need: 1 }] }, payout_rule: {} });
    expect(Object.keys(bad.errors).sort()).toEqual(['bonus', 'name', 'payout_rule', 'plan', 'unit']);
    expect(validatePlanInput({ name: 'X', unit: 'rub', plan: 0, bonus: 1, fact_rule: { type: 'manual' }, payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }] } }).errors.plan).toMatch(/порогам/);
    expect(validatePlanInput({ name: 'X', unit: 'rub', plan: 1, bonus: 1, fact_rule: { type: 'items', items: [{ name: 'A', need: 1 }] }, payout_rule: { type: 'items' } }).errors.unit).toMatch(/Позиции/);
    const part = validatePlanInput({ fact: 5 }, { partial: true });
    expect(part).toEqual({ input: { fact: 5 }, errors: {} });
    expect(validatePlanInput({ fact: -1 }, { partial: true }).errors.fact).toBeTruthy();
  });

  it('продажа вручную', () => {
    const today = '2026-10-27';
    expect(validateSaleEntry({ product: ' Курс  «Python» ', amount: '45 000,5' }, today)).toEqual({
      entry: { product: 'Курс «Python»', client: null, quantity: 1, amount: 45000.5, sold_on: today, note: null },
      errors: {},
    });
    const bad = validateSaleEntry({ product: '', quantity: 0, amount: -1, sold_on: '2026-11-01', note: 'x'.repeat(1001) }, today);
    expect(Object.keys(bad.errors).sort()).toEqual(['amount', 'note', 'product', 'quantity', 'sold_on']);
    expect(validateSaleEntry({ product: 'A', sold_on: '27.10.2026' }, today).errors.sold_on).toMatch(/дату/);
  });

  it('список клиентов из текста', () => {
    expect(parsePatterns('ИП Соколова Д.И.\n ип  соколова д.и. \n\nООО Ромашка; Х')).toEqual({ patterns: ['ИП Соколова Д.И.', 'ООО Ромашка'], skipped: 2 });
  });
});

describe('продажи: расчёт месяца', () => {
  const base: SalesPlanRow = {
    id: 'p1',
    user_id: 'u1',
    month: '2026-05',
    name: 'Выручка',
    kind: null,
    unit: 'rub',
    plan: 100000,
    fact: 45000,
    bonus: 12000,
    payment: null,
    file_percent: null,
    fact_rule: { type: 'revenue', groups: [], clients: 'all', measure: 'revenue' },
    payout_rule: { type: 'threshold', steps: [{ from: 90, k: 1 }, { from: 80, k: 0.5 }], over: 'proportional' },
    fact_details: null,
    file_items: null,
    source: 'manual',
    description: null,
    fact_updated_at: null,
    sort_order: 0,
  };
  const cov = coverageOf('2026-05', '2026-05-15', 1);

  it('покрытие месяца отчётами и плитки продаж', () => {
    expect(cov).toEqual({ as_of: '2026-05-15', elapsed: 15, days: 31, work_elapsed: 13, work_days: 26, reports: 1 });
    // Среднее — по рабочим дням (пн–сб): с 1 по 15 мая 2026 — 13 дней.
    expect(salesStats(lines, noLists, cov)).toMatchObject({ revenue: 72000, clients: 6, per_day: 5538.46, quantity: 108 });
    expect(salesStats(lines, lists, cov).clients).toBe(4);
    expect(sp(coverageText(cov))).toBe('Продажи по 15 мая · 1 отчёт из 1С');
    expect(coverageText(null)).toMatch(/ещё нет/);
    expect(salesPeriodText('2026-05-01', '2026-05-15')).toBe('01.05–15.05');
    expect(salesPeriodText('2026-05-10', '2026-05-10')).toBe('10.05');
  });

  it('по отчётам: темп по рабочим дням и прогноз выплаты', () => {
    const c = planCalc(base, cov, '2026-05-16');
    // 45 000 за 13 рабочих дней → 90 000 за 26.
    expect(c).toMatchObject({ source: 'report', tracked: true, percent: 45, now: 0, forecast_value: 90000, forecast_percent: 90, forecast: 12000, max: 12000, marks: [80, 90], as_of: '2026-05-15' });
    expect(sp(c.hint)).toBe('До 80 % — ещё 35 000 ₽ (≈2 692 ₽ в рабочий день)');
    expect(planTone({ ...base, calc: c })).toBe('on_track');
    // Отчётов нет — факт не отслеживается, прогноза нет.
    expect(planCalc(base, null, '2026-05-16')).toMatchObject({ tracked: false, forecast_value: null, forecast: 0, as_of: null });
    // Месяц закрыт отчётами целиком — прогноз не нужен.
    const closed = planCalc({ ...base, fact: 95000 }, coverageOf('2026-05', '2026-05-31', 2), '2026-06-02');
    expect(closed).toMatchObject({ forecast_value: null, now: 12000 });
    expect(sp(closed.hint)).toBe('До плана — ещё 5 000 ₽');
  });

  it('позиции: прогресс по каждой и подсказка, что осталось', () => {
    const p: SalesPlanRow = { ...base, unit: 'items', plan: 2, fact: 0, bonus: 5000, fact_rule: { type: 'items', items: [{ name: 'A', need: 1 }, { name: 'B', need: 3 }] }, payout_rule: { type: 'items' } };
    expect(planCalc(p, cov, '2026-05-16')).toMatchObject({ now: 0, items: [{ name: 'A', count: 0 }, { name: 'B', count: 0 }], hint: 'Осталось: A (0 из 1 кл.), B (0 из 3 кл.)' });
    const done = planCalc({ ...p, fact: 1, fact_details: { from: 'report', items: [{ name: 'A', need: 1, count: 1, done: true }, { name: 'B', need: 3, count: 1, done: false }] } }, cov, '2026-05-16');
    expect(done).toMatchObject({ now: 2500, hint: 'Осталось: B (1 из 3 кл.)' });
  });

  it('вручную: темп по сегодняшнему дню текущего месяца', () => {
    const m = { ...base, fact_rule: { type: 'manual' as const }, payout_rule: { type: 'threshold' as const, steps: [{ from: 100, k: 1 }], over: 'cap' as const } };
    const c = planCalc(m, null, '2026-05-15');
    expect(c).toMatchObject({ source: 'manual', tracked: false, forecast_value: 90000, forecast: 0 });
    // Прошлый месяц — без прогноза.
    expect(planCalc(m, null, '2026-06-15')).toMatchObject({ forecast_value: null });
    expect(planTone({ ...m, calc: c })).toBe('behind');
  });

  it('из файла KPI: факт, процент и «к выплате» как в файле', () => {
    const fileMetric = metric(/Балтика, руб/);
    const row: SalesPlanRow = {
      ...base,
      name: fileMetric.name,
      kind: 'brand',
      plan: 100000,
      fact: 95000,
      payment: 12000,
      file_percent: 95,
      source: 'file',
      fact_rule: { type: 'manual' },
      payout_rule: defaultRules(fileMetric).payout,
      fact_updated_at: '2026-05-10T09:00:00Z',
    };
    const c = planCalc(row, null, '2026-05-12');
    expect(c).toMatchObject({ source: 'file', percent: 95, now: 12000, condition: 'порог 90%, При выполнении 80-90% кэф 0,5', as_of: '2026-05-10' });
    // Темп — по дате загрузки: 95 000 за 8 рабочих дней (3 и 10 мая — воскресенья) → 26 дней.
    expect(c.forecast_value).toBe(308750);
    // Без «к выплате» — по правилу.
    expect(planCalc({ ...row, payment: null, fact: 85000, file_percent: 85 }, null, '2026-06-01')).toMatchObject({ now: 6000, forecast_value: null });
    // Да/нет с процентом: позиции в подсказке.
    const pct = planCalc({ ...row, unit: 'percent', plan: 100, fact: 80, file_percent: 80, bonus: 3000, payment: 2400, description: 'Охота Крепкое; Бочкарев светлое', payout_rule: { type: 'items' } }, null, '2026-05-12');
    expect(pct).toMatchObject({ percent: 80, now: 2400, items: null, marks: [], hint: 'Позиции: Охота Крепкое, Бочкарев светлое' });
  });

  it('итоги месяца: оклад, сейчас, прогноз, максимум и «к выплате» из файла', () => {
    const plans = [
      { kind: 'salary' as const, payout_rule: { type: 'fixed' as const }, source: 'file' as const, payment: 30000, calc: { now: 30000, forecast: 30000, max: 30000 } },
      { kind: 'brand' as const, payout_rule: base.payout_rule, source: 'file' as const, payment: 12000, calc: { now: 12000, forecast: 12000, max: 12000 } },
      { kind: null, payout_rule: base.payout_rule, source: 'manual' as const, payment: null, calc: { now: 0, forecast: 6000, max: 12000 } },
      { kind: 'fuel' as const, payout_rule: { type: 'fixed' as const }, source: 'file' as const, payment: 8000, calc: { now: 8000, forecast: 8000, max: 8000 } },
    ].map((p) => ({ ...p, calc: { ...planCalc(base, null, '2026-05-01'), ...p.calc } }));
    expect(salesTotals(plans)).toEqual({ fixed: 30000, now: 42000, forecast: 48000, max: 54000, file: 42000 });
    expect(salesTotals([])).toEqual({ fixed: 0, now: 0, forecast: 0, max: 0, file: null });
    expect(averagePercent([{ payout_rule: { type: 'fixed' }, plan: 1, calc: { percent: 100 } }, { payout_rule: base.payout_rule, plan: 1, calc: { percent: 50 } }, { payout_rule: base.payout_rule, plan: 1, calc: { percent: 300 } }])).toBe(125);
    expect(averagePercent([])).toBeNull();
    expect(plansLine([])).toBe('План на месяц не задан');
    expect(plansLine([{ payout_rule: { type: 'fixed' } }, { payout_rule: { type: 'items' } }, { payout_rule: { type: 'none' } }])).toBe('2 показателя и фиксированные выплаты');
    expect(plansLine([{ payout_rule: { type: 'fixed' } }])).toBe('Только фиксированные выплаты');
  });

  it('цвет показателя', () => {
    const calc = planCalc(base, cov, '2026-05-16');
    expect(planTone({ ...base, calc: { ...calc, percent: 100 } })).toBe('done');
    expect(planTone({ ...base, calc: { ...calc, forecast_percent: 70 } })).toBe('behind');
    expect(planTone({ ...base, calc: { ...calc, forecast_percent: null } })).toBe('neutral');
    expect(planTone({ ...base, payout_rule: { type: 'fixed' }, calc })).toBe('neutral');
  });

  it('значения и деньги по-русски', () => {
    expect(sp(formatRub(1234567.8))).toBe('1 234 568 ₽');
    expect(sp(salesValueText(44, 'clients'))).toBe('44 кл.');
    expect(sp(salesValueText(3, 'items'))).toBe('3 поз.');
    expect(sp(salesValueText(95.56, 'percent'))).toBe('95,6 %');
    expect(sp(salesValueText(2.5, 'count'))).toBe('2,5 шт');
  });
});

describe('продажи: сотрудники из отчётов', () => {
  const people = [
    { id: 'anna', name: 'Анна Смирнова', email: 'anna@x.ru' },
    { id: 'petr', name: 'Петр Иванов', email: 'p.ivanov@x.ru' },
    { id: 'petr2', name: 'Пётр Сидоров', email: 'sidorov@x.ru' },
    { id: 'olga', name: 'Ольга', email: 'olga.mishina@x.ru' },
  ];

  it('по словам имени в любом порядке, ё = е, по почте; ручное сопоставление важнее', () => {
    const m = matchPeople(['Смирнова Анна', 'Иванов Пётр', 'Пётр', 'Мишина Ольга', 'Неизвестный Менеджер', 'Смирнова Анна', ''], people, new Map([['неизвестный менеджер', 'anna']]));
    expect(Object.fromEntries(m)).toEqual({
      'смирнова анна': { user_id: 'anna', ambiguous: false },
      'иванов петр': { user_id: 'petr', ambiguous: false },
      петр: { user_id: null, ambiguous: true },
      'мишина ольга': { user_id: 'olga', ambiguous: false },
      'неизвестный менеджер': { user_id: 'anna', ambiguous: false },
    });
  });

  it('сопоставление на сотрудника не из списка не применяется', () => {
    const m = matchPeople(['Кто-то'], people, new Map([['кто-то', 'gone']]));
    expect(m.get('кто-то')).toEqual({ user_id: null, ambiguous: false });
  });
});
