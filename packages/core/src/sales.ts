import { formatNumber } from './format';
import { isIsoDay } from './my-notes';
import { cellText, daysInMonth, matchesClient, matchesItem, monthLastDay, personScore, personWords, salesKey, workDays } from './sales-text';
import { plural } from './units';

/**
 * Продажи и личный KPI сотрудника с выплатами — модуль из прошлого проекта.
 *
 * У сотрудника на месяц есть план из показателей: «Выручка без ключевых
 * клиентов, порог 90 %», «Активная клиентская база», «Дистрибуция: 5 позиций
 * в 4 точки», оклад. У каждого показателя два правила:
 *  - как считается факт: вручную, по отчётам 1С о продажах (выручка, штуки,
 *    число клиентов, позиции) или из файла KPI;
 *  - сколько за него платят: фиксированно, по порогам выполнения, процентом
 *    от продаж или поровну за выполненные позиции.
 *
 * Отсюда «заработано сейчас», «прогноз к концу месяца» по темпу рабочих дней
 * (пн–сб) и «максимум». Здесь только расчёты, без базы и файлов.
 */

// ---------------------------------------------------------------- виды и единицы

export const SALES_UNITS = ['rub', 'count', 'clients', 'items', 'percent'] as const;
export type SalesUnit = (typeof SALES_UNITS)[number];

export const SALES_UNIT_LABELS: Record<SalesUnit, { label: string; short: string }> = {
  rub: { label: 'Рубли', short: '₽' },
  count: { label: 'Штуки', short: 'шт' },
  clients: { label: 'Клиенты, точки', short: 'ТТ' },
  items: { label: 'Позиции', short: 'поз.' },
  percent: { label: 'Проценты выполнения', short: '%' },
};

/**
 * Вид показателя. Ключевые клиенты — сеть, по которой продажи считаются
 * отдельно (в файлах заказчика — «Есть повод», «ЕП»). АКБ — активная
 * клиентская база: число клиентов с продажами за месяц.
 */
export const SALES_KINDS = ['non_key', 'key', 'clients', 'distribution', 'brand', 'salary', 'fuel', 'fixed', 'other'] as const;
export type SalesKind = (typeof SALES_KINDS)[number];

export const SALES_KIND_LABELS: Record<SalesKind, string> = {
  non_key: 'Продажи без ключевых клиентов',
  key: 'Продажи ключевым клиентам',
  clients: 'Активная клиентская база',
  distribution: 'Дистрибуция позиций',
  brand: 'Продажи бренда',
  salary: 'Оклад',
  fuel: 'Топливо',
  fixed: 'Фиксированная выплата',
  other: 'Показатель',
};

/** Разделитель групп в пути товара: «Пиво › Пиво разливное › Драфт». */
export const PATH_SEP = ' › ';

// ---------------------------------------------------------------- правила

export type FactRule =
  /** Факт не из отчётов: вносится вручную, продажами или из файла KPI. */
  | { type: 'manual' }
  /** Выручка или штуки: все продажи или группы товаров; клиенты — все, только ключевые или без них. */
  | { type: 'revenue'; groups: string[]; clients: 'all' | 'key' | 'non_key'; measure: 'revenue' | 'quantity' }
  /** АКБ: число клиентов с продажами. Задвоенные клиенты из merge — одна точка. */
  | { type: 'clients'; groups: string[]; exclude_key: boolean; merge: string[] }
  /** Товар или группа по названию: выручка, штуки или число точек. */
  | { type: 'products'; query: string; measure: 'revenue' | 'quantity' | 'clients' }
  /** Дистрибуция: каждую позицию нужно продать в N точек. */
  | { type: 'items'; items: { name: string; need: number }[] };

export type PayoutRule =
  | { type: 'none' }
  /** Оклад и другие выплаты, которые платятся всегда. */
  | { type: 'fixed' }
  /** Пороги: от N % плана — бонус × k. Сверх плана — не растёт или растёт пропорционально. */
  | { type: 'threshold'; steps: { from: number; k: number }[]; over: 'cap' | 'proportional' }
  /** Процент от продаж, если продано не меньше min. */
  | { type: 'rate'; rate: number; min: number }
  /** Бонус делится поровну между выполненными позициями. */
  | { type: 'items' };

export const FACT_RULE_LABELS: Record<FactRule['type'], string> = {
  manual: 'Вручную',
  revenue: 'Продажи по отчётам 1С',
  clients: 'Клиенты с продажами (АКБ)',
  products: 'Товар по названию',
  items: 'Позиции в точках',
};

export const PAYOUT_RULE_LABELS: Record<PayoutRule['type'], string> = {
  none: 'Без выплаты',
  fixed: 'Фиксированная',
  threshold: 'По порогам выполнения',
  rate: 'Процент от продаж',
  items: 'За выполненные позиции',
};

export const SALES_LIMITS = {
  name: 300,
  groups: 50,
  group: 300,
  items: 30,
  item: 200,
  steps: 10,
  /** Списков клиентов: строк на компанию. */
  listPatterns: 2000,
  pattern: 200,
  product: 255,
  client: 255,
  note: 1000,
  /** Строк в одной загрузке продаж из Excel. */
  importRows: 5000,
  /** Сумма — до 10 млрд: больше похоже на опечатку. */
  amount: 10_000_000_000,
} as const;

type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function strings(v: unknown, max: number, len: number, what: string): Result<string[]> {
  if (v === undefined || v === null) return { value: [] };
  if (!Array.isArray(v)) return { error: `${what}: нужен список` };
  const out = [...new Set(v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean))];
  if (out.length > max) return { error: `${what}: не больше ${max}` };
  if (out.some((s) => s.length > len)) return { error: `${what}: каждое — не длиннее ${len} символов` };
  return { value: out };
}

