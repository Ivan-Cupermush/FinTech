import { describe, expect, it } from 'vitest';
import {
  buildKpiSheet,
  buildSalesReportSheet,
  excelSerial,
  checkEntryMapping,
  csvTable,
  entriesFromRows,
  entryDay,
  guessEntryColumns,
  kpiMetricPercent,
  kpiMetricUnit,
  parseKpiItem,
  parseKpiSheet,
  parseKpiSheets,
  parseSalesReport,
  pickReportSheet,
  SalesFileError,
  salesKindOf,
  sheetTable,
} from '../src';
import { kpiRows, mayClients, reportSheet } from './sales-fixtures';

describe('продажи: отчёт 1С «Валовая прибыль»', () => {
  const sheet = reportSheet('01.05.2026 - 15.05.2026', mayClients());

  it('период, клиенты, менеджеры и суммы', () => {
    const r = parseSalesReport(sheet);
    expect(r).toMatchObject({ period_start: '2026-05-01', period_end: '2026-05-15', month: '2026-05', total: 79000, file_total: 79000, warnings: [] });
    // У клиента два менеджера — два блока; пробел в конце имени из 1С убран.
    expect(r.blocks.filter((b) => b.client === 'ООО "Ромашка"').map((b) => [b.manager, b.revenue])).toEqual([
      ['Смирнова Анна', 28000],
      ['Иванов Пётр', 4000],
    ]);
    expect(r.blocks).toHaveLength(8);
  });

  it('группы товаров и товары: по уровням группировки и без них (старый .xls)', () => {
    const withLevels = parseSalesReport(sheet);
    const noLevels = parseSalesReport(reportSheet('01.05.2026 - 15.05.2026', mayClients(), false));
    const ignored = parseSalesReport(sheet, { ignoreLevels: true });
    for (const r of [withLevels, noLevels, ignored]) {
      const nodes = r.blocks[0]!.nodes;
      expect(nodes[0]).toMatchObject({ kind: 'group', depth: 1, name: 'ПИВО', revenue: 25000 });
      const stout = nodes.find((n) => n.name.startsWith('Пиво Балтика Stout'))!;
      expect(stout).toMatchObject({ kind: 'item', depth: 5, path: ['ПИВО', 'Пиво разливное', 'Россия', 'Драфт Балтика'] });
      // «, » в конце (пустая характеристика) убирается.
      expect(stout.name).toBe('Пиво Балтика Stout тм. КЕГ 30л');
    }
    const shape = (r: typeof withLevels) => r.blocks.map((b) => b.nodes.map((n) => [n.kind, n.path.join('/'), n.name]));
    expect(shape(noLevels)).toEqual(shape(withLevels));
  });

  it('понятные ошибки вместо падения', () => {
    expect(() => parseSalesReport(reportSheet('май', mayClients()))).toThrow(/не найден период/);
    expect(() => parseSalesReport(reportSheet('25.05.2026 - 05.06.2026', mayClients()))).toThrow(/несколько месяцев/);
    expect(() => parseSalesReport({ rows: [['просто текст']], levels: [] })).toThrow(SalesFileError);
    expect(() => parseSalesReport({ rows: [], levels: [] })).toThrow(/пустой/);
    expect(() => parseSalesReport({ rows: [['Период: 01.05.2026 - 02.05.2026'], ['Клиент', 'Выручка']], levels: [] })).toThrow(/По менеджерам/);
  });

  it('«Итого» не сходится — предупреждение, а не отказ', () => {
    const broken = reportSheet('01.05.2026 - 15.05.2026', mayClients());
    const total = broken.rows.findIndex((r) => r[0] === 'Итого');
    broken.rows[total] = ['Итого', '', '', '', '', '', 1, 90000];
    const r = parseSalesReport(broken);
    expect(r.file_total).toBe(90000);
    expect(r.warnings[0]).toMatch(/не совпадает со строкой «Итого»/);
  });

  it('клиент без раздела «По менеджерам» — продажи без менеджера', () => {
    const rows: unknown[][] = [
      ['Период: 01.05.2026 - 02.05.2026'],
      ['Клиент', '', '', '', '', '', 'Количество', 'Выручка'],
      ['Петров Пётр', '', '', '', '', '', 9, 900],
      ['ООО Альфа', '', '', '', '', '', 3, 300],
      ['По менеджерам'],
      ['00001', '', '', 'Товар А, ', '', '', 3, 300],
      ['ООО Бета', '', '', '', '', '', 1, 100],
      ['По менеджерам'],
      ['Иванов Пётр', '', '', '', '', '', 1, 100],
      ['00002', '', '', 'Товар Б, ', '', '', 1, 100],
    ];
    const r = parseSalesReport({ rows, levels: [] });
    expect(r.blocks.map((b) => [b.client, b.manager, b.revenue, b.nodes.map((n) => n.name)])).toEqual([
      ['ООО Альфа', '', 300, ['Товар А']],
      ['ООО Бета', 'Иванов Пётр', 100, ['Товар Б']],
    ]);
    expect(r.file_total).toBeNull();
    // Менеджер без клиента выше — пропущен с предупреждением.
    expect(r.warnings).toEqual(['Строка «Петров Пётр» без клиента — пропущена']);
  });

  it('лист отчёта — с разделом «По менеджерам»', () => {
    const other = { name: 'Пояснения', rows: [['Пояснения к отчёту']], levels: [] };
    expect(pickReportSheet([other, sheet])).toBe(sheet);
    expect(pickReportSheet([other])).toBe(other);
    expect(pickReportSheet([])).toBeNull();
  });
});

