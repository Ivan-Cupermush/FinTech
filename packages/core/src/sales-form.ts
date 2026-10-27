import { formatNumber } from './format';
import { addMonths } from './my-notes';
import {
  formatRub,
  salesPeriodText,
  SALES_LIMITS,
  salesValueText,
  validatePlanInput,
  type FactRule,
  type PayoutRule,
  type PlanCalc,
  type ReportPersonStatus,
  type SalesMonth,
  type SalesPlanRow,
  type SalesReportImport,
  type SalesTeamMember,
  type SalesUnit,
} from './sales';

/**
 * Форма показателя продаж для веба и телефона: правила факта и выплаты
 * редактируются строками («90: 1», «Курс Python: 5»), а на сервер уходят
 * готовыми правилами. Здесь же — полоса выполнения и плитки месяца.
 */

export interface PlanForm {
  name: string;
  unit: SalesUnit;
  plan: string;
  bonus: string;
  description: string;
  fact_type: FactRule['type'];
  /** Группы товаров — по одной на строку. */
  groups: string;
  clients: 'all' | 'key' | 'non_key';
  measure: 'revenue' | 'quantity';
  exclude_key: boolean;
  merge: string;
  query: string;
  products_measure: 'revenue' | 'quantity' | 'clients';
  /** «Курс Python: 5» — позиция и в сколько точек продать. */
  items: string;
  payout_type: PayoutRule['type'];
  /** «100: 1» — от скольких % плана и коэффициент бонуса. */
  steps: string;
  over: 'cap' | 'proportional';
  /** Процент от продаж, «3,5». */
  rate: string;
  min: string;
}

export function emptyPlanForm(): PlanForm {
  return {
    name: '',
    unit: 'rub',
    plan: '',
    bonus: '',
    description: '',
    fact_type: 'manual',
    groups: '',
    clients: 'all',
    measure: 'revenue',
    exclude_key: true,
    merge: '',
    query: '',
    products_measure: 'revenue',
    items: '',
    payout_type: 'threshold',
    steps: '100: 1',
    over: 'cap',
    rate: '',
    min: '',
  };
}

const num = (n: number) => formatNumber(n, 2).replace(/\s/g, '');
const lines = (text: string) =>
  text
    .split(/\r?\n|;/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
const parseNum = (s: string) => Number(s.replace(/[\s ]/g, '').replace(',', '.'));

/** Пороги строками: «100: 1», «90: 0,5» — сверху вниз. */
export const stepsText = (steps: readonly { from: number; k: number }[]) =>
  [...steps]
    .sort((a, b) => b.from - a.from)
    .map((s) => `${num(s.from)}: ${num(s.k)}`)
    .join('\n');

/** «90% — 1», «80: 0,5», «70 0.3». Ошибка — с номером строки. */
export function parseStepsText(text: string): { steps: { from: number; k: number }[]; error: string | null } {
  const steps: { from: number; k: number }[] = [];
  const rows = lines(text);
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i]!.match(/^(?:от\s*)?(\d+(?:[.,]\d+)?)\s*%?\s*(?:[:=—–→-]|\s)\s*(?:×|x|х|к)?\s*(\d+(?:[.,]\d+)?)$/i);
    if (!m) return { steps: [], error: `Строка ${i + 1}: напишите «процент плана: коэффициент», например «90: 0,5»` };
    steps.push({ from: parseNum(m[1]!), k: parseNum(m[2]!) });
  }
  if (!steps.length) return { steps, error: 'Добавьте хотя бы один порог' };
  return { steps: steps.sort((a, b) => b.from - a.from), error: null };
}

/** Позиции строками: «Курс Python: 5». */
export const itemsText = (items: readonly { name: string; need: number }[]) => items.map((it) => `${it.name}: ${it.need}`).join('\n');

export function parseItemsText(text: string): { items: { name: string; need: number }[]; error: string | null } {
  const items: { name: string; need: number }[] = [];
  for (const row of lines(text)) {
    const m = row.match(/^(.*?)\s*[:—–-]\s*(\d+)\s*(?:тт|точ[а-я]*|кл\.?)?$/i);
    const name = (m ? m[1]! : row).trim();
    const need = m ? Number(m[2]) : 1;
    if (!name) return { items: [], error: 'У каждой позиции должно быть название' };
    items.push({ name, need });
  }
  if (!items.length) return { items, error: 'Добавьте хотя бы одну позицию' };
  if (items.length > SALES_LIMITS.items) return { items, error: `Позиций — не больше ${SALES_LIMITS.items}` };
  return { items, error: null };
}

