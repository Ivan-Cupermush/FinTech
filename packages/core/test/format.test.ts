import { describe, expect, it } from 'vitest';
import { formatChange, formatDate, formatDuration, formatNumber, formatValue, initials } from '../src/format';
import { plural } from '../src/units';

const nb = ' ';

describe('plural', () => {
  const f = ['минута', 'минуты', 'минут'] as const;
  it.each([
    [1, 'минута'],
    [2, 'минуты'],
    [5, 'минут'],
    [11, 'минут'],
    [14, 'минут'],
    [21, 'минута'],
    [22, 'минуты'],
    [111, 'минут'],
    [1.5, 'минуты'],
  ])('%s → %s', (n, w) => expect(plural(n, f)).toBe(w));
});

describe('formatNumber', () => {
  it('группирует разряды и ставит запятую', () => {
    expect(formatNumber(1234567.5, 1)).toBe(`1${nb}234${nb}567,5`);
  });
  it('убирает лишние нули', () => {
    expect(formatNumber(30, 1)).toBe('30');
  });
  it('минус — типографский', () => {
    expect(formatNumber(-12, 0)).toBe('−12');
  });
  it('не пишет «−0»', () => {
    expect(formatNumber(-0.01, 0)).toBe('0');
  });
});

describe('formatValue', () => {
  it('нет значения — «Нет данных»', () => {
    expect(formatValue(null, 'minutes')).toBe('Нет данных');
  });
  it('короткая и длинная форма', () => {
    expect(formatValue(40, 'minutes')).toBe(`40${nb}мин`);
    expect(formatValue(21, 'minutes', { long: true })).toBe(`21${nb}минута`);
    expect(formatValue(1500000, 'rub')).toBe(`1${nb}500${nb}000${nb}₽`);
  });
});

describe('formatChange', () => {
  it('знак у изменения', () => {
    expect(formatChange(-25)).toBe(`−25${nb}%`);
    expect(formatChange(12.5)).toBe(`+12,5${nb}%`);
    expect(formatChange(null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('в текущем году без года', () => {
    expect(formatDate('2026-12-31', { today: '2026-10-19' })).toBe('31 декабря');
  });
  it('в другом году с годом', () => {
    expect(formatDate('2027-01-05', { today: '2026-10-19' })).toBe('5 января 2027');
  });
  it('коротко', () => {
    expect(formatDate('2026-03-08', { short: true, today: '2026-01-01' })).toBe('8 мар');
  });
  it('без даты', () => {
    expect(formatDate(null)).toBe('Без срока');
  });
});

describe('formatDuration', () => {
  it.each([
    [0.5, `30${nb}мин`],
    [5, `5${nb}ч`],
    [72, `3${nb}дня`],
    [24 * 5, `5${nb}дней`],
  ])('%s ч → %s', (h, s) => expect(formatDuration(h)).toBe(s));
});

describe('initials', () => {
  it('две буквы', () => expect(initials('анна королёва')).toBe('АК'));
  it('пустое имя', () => expect(initials('  ')).toBe('?'));
});