/** Правило факта из запроса. Неизвестное поле не ломает, неизвестный тип — ошибка. */
export function parseFactRule(v: unknown): Result<FactRule> {
  if (!isObj(v)) return { error: 'Выберите, как считается факт' };
  switch (v.type) {
    case 'manual':
      return { value: { type: 'manual' } };
    case 'revenue': {
      const groups = strings(v.groups, SALES_LIMITS.groups, SALES_LIMITS.group, 'Группы товаров');
      if (groups.error !== undefined) return groups;
      const clients = v.clients === 'key' || v.clients === 'non_key' ? v.clients : 'all';
      const measure = v.measure === 'quantity' ? 'quantity' : 'revenue';
      return { value: { type: 'revenue', groups: groups.value, clients, measure } };
    }
    case 'clients': {
      const groups = strings(v.groups, SALES_LIMITS.groups, SALES_LIMITS.group, 'Группы товаров');
      if (groups.error !== undefined) return groups;
      const merge = strings(v.merge, SALES_LIMITS.groups, SALES_LIMITS.pattern, 'Задвоенные клиенты');
      if (merge.error !== undefined) return merge;
      return { value: { type: 'clients', groups: groups.value, exclude_key: v.exclude_key === true, merge: merge.value } };
    }
    case 'products': {
      const query = typeof v.query === 'string' ? v.query.trim() : '';
      if (!query) return { error: 'Укажите товар или группу' };
      if (query.length > SALES_LIMITS.item) return { error: `Название товара — не длиннее ${SALES_LIMITS.item} символов` };
      const measure = v.measure === 'quantity' || v.measure === 'clients' ? v.measure : 'revenue';
      return { value: { type: 'products', query, measure } };
    }
    case 'items': {
      if (!Array.isArray(v.items) || !v.items.length) return { error: 'Добавьте хотя бы одну позицию' };
      if (v.items.length > SALES_LIMITS.items) return { error: `Позиций — не больше ${SALES_LIMITS.items}` };
      const items: { name: string; need: number }[] = [];
      for (const it of v.items) {
        const name = isObj(it) && typeof it.name === 'string' ? it.name.trim() : '';
        const need = isObj(it) ? Number(it.need) : NaN;
        if (!name) return { error: 'У каждой позиции должно быть название' };
        if (name.length > SALES_LIMITS.item) return { error: `Название позиции — не длиннее ${SALES_LIMITS.item} символов` };
        if (!Number.isInteger(need) || need < 1 || need > 10_000) return { error: `«${name}»: число точек — целое от 1 до 10 000` };
        items.push({ name, need });
      }
      return { value: { type: 'items', items } };
    }
    default:
      return { error: 'Неизвестный способ подсчёта факта' };
  }
}

export function parsePayoutRule(v: unknown): Result<PayoutRule> {
  if (!isObj(v)) return { error: 'Выберите, как считается выплата' };
  switch (v.type) {
    case 'none':
    case 'fixed':
    case 'items':
      return { value: { type: v.type } };
    case 'rate': {
      const rate = Number(v.rate);
      const min = v.min === undefined || v.min === null || v.min === '' ? 0 : Number(v.min);
      if (!Number.isFinite(rate) || rate <= 0 || rate > 1) return { error: 'Процент от продаж — от 0 до 100 %' };
      if (!Number.isFinite(min) || min < 0) return { error: 'Порог продаж не может быть отрицательным' };
      return { value: { type: 'rate', rate, min } };
    }
    case 'threshold': {
      if (!Array.isArray(v.steps) || !v.steps.length) return { error: 'Добавьте хотя бы один порог' };
      if (v.steps.length > SALES_LIMITS.steps) return { error: `Порогов — не больше ${SALES_LIMITS.steps}` };
      const steps: { from: number; k: number }[] = [];
      for (const s of v.steps) {
        const from = isObj(s) ? Number(s.from) : NaN;
        const k = isObj(s) ? Number(s.k) : NaN;
        if (!Number.isFinite(from) || from < 0 || from > 1000) return { error: 'Порог — от 0 до 1000 % плана' };
        if (!Number.isFinite(k) || k < 0 || k > 10) return { error: 'Коэффициент — от 0 до 10' };
        steps.push({ from, k });
      }
      if (new Set(steps.map((s) => s.from)).size !== steps.length) return { error: 'Пороги не должны повторяться' };
      steps.sort((a, b) => b.from - a.from);
      return { value: { type: 'threshold', steps, over: v.over === 'proportional' ? 'proportional' : 'cap' } };
    }
    default:
      return { error: 'Неизвестный способ выплаты' };
  }
}

// ---------------------------------------------------------------- правила из названия

const numberIn = (s: string) => Number(s.replace(/[\s ]/g, '').replace(',', '.'));

/** Пороги из названия: «порог 90%, при выполнении 80-90% кэф 0,5» → [90 → 1, 80 → 0,5]. */
export function thresholdsFromName(name: string): { from: number; k: number }[] {
  const s = name.toLowerCase();
  const steps: { from: number; k: number }[] = [];
  const main = s.match(/порог[а-яё]*\s*(\d+(?:[.,]\d+)?)\s*%/);
  if (main) steps.push({ from: numberIn(main[1]!), k: 1 });
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*%?\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*%[^,;)]*?(?:кэф|коэф[а-яё]*|кф|к-т)\.?\s*(\d+(?:[.,]\d+)?)/g)) {
    steps.push({ from: numberIn(m[1]!), k: numberIn(m[3]!) });
  }
  const seen = new Set<number>();
  return steps
    .filter((st) => Number.isFinite(st.from) && Number.isFinite(st.k) && !seen.has(st.from) && (seen.add(st.from), true))
    .sort((a, b) => b.from - a.from);
}

/** Порог в рублях: «Порог 200 000 руб» → 200000. */
export function amountThresholdFromName(name: string): number {
  const m = name.toLowerCase().match(/порог[а-яё]*\s*([\d\s ]{3,})\s*(?:руб|р\.|₽|т\.?\s*р)/);
  return m ? numberIn(m[1]!) : 0;
}

/** Задвоенные клиенты из названия АКБ: «без учета ЕП и задвоенных: Егорова, Морозов и пр» → [Егорова, Морозов]. */
export function mergedClientsFromName(name: string): string[] {
  const m = name.match(/задвоен[а-яё]*\s*:?\s*([^)]*)/i);
  if (!m) return [];
  return m[1]!
    .split(/,|\sи\s/)
    .map((w) => w.trim().replace(/\.$/, ''))
    .filter((w) => w.length >= 3 && !/^(пр|др|прочие|другие|т\.?\s*д)$/i.test(w));
}

/** «План ОПХ, руб (порог 90%, При выполнении 80-90% кэф 0,5)» → «порог 90%, При выполнении 80-90% кэф 0,5». */
export function conditionOf(name: string | null | undefined): string | null {
  const parts = [...(name || '').matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.trim()).filter(Boolean);
  return parts.length ? parts.join('; ') : null;
}

/**
 * Бренды из файлов заказчиков прошлого проекта: группы товаров, по которым
 * считается факт, даже если отчётов ещё нет. Остальные бренды находятся по
 * группам товаров в загруженных отчётах (guessFactRule).
 */
export const BRAND_GROUPS: readonly { test: RegExp; groups: string[] }[] = [
  { test: /балтик/, groups: ['балтика'] },
  { test: /(^|[^а-яa-z])опх([^а-яa-z]|$)|heineken|хейнекен/, groups: ['heineken', 'хейнекен', 'опх'] },
];

/** Вид показателя по названию. Опечатки из реальных файлов («Есть Подод») учтены. */
export function salesKindOf(name: string, fixed: boolean): SalesKind {
  const s = salesKey(name);
  if (fixed) {
    if (s.startsWith('оклад')) return 'salary';
    if (/гсм|топлив|бензин/.test(s)) return 'fuel';
    return 'fixed';
  }
  const word = (w: string) => new RegExp(`(^|[^а-яa-z])${w}([^а-яa-z]|$)`).test(s);
  if (/без\s*(еп|есть\s*по[вд]о[дт]|ключев)/.test(s)) return 'non_key';
  if (word('акб') || /клиентск[а-я]*\s+баз/.test(s)) return 'clients';
  if (s.includes('дистр')) return 'distribution';
  if (/есть\s*по[вд]о[дт]/.test(s) || word('еп') || /ключев[а-я]*\s+клиент/.test(s)) return 'key';
  if (BRAND_GROUPS.some((b) => b.test.test(s))) return 'brand';
  return 'other';
}