/** Форма из показателя — для правки. */
export function planFormOf(p: Pick<SalesPlanRow, 'name' | 'unit' | 'plan' | 'bonus' | 'description' | 'fact_rule' | 'payout_rule'>): PlanForm {
  const f = emptyPlanForm();
  f.name = p.name;
  f.unit = p.unit;
  f.plan = p.plan ? num(p.plan) : '';
  f.bonus = p.bonus ? num(p.bonus) : '';
  f.description = p.description ?? '';
  const r = p.fact_rule;
  f.fact_type = r.type;
  if (r.type === 'revenue') {
    f.groups = r.groups.join('\n');
    f.clients = r.clients;
    f.measure = r.measure;
  } else if (r.type === 'clients') {
    f.groups = r.groups.join('\n');
    f.exclude_key = r.exclude_key;
    f.merge = r.merge.join('\n');
  } else if (r.type === 'products') {
    f.query = r.query;
    f.products_measure = r.measure;
  } else if (r.type === 'items') f.items = itemsText(r.items);
  const pr = p.payout_rule;
  f.payout_type = pr.type;
  if (pr.type === 'threshold') {
    f.steps = stepsText(pr.steps);
    f.over = pr.over;
  } else if (pr.type === 'rate') {
    f.rate = num(Math.round(pr.rate * 100_000) / 1000);
    f.min = pr.min ? num(pr.min) : '';
  }
  return f;
}

/** Единица, которая подходит правилу факта: позиции — «Позиции», клиенты — «Клиенты». */
export function unitForFact(f: Pick<PlanForm, 'fact_type' | 'measure' | 'products_measure' | 'unit'>): SalesUnit {
  switch (f.fact_type) {
    case 'revenue':
      return f.measure === 'quantity' ? 'count' : 'rub';
    case 'clients':
      return 'clients';
    case 'products':
      return f.products_measure === 'revenue' ? 'rub' : f.products_measure === 'quantity' ? 'count' : 'clients';
    case 'items':
      return 'items';
    default:
      return f.unit;
  }
}

export interface PlanBody {
  name: string;
  unit: SalesUnit;
  plan: number;
  bonus: number;
  description: string | null;
  fact_rule: FactRule;
  payout_rule: PayoutRule;
}

/** Тело запроса из формы и ошибки по полям — те же проверки, что на сервере. */
export function planFormBody(f: PlanForm): { body: PlanBody | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  let fact: FactRule = { type: 'manual' };
  switch (f.fact_type) {
    case 'revenue':
      fact = { type: 'revenue', groups: lines(f.groups), clients: f.clients, measure: f.measure };
      break;
    case 'clients':
      fact = { type: 'clients', groups: lines(f.groups), exclude_key: f.exclude_key, merge: lines(f.merge) };
      break;
    case 'products':
      fact = { type: 'products', query: f.query.trim(), measure: f.products_measure };
      break;
    case 'items': {
      const it = parseItemsText(f.items);
      if (it.error) errors.items = it.error;
      fact = { type: 'items', items: it.items };
      break;
    }
  }
  let payout: PayoutRule = { type: f.payout_type } as PayoutRule;
  if (f.payout_type === 'threshold') {
    const st = parseStepsText(f.steps);
    if (st.error) errors.steps = st.error;
    payout = { type: 'threshold', steps: st.steps, over: f.over };
  } else if (f.payout_type === 'rate') {
    const rate = parseNum(f.rate);
    const min = f.min.trim() ? parseNum(f.min) : 0;
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) errors.rate = 'Процент от продаж — больше 0 и не больше 100';
    if (!Number.isFinite(min) || min < 0) errors.min = 'Порог — число не меньше нуля';
    payout = { type: 'rate', rate: Math.round((rate / 100) * 1e6) / 1e6, min: Number.isFinite(min) ? min : 0 };
  }
  const unit = f.fact_type === 'manual' ? f.unit : unitForFact(f);
  const { input, errors: base } = validatePlanInput({
    name: f.name,
    unit,
    plan: f.plan.trim() === '' ? 0 : f.plan,
    bonus: f.bonus.trim() === '' ? 0 : f.bonus,
    fact_rule: fact,
    payout_rule: payout,
  });
  for (const [k, v] of Object.entries(base)) {
    // Ошибку правила показываем у поля, которое её вызвало.
    const key = k === 'fact_rule' ? (f.fact_type === 'items' ? 'items' : f.fact_type === 'products' ? 'query' : 'groups') : k === 'payout_rule' ? (f.payout_type === 'rate' ? 'rate' : 'steps') : k;
    errors[key] ??= v;
  }
  if (Object.keys(errors).length) return { body: null, errors };
  return {
    body: {
      name: input.name!,
      unit: input.unit!,
      plan: input.plan ?? 0,
      bonus: input.bonus ?? 0,
      description: f.description.trim() || null,
      fact_rule: input.fact_rule!,
      payout_rule: input.payout_rule!,
    },
    errors,
  };
}

