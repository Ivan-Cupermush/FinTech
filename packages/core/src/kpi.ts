import { UNITS, checkUnitRange, isUnitId, type UnitId } from './units';

export const DIRECTIONS = ['decrease', 'increase', 'maintain'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  decrease: 'Уменьшить',
  increase: 'Увеличить',
  maintain: 'Удерживать в диапазоне',
};

export interface MetricInput {
  name: string;
  unit: UnitId;
  baseline: number;
  target: number;
  direction: Direction;
  /** Только для maintain: допустимый диапазон. */
  range_min?: number | null;
  range_max?: number | null;
}

export type FieldErrors = Record<string, string>;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Проверка одного KPI. Ключи ошибок — имена полей (name, unit, baseline…),
 * вызывающий код добавляет префикс вроде `metrics.0.`.
 *
 * Направление важно: «30 при 40» верно для времени обработки (decrease),
 * но не для выручки (increase). Универсального «цель меньше исходного» нет.
 */
export function validateMetric(m: Partial<Record<keyof MetricInput, unknown>>): FieldErrors {
  const errors: FieldErrors = {};
  const name = typeof m.name === 'string' ? m.name.trim() : '';
  if (!name) errors.name = 'Укажите название KPI';
  else if (name.length > 100) errors.name = 'Название KPI — не длиннее 100 символов';

  const unitOk = isUnitId(m.unit);
  if (!unitOk) errors.unit = 'Выберите корректную единицу';

  const directionOk = typeof m.direction === 'string' && (DIRECTIONS as readonly string[]).includes(m.direction);
  if (!directionOk) errors.direction = 'Выберите, как должен меняться показатель';

  const baselineOk = isFiniteNumber(m.baseline);
  const targetOk = isFiniteNumber(m.target);
  if (!baselineOk) errors.baseline = 'Укажите исходное значение';
  if (!targetOk) errors.target = 'Укажите целевое значение';

  if (unitOk) {
    const unit = m.unit as UnitId;
    if (baselineOk && !errors.baseline) {
      const e = checkUnitRange(unit, m.baseline as number);
      if (e) errors.baseline = e;
    }
    if (targetOk && !errors.target) {
      const e = checkUnitRange(unit, m.target as number);
      if (e) errors.target = e;
    }
  }

  if (baselineOk && targetOk && directionOk && !errors.baseline && !errors.target) {
    const b = m.baseline as number;
    const t = m.target as number;
    const unitShort = unitOk ? ` ${UNITS[m.unit as UnitId].short}` : '';
    if (m.direction === 'decrease' && !(t < b)) {
      errors.target = `Чтобы уменьшить показатель, целевое значение должно быть меньше исходного (${b}${unitShort})`;
    }
    if (m.direction === 'increase' && !(t > b)) {
      errors.target = `Чтобы увеличить показатель, целевое значение должно быть больше исходного (${b}${unitShort})`;
    }
    if (m.direction === 'maintain') {
      const lo = m.range_min;
      const hi = m.range_max;
      if (!isFiniteNumber(lo)) errors.range_min = 'Укажите нижнюю границу диапазона';
      if (!isFiniteNumber(hi)) errors.range_max = 'Укажите верхнюю границу диапазона';
      if (isFiniteNumber(lo) && isFiniteNumber(hi)) {
        if (lo > hi) errors.range_max = 'Верхняя граница должна быть не меньше нижней';
        else if (t < lo || t > hi) errors.target = 'Целевое значение должно попадать в диапазон';
      }
    }
  }
  return errors;
}

/** Плановое изменение в процентах: 40 → 30 = −25 %. Это план, а не достижение. */
export function plannedChange(baseline: number, target: number): number | null {
  if (!Number.isFinite(baseline) || !Number.isFinite(target) || baseline === 0) return null;
  return ((target - baseline) / Math.abs(baseline)) * 100;
}

export type KpiState = 'no_data' | 'regress' | 'stalled' | 'progress' | 'achieved' | 'in_range' | 'out_of_range';

export interface KpiProgress {
  state: KpiState;
  /** Реальный процент движения к цели (может быть < 0 или > 100). null — нет измерений. */
  raw: number | null;
  /** Для индикатора: 0–100. */
  bar: number | null;
}

/**
 * Прогресс KPI: P = (B − C) / (B − T) · 100 %.
 * Формула одна для decrease и increase. Если фактических измерений нет —
 * «Нет данных», никакого фиктивного прогресса (ТЗ 4.5.3, 4.6.3).
 * Отрицательная динамика сохраняется в raw — её нельзя прятать.
 */
export function kpiProgress(
  m: Pick<MetricInput, 'baseline' | 'target' | 'direction' | 'range_min' | 'range_max'>,
  current: number | null | undefined,
): KpiProgress {
  if (current === null || current === undefined || !Number.isFinite(current)) {
    return { state: 'no_data', raw: null, bar: null };
  }
  if (m.direction === 'maintain') {
    const lo = m.range_min ?? m.target;
    const hi = m.range_max ?? m.target;
    const inside = current >= lo && current <= hi;
    return { state: inside ? 'in_range' : 'out_of_range', raw: inside ? 100 : 0, bar: inside ? 100 : 0 };
  }
  const span = m.baseline - m.target;
  if (span === 0) return { state: 'no_data', raw: null, bar: null };
  const raw = ((m.baseline - current) / span) * 100;
  const bar = Math.max(0, Math.min(100, raw));
  let state: KpiState;
  if (raw >= 100) state = 'achieved';
  else if (raw < 0) state = 'regress';
  else if (raw === 0) state = 'stalled';
  else state = 'progress';
  return { state, raw, bar };
}

export const KPI_STATE_LABELS: Record<KpiState, string> = {
  no_data: 'Нет данных',
  regress: 'Хуже исходного',
  stalled: 'Без изменений',
  progress: 'Движемся к цели',
  achieved: 'Цель достигнута',
  in_range: 'В диапазоне',
  out_of_range: 'Вне диапазона',
};

export interface Observation {
  value: number;
  observed_at: string;
}

/** Последнее измерение по времени (не по порядку вставки). */
export function latestObservation<T extends Observation>(obs: readonly T[]): T | null {
  let best: T | null = null;
  for (const o of obs) {
    if (!best || o.observed_at > best.observed_at) best = o;
  }
  return best;
}

/**
 * Темп: сколько процентов пути проходим в день по двум последним точкам и
 * когда при таком темпе дойдём до цели. Это не вероятность (её считать в MVP
 * не будем), а простая экстраполяция, которую честно подписываем.
 */
export function kpiPace(
  m: Pick<MetricInput, 'baseline' | 'target' | 'direction'>,
  obs: readonly Observation[],
): { perDay: number; etaDays: number | null } | null {
  if (m.direction === 'maintain' || obs.length < 2) return null;
  const sorted = [...obs].sort((a, b) => (a.observed_at < b.observed_at ? -1 : 1));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const days = (Date.parse(last.observed_at) - Date.parse(first.observed_at)) / 86_400_000;
  if (days <= 0) return null;
  const p0 = kpiProgress(m, first.value).raw ?? 0;
  const p1 = kpiProgress(m, last.value).raw ?? 0;
  const perDay = (p1 - p0) / days;
  if (perDay <= 0) return { perDay, etaDays: null };
  return { perDay, etaDays: Math.max(0, (100 - p1) / perDay) };
}