describe('продажи: файл KPI сотрудника', () => {
  it('показатели, месяц, позиции, ставка ключевых клиентов и опечатки', () => {
    const f = parseKpiSheet(kpiRows({ name: 'Анна' }));
    expect(f).toMatchObject({ employee: 'Анна', month: '2026-05', has_results: true, warnings: [] });
    // Топливо в план не попадает.
    expect(f.metrics.map((m) => m.kind)).toEqual(['salary', 'clients', 'distribution', 'brand', 'brand', 'key', 'non_key']);
    const by = (name: RegExp) => f.metrics.find((m) => name.test(m.name))!;
    expect(by(/АКБ/)).toMatchObject({ plan: 4, fact: 5, bonus: 5000, payment: 5000, file_percent: 125 });
    expect(by(/Дистра/).items).toEqual([
      { name: 'Балтика Стаут кег', need: 1, file_count: null, file_done: true },
      { name: 'Крон Бланш', need: 1, file_count: null, file_done: false },
      { name: 'Балтика Хеллес', need: 1, file_count: null, file_done: true },
      { name: 'Балтика 0 any', need: 2, file_count: 1, file_done: false },
    ]);
    // Галочки и крестики: выполнено столько позиций, сколько галочек.
    expect(by(/Дистра/)).toMatchObject({ plan: 4, fact: 2, percent_only: false });
    // Первая строка «факт» у ЕП — это план; «%» — ставка 3,5 %, а не выполнение.
    expect(by(/Есть Подод/)).toMatchObject({ plan: 40000, fact: 30000, rate: 0.035, file_percent: null });
    expect(by(/без ЕП/)).toMatchObject({ plan: 200000, fact: 150000, file_percent: 75, payment: 0 });
    expect(by(/Балтика, руб/).file_percent).toBe(95);
    expect(by(/Оклад/)).toMatchObject({ fixed: true, plan: 30000, payment: 30000, kind: 'salary' });
  });

  it('позиции без галочек: «да» — выполнение по проценту, пустой факт — нет данных', () => {
    const yes = parseKpiSheet(kpiRows({ name: 'Анна', yesNo: true })).metrics.find((m) => m.name === 'Дистра Хайнекен')!;
    expect(yes).toMatchObject({ kind: 'distribution', percent_only: true, plan: 100, fact: 80, file_percent: 80, payment: 2400 });
    expect(yes.items.map((i) => [i.name, i.file_done])).toEqual([
      ['Охота Крепкое', null],
      ['Бочкарев светлое', null],
    ]);
    const empty = parseKpiSheet(kpiRows({ name: 'Анна', yesNo: true, facts: false })).metrics.find((m) => m.name === 'Дистра Хайнекен')!;
    expect(empty).toMatchObject({ percent_only: true, plan: 100, fact: null });
  });

  it('файл на начало месяца — только план, без итогов; месяц текстом', () => {
    const f = parseKpiSheet(kpiRows({ name: 'Анна', month: '01.06.2026', facts: false }));
    expect(f.month).toBe('2026-06');
    expect(f.has_results).toBe(false);
    expect(f.metrics.find((m) => /Балтика, руб/.test(m.name))).toMatchObject({ plan: 100000, fact: null, payment: null });
  });

  it('имя сотрудника из шапки «Факт …», если в первой строке его нет', () => {
    const rows = kpiRows({ name: 'Анна' });
    rows[0] = ['', '', '', ''];
    expect(parseKpiSheet(rows).employee).toBe('Анна');
  });

  it('несколько листов — несколько сотрудников; пустые листы пропускаются', () => {
    const files = parseKpiSheets([
      { name: 'Анна', rows: kpiRows({ name: 'Анна' }) },
      { name: 'Пусто', rows: [['Заметки']] },
      { name: 'Пётр', rows: kpiRows({ name: '' }).map((r, i) => (i === 1 ? [46143, '', '', 'Факт'] : r)) },
    ]);
    expect(files.map((f) => [f.sheet, f.employee])).toEqual([
      ['Анна', 'Анна'],
      ['Пётр', 'Пётр'],
    ]);
  });

  it('вид показателя по названию', () => {
    expect(salesKindOf('Продажи Есть Подод, руб', false)).toBe('key');
    expect(salesKindOf('План продаж без ЕП, руб', false)).toBe('non_key');
    expect(salesKindOf('Выручка без ключевых клиентов', false)).toBe('non_key');
    expect(salesKindOf('Продажи ключевым клиентам', false)).toBe('key');
    expect(salesKindOf('АКБ (без учета ЕП)', false)).toBe('clients');
    expect(salesKindOf('Активная клиентская база', false)).toBe('clients');
    expect(salesKindOf('План ОПХ, руб', false)).toBe('brand');
    expect(salesKindOf('План Сидр, руб', false)).toBe('other');
    expect(salesKindOf('Оклад', true)).toBe('salary');
    expect(salesKindOf('ГСМ', true)).toBe('fuel');
    expect(salesKindOf('Связь', true)).toBe('fixed');
    expect(parseKpiItem('Балтика 0 any - 5 ТТ (4) X')).toEqual({ name: 'Балтика 0 any', need: 5, file_count: 4, file_done: false });
    expect(parseKpiItem('Курс Python V')).toEqual({ name: 'Курс Python', need: 1, file_count: null, file_done: true });
    expect(parseKpiItem('Курс Python')).toEqual({ name: 'Курс Python', need: 1, file_count: null, file_done: null });
  });

  it('единица и выполнение показателя из файла', () => {
    const f = parseKpiSheet(kpiRows({ name: 'Анна', yesNo: true }));
    const unit = Object.fromEntries(f.metrics.map((m) => [m.name, kpiMetricUnit(m)]));
    expect(unit).toMatchObject({ Оклад: 'rub', 'Дистра Балтика': 'items', 'Дистра Хайнекен': 'percent', 'Продажи Есть Подод, руб (Порог 20 000 руб)': 'rub' });
    expect(unit[f.metrics.find((m) => m.kind === 'clients')!.name]).toBe('clients');
    const pct = Object.fromEntries(f.metrics.map((m) => [m.name, kpiMetricPercent(m)]));
    expect(pct['Дистра Балтика']).toBe(50);
    expect(pct['Дистра Хайнекен']).toBe(80);
    expect(pct['Продажи Есть Подод, руб (Порог 20 000 руб)']).toBe(75);
    expect(kpiMetricUnit({ name: 'Звонки, шт', kind: 'other', fixed: false, percent_only: false, items: [], yes_no: false, rate: null, plan: 50 })).toBe('count');
    expect(kpiMetricUnit({ name: 'Новые ТТ', kind: 'other', fixed: false, percent_only: false, items: [], yes_no: false, rate: null, plan: 5 })).toBe('clients');
    expect(kpiMetricUnit({ name: 'План', kind: 'other', fixed: false, percent_only: false, items: [], yes_no: false, rate: null, plan: 5000 })).toBe('rub');
  });
});

