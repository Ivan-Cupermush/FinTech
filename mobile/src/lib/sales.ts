import {
  addDays,
  averagePercent,
  formatNumber,
  formatRubShort,
  moscowDay,
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

/** Цифры в шапке «Моих продаж»: выручка, клиенты, выполнение плана. Суммы — коротко, чтобы влезли в плитку. */
export function salesHeroStats(m: Pick<SalesMonth, 'plans' | 'stats' | 'entries'>): HeroStat[] {
  const avg = averagePercent(m.plans);
  const money = m.stats ? m.stats.revenue : m.entries.count ? m.entries.amount : null;
  return [
    { label: m.stats || !m.entries.count ? 'выручка' : 'вручную', value: money == null ? '—' : formatRubShort(money) },
    { label: 'клиентов', value: m.stats ? m.stats.clients : '—' },
    { label: 'плана', value: avg == null ? '—' : `${formatNumber(avg, 0)} %`, tone: avg == null ? undefined : avg >= 100 ? 'good' : avg < 70 ? 'warn' : undefined },
  ];
}

/** Шапка «Команды»: сколько людей, выручка и прогноз выплат. */
export function teamHeroStats(t: Pick<SalesTeam, 'members' | 'totals'>): HeroStat[] {
  return [
    { label: 'в команде', value: t.members.length },
    { label: 'выручка', value: formatRubShort(t.totals.revenue) },
    { label: 'прогноз выплат', value: formatRubShort(t.totals.forecast) },
  ];
}

/**
 * Что можно сделать с показателем на телефоне. План и правила ставят на сайте;
 * здесь — отметить факт: руководитель — у любого «ручного» показателя,
 * сотрудник — у своего (если ему разрешено отмечать факт).
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
