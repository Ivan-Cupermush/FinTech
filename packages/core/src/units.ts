/**
 * Единицы измерения KPI.
 *
 * У каждой единицы — допустимый диапазон значений: время и количество не
 * бывают отрицательными, а прибыль или NPS — бывают. Глобального
 * «baseline >= 0» нет (ТЗ 4.6.2): ограничение задаёт единица.
 */
export const UNIT_IDS = [
  'minutes',
  'hours',
  'days',
  'percent',
  'rub',
  'count',
  'points',
  'score',
] as const;

export type UnitId = (typeof UNIT_IDS)[number];

export interface UnitInfo {
  id: UnitId;
  /** Короткая подпись рядом с числом: «мин», «%», «₽». */
  short: string;
  /** Название в списке выбора. */
  label: string;
  /** Формы для согласования с числом: 1 минута, 2 минуты, 5 минут. */
  forms?: readonly [one: string, few: string, many: string];
  min?: number;
  max?: number;
  /** Сколько знаков после запятой показывать. */
  decimals: number;
}

export const UNITS: Record<UnitId, UnitInfo> = {
  minutes: { id: 'minutes', short: 'мин', label: 'Минуты', forms: ['минута', 'минуты', 'минут'], min: 0, decimals: 1 },
  hours: { id: 'hours', short: 'ч', label: 'Часы', forms: ['час', 'часа', 'часов'], min: 0, decimals: 1 },
  days: { id: 'days', short: 'дн', label: 'Дни', forms: ['день', 'дня', 'дней'], min: 0, decimals: 1 },
  percent: { id: 'percent', short: '%', label: 'Проценты', min: -100, max: 1000, decimals: 1 },
  rub: { id: 'rub', short: '₽', label: 'Рубли', decimals: 0 },
  count: { id: 'count', short: 'шт', label: 'Штуки, количество', forms: ['штука', 'штуки', 'штук'], min: 0, decimals: 0 },
  points: { id: 'points', short: 'п.', label: 'Пункты (NPS, индекс)', min: -100, max: 100, decimals: 0 },
  score: { id: 'score', short: 'балл', label: 'Баллы, оценка', forms: ['балл', 'балла', 'баллов'], min: 0, decimals: 1 },
};

export function isUnitId(value: unknown): value is UnitId {
  return typeof value === 'string' && (UNIT_IDS as readonly string[]).includes(value);
}

/** Русское согласование числительного: 1 минута, 3 минуты, 11 минут, 21 минута. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n);
  if (!Number.isInteger(abs)) return forms[1];
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** Проверяет, что значение допустимо для единицы. Возвращает текст ошибки или null. */
export function checkUnitRange(unit: UnitId, value: number): string | null {
  const info = UNITS[unit];
  if (info.min !== undefined && value < info.min) {
    return info.min === 0 ? `Значение в единицах «${info.label}» не может быть отрицательным` : `Значение не может быть меньше ${info.min}`;
  }
  if (info.max !== undefined && value > info.max) return `Значение не может быть больше ${info.max}`;
  return null;
}