describe('продажи: таблица продаж из Excel', () => {
  const rows: unknown[][] = [
    ['Продажи за октябрь'],
    [],
    ['Дата', 'Клиент', 'Наименование', 'Кол-во', 'Сумма, руб', 'Комментарий'],
    [46314, 'ООО Альфа', 'Курс «Аналитика данных»', 2, '120 000', 'Корпоративная группа'],
    ['19.10.2026', '', 'Консультация', '', '15000,50', ''],
    ['', '', '', '', '', ''],
    ['32.10.2026', 'ООО Бета', 'Курс', 1, 1000, ''],
    ['2026-10-20', 'ООО Бета', '', 1, 1000, ''],
    ['2026-12-01', 'ООО Бета', 'Из будущего', 1, 1000, ''],
    ['2026-10-21', 'ООО Бета', 'Минус', 1, -5, ''],
  ];

  it('шапка — первая строка с подписями колонок', () => {
    const t = sheetTable(rows);
    expect(t.headers).toEqual(['Дата', 'Клиент', 'Наименование', 'Кол-во', 'Сумма, руб', 'Комментарий']);
    expect(t.rows).toHaveLength(6);
    expect(sheetTable([[1, 2], [3, 4]])).toEqual({ headers: [], rows: [], lines: [] });
  });

  it('колонки угадываются по названиям, одна колонка — одно поле', () => {
    const m = guessEntryColumns(['Дата', 'Клиент', 'Наименование', 'Кол-во', 'Сумма, руб', 'Комментарий']);
    expect(m).toEqual({ product: 2, quantity: 3, amount: 4, sold_on: 0, client: 1, note: 5 });
    expect(guessEntryColumns(['Что', 'Сколько денег'])).toMatchObject({ product: 0, amount: null });
    expect(checkEntryMapping({ product: 2, amount: 2 }, 6).error).toMatch(/двух полей/);
    expect(checkEntryMapping({ amount: 4 }, 6).error).toMatch(/товаром/);
    expect(checkEntryMapping({ product: 2 }, 6).error).toMatch(/суммой или количеством/);
    expect(checkEntryMapping({ product: 9, amount: 1 }, 6).error).toMatch(/не найдена/);
    expect(checkEntryMapping({ product: '2', amount: 4, note: '' }, 6)).toEqual({ mapping: { product: 2, quantity: null, amount: 4, sold_on: null, client: null, note: null }, error: null });
  });

  it('строки → продажи; ошибки с номером строки файла', () => {
    const t = sheetTable(rows);
    const { entries, errors } = entriesFromRows(t.rows, guessEntryColumns(t.headers), '2026-10-27', t.lines);
    expect(t.lines).toEqual([4, 5, 7, 8, 9, 10]);
    expect(entries).toEqual([
      { product: 'Курс «Аналитика данных»', client: 'ООО Альфа', quantity: 2, amount: 120000, sold_on: '2026-10-19', note: 'Корпоративная группа' },
      { product: 'Консультация', client: null, quantity: 1, amount: 15000.5, sold_on: '2026-10-19', note: null },
    ]);
    expect(errors).toEqual([
      { row: 7, message: 'Не понятна дата «32.10.2026»' },
      { row: 8, message: 'Укажите товар или услугу' },
      { row: 9, message: 'Продажа не может быть в будущем' },
      { row: 10, message: 'Сумма не может быть отрицательной' },
    ]);
  });

  it('дата продажи из ячейки и CSV-таблица', () => {
    expect(entryDay(46314)).toBe('2026-10-19');
    expect(entryDay('2026-10-19')).toBe('2026-10-19');
    expect(entryDay('19.10.2026 10:30')).toBe('2026-10-19');
    expect(entryDay('вчера')).toBeNull();
    expect(entryDay('')).toBeNull();
    const csv = csvTable('Товар;Сумма\nКурс;1 000\n');
    expect(csv).toEqual({ headers: ['Товар', 'Сумма'], rows: [['Курс', '1 000']], lines: [2] });
    // Без номеров строк — считаем от второй (первая — шапка).
    expect(entriesFromRows([['', '']], { product: 0, quantity: null, amount: 1, sold_on: null, client: null, note: null }, '2026-10-27')).toEqual({ entries: [], errors: [] });
    expect(entriesFromRows([['Курс', 'x']], { product: 0, quantity: null, amount: 1, sold_on: null, client: null, note: null }, '2026-10-27').errors).toEqual([{ row: 2, message: 'Укажите сумму числом' }]);
  });
});

