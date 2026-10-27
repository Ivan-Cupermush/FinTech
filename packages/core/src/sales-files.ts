import { parseLooseDate, parseTable } from './import';
import { isIsoDay } from './my-notes';
import {
  ENTRY_FIELDS,
  salesKindOf,
  SALES_LIMITS,
  validateSaleEntry,
  type EntryMapping,
  type KpiItem,
  type KpiMetric,
  type SaleEntryInput,
  type SalesUnit,
} from './sales';
import { cellNumber, cellText, datesIn, excelSerialDate, salesKey } from './sales-text';

/**
 * Файлы продаж: отчёт 1С «Валовая прибыль», файл KPI сотрудника и таблица
 * продаж из Excel. Разбор — по строкам листа (сервер читает .xlsx сам и
 * отдаёт сюда ячейки и уровни группировки), без зависимостей от библиотек.
 */

/** Ошибка разбора, которую показываем человеку как есть. */
export class SalesFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesFileError';
  }
}

/** Лист: ячейки по строкам и уровень группировки строки (0 — без группировки). */
export interface SheetData {
  name: string;
  rows: unknown[][];
  levels: number[];
}

// ---------------------------------------------------------------- отчёт 1С

export interface ReportNode {
  kind: 'group' | 'item';
  /** 1 — верхняя группа. */
  depth: number;
  /** Названия групп выше этой строки. */
  path: string[];
  name: string;
  quantity: number;
  revenue: number;
}

export interface ReportBlock {
  client: string;
  manager: string;
  quantity: number;
  revenue: number;
  nodes: ReportNode[];
}

export interface ParsedSalesReport {
  period_start: string;
  period_end: string;
  /** «2026-10» */
  month: string;
  blocks: ReportBlock[];
  /** Сумма выручки по всем клиентам. */
  total: number;
  /** Строка «Итого» из файла, если есть. */
  file_total: number | null;
  warnings: string[];
}

interface RawRow {
  a: string;
  /** Первая ячейка как в файле: у товаров без артикула там бывают пробелы. */
  aRaw: string;
  name: string;
  quantity: number;
  revenue: number;
  level: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
const HEADER_LABELS = new Set(['клиент', 'менеджер', 'артикул']);
const round2 = (n: number) => Math.round(n * 100) / 100;

function numbersOf(row: readonly unknown[], qtyCol: number | null, revCol: number | null) {
  if (revCol != null) return { quantity: cellNumber(row[qtyCol ?? -1]) ?? 0, revenue: cellNumber(row[revCol]) ?? 0 };
  const nums = row.map(cellNumber).filter((n): n is number => n != null);
  return { quantity: nums.length > 1 ? nums[nums.length - 2]! : 0, revenue: nums.length ? nums[nums.length - 1]! : 0 };
}

function findPeriod(rows: readonly unknown[][]): { start: string; end: string; row: number } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const text = rows[i]!.map(cellText).join(' ');
    const at = text.toLowerCase().indexOf('период');
    if (at < 0) continue;
    const dates = datesIn(text.slice(at));
    if (dates.length) {
      const sorted = [...dates].sort();
      return { start: sorted[0]!, end: sorted[sorted.length - 1]!, row: i };
    }
  }
  return null;
}

/** «Пиво Балтика №3 0,5 ст.б.*20, » → «Пиво Балтика №3 0,5 ст.б.*20» (пустая характеристика). */
function cleanName(name: string, kind: ReportNode['kind']): string {
  const s = name.replace(/\s+/g, ' ').trim();
  return kind === 'item' ? s.replace(/,\s*$/, '') : s;
}

