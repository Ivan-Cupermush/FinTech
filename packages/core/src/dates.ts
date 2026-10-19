/** Работа с календарными датами YYYY-MM-DD без часовых поясов. */

const DAY = 86_400_000;

export function toDayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
}

export function fromDayNumber(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** b − a в днях. */
export function diffDays(a: string, b: string): number {
  return toDayNumber(b) - toDayNumber(a);
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Часы между двумя моментами времени (ISO с временем). */
export function hoursBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 3_600_000;
}