describe('образцы файлов', () => {
  const metrics = [
    { name: 'План продаж курсов, руб (порог 90%, При выполнении 80-90% кэф 0,5)', plan: 600000, fact: 540000, percent: 0.9, bonus: 30000, payment: 30000 },
    { name: 'Корпоративные клиенты, шт', plan: 10, fact: 12, percent: 1.2, bonus: 10000, payment: 10000 },
  ];

  it('файл KPI читается обратно: сотрудник, месяц, план, факт и выплаты', () => {
    const f = parseKpiSheet(buildKpiSheet({ employee: 'Павел Соколов', month: '2026-10', fixed: [{ name: 'Оклад', amount: 40000 }], metrics, results: true }));
    expect(f).toMatchObject({ employee: 'Павел Соколов', month: '2026-10', has_results: true, warnings: [] });
    expect(f.metrics.map((m) => [m.name, m.fixed, m.plan, m.fact, m.bonus, m.payment, m.file_percent])).toEqual([
      ['Оклад', true, 40000, 40000, 40000, 40000, null],
      [metrics[0]!.name, false, 600000, 540000, 30000, 30000, 90],
      ['Корпоративные клиенты, шт', false, 10, 12, 10000, 10000, 120],
    ]);
    expect(kpiMetricUnit(f.metrics[1]!)).toBe('rub');
    expect(kpiMetricUnit(f.metrics[2]!)).toBe('count');
  });

  it('файл на начало месяца — только план', () => {
    const f = parseKpiSheet(buildKpiSheet({ employee: 'Павел Соколов', month: '2026-11', fixed: [], metrics, results: false }));
    expect(f).toMatchObject({ month: '2026-11', has_results: false });
    expect(f.metrics.map((m) => [m.plan, m.fact, m.payment])).toEqual([
      [600000, null, null],
      [10, null, null],
    ]);
    // «Если выполнен» — 100 %, но факта нет: выполнение 0, а не 100.
    expect(f.metrics.map((m) => [m.file_percent, kpiMetricPercent(m)])).toEqual([
      [null, 0],
      [null, 0],
    ]);
  });

  it('отчёт 1С из образца разбирается с теми же суммами', () => {
    const r = parseSalesReport(
      buildSalesReportSheet('01.10.2026 - 26.10.2026', [
        { client: 'ООО «Альфа»', managers: [{ name: 'Соколов Павел', sales: [{ path: ['КУРСЫ', 'Программирование'], name: 'Курс «Python для аналитиков»', qty: 3, rev: 90000 }] }] },
      ]),
    );
    expect(r).toMatchObject({ period_start: '2026-10-01', period_end: '2026-10-26', month: '2026-10', total: 90000, file_total: 90000 });
    expect(r.blocks[0]!.nodes.map((n) => [n.kind, n.depth, n.path.join('/'), n.name])).toEqual([
      ['group', 1, '', 'КУРСЫ'],
      ['group', 2, 'КУРСЫ', 'Программирование'],
      ['item', 3, 'КУРСЫ/Программирование', 'Курс «Python для аналитиков»'],
    ]);
    expect(excelSerial('2026-05-01')).toBe(46143);
  });
});