/** Вложенность и тип строк товаров одного менеджера. */
function buildTree(rows: RawRow[], useLevels: boolean): ReportNode[] {
  if (!rows.length) return [];
  if (useLevels) {
    const base = Math.min(...rows.map((r) => r.level));
    const stack: string[] = [];
    return rows.map((r, i) => {
      const depth = r.level - base + 1;
      const next = rows[i + 1];
      const kind = next && next.level > r.level ? 'group' : 'item';
      stack.length = depth - 1;
      const node: ReportNode = { kind, depth, path: stack.filter(Boolean), name: cleanName(r.name, kind), quantity: r.quantity, revenue: r.revenue };
      if (kind === 'group') stack[depth - 1] = node.name;
      return node;
    });
  }

  // Без уровней: открытые группы ждут, пока сумма вложенных строк не сравняется с их итогом.
  type Open = { node: ReportNode; leftQty: number; leftRev: number; children: number };
  const stack: Open[] = [];
  const out: ReportNode[] = [];
  for (const r of rows) {
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const done = near(top.leftRev, 0) && near(top.leftQty, 0);
      const fits = r.revenue <= top.leftRev + 0.01 && r.quantity <= top.leftQty + 0.01;
      if (!done && fits) break;
      // Не вместилась первая же строка — это был товар, а не группа.
      if (!top.children) top.node.kind = 'item';
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    // У товаров в первой колонке артикул (или пробелы), у групп она пустая.
    const leafHint = /,\s*$/.test(r.name) || r.aRaw !== '';
    const node: ReportNode = { kind: leafHint ? 'item' : 'group', depth: stack.length + 1, path: stack.map((s) => s.node.name), name: r.name, quantity: r.quantity, revenue: r.revenue };
    if (parent) {
      parent.leftQty -= r.quantity;
      parent.leftRev -= r.revenue;
      parent.children++;
    }
    out.push(node);
    if (node.kind === 'group') stack.push({ node, leftQty: r.quantity, leftRev: r.revenue, children: 0 });
  }
  for (const s of stack) if (!s.children) s.node.kind = 'item';
  return out.map((n) => ({ ...n, name: cleanName(n.name, n.kind), path: n.path.map((p) => cleanName(p, 'group')) }));
}

/** Лист отчёта: тот, где есть раздел «По менеджерам», иначе первый. */
export function pickReportSheet(sheets: readonly SheetData[]): SheetData | null {
  return sheets.find((s) => s.rows.some((r) => salesKey(r[0]) === 'по менеджерам')) ?? sheets[0] ?? null;
}

/**
 * Отчёт о продажах из 1С («Валовая прибыль предприятия»):
 *
 *   Период: 01.10.2026 - 18.10.2026
 *   Клиент                                    Количество  Выручка
 *   ООО Ромашка                                      257    55 448   ← клиент
 *   По менеджерам
 *   Иванов Иван                                      257    55 448   ← менеджер клиента
 *          НАПИТКИ                                    12     2 557   ← группы товаров
 *   00001234  Лимонад 0,5 ст.б.,                      12     2 557   ← товар
 *   …
 *   Итого                                          90 910  18 997 284
 *
 * Вложенность групп берётся из уровней группировки строк Excel (их сохраняет
 * 1С). Если их нет — восстанавливается по суммам: группа равна сумме вложенных
 * строк, а товар заканчивается на «, » (пустая характеристика) или имеет артикул.
 */
