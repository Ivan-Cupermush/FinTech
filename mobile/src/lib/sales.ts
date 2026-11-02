import {
  addDays,
  averagePercent,
  FACT_RULE_LABELS,
  formatNumber,
  moscowDay,
  PAYOUT_RULE_LABELS,
  planFormBody,
  rubShortParts,
  SALES_UNIT_LABELS,
  SALES_UNITS,
  type PlanForm,
  type SalesEmployee,
  type SalesMonth,
  type SalesPlan,
  type SalesTeam,
} from '@offix/core';
import type { HeroStat } from './fx';

/**
 * Продажи на телефоне: то же, что на сайте, — мой месяц, команда, сотрудник.
 * Здесь только логика без React Native, её проверяют тесты.
 */

/** Ключи кэша — те же, что на сайте: после любой правки обновляем раздел целиком. */
export const sk = {
  all: ['sales'] as const,
  month: (month: string, user?: string) => ['sales', 'month', user ?? 'me', month] as const,
  team: (month: string) => ['sales', 'team', month] as const,
  employee: (id: string, month: string) => ['sales', 'employee', id, month] as const,
  entries: (month: string, user?: string) => ['sales', 'entries', user ?? 'me', month] as const,
};

/** «?month=2026-10&user=…» — пустые параметры не пишем. */
export function salesQs(o: Record<string, string | undefined>): string {
  const p = Object.entries(o).filter(([, v]) => v);
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')}` : '';
}

/** «Сегодня» в продажах — по Москве, как на сервере: отчёты 1С и месяцы считаются так же. */
export const salesToday = (now: Date = new Date()) => moscowDay(now.toISOString());

export type SalesView = 'month' | 'team';

/**
 * С какой вкладки открыть «Продажи»: руководитель без своего плана и продаж
 * приходит смотреть команду — ему сразу «Команда», остальным — свой месяц.
 */
export function defaultSalesView(m: Pick<SalesMonth, 'can' | 'plans' | 'stats' | 'entries'>): SalesView {
  return m.can.team && !m.plans.length && !m.stats && !m.entries.count ? 'team' : 'month';
}

/** Сумма для плитки: число крупно, «тыс. ₽» / «млн ₽» — мельче. */
const moneyStat = (n: number) => {
  const p = rubShortParts(n);
  return { value: p.value, unit: p.unit };
};

/** Цифры в шапке «Моих продаж»: выручка, клиенты, выполнение плана. Суммы — коротко, чтобы влезли в плитку. */
export function salesHeroStats(m: Pick<SalesMonth, 'plans' | 'stats' | 'entries'>): HeroStat[] {
  const avg = averagePercent(m.plans);
  const money = m.stats ? m.stats.revenue : m.entries.count ? m.entries.amount : null;
  return [
    { label: m.stats || !m.entries.count ? 'выручка' : 'вручную', ...(money == null ? { value: '—' } : moneyStat(money)) },
    { label: 'клиентов', value: m.stats ? m.stats.clients : '—' },
    { label: 'плана', value: avg == null ? '—' : `${formatNumber(avg, 0)} %`, tone: avg == null ? undefined : avg >= 100 ? 'good' : avg < 70 ? 'warn' : undefined },
  ];
}

/** Шапка «Команды»: сколько людей, выручка и прогноз выплат. */
export function teamHeroStats(t: Pick<SalesTeam, 'members' | 'totals'>): HeroStat[] {
  return [
    { label: 'в команде', value: t.members.length },
    { label: 'выручка', ...moneyStat(t.totals.revenue) },
    { label: 'прогноз выплат', ...moneyStat(t.totals.forecast) },
  ];
}

/**
 * Можно ли отметить факт показателя: руководитель — у любого «ручного»
 * показателя, сотрудник — у своего (если ему разрешено отмечать факт).
 */