/** Слова названия показателя, которые не про товар («План продаж …, руб (порог 90%)»). */
const NOT_PRODUCT = new Set([
  'план', 'плана', 'продаж', 'продажи', 'продажа', 'руб', 'рубли', 'рублей', 'тт', 'шт', 'порог', 'выполнение', 'выполнении',
  'при', 'кэф', 'коэф', 'факт', 'бонус', 'сумма', 'объем', 'объём', 'по', 'на', 'в', 'и', 'с', 'без', 'от', 'до', 'за', 'месяц',
  'kpi', 'кпи', 'новых', 'клиентов', 'точек', 'точки', 'количество', 'выручка', 'выручки',
]);

/**
 * Показатель, которого нет среди известных: если слово из его названия есть
 * в названии группы товаров отчёта («План Сидр, руб» → «СИДР, МЕДОВУХА»),
 * факт считается по этим группам.
 */
export function guessFactRule(name: string, knownGroups: readonly string[]): FactRule | null {
  const plain = salesKey(name.replace(/\([^)]*\)/g, ' '));
  const keys = (plain.match(/[a-zа-я0-9]+/g) || []).filter((w) => w.length >= 3 && !NOT_PRODUCT.has(w) && !/^\d+$/.test(w));
  const groupWords = knownGroups.map((g) => salesKey(g).match(/[a-zа-я0-9]+/g) || []);
  const hits = [...new Set(keys.filter((k) => groupWords.some((ws) => ws.some((w) => w === k || (k.length >= 4 && w.startsWith(k))))))];
  if (!hits.length) return null;
  if (/(^|[^а-я])тт([^а-я]|$)|точ/.test(plain)) return { type: 'clients', groups: hits, exclude_key: false, merge: [] };
  return { type: 'revenue', groups: hits, clients: 'all', measure: /(^|[^а-я])шт([^а-я]|$)/.test(plain) ? 'quantity' : 'revenue' };
}

/** Позиция плана из файла KPI. */
export interface KpiItem {
  name: string;
  /** Сколько точек нужно. */
  need: number;
  /** Сколько точек по файлу, если указано («(4)»). */
  file_count: number | null;
  /** Отметка в файле: V — выполнено, X — нет. */
  file_done: boolean | null;
}

/** Показатель из файла KPI сотрудника. */
export interface KpiMetric {
  name: string;
  kind: SalesKind;
  fixed: boolean;
  plan: number;
  fact: number | null;
  /** Бонус при выполнении плана. */
  bonus: number;
  /** К выплате по файлу (null — в файле нет итогов). */
  payment: number | null;
  /** Ставка от продаж (0,035 = 3,5 %), если в строке «%» ставка, а не выполнение. */
  rate: number | null;
  file_percent: number | null;
  items: KpiItem[];
  /** План и факт в файле — «да/нет». */
  yes_no: boolean;
  /** «да/нет» без отметок у позиций: выполнение — процент из файла. */
  percent_only: boolean;
}

/** Правила по умолчанию для показателя: из его вида и названия. */
export function defaultRules(m: Pick<KpiMetric, 'name' | 'kind' | 'fixed' | 'rate' | 'items'>, knownGroups: readonly string[] = []): { fact: FactRule; payout: PayoutRule } {
  if (m.fixed) return { fact: { type: 'manual' }, payout: { type: 'fixed' } };
  const steps = thresholdsFromName(m.name);
  const threshold = (over: 'cap' | 'proportional'): PayoutRule => ({ type: 'threshold', steps: steps.length ? steps : [{ from: 100, k: 1 }], over });
  const payout: PayoutRule = m.rate != null ? { type: 'rate', rate: m.rate, min: amountThresholdFromName(m.name) } : threshold('proportional');
  switch (m.kind) {
    case 'non_key':
      return { fact: { type: 'revenue', groups: [], clients: 'non_key', measure: 'revenue' }, payout };
    case 'key':
      return { fact: { type: 'revenue', groups: [], clients: 'key', measure: 'revenue' }, payout };
    case 'brand': {
      const s = salesKey(m.name);
      const groups = BRAND_GROUPS.find((b) => b.test.test(s))?.groups;
      if (groups) return { fact: { type: 'revenue', groups: [...groups], clients: 'all', measure: 'revenue' }, payout };
      break;
    }
    case 'clients':
      return { fact: { type: 'clients', groups: [], exclude_key: true, merge: mergedClientsFromName(m.name) }, payout: threshold('cap') };
    case 'distribution':
      return m.items.length
        ? { fact: { type: 'items', items: m.items.map((i) => ({ name: i.name, need: i.need })) }, payout: { type: 'items' } }
        : { fact: { type: 'manual' }, payout: threshold('cap') };
  }
  const fact = guessFactRule(m.name, knownGroups) ?? { type: 'manual' as const };
  return { fact, payout: m.rate != null || fact.type === 'revenue' ? payout : threshold('cap') };
}

// ---------------------------------------------------------------- выплата

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Выплата по правилу при данном факте. */
export function payoutFor(rule: PayoutRule, v: { plan: number; fact: number; bonus: number; done?: number; total?: number }): number {
  switch (rule.type) {
    case 'none':
      return 0;
    case 'fixed':
      return round2(v.bonus);
    case 'rate':
      return v.fact >= rule.min ? round2(v.fact * rule.rate) : 0;
    case 'items':
      return v.total ? round2((v.bonus * (v.done ?? 0)) / v.total) : 0;
    case 'threshold': {
      if (!(v.plan > 0)) return 0;
      const pct = (v.fact / v.plan) * 100;
      const steps = [...rule.steps].sort((a, b) => b.from - a.from);
      const step = steps.find((s) => pct >= s.from - 1e-9);
      if (!step) return 0;
      const top = step === steps[0];
      const k = rule.over === 'proportional' && top && pct > 100 ? (step.k * pct) / 100 : step.k;
      return round2(v.bonus * k);
    }
  }
}

/** Максимум выплаты при выполнении плана («до … ₽»). */
export function maxPayout(rule: PayoutRule, plan: number, bonus: number): number {
  switch (rule.type) {
    case 'none':
      return 0;
    case 'rate':
      return round2(Math.max(bonus, plan * rule.rate));
    case 'threshold':
      return round2(bonus * Math.max(...rule.steps.map((s) => s.k)));
    default:
      return round2(bonus);
  }
}

const NBSP = ' ';
/** «12 000 ₽» с неразрывными пробелами, без копеек. */
export const formatRub = (n: number) => `${formatNumber(Math.round(n), 0)}${NBSP}₽`;
const pct = (n: number) => `${formatNumber(n, 2)}${NBSP}%`;

/** Значение показателя с единицей: «1 200 000 ₽», «44 ТТ», «3 поз.», «95 %». */
export function salesValueText(value: number, unit: SalesUnit): string {
  if (unit === 'rub') return formatRub(value);
  if (unit === 'percent') return `${formatNumber(value, 1)}${NBSP}%`;
  return `${formatNumber(value, unit === 'count' ? 2 : 0)}${NBSP}${SALES_UNIT_LABELS[unit].short}`;
}

