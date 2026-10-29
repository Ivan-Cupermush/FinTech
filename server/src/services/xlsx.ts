import { strToU8, unzipSync, zipSync } from 'fflate';
import { SalesFileError, type SheetData } from '@offix/core';

/**
 * Таблицы Excel (.xlsx) без сторонних библиотек: .xlsx — это zip с XML.
 * Читаем ячейки (числа, строки, логические), уровни группировки строк (их
 * сохраняет 1С — по ним видна вложенность групп товаров) и названия листов.
 * Формулы не вычисляем: берём сохранённое значение. Старый .xls (двоичный
 * формат) не читаем — просим сохранить как .xlsx.
 */

/** Распакованная часть больше — подозрительно (zip-бомба). */
const PART_MAX_BYTES = 80 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_COLS = 200;

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return XML_ENTITIES[e.toLowerCase()] ?? whole;
  });
}

const escapeXml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = decodeXml(m[2]!);
  return out;
}

/** «AB12» → 27 (с нуля). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const columnName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : columnName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/** Текст из <si> или <is>: все <t>, кроме фонетических подсказок <rPh>. */
function richText(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => decodeXml(m[1] ?? '')).join('');
}

function sheetRows(xml: string, shared: readonly string[]): { rows: unknown[][]; levels: number[] } {
  const rows: unknown[][] = [];
  const levels: number[] = [];
  for (const m of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const a = attrs(m[1]!);
    const index = a.r ? Number(a.r) - 1 : rows.length;
    if (!Number.isInteger(index) || index < 0 || index >= MAX_ROWS) continue;
    while (rows.length < index) {
      rows.push([]);
      levels.push(0);
    }
    const row: unknown[] = [];
    for (const c of (m[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(c[1]!);
      const col = ca.r ? columnIndex(ca.r) : row.length;
      if (col < 0 || col >= MAX_COLS) continue;
      const body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: unknown = '';
      switch (ca.t) {
        case 's':
          value = v !== undefined ? (shared[Number(v)] ?? '') : '';
          break;
        case 'inlineStr':
          value = richText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
          break;
        case 'str':
        case 'd':
          value = v !== undefined ? decodeXml(v) : '';
          break;
        case 'b':
          value = v === '1';
          break;
        case 'e':
          value = '';
          break;
        default:
          if (v !== undefined && v.trim() !== '') {
            const n = Number(v);
            value = Number.isFinite(n) ? n : decodeXml(v);
          }
      }
      while (row.length < col) row.push('');
      row[col] = value;
    }
    if (rows.length === index) {
      rows.push(row);
      levels.push(Number(a.outlineLevel) || 0);
    } else {
      rows[index] = row;
      levels[index] = Number(a.outlineLevel) || 0;
    }
  }
  return { rows, levels };
}

/** Похоже на старый .xls (OLE2) — его не читаем. */
const isLegacyXls = (b: Uint8Array) => b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

export function readXlsx(buf: Uint8Array): SheetData[] {
  if (isLegacyXls(buf)) throw new SalesFileError('Файл в старом формате .xls. Откройте его в Excel и сохраните как «Книга Excel (.xlsx)», затем загрузите ещё раз');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, { filter: (f) => ((f.name.startsWith('xl/') && f.name.endsWith('.xml')) || f.name.endsWith('.rels')) && f.originalSize <= PART_MAX_BYTES });
  } catch {
    throw new SalesFileError('Не удалось прочитать файл. Сохраните таблицу в Excel как .xlsx и загрузите ещё раз');
  }
  const text = (name: string) => (files[name] ? new TextDecoder().decode(files[name]) : null);
  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new SalesFileError('Это не таблица Excel (.xlsx) или она слишком большая');
  const rels = new Map<string, string>();
  for (const m of (text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]!);
    if (a.Id && a.Target) rels.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target.replace(/^\.\//, '')}`);
  }
  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => richText(m[1] ?? ''));
  const sheets: SheetData[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]!);
    const target = rels.get(a['r:id'] ?? '') ?? null;
    const xml = target ? text(target) : null;
    if (!xml) continue;
    sheets.push({ name: a.name ?? `Лист ${sheets.length + 1}`, ...sheetRows(xml, shared) });
  }
  if (!sheets.length) throw new SalesFileError('В файле нет листов с данными');
  return sheets;
}

export interface SheetToWrite {
  name: string;
  rows: unknown[][];
  /** Уровни группировки строк, как в выгрузке 1С. */
  levels?: number[];
  /** Ширина колонок в символах. */
  widths?: number[];
}

/**
 * Простая книга .xlsx: строки — текстом, числа — числами, уровни группировки.
 * Для шаблонов загрузки, демо-файлов и тестов.
 */
export function writeXlsx(sheets: readonly SheetToWrite[]): Uint8Array {
  const sheetXml = (s: SheetToWrite) => {
    const rows = s.rows
      .map((row, i) => {
        const level = s.levels?.[i] ?? 0;
        const cells = row
          .map((v, c) => {
            const ref = `${columnName(c)}${i + 1}`;
            if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
            if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
            const str = v === null || v === undefined ? '' : String(v);
            return str === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(str)}</t></is></c>`;
          })
          .join('');
        return `<row r="${i + 1}"${level ? ` outlineLevel="${level}"` : ''}>${cells}</row>`;
      })
      .join('');
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${escapeXml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
    ),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files, { level: 6 });
}
