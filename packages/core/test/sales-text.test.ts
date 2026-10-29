import { describe, expect, it } from 'vitest';
import { cellNumber, cellText, datesIn, daysInMonth, excelSerialDate, matchesClient, matchesItem, monthLastDay, personScore, personWords, productWords, salesKey, workDays } from '../src';

describe('продажи: сравнение названий', () => {
  it('ключ: регистр, ё, кавычки и пробелы не важны', () => {
    expect(salesKey('  ООО «Василёк»  ')).toBe('ооо василек');
    expect(salesKey('ИП Соколова   Д.И.')).toBe('ип соколова д.и.');
    expect(salesKey(null)).toBe('');
  });

  it('числа из ячеек: рубли, проценты, русская и английская запись', () => {
    expect(cellNumber('1 234,50 ₽')).toBe(1234.5);
    expect(cellNumber('1,234.50')).toBe(1234.5);
    expect(cellNumber('12%')).toBe(12);
    expect(cellNumber('3 500 руб.')).toBe(3500);
    expect(cellNumber(0.035)).toBe(0.035);
    expect(cellNumber('0,035')).toBe(0.035);
    expect(cellNumber('да')).toBeNull();
    expect(cellNumber('')).toBeNull();
    expect(cellNumber(Number.NaN)).toBeNull();
    expect(cellNumber(true)).toBeNull();
    expect(cellText(' текст ')).toBe('текст');
  });

  it('рабочие дни: понедельник–суббота, воскресенье — выходной', () => {
    expect(workDays(2026, 5)).toBe(26);
    expect(workDays(2026, 5, 15)).toBe(13);
    expect(workDays(2026, 2)).toBe(24);
    // 1 марта 2026 — воскресенье.
    expect(workDays(2026, 3, 1)).toBe(0);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(monthLastDay('2026-02')).toBe('2026-02-28');
    expect(monthLastDay('2026-10')).toBe('2026-10-31');
  });

  it('даты периода в разных записях', () => {
    expect(datesIn('Период: 1.6.26 - 30.06.2026')).toEqual(['2026-06-01', '2026-06-30']);
    expect(datesIn('Период: 3 марта 2026 г.')).toEqual(['2026-03-03']);
    expect(datesIn('Период: Май 2026')).toEqual(['2026-05-01', '2026-05-31']);
    expect(datesIn('Период: 31.02.2026')).toEqual([]);
    expect(excelSerialDate(46143)).toBe('2026-05-01');
    expect(excelSerialDate(30000.4)).toBe('1982-02-18');
    expect(excelSerialDate(44)).toBeNull();
  });

  it('товары: латиница и кириллица по звучанию, числа — точно', () => {
    expect(productWords('Пиво Балтика №0 0,5')).toEqual(['pivo', 'baltika', '0', '0.5']);
    expect(matchesItem('Балтика Стаут кег', 'Пиво Балтика Stout тм. КЕГ 30л')).toBe(true);
    expect(matchesItem('Крон Бланш', 'Пив нап Krone Blanche Biere 0,45')).toBe(true);
    expect(matchesItem('Балтика Хеллес', 'Пиво Балтика Helles КЕГ 30л')).toBe(true);
    expect(matchesItem('Балтика 0 any', 'Пиво Балтика №7 Экспортное 0,5 ст.б.*20')).toBe(false);
    expect(matchesItem('Балтика Стаут кег', 'посуда Балтика Стаут 0,5')).toBe(false);
    expect(matchesItem('any', 'что угодно')).toBe(false);
  });

  it('имена: порядок слов, ё, латиница', () => {
    expect(personScore(personWords('Мишина Анастасия'), personWords('Анастасия Мишина'))).toBe(2);
    expect(personScore(personWords('Иванов Пётр'), personWords('Петр Иванов'))).toBe(2);
    expect(personScore(personWords('Иванов Пётр'), personWords('ivanov'))).toBe(1);
    expect(personScore(personWords('Иванов Пётр'), personWords('Петров Иван'))).toBe(0);
    // Инициалы не считаются словами.
    expect(personWords('Соколова Д. И.')).toEqual(['sokolova']);
  });

  it('клиенты: совпадение или вхождение не слишком короткой строки', () => {
    expect(matchesClient('ИП Соколова Д.И. Ленина 1', 'ИП Соколова Д.И.')).toBe(true);
    expect(matchesClient('ООО Ромашка', 'ооо  «ромашка»')).toBe(true);
    expect(matchesClient('ООО Ромашка', 'ООО')).toBe(false);
    expect(matchesClient('ООО Ромашка', '')).toBe(false);
  });
});