/** Правило выплаты словами — для карточки показателя. */
export function ruleText(rule: PayoutRule, bonus: number, itemsTotal = 0): string {
  switch (rule.type) {
    case 'none':
      return '';
    case 'fixed':
      return 'фиксированная выплата';
    case 'rate':
      return `${pct(rule.rate * 100)} от продаж${rule.min > 0 ? `, если продано от ${formatRub(rule.min)}` : ''}`;
    case 'items':
      return itemsTotal ? `${formatRub(bonus)} делится между позициями: по ${formatRub(bonus / itemsTotal)} за каждую` : `${formatRub(bonus)} за позиции`;
    case 'threshold': {
      const steps = [...rule.steps].sort((a, b) => b.from - a.from);
      const parts = steps.map((s, i) => {
        const money = s.k === 1 ? formatRub(bonus) : `${formatRub(bonus * s.k)} (×${NBSP}${formatNumber(s.k, 2)})`;
        return i === 0 ? `от ${pct(s.from)} — ${money}` : `${formatNumber(s.from, 2)}–${pct(steps[i - 1]!.from)} — ${money}`;
      });
      if (rule.over === 'proportional') parts.push('сверх плана — пропорционально');
      return parts.join(', ');
    }
  }
}

/** Отметки порогов на полосе выполнения, в % плана. */
export function ruleMarks(rule: PayoutRule, plan: number): number[] {
  if (rule.type === 'threshold') return rule.steps.map((s) => s.from).filter((f) => f > 0 && f <= 100).sort((a, b) => a - b);
  if (rule.type === 'rate' && rule.min > 0 && plan > 0) return [Math.round((rule.min / plan) * 1000) / 10].filter((m) => m <= 100);
  return [];
}

// ---------------------------------------------------------------- факт по отчётам

