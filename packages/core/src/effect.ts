import type { MetricsReport } from './api-types';
import { formatDate, formatNumber } from './format';
import { formatHours, type Movement } from './metrics';
import { plural } from './units';

/**
 * Подписи и шаги экрана «Эффект» — общие для сайта и приложения, чтобы
 * формулировки и порядок шагов не расходились между платформами.
 */

export type EffectTone = 'neutral' | 'good' | 'warn' | 'bad';

export const MOVEMENT_TONES: Record<Movement, EffectTone> = { improved: 'good', flat: 'neutral', worse: 'bad', stale: 'warn' };

/** Изменение прогресса в процентных пунктах: «+35 п.п.», «−12 п.п.». */
export function formatDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return '';
  const r = Math.round(delta);
  if (r === 0) return '0 п.п.';
  return `${r > 0 ? '+' : '−'}${formatNumber(Math.abs(r), 0)} п.п.`;
}

export const formatPercent = (v: number | null) => (v === null ? '—' : `${v} %`);

const weeksText = (n: number) => `${n} ${plural(n, ['неделю', 'недели', 'недель'])}`;

/** Подпись к тренду ряда: «+12 п.п. за 4 недели» — за столько недель, сколько есть данных. */
export function trendText(trend: { delta: number; steps: number } | null, unit: 'pp' | 'hours' = 'pp'): string | null {
  if (!trend) return null;
  const { delta, steps } = trend;
  if (unit === 'hours') {
    if (Math.round(delta) === 0) return `без изменений за ${weeksText(steps)}`;
    return `${delta < 0 ? 'быстрее' : 'медленнее'} на ${formatHours(Math.abs(delta))} за ${weeksText(steps)}`;
  }
  return `${formatDelta(delta)} за ${weeksText(steps)}`;
}

/** Куда ведёт шаг: платформа сама превращает это в маршрут. */
export type EffectTarget = { kind: 'goal'; id: string } | { kind: 'blocked_tasks' } | { kind: 'goals' };

export interface EffectStep {
  key: string;
  tone: EffectTone;
  title: string;
  hint: string;
  cta: string;
  target: EffectTarget;
}

/**
 * «Что поднимет цифры»: конкретные шаги из тех же данных, по которым считаны
 * метрики. Сначала то, что портит Северную звезду сильнее всего.
 */
export function effectSteps(r: MetricsReport, today: string, limit = 5): EffectStep[] {
  const out: EffectStep[] = [];
  for (const item of r.north_star.items.filter((i) => i.movement === 'worse')) {
    out.push({
      key: `worse-${item.id}`,
      tone: 'bad',
      title: `«${item.title}»: показатель хуже, чем ${r.window_days} дней назад`,
      hint: 'Посмотрите на карте цели, какие задачи закрыты, а цифра не двигается.',
      cta: 'Открыть цель',
      target: { kind: 'goal', id: item.id },
    });
  }
  if (r.blockers.open > 0) {
    const n = r.blockers.open;
    out.push({
      key: 'blockers',
      tone: 'bad',
      title: `${n} ${plural(n, ['задача заблокирована', 'задачи заблокированы', 'задач заблокировано'])}, самый старый блокер — ${formatHours(r.blockers.oldest_open_hours)}`,
      hint: 'Блокер, который снимают быстро, почти не сдвигает сроки цели.',
      cta: 'К задачам',
      target: { kind: 'blocked_tasks' },
    });
  }
  for (const s of r.freshness.stale) {
    out.push({
      key: `stale-${s.id}`,
      tone: 'warn',
      title: s.last_observed_at ? `«${s.title}»: последний замер ${formatDate(s.last_observed_at, { today })}` : `«${s.title}»: замеров ещё не было`,
      hint: 'Без свежего факта нельзя понять, работает ли план.',
      cta: 'Внести замер',
      target: { kind: 'goal', id: s.id },
    });
  }
  if (r.north_star.without_kpi > 0) {
    const n = r.north_star.without_kpi;
    out.push({
      key: 'no-kpi',
      tone: 'neutral',
      title: `${n} ${plural(n, ['активная цель', 'активные цели', 'активных целей'])} без KPI`,
      hint: 'Эффект такой цели нельзя измерить. Добавьте показатель, который она должна сдвинуть.',
      cta: 'К целям',
      target: { kind: 'goals' },
    });
  }
  return out.slice(0, limit);
}

/** Главная подпись Северной звезды: «2 из 3 активных целей с KPI сдвинули показатель…». */
export function northStarCaption(r: MetricsReport): string {
  const ns = r.north_star;
  if (!ns.total) return 'Нет активных целей с KPI — оценивать пока нечего';
  return `${ns.counts.improved} из ${ns.total} ${plural(ns.total, ['активной цели', 'активных целей', 'активных целей'])} с KPI ${ns.counts.improved === 1 ? 'сдвинула' : 'сдвинули'} показатель к цели за ${r.window_days} дней`;
}
