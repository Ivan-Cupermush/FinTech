import { describe, expect, it } from 'vitest';
import {
  detectSeparator,
  IMPORT_MAX_ROWS,
  importTemplate,
  observationDay,
  parseLooseDate,
  parseLooseNumber,
  parseTable,
  planImport,
} from '../src/import';

const NOW = new Date('2026-10-19T12:00:00Z'); // 15:00 по Москве

describe('parseLooseNumber', () => {
  it.each([
    ['36.5', 36.5],
    ['36,5', 36.5],
    ['1 200,5', 1200.5],
    ['1 200,5', 1200.5],
    ['1.200,5', 1200.5],
    ['1,200.5', 1200.5],
    ['1.200.000', 1_200_000],
    ['1,200,000', 1_200_000],
    ['−3', -3],
    ['-3', -3],
    ['+4', 4],
    ['12 %', 12],
    ['12%', 12],
    ['0', 0],
    ['  40  ', 40],
    [',5', 0.5],
  ])('«%s» → %s', (raw, expected) => {
    expect(parseLooseNumber(raw)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '12abc', '1.2.3', '1,2,3', '1.20.000', '1,200.5,3', '-', '.', '19.10.2026', 'N/A', null, undefined])(
    'мусор «%s» → null',
    (raw) => {
      expect(parseLooseNumber(raw as string)).toBeNull();
    },
  );
});

describe('parseLooseDate', () => {
  it('без времени — полдень по Москве', () => {
    expect(parseLooseDate('19.10.2026')).toEqual({ day: '2026-10-19', at: '2026-10-19T09:00:00.000Z', timeGiven: false });
  });

  it.each(['19.10.2026', '19.10.26', '19/10/2026', '19-10-2026', '2026-10-19', '2026-10-19 '])('«%s» → 19 октября', (raw) => {
    expect(parseLooseDate(raw)?.day).toBe('2026-10-19');
  });

  it('день и месяц без ведущего нуля', () => {
    expect(parseLooseDate('1.2.2026')?.day).toBe('2026-02-01');
  });

  it('время без зоны — московское', () => {
    expect(parseLooseDate('19.10.2026 10:30')).toEqual({ day: '2026-10-19', at: '2026-10-19T07:30:00.000Z', timeGiven: true });
    expect(parseLooseDate('2026-10-19T10:30')?.at).toBe('2026-10-19T07:30:00.000Z');
    expect(parseLooseDate('2026-10-19 10:30:15')?.at).toBe('2026-10-19T07:30:15.000Z');
  });

  it('ISO с Z и со смещением', () => {
    expect(parseLooseDate('2026-10-19T10:30:00Z')).toEqual({ day: '2026-10-19', at: '2026-10-19T10:30:00.000Z', timeGiven: true });
    expect(parseLooseDate('2026-10-19T10:30:00.123Z')?.at).toBe('2026-10-19T10:30:00.000Z');
    expect(parseLooseDate('2026-10-19T10:30:00+05:00')?.at).toBe('2026-10-19T05:30:00.000Z');
  });

  it('день считается по Москве: поздний вечер по UTC — уже следующий день', () => {
    expect(parseLooseDate('2026-10-19T22:30:00Z')?.day).toBe('2026-10-20');
  });

  it.each(['', 'вчера', '31.02.2026', '32.10.2026', '19.13.2026', '2026-02-30', '19.10.2026 25:00', '19.10', '2026', 'abc 19.10.2026', null])(
    'не дата «%s» → null',
    (raw) => {
      expect(parseLooseDate(raw as string)).toBeNull();
    },
  );
});

describe('observationDay', () => {
  it('считает день по Москве (UTC+3)', () => {
    expect(observationDay('2026-10-19T20:59:59Z')).toBe('2026-10-19');
    expect(observationDay('2026-10-19T21:00:00Z')).toBe('2026-10-20');
    expect(observationDay(new Date('2026-10-18T21:00:00Z'))).toBe('2026-10-19');
  });
});

describe('detectSeparator', () => {
  it('таб важнее всего — так вставляют из Excel и Google Таблиц', () => {
    expect(detectSeparator('Дата\tЗначение; комментарий\n19.10.2026\t36,5')).toBe('\t');
  });
  it('«;» важнее запятой — запятая в русских числах десятичная', () => {
    expect(detectSeparator('19.10.2026;36,5\n20.10.2026;36')).toBe(';');
  });
  it('запятая — только если других нет', () => {
    expect(detectSeparator('2026-10-19,36.5')).toBe(',');
  });
});

describe('parseTable', () => {
  it('вставка из Excel: таб, шапка, колонки даты и значения', () => {
    const t = parseTable('Дата\tВремя обработки, мин\n01.10.2026\t40\n08.10.2026\t38,5\n');
    expect(t.separator).toBe('\t');
    expect(t.hasHeader).toBe(true);
    expect(t.columns).toEqual(['Дата', 'Время обработки, мин']);
    expect(t.rows).toEqual([
      ['01.10.2026', '40'],
      ['08.10.2026', '38,5'],
    ]);
    expect(t.lines).toEqual([2, 3]);
    expect(t.dateCol).toBe(0);
    expect(t.valueCol).toBe(1);
  });

  it('без шапки — колонки называются «Колонка N»', () => {
    const t = parseTable('01.10.2026;40\n08.10.2026;38,5');
    expect(t.hasHeader).toBe(false);
    expect(t.columns).toEqual(['Колонка 1', 'Колонка 2']);
    expect(t.rows).toHaveLength(2);
  });

  it('BOM, CRLF, кавычки, удвоенные кавычки и перевод строки внутри кавычек', () => {
    const t = parseTable('﻿"Дата";"Значение";"Комментарий"\r\n"01.10.2026";"1 200,5";"сказал ""ок""\nи ушёл"\r\n02.10.2026;7;\r\n');
    expect(t.columns).toEqual(['Дата', 'Значение', 'Комментарий']);
    expect(t.rows[0]).toEqual(['01.10.2026', '1 200,5', 'сказал "ок"\nи ушёл']);
    expect(t.lines).toEqual([2, 4]);
    expect(t.rows[1]).toEqual(['02.10.2026', '7', '']);
  });

  it('CSV с запятой и кавычками вокруг русского числа', () => {
    const t = parseTable('date,value\n2026-10-01,"36,5"\n2026-10-02,36');
    expect(t.separator).toBe(',');
    expect(t.rows[0]).toEqual(['2026-10-01', '36,5']);
    expect(t.valueCol).toBe(1);
  });

  it('несколько колонок: находит дату, числовые колонки, пропускает текст и пустые строки', () => {
    const t = parseTable('Комментарий\tДата\tПлан\tФакт\nок\t01.10.2026\t40\t41\n\n\t\t\t\nтак\t08.10.2026\t39\t38\n');
    expect(t.dateColumns).toEqual([1]);
    expect(t.numberColumns).toEqual([2, 3]);
    expect(t.dateCol).toBe(1);
    expect(t.valueCol).toBe(2);
    expect(t.rows).toHaveLength(2);
  });

  it('выравнивает строки разной ширины', () => {
    const t = parseTable('01.10.2026;40;x\n08.10.2026;38');
    expect(t.rows[1]).toEqual(['08.10.2026', '38', '']);
  });

  it('пустой текст — пустая таблица', () => {
    const t = parseTable('  \n');
    expect(t.rows).toEqual([]);
    expect(t.dateCol).toBeNull();
    expect(t.valueCol).toBeNull();
  });
});

describe('planImport', () => {
  const plan = (text: string, opts: Partial<Parameters<typeof planImport>[3]> = {}) => {
    const t = parseTable(text);
    return planImport(t, t.dateCol ?? 0, t.valueCol ?? 1, { unit: 'minutes', now: NOW, ...opts });
  };

  it('корректные строки — ok, наружу уходят ISO-моменты', () => {
    const p = plan('Дата;Мин\n01.10.2026;40\n08.10.2026;38,5');
    expect(p.counts).toEqual({ ok: 2, duplicate: 0, error: 0 });
    expect(p.observations).toEqual([
      { observed_at: '2026-10-01T09:00:00.000Z', value: 40 },
      { observed_at: '2026-10-08T09:00:00.000Z', value: 38.5 },
    ]);
    expect(p.latest).toEqual({ day: '2026-10-08', at: '2026-10-08T09:00:00.000Z', value: 38.5 });
  });

  it('latest — по дате, а не по порядку строк', () => {
    const p = plan('08.10.2026;38\n01.10.2026;40');
    expect(p.latest?.value).toBe(38);
  });

  it('нет даты, не дата, нет значения, не число — ошибки с причиной и номером строки', () => {
    const p = plan('Дата;Мин\n;40\nвчера;40\n03.10.2026;\n04.10.2026;много');
    expect(p.rows.map((r) => [r.line, r.status, r.reason])).toEqual([
      [2, 'error', 'Нет даты'],
      [3, 'error', 'Не похоже на дату: «вчера»'],
      [4, 'error', 'Нет значения'],
      [5, 'error', 'Не число: «много»'],
    ]);
    expect(p.counts).toEqual({ ok: 0, duplicate: 0, error: 4 });
    expect(p.latest).toBeNull();
  });

  it('дата из будущего — ошибка', () => {
    const p = plan('20.10.2026;40\n19.10.2026 18:00;40');
    expect(p.rows.map((r) => r.reason)).toEqual(['Дата из будущего', 'Дата из будущего']);
  });

  it('сегодня без времени — не будущее, замер ставится на «сейчас»', () => {
    const early = new Date('2026-10-19T05:00:00Z'); // 8:00 по Москве, полдень ещё не наступил
    const p = plan('19.10.2026;40', { now: early });
    expect(p.rows[0]!.status).toBe('ok');
    expect(p.observations[0]!.observed_at).toBe(early.toISOString());
  });

  it('вне диапазона единицы — ошибка из checkUnitRange', () => {
    expect(plan('01.10.2026;-5').rows[0]!.reason).toMatch(/не может быть отрицательным/);
    expect(plan('01.10.2026;150', { unit: 'points' }).rows[0]!.reason).toBe('Значение не может быть больше 100');
    expect(plan('01.10.2026;-5', { unit: 'rub' }).rows[0]!.status).toBe('ok');
  });

  it('день, за который замер уже есть, — duplicate', () => {
    const p = plan('01.10.2026;40\n08.10.2026;38', { existingDays: ['2026-10-01'] });
    expect(p.rows.map((r) => r.status)).toEqual(['duplicate', 'ok']);
    expect(p.rows[0]!.reason).toBe('За этот день замер уже есть');
    expect(p.counts).toEqual({ ok: 1, duplicate: 1, error: 0 });
  });

  it('повторный импорт того же файла ничего не добавляет', () => {
    const text = 'Дата;Мин\n01.10.2026;40\n08.10.2026 10:00;38\n15.10.2026;36';
    const first = plan(text);
    const days = first.observations.map((o) => observationDay(o.observed_at));
    const second = plan(text, { existingDays: days });
    expect(second.counts).toEqual({ ok: 0, duplicate: 3, error: 0 });
    expect(second.observations).toEqual([]);
  });

  it('день повторяется в файле: то же значение — повтор, другое — ошибка', () => {
    const p = plan('01.10.2026;40\n01.10.2026 15:00;40\n01.10.2026;41');
    expect(p.rows.map((r) => [r.status, r.reason])).toEqual([
      ['ok', undefined],
      ['duplicate', 'Повтор строки 1'],
      ['error', 'День повторяется в файле (строка 1) — за день один замер'],
    ]);
  });

  it('пустые строки пропускаются без ошибок', () => {
    const t = parseTable('01.10.2026;40;a\n;;b\n02.10.2026;41;c');
    const p = planImport(t, 0, 1, { unit: 'minutes', now: NOW });
    expect(p.rows).toHaveLength(2);
  });

  it(`не больше ${IMPORT_MAX_ROWS} замеров за раз, остальные — ошибка с подсказкой`, () => {
    const lines = Array.from({ length: IMPORT_MAX_ROWS + 3 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      return `${d};${i}`;
    });
    const p = plan(lines.join('\n'));
    expect(p.counts.ok).toBe(IMPORT_MAX_ROWS);
    expect(p.counts.error).toBe(3);
    expect(p.observations).toHaveLength(IMPORT_MAX_ROWS);
    expect(p.rows.at(-1)!.reason).toMatch(/ещё раз/);
  });

  it('дубликаты и ошибки не съедают лимит', () => {
    const lines = ['xx;1', '2024-01-01;1', '2024-01-01;1'];
    for (let i = 1; i < IMPORT_MAX_ROWS; i++) lines.push(`${new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)};${i}`);
    expect(plan(lines.join('\n')).counts).toEqual({ ok: IMPORT_MAX_ROWS, duplicate: 1, error: 1 });
  });
});

describe('importTemplate', () => {
  it('CSV с BOM и «;», который сам же разбирается без ошибок', () => {
    const csv = importTemplate('мин');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toBe('﻿Дата;Значение (мин)');
    const t = parseTable(csv);
    expect(t.separator).toBe(';');
    expect(t.hasHeader).toBe(true);
    const p = planImport(t, t.dateCol!, t.valueCol!, { unit: 'minutes', now: NOW });
    expect(p.counts).toEqual({ ok: 3, duplicate: 0, error: 0 });
  });
});
