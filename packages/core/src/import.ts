import { checkUnitRange, type UnitId } from './units';

/**
 * Импорт замеров KPI из таблиц: вставка из Excel или Google Таблиц, CSV.
 *
 * Правило: за один день у KPI — один импортированный замер. День считаем по
 * Москве, поэтому повторный импорт того же файла ничего не задваивает.
 */

/** Сколько замеров принимаем за один импорт. */
export const IMPORT_MAX_ROWS = 500;

/** Москва — UTC+3 круглый год. */
const MOSCOW_OFFSET_MS = 3 * 3_600_000;
/** Допуск на расхождение часов клиента и сервера. */
const FUTURE_TOLERANCE_MS = 60_000;

/**
 * Число из ячейки: «1 200,5», «36.5», «−3», «12 %», «1.200,5», «1,200.5».
 * Одна запятая — десятичная (так пишут по-русски). Мусор → null.
 */
export function parseLooseNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw)
    .trim()
    .replace(/[\s   ']/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/%$/, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Последний из разделителей — десятичный, второй — разряды.
    const [thousands, decimal] = lastComma > lastDot ? ['.', ','] : [',', '.'];
    const [int, frac, ...rest] = s.split(decimal);
    if (rest.length || frac === undefined || !isGrouped(int!, thousands)) return null;
    s = `${int!.split(thousands).join('')}.${frac}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (!isGrouped(s, sep)) return null;
      s = parts.join('');
    } else {
      s = parts.join('.');
    }
  }
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** «1.200.000» или «-1,200»: группы по три цифры после первой. */
function isGrouped(int: string, sep: string): boolean {
  const re = sep === '.' ? /^[+-]?\d{1,3}(\.\d{3})+$/ : /^[+-]?\d{1,3}(,\d{3})+$/;
  return !int.includes(sep) || re.test(int);
}

export interface LooseDate {
  /** Календарный день по Москве, YYYY-MM-DD. */
  day: string;
  /** Момент замера, ISO в UTC. */
  at: string;
  /** Было ли в ячейке время. Без времени ставим полдень по Москве. */
  timeGiven: boolean;
}

/** Календарный день замера по Москве. */
export function observationDay(at: string | Date): string {
  const t = typeof at === 'string' ? Date.parse(at) : at.getTime();
  return new Date(t + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const RU_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:[\sT,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Дата из ячейки: «19.10.2026», «19.10.26», «19/10/2026», «2026-10-19»,
 * с временем «19.10.2026 10:30», ISO с Z или смещением. Время без зоны —
 * московское, без времени — полдень по Москве. Невозможная дата → null.
 */
export function parseLooseDate(raw: string | null | undefined): LooseDate | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let y: number, mo: number, d: number, h: string | undefined, mi: string | undefined, sec: string | undefined, zone: string | undefined;
  const iso = ISO_RE.exec(s);
  const ru = iso ? null : RU_RE.exec(s);
  if (iso) {
    [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    [h, mi, sec, zone] = [iso[4], iso[5], iso[6], iso[7]];
  } else if (ru) {
    [d, mo] = [Number(ru[1]), Number(ru[2])];
    y = ru[3]!.length === 2 ? 2000 + Number(ru[3]) : Number(ru[3]);
    [h, mi, sec] = [ru[4], ru[5], ru[6]];
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2999) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const timeGiven = h !== undefined;
  const hh = timeGiven ? Number(h) : 12;
  const mm = timeGiven ? Number(mi) : 0;
  const ss = sec ? Number(sec) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;

  let t: number;
  if (zone) {
    const offsetMin = zone.toUpperCase() === 'Z' ? 0 : zoneMinutes(zone);
    t = Date.UTC(y, mo - 1, d, hh, mm, ss) - offsetMin * 60_000;
  } else {
    t = Date.UTC(y, mo - 1, d, hh, mm, ss) - MOSCOW_OFFSET_MS;
  }
  const at = new Date(t).toISOString();
  return { day: observationDay(at), at, timeGiven };
}

function zoneMinutes(zone: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -v : v;
}

export type Separator = '\t' | ';' | ',';

/**
 * Разделитель колонок: таб (вставка из Excel и Google Таблиц), затем «;»
 * (русский Excel сохраняет CSV так), и только потом запятая — в русских
 * числах она десятичная.
 */
export function detectSeparator(text: string): Separator {
  const sample = stripBom(text).split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 20);
  if (sample.some((l) => l.includes('\t'))) return '\t';
  if (sample.some((l) => l.includes(';'))) return ';';
  return ',';
}

export interface ParsedTable {
  separator: Separator;
  /** Была ли первая строка шапкой. */
  hasHeader: boolean;
  /** Названия колонок: из шапки или «Колонка N». */
  columns: string[];
  /** Строки данных без шапки, все одной ширины. */
  rows: string[][];
  /** Номер строки в исходном тексте (с 1) для каждой строки данных. */
  lines: number[];
  /** Колонки, где в основном даты. */
  dateColumns: number[];
  /** Колонки, где в основном числа (без колонок дат). */
  numberColumns: number[];
  /** Предлагаемые колонки даты и значения, null — не нашли. */
  dateCol: number | null;
  valueCol: number | null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** CSV по RFC 4180: кавычки, удвоенные кавычки, переводы строк внутри кавычек. */
function splitRecords(text: string, sep: Separator): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  const push = () => {
    cells.push(cell);
    out.push({ cells, line: recordLine });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === sep) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      push();
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length) push();
  return out;
}

const isFilled = (c: string) => c.trim() !== '';

/** Разбор вставленного текста или CSV-файла в таблицу с догадкой о колонках. */
export function parseTable(text: string): ParsedTable {
  const clean = stripBom(text);
  const separator = detectSeparator(clean);
  const records = splitRecords(clean, separator)
    .map((r) => ({ ...r, cells: r.cells.map((c) => c.trim()) }))
    .filter((r) => r.cells.some(isFilled));
  const width = records.reduce((w, r) => Math.max(w, r.cells.length), 0);
  for (const r of records) while (r.cells.length < width) r.cells.push('');

  const first = records[0]?.cells ?? [];
  const hasHeader =
    records.length > 0 && first.some(isFilled) && !first.some((c) => parseLooseDate(c) !== null || parseLooseNumber(c) !== null);
  const data = hasHeader ? records.slice(1) : records;
  const columns = Array.from({ length: width }, (_, i) => (hasHeader && first[i] ? first[i]! : `Колонка ${i + 1}`));

  const share = (col: number, test: (c: string) => boolean) => {
    const filled = data.map((r) => r.cells[col]!).filter(isFilled);
    return filled.length ? filled.filter(test).length / filled.length : 0;
  };
  const dateColumns: number[] = [];
  const numberColumns: number[] = [];
  for (let i = 0; i < width; i++) {
    if (share(i, (c) => parseLooseDate(c) !== null) >= 0.5) dateColumns.push(i);
    else if (share(i, (c) => parseLooseNumber(c) !== null) >= 0.5) numberColumns.push(i);
  }
  return {
    separator,
    hasHeader,
    columns,
    rows: data.map((r) => r.cells),
    lines: data.map((r) => r.line),
    dateColumns,
    numberColumns,
    dateCol: dateColumns[0] ?? null,
    valueCol: numberColumns[0] ?? null,
  };
}

export type ImportRowStatus = 'ok' | 'duplicate' | 'error';

export interface ImportRow {
  /** Номер строки в исходном тексте. */
  line: number;
  rawDate: string;
  rawValue: string;
  status: ImportRowStatus;
  /** Почему строка не добавится. Для ok — не задана. */
  reason?: string;
  day?: string;
  at?: string;
  value?: number;
}

export interface ImportPlan {
  rows: ImportRow[];
  counts: Record<ImportRowStatus, number>;
  /** Самый поздний добавляемый замер. */
  latest: { day: string; at: string; value: number } | null;
  /** Что отправить на сервер: только строки со статусом ok. */
  observations: { observed_at: string; value: number }[];
}

export interface ImportOptions {
  unit: UnitId;
  now: Date;
  /** Дни (по Москве), за которые у KPI уже есть замеры. */
  existingDays?: Iterable<string>;
}

/**
 * План импорта: что добавится, что уже есть и что не так с остальными
 * строками. Ничего не отбрасываем молча — у каждой строки есть статус.
 */
export function planImport(table: Pick<ParsedTable, 'rows' | 'lines'>, dateCol: number, valueCol: number, opts: ImportOptions): ImportPlan {
  const existing = new Set(opts.existingDays ?? []);
  const nowMs = opts.now.getTime();
  const today = observationDay(opts.now);
  const seen = new Map<string, { line: number; value: number }>();
  const rows: ImportRow[] = [];
  let okCount = 0;

  table.rows.forEach((cells, i) => {
    const rawDate = (cells[dateCol] ?? '').trim();
    const rawValue = (cells[valueCol] ?? '').trim();
    if (!rawDate && !rawValue) return;
    const row: ImportRow = { line: table.lines[i] ?? i + 1, rawDate, rawValue, status: 'error' };
    rows.push(row);
    const date = parseLooseDate(rawDate);
    const value = parseLooseNumber(rawValue);
    if (!rawDate) return void (row.reason = 'Нет даты');
    if (!date) return void (row.reason = `Не похоже на дату: «${rawDate}»`);
    if (!rawValue) return void (row.reason = 'Нет значения');
    if (value === null) return void (row.reason = `Не число: «${rawValue}»`);
    // Дата без времени за сегодня — замер «сейчас», а не в будущий полдень.
    const at = !date.timeGiven && date.day === today && Date.parse(date.at) > nowMs ? opts.now.toISOString() : date.at;
    Object.assign(row, { day: date.day, at, value });
    if (date.day > today || Date.parse(at) > nowMs + FUTURE_TOLERANCE_MS) return void (row.reason = 'Дата из будущего');
    const range = checkUnitRange(opts.unit, value);
    if (range) return void (row.reason = range);
    if (existing.has(date.day)) {
      row.status = 'duplicate';
      row.reason = 'За этот день замер уже есть';
      return;
    }
    const prev = seen.get(date.day);
    if (prev) {
      if (prev.value === value) {
        row.status = 'duplicate';
        row.reason = `Повтор строки ${prev.line}`;
      } else {
        row.reason = `День повторяется в файле (строка ${prev.line}) — за день один замер`;
      }
      return;
    }
    if (okCount >= IMPORT_MAX_ROWS) {
      row.reason = `За раз — не больше ${IMPORT_MAX_ROWS} замеров. Импортируйте файл ещё раз, добавленные не повторятся`;
      return;
    }
    seen.set(date.day, { line: row.line, value });
    row.status = 'ok';
    okCount++;
  });

  const counts = { ok: 0, duplicate: 0, error: 0 };
  let latest: ImportPlan['latest'] = null;
  const observations: ImportPlan['observations'] = [];
  for (const r of rows) {
    counts[r.status]++;
    if (r.status !== 'ok') continue;
    observations.push({ observed_at: r.at!, value: r.value! });
    if (!latest || r.at! > latest.at) latest = { day: r.day!, at: r.at!, value: r.value! };
  }
  return { rows, counts, latest, observations };
}

/** Шаблон для Excel: BOM, чтобы кириллица открылась, и «;» как в русском Excel. */
export function importTemplate(unitShort: string): string {
  return `﻿Дата;Значение (${unitShort})\r\n01.10.2026;40\r\n08.10.2026;38,5\r\n15.10.2026;36\r\n`;
}