export function planFactEditable(m: Pick<SalesMonth, 'can'>, p: Pick<SalesPlan, 'source' | 'fact_rule' | 'payout_rule'>): boolean {
  if (p.source !== 'manual' || p.fact_rule.type !== 'manual' || p.payout_rule.type === 'fixed') return false;
  return m.can.edit || m.can.fact;
}

/** Плитки задач сотрудника: просрочки и блокеры подсвечиваем. */
export function employeeTaskFigures(t: SalesEmployee['tasks']): { label: string; value: number; bad: boolean }[] {
  return [
    { label: 'в работе', value: t.open, bad: false },
    { label: 'просрочены', value: t.overdue, bad: t.overdue > 0 },
    { label: 'с блокером', value: t.blocked, bad: t.blocked > 0 },
    { label: 'сделано за 30 дней', value: t.done_30d, bad: false },
  ];
}

/** Шкала выплаты: доля «сейчас» и «прогноза» от максимума, 0–100. Без максимума — шкалы нет. */
export function payoutScale(t: Pick<SalesMonth['totals'], 'now' | 'forecast' | 'max' | 'file'>): { now: number; forecast: number } | null {
  if (t.file != null || !(t.max > 0)) return null;
  const pct = (n: number) => Math.max(0, Math.min(100, (n / t.max) * 100));
  return { now: pct(t.now), forecast: pct(Math.max(t.now, t.forecast)) };
}

/** Отчёт 1С и файлы KPI — таблицы Excel или CSV: остальное в выборе файла не показываем. */
export const SALES_FILE_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/comma-separated-values',
] as const;

/** Подходит ли выбранный файл под отчёт: по расширению, MIME у документов на телефоне бывает пустым. */
export const isSalesTable = (name: string) => /\.(xlsx|xls|csv)$/i.test(name.trim());

/** Пустая форма продажи: количество 1, дата — сегодня, показатель — первый подходящий. */
export function emptyEntry(today: string, planId: string | null) {
  return { product: '', client: '', quantity: '1', amount: '', sold_on: today, note: '', plan_id: planId ?? '' };
}
export type EntryDraft = ReturnType<typeof emptyEntry>;

/** Тело запроса: чужому сотруднику — с его id, «не прибавлять» — null. */
export function entryBody(v: EntryDraft, userId?: string) {
  return { ...v, user_id: userId, plan_id: v.plan_id || null };
}

/** Быстрые даты продажи: сегодня, вчера, позавчера — чаще всего записывают по свежим следам. */
export function entryDayPresets(today: string): { label: string; value: string }[] {
  return [
    { label: 'Сегодня', value: today },
    { label: 'Вчера', value: addDays(today, -1) },
    { label: 'Позавчера', value: addDays(today, -2) },
  ];
}

// ---------------------------------------------------------------- показатель: план и правила выплаты

/** Как открыть показатель: целиком или, у пришедшего из файла KPI, только правило выплаты. */
export type PlanEditMode = 'new' | 'full' | 'payout';

/** Руководитель (право «ставить план») меняет показатель; у показателя из файла KPI — только выплату. */
export function planEditMode(m: Pick<SalesMonth, 'can'>, p: Pick<SalesPlan, 'source'>): Exclude<PlanEditMode, 'new'> | null {
  if (!m.can.edit) return null;
  return p.source === 'file' ? 'payout' : 'full';
}

export const planEditorTitle = (mode: PlanEditMode) => (mode === 'new' ? 'Новый показатель' : mode === 'payout' ? 'Правило выплаты' : 'Показатель');

type Choice<T extends string> = { value: T; label: string };

/** Способы подсчёта факта — те же подписи, что на сайте. */
export const FACT_CHOICES = Object.entries(FACT_RULE_LABELS).map(([value, label]) => ({ value, label })) as Choice<PlanForm['fact_type']>[];

export const UNIT_CHOICES = SALES_UNITS.map((u) => ({ value: u, label: SALES_UNIT_LABELS[u].label })) as Choice<PlanForm['unit']>[];