export function parseSalesReport(sheet: Pick<SheetData, 'rows' | 'levels'>, options: { ignoreLevels?: boolean } = {}): ParsedSalesReport {
  const rows = sheet.rows;
  if (!rows.length) throw new SalesFileError('Файл пустой');
  const levelOf = (i: number) => (options.ignoreLevels ? 0 : (sheet.levels[i] ?? 0));

  const period = findPeriod(rows);
  if (!period) throw new SalesFileError('В отчёте не найден период. Нужна строка вида «Период: 01.10.2026 - 18.10.2026», как в отчёте 1С');
  if (period.start.slice(0, 7) !== period.end.slice(0, 7)) {
    throw new SalesFileError('Отчёт захватывает несколько месяцев. План считается по месяцам — сформируйте отчёт в пределах одного месяца');
  }

  // Шапка: колонки «Количество», «Выручка» и «Номенклатура».
  let header = -1;
  let qtyCol: number | null = null;
  let revCol: number | null = null;
  let nameCol = 3;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i]!.map(salesKey);
    const rev = cells.findIndex((c) => c.startsWith('выручка'));
    if (rev >= 0) {
      revCol = rev;
      const qty = cells.findIndex((c) => c.startsWith('количество'));
      qtyCol = qty >= 0 ? qty : null;
      header = i;
    }
    const nm = cells.findIndex((c) => c.startsWith('номенклатура'));
    if (nm > 0) nameCol = nm;
    if (header >= 0 && (nm > 0 || HEADER_LABELS.has(cells[0] ?? ''))) header = i;
  }
  const start = header >= 0 ? header + 1 : period.row + 1;

  const warnings: string[] = [];
  const raw: { kind: 'client' | 'manager' | 'product'; row: RawRow }[] = [];
  let fileTotal: number | null = null;
  const nextFilled = (i: number) => {
    for (let j = i + 1; j < rows.length; j++) if (rows[j]!.some((c) => cellText(c))) return rows[j]!;
    return null;
  };
  for (let i = start; i < rows.length; i++) {
    const row = rows[i]!;
    const a = cellText(row[0]);
    const name = String(row[nameCol] ?? '').replace(/ /g, ' ');
    if (!a && !name.trim()) continue;
    if (/^итого/i.test(a)) {
      fileTotal = numbersOf(row, qtyCol, revCol).revenue;
      break;
    }
    if (salesKey(a) === 'по менеджерам') continue;
    const r: RawRow = { a, aRaw: String(row[0] ?? ''), name, level: levelOf(i), ...numbersOf(row, qtyCol, revCol) };
    if (a && !name.trim()) {
      const next = nextFilled(i);
      raw.push({ kind: next && salesKey(next[0]) === 'по менеджерам' ? 'client' : 'manager', row: r });
    } else {
      raw.push({ kind: 'product', row: r });
    }
  }

  const useLevels = raw.some((r) => r.kind === 'product' && r.row.level > 0);
  const blocks: ReportBlock[] = [];
  let client: RawRow | null = null;
  let current: { block: ReportBlock; rows: RawRow[] } | null = null;
  const flush = () => {
    if (current) current.block.nodes = buildTree(current.rows, useLevels);
    current = null;
  };
  for (const item of raw) {
    if (item.kind === 'client') {
      flush();
      client = item.row;
    } else if (item.kind === 'manager') {
      flush();
      if (!client) {
        warnings.push(`Строка «${item.row.a}» без клиента — пропущена`);
        continue;
      }
      current = { block: { client: client.a, manager: item.row.a.replace(/\s+/g, ' '), quantity: item.row.quantity, revenue: item.row.revenue, nodes: [] }, rows: [] };
      blocks.push(current.block);
    } else {
      if (!current && client) {
        // Клиент без раздела «По менеджерам» — продажи без менеджера.
        current = { block: { client: client.a, manager: '', quantity: client.quantity, revenue: client.revenue, nodes: [] }, rows: [] };
        blocks.push(current.block);
      }
      (current as { rows: RawRow[] } | null)?.rows.push(item.row);
    }
  }
  flush();

  if (!blocks.length) throw new SalesFileError('Не похоже на отчёт о продажах из 1С: не найден раздел «По менеджерам» под клиентами');
  const total = round2(blocks.reduce((s, b) => s + b.revenue, 0));
  // Копейки на округлении строк не считаем расхождением.
  if (fileTotal != null && Math.abs(fileTotal - total) >= 1) {
    const rub = (n: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n).replace(/\s/g, ' ')} ₽`;
    warnings.push(`Сумма по клиентам (${rub(total)}) не совпадает со строкой «Итого» (${rub(fileTotal)}) — проверьте, что отчёт выгружен целиком`);
  }
  return { period_start: period.start, period_end: period.end, month: period.start.slice(0, 7), blocks, total, file_total: fileTotal, warnings };
}

// ---------------------------------------------------------------- файл KPI

/**
 * Файл KPI сотрудника (как его ведут заказчики прошлого проекта):
 *
 *   A                                   B              C (план)   D (факт)
 *   Анастасия                                                             ← сотрудник
 *   01.10.2026                                                Факт Анастасия ← месяц
 *   Оклад                                              30 000     30 000   ← фиксированные
 *   АКБ (Порог 100%)                    план, ТТ           44         44
 *                                       факт               44         46
 *                                       % выполнения        1       1,045
 *                                       бонус           5 000      5 000
 *                                       к выплате       5 000      5 000
 *   Дистрибуция:                        план, ТТ           да         да
 *   Лимонад 0,5 - 4 ТТ V                факт …                            ← позиции
 *   Продажи без ключевых (Порог 200 000) факт     400 000    400 000      ← первая строка — план
 *                                        %         0,035      0,035       ← ставка, а не %
 *
 * Колонка C — значения «если план выполнен», D — фактические. В начале месяца
 * колонка D может быть пустой: тогда в файле только план и бонусы.
 */
export interface KpiFile {
  employee: string;
  /** «2026-10», если в файле есть дата. */
  month: string | null;
  metrics: KpiMetric[];
  /** В файле есть фактические выплаты (итоговый файл за месяц). */
  has_results: boolean;
  warnings: string[];
}

type RowType = 'plan' | 'fact' | 'percent' | 'bonus' | 'payment';
const CYCLE: RowType[] = ['plan', 'fact', 'percent', 'bonus', 'payment'];

function rowType(label: string): RowType | 'total' | null {
  const s = salesKey(label);
  if (!s) return null;
  if (s.includes('итого')) return 'total';
  if (s.includes('план')) return 'plan';
  if (s.includes('факт')) return 'fact';
  if (s.includes('бонус')) return 'bonus';
  if (s.includes('выплат')) return 'payment';
  if (s.includes('%') || s.includes('выполн')) return 'percent';
  return null;
}

const expectedNext = (last: RowType | null): RowType => {
  const i = last ? CYCLE.indexOf(last) : -1;
  return i < 0 || i === CYCLE.length - 1 ? 'plan' : CYCLE[i + 1]!;
};

/** Ячейка-число; «да/нет» → 1/0. */
function value(v: unknown): { n: number | null; yesNo: boolean } {
  const s = salesKey(v);
  if (s === 'да') return { n: 1, yesNo: true };
  if (s === 'нет') return { n: 0, yesNo: true };
  return { n: cellNumber(v), yesNo: false };
}

/** «Лимонад 0,5 - 4 ТТ (3) X» → позиция «Лимонад 0,5», нужно 4 точки, по файлу 3, не выполнено. */
export function parseKpiItem(text: string): KpiItem {
  const s = text.replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.*?)\s*[-–—]\s*(\d+)\s*тт\.?\s*(?:\((\d+)\))?\s*([vxх✓✔✗✘+])?\s*$/i);
  if (!m) {
    const mark = s.match(/\s([vxх✓✔✗✘+])$/i);
    return { name: mark ? s.slice(0, -2).trim() : s, need: 1, file_count: null, file_done: mark ? /[v✓✔+]/i.test(mark[1]!) : null };
  }
  return { name: m[1]!.trim(), need: Math.max(1, Number(m[2])), file_count: m[3] != null ? Number(m[3]) : null, file_done: m[4] ? /[v✓✔+]/i.test(m[4]) : null };
}

interface Draft {
  name: string;
  fixed: boolean;
  plan: number | null;
  fact: number | null;
  bonus: number | null;
  payment: number | null;
  percent: number | null;
  /** Строка «%» без слова «выполнение» — возможно, ставка. */
  percentBare: boolean;
  yesNo: boolean;
  last: RowType | null;
  subItems: string[];
}

export function parseKpiSheet(rows: readonly unknown[][]): KpiFile {
  const warnings: string[] = [];
  // Колонка факта — та, где в шапке «Факт …»; план — слева от неё.
  let factCol = 3;
  for (const row of rows.slice(0, 5)) {
    const i = row.findIndex((c) => /^факт/i.test(cellText(c)));
    if (i >= 2) {
      factCol = i;
      break;
    }
  }
  const planCol = factCol - 1;

  let employee = '';
  let month: string | null = null;
  // Месяц — дата в первых строках: число Excel (2015–2099) или текст «01.10.2026».
  for (const row of rows.slice(0, 3)) {
    for (const c of row) {
      if (month) break;
      if (typeof c === 'number') month = c >= 42005 && c <= 73050 ? excelSerialDate(c) : null;
      else if (typeof c === 'string' && /\d/.test(c)) month = datesIn(c)[0] ?? null;
    }
  }
  if (month) month = month.slice(0, 7);
  for (const row of rows.slice(0, 3)) {
    const a = cellText(row[0]);
    if (a && !/\d/.test(a) && !rowType(cellText(row[1])) && !cellText(row[planCol]) && salesKindOf(a, false) === 'other' && !/оклад|гсм/i.test(a)) {
      employee = a.replace(/\s+/g, ' ');
      break;
    }
  }
  if (!employee) {
    const head = rows
      .slice(0, 5)
      .flat()
      .map(cellText)
      .find((c) => /^факт\s+\S/i.test(c));
    if (head) employee = head.replace(/^факт\s+/i, '').trim();
  }

  const drafts: Draft[] = [];
  let current: Draft | null = null;
  for (const row of rows) {
    const a = cellText(row[0]).replace(/\s+/g, ' ');
    const type = rowType(cellText(row[1]));
    const c = value(row[planCol]);
    const d = value(row[factCol]);
    if (/^итого/i.test(a) || type === 'total') continue;
    if (a === employee && !type) continue;

    if (!type) {
      // Оклад, топливо: название и сумма без строк план/факт.
      if (a && (c.n != null || d.n != null) && !/^\d/.test(a) && !/^факт/i.test(a)) {
        const amount = d.n ?? c.n ?? 0;
        current = { name: a, fixed: true, plan: c.n ?? amount, fact: amount, bonus: c.n ?? amount, payment: d.n, percent: null, percentBare: false, yesNo: false, last: null, subItems: [] };
        drafts.push(current);
      }
      continue;
    }

    const cur: Draft | null = current;
    const continues = cur != null && !cur.fixed && (!a || a === cur.name || (type !== 'plan' && expectedNext(cur.last) === type));
    let m: Draft;
    if (!continues || !cur) {
      m = { name: a || `Показатель ${drafts.length + 1}`, fixed: false, plan: null, fact: null, bonus: null, payment: null, percent: null, percentBare: false, yesNo: false, last: null, subItems: [] };
      drafts.push(m);
      current = m;
    } else {
      m = cur;
      if (a && a !== m.name) m.subItems.push(a);
    }
    if (c.yesNo || d.yesNo) m.yesNo = true;
    if (type === 'plan') m.plan = d.n ?? c.n;
    else if (type === 'fact') {
      // Первая строка показателя подписана «факт», но это план (так в файлах заказчика).
      if (m.plan == null) {
        m.plan = c.n ?? d.n;
        m.fact = d.n;
      } else m.fact = d.n;
    } else if (type === 'percent') {
      m.percent = d.n ?? c.n;
      m.percentBare = !/выполн/i.test(cellText(row[1]));
    } else if (type === 'bonus') m.bonus = c.n ?? d.n;
    else if (type === 'payment') m.payment = d.n;
    m.last = type;
  }

  const metrics: KpiMetric[] = drafts
    .map((m): KpiMetric => {
      const name = m.name.replace(/[:\s]+$/, '');
      const kind = salesKindOf(name, m.fixed);
      let plan = m.plan ?? 0;
      let fact = m.fact;
      const bonus = m.bonus ?? 0;
      const items = kind === 'distribution' || m.subItems.length ? m.subItems.map(parseKpiItem) : [];
      // «%» со ставкой: бонус = план × ставка (3,5 % от продаж), а не процент выполнения.
      const p = m.percent;
      const isRate =
        p != null &&
        p > 0 &&
        p < 1 &&
        m.percentBare &&
        plan > 0 &&
        (Math.abs(bonus - plan * p) <= Math.max(1, bonus * 0.01) || (fact != null && m.payment != null && Math.abs(m.payment - fact * p) <= Math.max(1, m.payment * 0.01)));
      const filePercent = isRate || p == null ? null : p <= 5 ? Math.round(p * 1000) / 10 : p;
      const marked = items.filter((i) => i.file_done != null);
      let percentOnly = false;
      if (items.length && marked.length) {
        // Позиции с галочками и крестиками: выполнено столько, сколько галочек.
        plan = items.length;
        fact = items.filter((i) => i.file_done).length;
      } else if (m.yesNo) {
        // Отметок нет: «да» — смотрим процент выполнения, «нет» — не выполнено.
        percentOnly = true;
        plan = 100;
        fact = m.fact == null ? null : m.fact >= 1 ? (filePercent ?? 100) : 0;
      }
      return {
        name,
        kind,
        fixed: m.fixed,
        plan,
        fact,
        bonus: m.fixed ? plan : bonus,
        payment: m.payment,
        rate: isRate ? p : null,
        file_percent: filePercent,
        items,
        yes_no: m.yesNo && !items.length,
        percent_only: percentOnly,
      };
    })
    // Топливо в плане не показываем: это компенсация, а не KPI.
    .filter((m) => m.kind !== 'fuel');

  for (const m of metrics) if (!m.fixed && !m.plan) warnings.push(`«${m.name}»: не найден план`);
  const has_results = metrics.some((m) => !m.fixed && m.payment != null);
  return { employee, month, metrics, has_results, warnings };
}

/** Файл, где каждый лист — KPI отдельного сотрудника. Имя — на листе или название листа. */
export function parseKpiSheets(sheets: readonly Pick<SheetData, 'name' | 'rows'>[]): (KpiFile & { sheet: string })[] {
  return sheets
    .map((s) => {
      const parsed = parseKpiSheet(s.rows);
      return { ...parsed, sheet: s.name, employee: parsed.employee || s.name };
    })
    .filter((f) => f.metrics.length > 0);
}

/** Единица показателя из файла: рубли, точки, позиции, проценты или штуки. */
export function kpiMetricUnit(m: Pick<KpiMetric, 'name' | 'kind' | 'fixed' | 'percent_only' | 'items' | 'yes_no' | 'rate' | 'plan'>): SalesUnit {
  const s = salesKey(m.name);
  if (m.fixed) return 'rub';
  if (m.kind === 'clients') return 'clients';
  if (m.percent_only || m.yes_no) return 'percent';
  if (m.items.length) return 'items';
  if (/руб|₽|выручк|сумм/.test(s) || m.rate != null) return 'rub';
  if (/(^|[^а-я])тт([^а-я]|$)|точ/.test(s)) return 'clients';
  if (/(^|[^а-я])шт([^а-я]|$)/.test(s)) return 'count';
  return m.plan >= 1000 ? 'rub' : 'count';
}

/** Выполнение показателя из файла, %: по процентам, отметкам позиций или факту к плану. */
export function kpiMetricPercent(m: Pick<KpiMetric, 'percent_only' | 'fact' | 'items' | 'file_percent' | 'plan'>): number {
  const marked = m.items.some((it) => it.file_done != null);
  const p = m.percent_only
    ? (m.fact ?? 0)
    : marked
      ? (m.items.filter((it) => it.file_done).length / m.items.length) * 100
      : (m.file_percent ?? (m.plan > 0 && m.fact != null ? (m.fact / m.plan) * 100 : 0));
  return Math.round(p * 10) / 10;
}

// ---------------------------------------------------------------- продажи из Excel

/** Шапка таблицы — первая строка, где хотя бы две ячейки с текстом без цифр. */
export interface EntryTable {
  headers: string[];
  rows: unknown[][];
  /** Номер строки файла (с 1) для каждой строки данных — чтобы ошибка называла настоящую строку. */
  lines: number[];
}

export function sheetTable(rows: readonly unknown[][]): EntryTable {
  const isText = (c: unknown) => typeof c === 'string' && cellText(c) !== '' && cellNumber(c) === null;
  const at = rows.findIndex((r) => r.filter(isText).length >= 2);
  if (at < 0) return { headers: [], rows: [], lines: [] };
  const width = rows.slice(at).reduce((w, r) => Math.max(w, r.length), 0);
  const head = rows[at]!;
  const headers = Array.from({ length: width }, (_, i) => cellText(head[i]) || `Колонка ${i + 1}`);
  const data: unknown[][] = [];
  const lines: number[] = [];
  rows.forEach((r, i) => {
    if (i <= at || !r.some((c) => cellText(c) !== '')) return;
    data.push(r);
    lines.push(i + 1);
  });
  return { headers, rows: data, lines };
}

/** Таблица из CSV-файла: те же правила, что у импорта замеров (таб, «;», запятая). */
export function csvTable(text: string): EntryTable {
  const t = parseTable(text);
  return { headers: t.columns, rows: t.rows, lines: t.lines };
}

const ENTRY_HEADER_HINTS: Record<keyof EntryMapping, RegExp> = {
  product: /товар|продукт|product|название|наименование|номенклатур|item|услуг/i,
  quantity: /кол|quantity|шт|count/i,
  amount: /сумм|amount|выручк|стоимост|руб|price|цена/i,
  sold_on: /дата|date|день/i,
  client: /клиент|client|покупател|customer|контрагент/i,
  note: /коммент|note|примечан|comment|описан/i,
};

/** Какая колонка за что отвечает — по названиям в шапке. Одну колонку дважды не берём. */
export function guessEntryColumns(headers: readonly string[]): EntryMapping {
  const used = new Set<number>();
  const out = {} as EntryMapping;
  for (const f of ENTRY_FIELDS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && ENTRY_HEADER_HINTS[f].test(h));
    out[f] = i >= 0 ? i : null;
    if (i >= 0) used.add(i);
  }
  if (out.product == null) {
    const free = headers.findIndex((_, idx) => !used.has(idx));
    out.product = free >= 0 ? free : null;
  }
  return out;
}

/** Проверка выбранных колонок: товар обязателен, одна колонка — одно поле. */
export function checkEntryMapping(m: Partial<Record<string, unknown>>, width: number): { mapping: EntryMapping | null; error: string | null } {
  const out = {} as EntryMapping;
  const used = new Set<number>();
  for (const f of ENTRY_FIELDS) {
    const v = m[f];
    if (v === null || v === undefined || v === '') {
      out[f] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n >= width) return { mapping: null, error: 'Колонка не найдена в файле' };
    if (used.has(n)) return { mapping: null, error: 'Одна колонка выбрана для двух полей' };
    used.add(n);
    out[f] = n;
  }
  if (out.product == null) return { mapping: null, error: 'Выберите колонку с товаром' };
  if (out.amount == null && out.quantity == null) return { mapping: null, error: 'Выберите колонку с суммой или количеством' };
  return { mapping: out, error: null };
}

/** День продажи из ячейки: дата Excel числом, «19.10.2026», «2026-10-19». */
export function entryDay(v: unknown): string | null {
  if (typeof v === 'number') return excelSerialDate(v);
  const s = cellText(v);
  if (!s) return null;
  if (isIsoDay(s)) return s;
  return parseLooseDate(s)?.day ?? null;
}

/** Строки таблицы → продажи. Пустые строки пропускаем, ошибки — с номером строки файла. */
export function entriesFromRows(rows: readonly unknown[][], mapping: EntryMapping, today: string, lines: readonly number[] = []): { entries: SaleEntryInput[]; errors: { row: number; message: string }[] } {
  const entries: SaleEntryInput[] = [];
  const errors: { row: number; message: string }[] = [];
  const at = (r: readonly unknown[], f: keyof EntryMapping) => (mapping[f] == null ? undefined : r[mapping[f]!]);
  rows.slice(0, SALES_LIMITS.importRows).forEach((r, i) => {
    const line = lines[i] ?? i + 2;
    if (!r.some((c) => cellText(c) !== '')) return;
    const rawDay = at(r, 'sold_on');
    let soldOn: string | undefined;
    if (rawDay !== undefined && cellText(rawDay) !== '') {
      const d = entryDay(rawDay);
      if (!d) {
        errors.push({ row: line, message: `Не понятна дата «${cellText(rawDay)}»` });
        return;
      }
      soldOn = d;
    }
    const num = (v: unknown) => (v === undefined || cellText(v) === '' ? undefined : (cellNumber(v) ?? NaN));
    const { entry, errors: e } = validateSaleEntry(
      { product: cellText(at(r, 'product')), client: cellText(at(r, 'client')), quantity: num(at(r, 'quantity')), amount: num(at(r, 'amount')), sold_on: soldOn, note: cellText(at(r, 'note')) },
      today,
    );
    if (entry) entries.push(entry);
    else errors.push({ row: line, message: Object.values(e)[0] ?? 'Ошибка в строке' });
  });
  if (rows.length > SALES_LIMITS.importRows) errors.push({ row: lines[SALES_LIMITS.importRows] ?? SALES_LIMITS.importRows + 2, message: `Загружаем не больше ${SALES_LIMITS.importRows} строк за раз` });
  return { entries, errors };
}