/** Строка отчёта о продажах одного сотрудника. */
export interface ReportLine {
  client_name: string;
  kind: 'total' | 'group' | 'item';
  group_path: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface ClientLists {
  /** Ключевые клиенты (сеть): их продажи считаются отдельно. */
  key: string[];
  /** Задвоенные клиенты: все с таким названием — одна точка в АКБ. */
  merge: string[];
}

export interface ItemProgress {
  name: string;
  need: number;
  count: number;
  done: boolean;
}

export interface FactDetails {
  clients?: number;
  items?: ItemProgress[];
  excluded_key?: number;
}

export interface FactResult {
  value: number;
  details: FactDetails;
}

const segmentsOf = (l: Pick<ReportLine, 'group_path' | 'name'>) => [...(l.group_path ? l.group_path.split(PATH_SEP) : []), l.name];

/**
 * Подходит ли строка под выбранные группы: «балтика» — любая группа, в названии
 * которой есть это слово; «ПИВО › … › Драфт Балтика» — именно эта группа.
 */
function groupMatcher(patterns: readonly string[]) {
  const sep = PATH_SEP.trim();
  const keys = patterns.map((p) => ({ path: p.includes(sep), key: salesKey(p.split(sep).map((s) => s.trim()).join(PATH_SEP)) }));
  const hit = (segs: string[], isGroup: boolean) => keys.some((p) => (p.path ? salesKey(segs.join(PATH_SEP)) === p.key : isGroup && salesKey(segs[segs.length - 1]).includes(p.key)));
  /** Строка учитывается, если подходит она сама, а не группа выше: иначе сумма задвоится. */
  return (l: ReportLine) => {
    if (l.kind === 'total') return false;
    const segs = segmentsOf(l);
    if (!hit(segs, l.kind === 'group')) return false;
    for (let i = 1; i < segs.length; i++) if (hit(segs.slice(0, i), true)) return false;
    return true;
  };
}

/** Факт показателя по строкам отчётов за месяц; null — показатель не считается по отчётам. */
export function computeFact(rule: FactRule, lines: readonly ReportLine[], lists: ClientLists): FactResult | null {
  const keyCache = new Map<string, boolean>();
  const isKey = (client: string) => {
    let v = keyCache.get(client);
    if (v === undefined) {
      v = lists.key.some((p) => matchesClient(client, p));
      keyCache.set(client, v);
    }
    return v;
  };

  /** Выручка (или штуки) по клиентам: все продажи или только выбранные группы. */
  const byClient = (groups: readonly string[], measure: 'revenue' | 'quantity' = 'revenue') => {
    const out = new Map<string, number>();
    const match = groups.length ? groupMatcher(groups) : (l: ReportLine) => l.kind === 'total';
    for (const l of lines) if (match(l)) out.set(l.client_name, (out.get(l.client_name) ?? 0) + Number(l[measure]));
    return out;
  };

  switch (rule.type) {
    case 'manual':
      return null;
    case 'revenue': {
      let sum = 0;
      let clients = 0;
      for (const [client, v] of byClient(rule.groups, rule.measure)) {
        const key = isKey(client);
        if ((rule.clients === 'key' && !key) || (rule.clients === 'non_key' && key)) continue;
        sum += v;
        if (v > 0) clients++;
      }
      return { value: round2(sum), details: { clients } };
    }
    case 'clients': {
      const points = new Set<string>();
      let excluded = 0;
      const merge = [...rule.merge, ...lists.merge];
      for (const [client, v] of byClient(rule.groups)) {
        if (!(v > 0)) continue;
        if (rule.exclude_key && isKey(client)) {
          excluded++;
          continue;
        }
        const merged = merge.find((p) => matchesClient(client, p));
        points.add(merged ? `merge:${salesKey(merged)}` : salesKey(client));
      }
      return { value: points.size, details: { clients: points.size, excluded_key: excluded } };
    }
    case 'products': {
      // Товар или группа по названию; вложенное в уже подходящую группу второй раз не считаем.
      const cache = new Map<string, boolean>();
      const hit = (name: string) => {
        let v = cache.get(name);
        if (v === undefined) {
          v = matchesItem(rule.query, name);
          cache.set(name, v);
        }
        return v;
      };
      let sum = 0;
      const clients = new Set<string>();
      for (const l of lines) {
        if (l.kind === 'total' || !hit(l.name)) continue;
        const parents = l.group_path ? l.group_path.split(PATH_SEP) : [];
        if (parents.some(hit)) continue;
        if (rule.measure === 'clients') {
          if (Number(l.quantity) > 0 || Number(l.revenue) > 0) clients.add(salesKey(l.client_name));
        } else sum += Number(l[rule.measure]);
      }
      const value = rule.measure === 'clients' ? clients.size : round2(sum);
      return { value, details: clients.size ? { clients: clients.size } : {} };
    }
    case 'items': {
      const cache = new Map<string, boolean>();
      const items: ItemProgress[] = rule.items.map((item) => {
        const clients = new Set<string>();
        for (const l of lines) {
          if (l.kind === 'total' || !(Number(l.quantity) > 0)) continue;
          const k = `${item.name}\u0000${l.name}`;
          let ok = cache.get(k);
          if (ok === undefined) {
            ok = matchesItem(item.name, l.name);
            cache.set(k, ok);
          }
          if (ok) clients.add(salesKey(l.client_name));
        }
        return { name: item.name, need: item.need, count: clients.size, done: clients.size >= item.need };
      });
      return { value: items.filter((i) => i.done).length, details: { items } };
    }
  }
}

/** Считается ли факт по отчётам: такие показатели пересчитываются при каждой загрузке. */
export const factFromReports = (rule: FactRule) => rule.type !== 'manual';

// ---------------------------------------------------------------- покрытие отчётами и статистика

export interface SalesCoverage {
  /** Последний день, за который есть отчёт. */
  as_of: string;
  /** Дней месяца с данными: с 1-го числа по as_of. */
  elapsed: number;
  days: number;
  /** Рабочих дней (пн–сб) с 1-го по as_of и во всём месяце. */
  work_elapsed: number;
  work_days: number;
  reports: number;
}

/** Покрытие месяца «2026-10» отчётами по последний день as_of. */
export function coverageOf(month: string, asOf: string, reports: number): SalesCoverage {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const elapsed = Number(asOf.slice(8, 10));
  return { as_of: asOf, elapsed, days: daysInMonth(y, m), work_elapsed: workDays(y, m, elapsed), work_days: workDays(y, m), reports };
}

export interface SalesStats extends SalesCoverage {
  /** Выручка с 1-го числа по последний отчёт. */
  revenue: number;
  /** АКБ: клиенты с продажами без ключевых, задвоенные — одна точка. */
  clients: number;
  /** Средняя выручка в рабочий день. */
  per_day: number;
  /** Продано, шт (все товары). */
  quantity: number;
}

/** Плитки продаж по строкам «итого по клиенту» за месяц. */
export function salesStats(totalLines: readonly ReportLine[], lists: ClientLists, cov: SalesCoverage): SalesStats {
  const totals = totalLines.filter((l) => l.kind === 'total');
  const revenue = totals.reduce((s, l) => s + Number(l.revenue), 0);
  const quantity = totals.reduce((s, l) => s + Number(l.quantity), 0);
  const clients = computeFact({ type: 'clients', groups: [], exclude_key: true, merge: [] }, totals, lists)?.value ?? 0;
  return { ...cov, revenue: round2(revenue), clients, per_day: round2(revenue / Math.max(1, cov.work_elapsed)), quantity: round2(quantity) };
}

// ---------------------------------------------------------------- расчёт показателя для экрана

export interface SalesPlanRow {
  id: string;
  user_id: string;
  /** «2026-10» */
  month: string;
  name: string;
  kind: SalesKind | null;
  unit: SalesUnit;
  plan: number;
  fact: number;
  bonus: number;
  /** К выплате по итоговому файлу KPI. */
  payment: number | null;
  /** Выполнение из файла KPI, %. */
  file_percent: number | null;
  fact_rule: FactRule;
  payout_rule: PayoutRule;
  /** Подробности факта по отчётам: клиенты, позиции. */
  fact_details: (FactDetails & { from?: 'report' }) | null;
  /** Позиции с отметками из файла KPI. */
  file_items: ItemProgress[] | null;
  source: 'manual' | 'file';
  description: string | null;
  /** Когда факт обновился: загрузка отчёта или файла KPI, правка. */
  fact_updated_at: string | null;
  sort_order: number;
}

export interface PlanCalc {
  /** Откуда факт: файл KPI, отчёты о продажах или вручную. */
  source: 'file' | 'report' | 'manual';
  /** Факт считается по отчётам и отчёты за месяц есть. */
  tracked: boolean;
  /** Выполнение, % плана. */
  percent: number;
  /** Заработано сейчас (null — у показателя нет выплаты). */
  now: number | null;
  /** Прогноз выплаты к концу месяца по темпу. */
  forecast: number | null;
  forecast_value: number | null;
  forecast_percent: number | null;
  max: number | null;
  /** Отметки порогов на полосе, % плана. */
  marks: number[];
  rule: string;
  /** Условие из названия показателя в файле KPI. */
  condition: string | null;
  hint: string | null;
  items: ItemProgress[] | null;
  /** Дата данных: последний отчёт или загрузка файла. */
  as_of: string | null;
}

function hintFor(p: Pick<SalesPlanRow, 'unit'>, rule: PayoutRule, plan: number, fact: number, items: ItemProgress[] | null, daysLeft: number | null): string | null {
  if (items) {
    const left = items.filter((i) => !i.done);
    return left.length ? `Осталось: ${left.map((i) => `${i.name} (${i.count} из ${i.need} ТТ)`).join(', ')}` : 'Все позиции выполнены';
  }
  if (!(plan > 0)) return null;
  const amount = (n: number) => (p.unit === 'rub' ? formatRub(n) : salesValueText(Math.ceil(n), p.unit));
  const perDay = (need: number) => (daysLeft && daysLeft > 0 && p.unit === 'rub' ? ` (≈${formatRub(need / daysLeft)} в рабочий день)` : '');
  if (rule.type === 'rate') {
    if (fact < rule.min) return `До порога ${formatRub(rule.min)} — ещё ${formatRub(rule.min - fact)}`;
    return fact < plan ? `До плана — ещё ${amount(plan - fact)}` : 'План выполнен';
  }
  if (rule.type !== 'threshold') return null;
  const done = (fact / plan) * 100;
  const next = [...rule.steps].sort((a, b) => a.from - b.from).find((s) => s.from > done + 1e-9);
  if (next) {
    const need = (plan * next.from) / 100 - fact;
    return `До ${formatNumber(next.from, 2)}${NBSP}% — ещё ${amount(need)}${perDay(need)}`;
  }
  if (done < 100) return `До плана — ещё ${amount(plan - fact)}${perDay(plan - fact)}`;
  return 'План выполнен';
}

/**
 * Выплата, выполнение, прогноз, пороги и подсказка показателя.
 * cov — покрытие месяца отчётами у сотрудника (null — отчётов нет).
 * today — «сегодня» по Москве, YYYY-MM-DD.
 */
export function planCalc(p: SalesPlanRow, cov: SalesCoverage | null, today: string): PlanCalc {
  const { plan, fact, bonus } = p;
  const payable = p.payout_rule.type !== 'none';
  const y = Number(p.month.slice(0, 4));
  const mon = Number(p.month.slice(5, 7));
  const days = daysInMonth(y, mon);
  const monthWork = workDays(y, mon);

  if (p.source === 'file') {
    // Показатель из файла KPI: факт, процент и «к выплате» — как в файле; темп — по дате загрузки.
    const items = p.file_items;
    const percent = p.file_percent ?? (plan > 0 ? (fact / plan) * 100 : 0);
    const total = items?.length ?? (p.unit === 'percent' ? plan : 0);
    const now = p.payment != null ? p.payment : payable ? payoutFor(p.payout_rule, { plan, fact, bonus, done: fact, total }) : null;
    const asOf = p.fact_updated_at ? p.fact_updated_at.slice(0, 10) : null;
    const elapsed = asOf && asOf.slice(0, 7) === p.month && p.month === today.slice(0, 7) ? Number(asOf.slice(8, 10)) : null;
    // Темп — только для сумм: точки и позиции к концу месяца не растут пропорционально дням.
    const projectable = !items && p.unit === 'rub' && p.payout_rule.type !== 'fixed' && plan > 0;
    const workElapsed = elapsed ? Math.max(1, workDays(y, mon, elapsed)) : null;
    const forecastValue = projectable && workElapsed && elapsed! < days ? round2((fact * monthWork) / workElapsed) : null;
    return {
      source: 'file',
      tracked: false,
      percent: round1(percent),
      now,
      forecast: now,
      forecast_value: forecastValue,
      forecast_percent: forecastValue != null ? round1((forecastValue / plan) * 100) : null,
      max: payable ? maxPayout(p.payout_rule, plan, bonus) : null,
      marks: p.unit === 'percent' ? [] : ruleMarks(p.payout_rule, plan),
      rule: ruleText(p.payout_rule, bonus, items?.length ?? 0),
      condition: conditionOf(p.name),
      hint:
        p.payout_rule.type === 'fixed'
          ? null
          : p.unit === 'percent'
            ? p.description
              ? `Позиции: ${p.description.split('; ').join(', ')}`
              : null
            : hintFor(p, p.payout_rule, plan, fact, items, workElapsed ? monthWork - workElapsed : null),
      items,
      as_of: asOf,
    };
  }

  const rule = p.fact_rule;
  const tracked = rule.type !== 'manual' && cov != null;
  const items: ItemProgress[] | null =
    rule.type === 'items' ? (p.fact_details?.items ?? rule.items.map((it) => ({ name: it.name, need: it.need, count: 0, done: false }))) : null;
  const total = items ? items.length : 0;
  const now = payable ? payoutFor(p.payout_rule, { plan, fact, bonus, done: fact, total }) : null;
  let forecastValue: number | null = null;
  let forecast = now;
  const projectable = rule.type === 'revenue' || (rule.type === 'products' && rule.measure !== 'clients');
  if (tracked && cov && projectable && cov.elapsed > 0 && cov.elapsed < cov.days) {
    forecastValue = round2((fact * cov.work_days) / Math.max(1, cov.work_elapsed));
    forecast = payable ? payoutFor(p.payout_rule, { plan, fact: forecastValue, bonus }) : null;
  } else if (rule.type === 'manual' && p.unit === 'rub' && plan > 0 && p.month === today.slice(0, 7)) {
    // Вручную: темп по сегодняшнему дню месяца.
    const d = Number(today.slice(8, 10));
    if (d < days && fact > 0) {
      forecastValue = round2((fact * monthWork) / Math.max(1, workDays(y, mon, d)));
      forecast = payable ? payoutFor(p.payout_rule, { plan, fact: forecastValue, bonus }) : null;
    }
  }
  const daysLeft = tracked && cov ? cov.work_days - cov.work_elapsed : rule.type === 'manual' && p.month === today.slice(0, 7) ? monthWork - workDays(y, mon, Number(today.slice(8, 10))) : null;
  return {
    source: rule.type === 'manual' ? 'manual' : 'report',
    tracked,
    percent: plan > 0 ? round1((fact / plan) * 100) : 0,
    now,
    forecast,
    forecast_value: forecastValue,
    forecast_percent: forecastValue != null && plan > 0 ? round1((forecastValue / plan) * 100) : null,
    max: payable ? maxPayout(p.payout_rule, plan, bonus) : null,
    marks: ruleMarks(p.payout_rule, plan),
    rule: ruleText(p.payout_rule, bonus, total),
    condition: null,
    hint: p.payout_rule.type === 'fixed' ? null : hintFor(p, p.payout_rule, plan, fact, items, daysLeft),
    items,
    as_of: tracked && cov ? cov.as_of : p.fact_updated_at ? p.fact_updated_at.slice(0, 10) : null,
  };
}

export interface SalesTotals {
  /** Оклад и другие фиксированные выплаты. */
  fixed: number;
  now: number;
  forecast: number;
  max: number;
  /** К выплате по итоговому файлу KPI (null — итогов в файле нет). */
  file: number | null;
}

export function salesTotals(plans: readonly (Pick<SalesPlanRow, 'kind' | 'payout_rule' | 'source' | 'payment'> & { calc: PlanCalc })[]): SalesTotals {
  let fixed = 0;
  let now = 0;
  let forecast = 0;
  let max = 0;
  let file: number | null = null;
  for (const p of plans) {
    if (p.kind === 'fuel') continue;
    if (p.payout_rule.type === 'fixed') fixed += p.calc.now ?? 0;
    now += p.calc.now ?? 0;
    forecast += p.calc.forecast ?? p.calc.now ?? 0;
    max += p.calc.max ?? 0;
    if (p.source === 'file' && p.payment != null) file = (file ?? 0) + p.payment;
  }
  return { fixed: round2(fixed), now: round2(now), forecast: round2(forecast), max: round2(max), file: file == null ? null : round2(file) };
}

/** Среднее выполнение показателей с планом (без оклада): для списка команды. */
export function averagePercent(plans: readonly (Pick<SalesPlanRow, 'payout_rule' | 'plan'> & { calc: Pick<PlanCalc, 'percent'> })[]): number | null {
  const counted = plans.filter((p) => p.payout_rule.type !== 'fixed' && p.plan > 0);
  if (!counted.length) return null;
  return round1(counted.reduce((s, p) => s + Math.min(p.calc.percent, 200), 0) / counted.length);
}

/** Состояние показателя для цвета: выполнен, идёт к плану по прогнозу, отстаёт, без плана. */
export type PlanTone = 'done' | 'on_track' | 'behind' | 'neutral';

export function planTone(p: Pick<SalesPlanRow, 'payout_rule' | 'plan'> & { calc: Pick<PlanCalc, 'percent' | 'forecast_percent' | 'marks'> }): PlanTone {
  if (p.payout_rule.type === 'fixed' || !(p.plan > 0)) return 'neutral';
  if (p.calc.percent >= 100) return 'done';
  const target = p.calc.marks[0] ?? 100;
  if (p.calc.forecast_percent != null) return p.calc.forecast_percent >= target ? 'on_track' : 'behind';
  return 'neutral';
}

// ---------------------------------------------------------------- проверки ввода

export interface PlanInput {
  name: string;
  unit: SalesUnit;
  plan: number;
  bonus: number;
  fact?: number;
  fact_rule: FactRule;
  payout_rule: PayoutRule;
}

/** Показатель, который руководитель ставит вручную. */
export function validatePlanInput(v: Record<string, unknown>, opts: { partial?: boolean } = {}): { input: Partial<PlanInput>; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const input: Partial<PlanInput> = {};
  const has = (k: string) => !opts.partial || v[k] !== undefined;
  if (has('name')) {
    const name = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim() : '';
    if (!name) errors.name = 'Назовите показатель';
    else if (name.length > SALES_LIMITS.name) errors.name = `Название — не длиннее ${SALES_LIMITS.name} символов`;
    else input.name = name;
  }
  if (has('unit')) {
    if ((SALES_UNITS as readonly unknown[]).includes(v.unit)) input.unit = v.unit as SalesUnit;
    else errors.unit = 'Выберите единицу';
  }
  for (const k of ['plan', 'bonus', 'fact'] as const) {
    if (!has(k) || (k === 'fact' && v.fact === undefined)) continue;
    const n = typeof v[k] === 'string' ? Number(String(v[k]).replace(',', '.').replace(/\s/g, '')) : v[k];
    if (!finite(n) || n < 0) errors[k] = k === 'plan' ? 'План — число не меньше нуля' : k === 'bonus' ? 'Бонус — число не меньше нуля' : 'Факт — число не меньше нуля';
    else if (n > SALES_LIMITS.amount) errors[k] = 'Слишком большое число';
    else input[k] = round2(n);
  }
  if (has('fact_rule')) {
    const r = parseFactRule(v.fact_rule);
    if (r.error !== undefined) errors.fact_rule = r.error;
    else input.fact_rule = r.value;
  }
  if (has('payout_rule')) {
    const r = parsePayoutRule(v.payout_rule);
    if (r.error !== undefined) errors.payout_rule = r.error;
    else input.payout_rule = r.value;
  }
  if (!errors.plan && input.payout_rule?.type === 'threshold' && input.plan !== undefined && !(input.plan > 0)) {
    errors.plan = 'Для выплаты по порогам нужен план больше нуля';
  }
  if (!errors.fact_rule && input.fact_rule?.type === 'items' && input.unit && input.unit !== 'items') errors.unit = 'Для позиций единица — «Позиции»';
  return { input, errors };
}

export interface SaleEntryInput {
  product: string;
  client: string | null;
  quantity: number;
  amount: number;
  sold_on: string;
  note: string | null;
}

/** Продажа, которую сотрудник записывает сам. Дата — не из будущего. */
export function validateSaleEntry(v: Record<string, unknown>, today: string): { entry: SaleEntryInput | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const text = (x: unknown) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');
  const product = text(v.product);
  if (!product) errors.product = 'Укажите товар или услугу';
  else if (product.length > SALES_LIMITS.product) errors.product = `Не длиннее ${SALES_LIMITS.product} символов`;
  const client = text(v.client);
  if (client.length > SALES_LIMITS.client) errors.client = `Не длиннее ${SALES_LIMITS.client} символов`;
  const num = (x: unknown, dflt: number) => (x === undefined || x === null || x === '' ? dflt : typeof x === 'string' ? Number(x.replace(',', '.').replace(/\s/g, '')) : Number(x));
  const quantity = num(v.quantity, 1);
  if (!Number.isFinite(quantity)) errors.quantity = 'Укажите количество числом';
  else if (quantity <= 0) errors.quantity = 'Количество — больше нуля';
  else if (quantity > 1_000_000) errors.quantity = 'Слишком большое количество';
  const amount = num(v.amount, 0);
  if (!Number.isFinite(amount)) errors.amount = 'Укажите сумму числом';
  else if (amount < 0) errors.amount = 'Сумма не может быть отрицательной';
  else if (amount > SALES_LIMITS.amount) errors.amount = 'Слишком большая сумма';
  const soldOn = v.sold_on === undefined || v.sold_on === null || v.sold_on === '' ? today : v.sold_on;
  if (!isIsoDay(soldOn)) errors.sold_on = 'Выберите дату продажи';
  else if (soldOn > today) errors.sold_on = 'Продажа не может быть в будущем';
  const note = text(v.note);
  if (note.length > SALES_LIMITS.note) errors.note = `Не длиннее ${SALES_LIMITS.note} символов`;
  if (Object.keys(errors).length) return { entry: null, errors };
  return { entry: { product, client: client || null, quantity: Math.round(quantity * 1000) / 1000, amount: round2(amount), sold_on: soldOn as string, note: note || null }, errors };
}

/** Строки списка клиентов из вставленного текста: по одной на строку, без повторов. */
export function parsePatterns(text: string): { patterns: string[]; skipped: number } {
  const seen = new Set<string>();
  const patterns: string[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n|;/)) {
    const p = cellText(raw).replace(/\s+/g, ' ');
    if (!p) continue;
    const key = salesKey(p);
    if (p.length > SALES_LIMITS.pattern || key.length < 2 || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    patterns.push(p);
  }
  return { patterns, skipped };
}

// ---------------------------------------------------------------- люди из отчётов

export interface PersonCandidate {
  id: string;
  name: string;
  /** Почта: латиница в ней тоже подходит («a.mishina@…»). */
  email?: string | null;
}

export interface PersonMatch {
  user_id: string | null;
  /** Несколько похожих сотрудников — выбрать вручную. */
  ambiguous: boolean;
}

/**
 * Сотрудники по именам из отчёта или файла KPI: сначала ручные сопоставления,
 * затем по словам имени в любом порядке («Мишина Анастасия» = «Анастасия
 * Мишина», ё = е, латиница почты тоже подходит). Ключ результата — salesKey(имя).
 */
export function matchPeople(names: readonly string[], people: readonly PersonCandidate[], aliases: ReadonlyMap<string, string> = new Map()): Map<string, PersonMatch> {
  const out = new Map<string, PersonMatch>();
  const ids = new Set(people.map((p) => p.id));
  const cands = people.map((p) => ({ id: p.id, words: [personWords(p.name), personWords((p.email ?? '').split('@')[0]!.replace(/[._]/g, ' '))] }));
  for (const name of names) {
    const key = salesKey(name);
    if (!key || out.has(key)) continue;
    const alias = aliases.get(key);
    if (alias && ids.has(alias)) {
      out.set(key, { user_id: alias, ambiguous: false });
      continue;
    }
    const words = personWords(name);
    const need = Math.min(2, words.length);
    let best = 0;
    let found: string[] = [];
    for (const c of cands) {
      const score = Math.max(...c.words.map((w) => personScore(words, w)));
      if (score < need || score < best || score === 0) continue;
      if (score > best) {
        best = score;
        found = [];
      }
      found.push(c.id);
    }
    out.set(key, found.length === 1 ? { user_id: found[0]!, ambiguous: false } : { user_id: null, ambiguous: found.length > 1 });
  }
  return out;
}

// ---------------------------------------------------------------- подписи

/** «2 показателя», «оклад и 3 показателя». */
export function plansLine(plans: readonly Pick<SalesPlanRow, 'payout_rule'>[]): string {
  const fixed = plans.filter((p) => p.payout_rule.type === 'fixed').length;
  const rest = plans.length - fixed;
  if (!plans.length) return 'План на месяц не задан';
  const restText = `${rest} ${plural(rest, ['показатель', 'показателя', 'показателей'])}`;
  return fixed ? (rest ? `${restText} и фиксированные выплаты` : 'Только фиксированные выплаты') : restText;
}

/** «по 18 октября · 3 отчёта» — откуда цифры продаж. */
export function coverageText(c: Pick<SalesCoverage, 'as_of' | 'reports'> | null): string {
  if (!c) return 'Отчётов о продажах за месяц ещё нет';
  const [, m, d] = c.as_of.split('-');
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `Продажи по ${Number(d)} ${MONTHS_GEN[Number(m) - 1]} · ${c.reports} ${plural(c.reports, ['отчёт', 'отчёта', 'отчётов'])} из 1С`;
}

/** Период отчёта: «01.10–18.10» или «18.10». */
export function salesPeriodText(start: string, end: string): string {
  const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return start === end ? dm(start) : `${dm(start)}–${dm(end)}`;
}

/** Последний день месяца как замер KPI цели: полдень по Москве. */
export const monthObservationAt = (month: string) => `${monthLastDay(month)}T09:00:00.000Z`;

// ---------------------------------------------------------------- ответы API

export interface SalesPerson {
  id: string;
  name: string;
  position: string | null;
}

export interface SalesPlan extends SalesPlanRow {
  /** Правило поправил руководитель: повторная загрузка файла KPI его сохранит. */
  rules_custom: boolean;
  calc: PlanCalc;
}

export interface SalesReportInfo {
  id: string;
  file_name: string;
  period_start: string;
  period_end: string;
  month: string;
  total: number;
  /** Расхождение со строкой «Итого» и другие замечания разбора. */
  warnings: string[];
  uploaded_by_name: string | null;
  created_at: string;
  /** Менеджеров в отчёте и сколько из них не нашли среди сотрудников. */
  people: number;
  unmatched: number;
  can_delete: boolean;
}

export interface SaleEntry {
  id: string;
  user_id: string;
  plan_id: string | null;
  product: string;
  client: string | null;
  quantity: number;
  amount: number;
  sold_on: string;
  note: string | null;
  created_at: string;
  can_delete: boolean;
}

export interface SalesMonth {
  month: string;
  user: SalesPerson;
  plans: SalesPlan[];
  totals: SalesTotals;
  coverage: SalesCoverage | null;
  stats: SalesStats | null;
  reports: SalesReportInfo[];
  /** Продажи, записанные вручную за месяц. */
  entries: { count: number; amount: number; quantity: number };
  /** Месяцы, за которые есть план или отчёты, новые сверху. */
  months: string[];
  can: {
    /** Ставить план, менять правила и факт. */
    edit: boolean;
    /** Отмечать факт своих показателей «вручную» (сотрудник сам себе). */
    fact: boolean;
    /** Загрузить сотруднику файл KPI. */
    kpi_file: boolean;
    /** Записывать продажи. */
    add_entry: boolean;
    /** Видеть команду: руководитель или есть функции продаж. */
    team: boolean;
    /** Загружать отчёты 1С и вести списки клиентов. */
    reports: boolean;
  };
  lists: { key: number; merge: number };
}

export interface SalesTeamMember {
  user: SalesPerson;
  plans: number;
  percent: number | null;
  totals: SalesTotals;
  stats: SalesStats | null;
  entries: { count: number; amount: number };
}

export interface SalesTeam {
  month: string;
  members: SalesTeamMember[];
  /** Сумма по команде. */
  totals: { revenue: number; now: number; forecast: number; max: number };
  can: {
    /** Загружать отчёты 1С, вести списки клиентов и сопоставлять менеджеров. */
    upload: boolean;
    /** Загружать файлы KPI. */
    kpi_files: boolean;
    /** Ставить план. */
    assign: boolean;
  };
}

export type ReportPersonStatus = 'ok' | 'unmatched' | 'ambiguous' | 'forbidden' | 'no_manager';

export interface ReportPersonResult {
  manager: string;
  user: SalesPerson | null;
  status: ReportPersonStatus;
  total: number;
  key: number;
  non_key: number;
  clients: number;
  plans_updated: number;
  error: string | null;
}

export interface SalesReportImport {
  report: SalesReportInfo | null;
  /** Прежние отчёты за этот период, которые заменил новый. */
  replaced: number;
  people: ReportPersonResult[];
  key_list_empty: boolean;
  warnings: string[];
  /** KPI целей, обновлённые по продажам. */
  goals_updated: number;
}

export interface KpiFileResult {
  sheet: string;
  employee: string;
  user: SalesPerson | null;
  month: string | null;
  created: number;
  replaced: number;
  error: string | null;
}

export interface KpiPreviewMetric {
  name: string;
  kind: SalesKind;
  unit: SalesUnit;
  plan: number;
  fact: number | null;
  bonus: number;
  payment: number | null;
  percent: number;
  /** Правило выплаты словами: «3,5% от продаж, если продано от 20 000 ₽». */
  rule: string;
}

/** Предпросмотр файла KPI: кто на листах, за какой месяц и что будет загружено. */
export interface KpiFilePreview {
  sheets: {
    sheet: string;
    employee: string;
    month: string | null;
    suggested_user: SalesPerson | null;
    has_results: boolean;
    warnings: string[];
    metrics: KpiPreviewMetric[];
  }[];
  /** Кому этот человек может загрузить файл KPI. */
  people: SalesPerson[];
}

export interface SalesUnmatched {
  name: string;
  revenue: number;
  last_date: string;
}

export interface SalesAlias {
  id: string;
  name: string;
  user: SalesPerson;
  created_at: string;
}

export interface SalesClientPattern {
  id: string;
  kind: 'key' | 'merge';
  pattern: string;
  created_by_name: string | null;
  created_at: string;
}

export interface SalesGoalLink {
  metric_id: string;
  metric_name: string;
  metric_unit: string;
  goal_id: string;
  goal_title: string;
  measure: 'revenue' | 'quantity' | 'clients';
  unit_id: string | null;
  unit_name: string | null;
  last_value: number | null;
  last_month: string | null;
  can_edit: boolean;
}

export const GOAL_LINK_MEASURE_LABELS: Record<SalesGoalLink['measure'], string> = {
  revenue: 'Выручка за месяц',
  quantity: 'Продано штук за месяц',
  clients: 'Клиенты с продажами за месяц',
};

export interface SalesEmployee {
  month: SalesMonth;
  tasks: { open: number; overdue: number; blocked: number; done_30d: number };
  top_products: { name: string; quantity: number; revenue: number }[];
  entries: SaleEntry[];
}

export interface SalesImportPreview {
  id: string;
  file_name: string;
  headers: string[];
  mapping: EntryMapping;
  sample: string[][];
  total_rows: number;
  /** Сколько строк пройдёт с предложенными колонками, сумма и первые ошибки. */
  valid: number;
  amount: number;
  errors: { row: number; message: string }[];
}

export const ENTRY_FIELDS = ['product', 'quantity', 'amount', 'sold_on', 'client', 'note'] as const;
export type EntryField = (typeof ENTRY_FIELDS)[number];
export type EntryMapping = Record<EntryField, number | null>;

export const ENTRY_FIELD_LABELS: Record<EntryField, string> = {
  product: 'Товар',
  quantity: 'Количество',
  amount: 'Сумма',
  sold_on: 'Дата',
  client: 'Клиент',
  note: 'Комментарий',
};
