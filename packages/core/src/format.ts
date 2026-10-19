import { UNITS, plural, type UnitId } from './units';

const nbsp = ' ';

/** Число по-русски: пробел между разрядами, запятая в дробной части, лишние нули убраны. */
export function formatNumber(value: number, decimals = 1): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [int = '0', frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  const trimmed = frac?.replace(/0+$/, '');
  const sign = value < 0 && Number(fixed) !== 0 ? '−' : '';
  return `${sign}${grouped}${trimmed ? `,${trimmed}` : ''}`;
}

/** Значение KPI с единицей: «40 мин», «12,5 %», «1 200 000 ₽». */
export function formatValue(value: number | null | undefined, unit: UnitId, opts: { long?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Нет данных';
  const info = UNITS[unit];
  const num = formatNumber(value, info.decimals);
  if (opts.long && info.forms) return `${num}${nbsp}${plural(value, info.forms)}`;
  return `${num}${nbsp}${info.short}`;
}

/** Изменение в процентах со знаком: «−25 %», «+12,5 %». */
export function formatChange(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return '—';
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(percent), 1)}${nbsp}%`;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Календарная дата YYYY-MM-DD → «31 декабря 2026» (или без года, если год текущий). */
export function formatDate(iso: string | null | undefined, opts: { short?: boolean; today?: string } = {}): string {
  if (!iso) return 'Без срока';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return 'Без срока';
  const months = opts.short ? MONTHS_SHORT : MONTHS_GEN;
  const thisYear = (opts.today ?? new Date().toISOString()).slice(0, 4);
  const year = String(y) === thisYear ? '' : ` ${y}`;
  return `${d} ${months[m - 1]}${year}`;
}

/** Длительность в часах → «3 дня», «5 ч», «40 мин». */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) {
    const m = Math.round(hours * 60);
    return `${m}${nbsp}мин`;
  }
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h}${nbsp}ч`;
  }
  const days = Math.round(hours / 24);
  return `${days}${nbsp}${plural(days, ['день', 'дня', 'дней'])}`;
}

/** Инициалы для аватара: «Анна Королёва» → «АК». */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letters.join('') || '?';
}