// ---------------------------------------------------------------- полоса выполнения

export interface PlanBar {
  /** Заполнение полосы, 0–100. */
  fill: number;
  /** Прогноз к концу месяца, 0–100 (null — прогноза нет). */
  forecast: number | null;
  marks: number[];
  /** План перевыполнен — полоса полная и подсвечена. */
  over: boolean;
}

export function planBar(p: Pick<SalesPlanRow, 'plan' | 'payout_rule'>, calc: Pick<PlanCalc, 'percent' | 'forecast_percent' | 'marks'>): PlanBar | null {
  if (!(p.plan > 0) || p.payout_rule.type === 'fixed') return null;
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return {
    fill: clamp(calc.percent),
    forecast: calc.forecast_percent != null && calc.forecast_percent > calc.percent ? clamp(calc.forecast_percent) : null,
    marks: calc.marks.filter((m) => m > 0 && m < 100),
    over: calc.percent >= 100,
  };
}

// ---------------------------------------------------------------- плитки

export interface SalesTile {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad';
}

/** Главные цифры месяца: к выплате сейчас, прогноз, выручка, АКБ. */
export function salesTiles(m: Pick<SalesMonth, 'plans' | 'totals' | 'stats' | 'entries'>): SalesTile[] {
  const tiles: SalesTile[] = [];
  const t = m.totals;
  if (m.plans.length) {
    if (t.file != null) tiles.push({ label: 'К выплате по файлу KPI', value: formatRub(t.file), tone: 'good' });
    else {
      tiles.push({ label: 'Заработано сейчас', value: formatRub(t.now) });
      tiles.push({ label: 'Прогноз к концу месяца', value: formatRub(t.forecast), tone: t.max > 0 && t.forecast >= t.max * 0.999 ? 'good' : undefined });
    }
  }
  if (m.stats) {
    tiles.push({ label: 'Выручка за месяц', value: formatRub(m.stats.revenue) });
    tiles.push({ label: 'Клиентов с продажами', value: formatNumber(m.stats.clients, 0) });
  } else if (m.entries.count) {
    tiles.push({ label: 'Продажи вручную', value: formatRub(m.entries.amount) });
  }
  return tiles.slice(0, 4);
}

/** Строка участника команды: «Выручка 351 500 ₽ · 97 % плана». */
export function teamMemberLine(x: Pick<SalesTeamMember, 'plans' | 'percent' | 'stats' | 'entries'>): string {
  const parts: string[] = [];
  if (x.stats) parts.push(`выручка ${formatRub(x.stats.revenue)}`);
  else if (x.entries.count) parts.push(`вручную ${formatRub(x.entries.amount)}`);
  if (x.percent != null) parts.push(`${formatNumber(x.percent, 0)} % плана в среднем`);
  if (!x.plans) parts.push('плана нет');
  const s = parts.join(' · ');
  return s ? s[0]!.toUpperCase() + s.slice(1) : '';
}

/** «351 500 ₽ из 400 000 ₽» — факт и план показателя. */
export const factOfPlan = (p: Pick<SalesPlanRow, 'fact' | 'plan' | 'unit'>) =>
  p.plan > 0 ? `${salesValueText(p.fact, p.unit)} из ${salesValueText(p.plan, p.unit)}` : salesValueText(p.fact, p.unit);

// ---------------------------------------------------------------- карточка показателя

export const PLAN_SOURCE_LABELS: Record<PlanCalc['source'], string> = { file: 'Файл KPI', report: 'Отчёты 1С', manual: 'Вручную' };