/** Выплата «за выполненные позиции» имеет смысл только у показателя с позициями. */
export function payoutChoices(fact: PlanForm['fact_type']): Choice<PlanForm['payout_type']>[] {
  return (Object.entries(PAYOUT_RULE_LABELS) as [PlanForm['payout_type'], string][]).filter(([k]) => k !== 'items' || fact === 'items').map(([value, label]) => ({ value, label }));
}

/** Сменить способ подсчёта: у позиций по умолчанию выплата за позиции, без позиций она пропадает. */
export function withFactType(f: PlanForm, fact: PlanForm['fact_type']): PlanForm {
  const payout = fact === 'items' && f.payout_type === 'threshold' && f.fact_type !== 'items' ? 'items' : fact !== 'items' && f.payout_type === 'items' ? 'threshold' : f.payout_type;
  return { ...f, fact_type: fact, payout_type: payout };
}

/**
 * Тело запроса из формы. У показателя из файла KPI уходит только правило
 * выплаты — план, факт и бонус приходят с файлом (как на сайте).
 */
export function planSaveBody(f: PlanForm, mode: PlanEditMode): { body: Record<string, unknown> | null; errors: Record<string, string> } {
  if (mode === 'payout') {
    const r = planFormBody({ ...f, name: f.name || 'x', plan: '1', bonus: '0', fact_type: 'manual' });
    return r.body ? { body: { payout_rule: r.body.payout_rule }, errors: {} } : { body: null, errors: r.errors };
  }
  const r = planFormBody(f);
  return r.body ? { body: { ...r.body }, errors: {} } : { body: null, errors: r.errors };
}

/** Ошибки сервера по правилам — к полю формы, которое их вызвало. */
export function planServerErrors(fields: Record<string, string>, f: Pick<PlanForm, 'fact_type' | 'payout_type'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = k === 'fact_rule' ? (f.fact_type === 'items' ? 'items' : f.fact_type === 'products' ? 'query' : 'groups') : k === 'payout_rule' ? (f.payout_type === 'rate' ? 'rate' : 'steps') : k;
    out[key] = v;
  }
  return out;
}

/** Пороги выплаты строками формы («90: 0,5») ⇄ строки редактора «от … % — × …». */
export interface StepRow {
  from: string;
  k: string;
}

export function stepRows(text: string): StepRow[] {
  return text
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(':');
      return i < 0 ? { from: l.replace(/%/g, '').trim(), k: '' } : { from: l.slice(0, i).replace(/%/g, '').trim(), k: l.slice(i + 1).trim() };
    });
}

export const stepsTextOf = (rows: StepRow[]) =>
  rows
    .filter((r) => r.from.trim() || r.k.trim())
    .map((r) => `${r.from.trim()}: ${r.k.trim()}`)
    .join('\n');

/** Следующий порог для «+ порог»: на 10 % ниже последнего, но не ниже нуля. */
export function nextStep(rows: StepRow[]): StepRow {
  const last = Number((rows.at(-1)?.from ?? '').replace(',', '.'));
  return { from: Number.isFinite(last) && last > 0 ? String(Math.max(0, last - 10)) : '', k: '' };
}

/** Позиции «Курс Python: 5» ⇄ строки редактора «название — в сколько точек». */
export interface ItemRow {
  name: string;
  need: string;
}

export function itemRows(text: string): ItemRow[] {
  return text
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.*?)\s*:\s*(\d*)\s*$/);
      return m ? { name: m[1]!.trim(), need: m[2]! } : { name: l, need: '' };
    });
}

export const itemsTextOf = (rows: ItemRow[]) =>
  rows
    .filter((r) => r.name.trim())
    .map((r) => (r.need.trim() ? `${r.name.trim()}: ${r.need.trim()}` : r.name.trim()))
    .join('\n');

/** Группа из отчётов — в список групп показателя, без повторов. */
export function addGroupLine(groups: string, path: string): string {
  const list = groups.split('\n').map((g) => g.trim()).filter(Boolean);
  return list.includes(path) ? list.join('\n') : [...list, path].join('\n');
}