/** «По темпу к концу месяца: 690 341 ₽ · 106 % плана» — для показателей с планом и прогнозом. */
export function planForecastText(p: Pick<SalesPlanRow, 'plan' | 'unit' | 'payout_rule'> & { calc: Pick<PlanCalc, 'forecast_value' | 'forecast_percent'> }): string | null {
  const c = p.calc;
  if (c.forecast_value == null || !(p.plan > 0) || p.payout_rule.type === 'fixed') return null;
  const value = p.unit === 'rub' ? c.forecast_value : Math.round(c.forecast_value);
  return `По темпу к концу месяца: ${salesValueText(value, p.unit)} · ${formatNumber(c.forecast_percent ?? 0, 0)}\u00a0% плана`;
}

/** Выплата по показателю: «К выплате» по файлу KPI или «Сейчас / Прогноз / Максимум». */
export function planPayParts(p: Pick<SalesPlanRow, 'source' | 'payment' | 'payout_rule'> & { calc: Pick<PlanCalc, 'now' | 'forecast' | 'max'> }): { label: string; value: string }[] {
  const c = p.calc;
  if (c.now == null || p.payout_rule.type === 'fixed') return [];
  if (p.source === 'file' && p.payment != null) return [{ label: 'К выплате', value: formatRub(p.payment) }];
  const parts = [{ label: 'Сейчас', value: formatRub(c.now) }];
  if (c.forecast != null && c.forecast !== c.now) parts.push({ label: 'Прогноз', value: formatRub(c.forecast) });
  if (c.max != null) parts.push({ label: 'Максимум', value: formatRub(c.max) });
  return parts;
}

/**
 * Показатели, к факту которых можно прибавить записанную продажу: факт ведётся
 * вручную, считается в рублях, штуках или клиентах и выплата не фиксированная.
 */
export const entryPlans = <T extends Pick<SalesPlanRow, 'source' | 'fact_rule' | 'unit' | 'payout_rule'>>(plans: readonly T[]): T[] =>
  plans.filter((p) => p.source === 'manual' && p.fact_rule.type === 'manual' && p.unit !== 'percent' && p.unit !== 'items' && p.payout_rule.type !== 'fixed');

/** Факт, введённый вручную: «12 500,5» → 12500.5; пусто, текст и минус — ошибка. */
export function parseFactInput(text: string): { value: number | null; error: string | null } {
  const raw = text.replace(/[\s\u00a0]/g, '').replace(',', '.');
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return { value: null, error: 'Факт — число не меньше нуля' };
  if (n > 1e12) return { value: null, error: 'Слишком большое число' };
  return { value: Math.round(n * 100) / 100, error: null };
}

/** Соседние месяцы для переключателя: вперёд — не дальше следующего за текущим (план ставят заранее). */
export function salesMonthNav(month: string, current: string): { prev: string; next: string | null } {
  const next = addMonths(month, 1);
  return { prev: addMonths(month, -1), next: next > addMonths(current, 1) ? null : next };
}

// ---------------------------------------------------------------- итог загрузки отчёта

export const REPORT_PERSON_STATUS_LABELS: Record<ReportPersonStatus, string> = {
  ok: 'Загружено',
  unmatched: 'Не нашли сотрудника',
  ambiguous: 'Несколько похожих',
  forbidden: 'Не ваш сотрудник',
  no_manager: 'Без менеджера',
};

/** Итог загрузки отчёта 1С одним абзацем — для телефона и уведомления. */
export function reportImportSummary(r: SalesReportImport): { title: string; lines: string[]; needsMatching: boolean } {
  const title = r.report ? `Отчёт ${salesPeriodText(r.report.period_start, r.report.period_end)}: ${formatRub(r.report.total)}` : 'Ничего не сохранено';
  const lines: string[] = [];
  if (r.replaced > 0) lines.push(`Заменил прежний: ${r.replaced}`);
  const ok = r.people.filter((x) => x.status === 'ok');
  if (ok.length) lines.push(`Сотрудников с продажами: ${ok.length}, показателей пересчитано: ${ok.reduce((n, x) => n + x.plans_updated, 0)}`);
  const lost = r.people.filter((x) => x.status === 'unmatched' || x.status === 'ambiguous');
  if (lost.length) lines.push(`Не сопоставлены: ${lost.map((x) => x.manager).join(', ')} — сопоставьте на сайте, в «Продажи → Настройки»`);
  if (r.goals_updated > 0) lines.push(`KPI целей обновлено: ${r.goals_updated}`);
  if (r.key_list_empty) lines.push('Список ключевых клиентов пуст — продажи «без ключевых» сейчас равны всем продажам');
  lines.push(...r.warnings);
  return { title, lines, needsMatching: lost.length > 0 };
}
