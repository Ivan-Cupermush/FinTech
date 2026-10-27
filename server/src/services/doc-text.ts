import { unzipSync } from 'fflate';
import type { KnowledgeDocType } from '@offix/core';

/** Текст документа длиннее — обрезаем: базе знаний хватит, а сервер не захлебнётся. */
export const DOC_TEXT_MAX_CHARS = 2_000_000;
/** DOCX — это zip; распакованный текст больше — подозрительно (zip-бомба). */
const DOCX_XML_MAX_BYTES = 60 * 1024 * 1024;

/** Ошибка, которую можно показать руководителю как есть. */
export class DocTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocTextError';
  }
}

export interface ExtractedText {
  text: string;
  pages: number | null;
}

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

/**
 * Текст из word/document.xml: абзацы — с новой строки, табуляции и переносы
 * сохраняем, служебное (поля, стили) пропускаем.
 */
export function docxXmlToText(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g)) {
    const tag = m[0];
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (tag.startsWith('<w:tab')) out += '\t';
    else out += '\n';
  }
  return out;
}

function docxText(buf: Uint8Array): ExtractedText {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, { filter: (f) => f.name === 'word/document.xml' && f.originalSize <= DOCX_XML_MAX_BYTES });
  } catch {
    throw new DocTextError('Не получилось прочитать DOCX — файл повреждён. Сохраните его в Word заново и загрузите ещё раз');
  }
  const xml = files['word/document.xml'];
  if (!xml) throw new DocTextError('Это не документ Word (DOCX) или он слишком большой');
  return { text: docxXmlToText(new TextDecoder().decode(xml)), pages: null };
}

/** Текстовый файл: UTF-8, а если не похоже — Windows-1251 (старые файлы из Блокнота). */
export function plainText(buf: Uint8Array): ExtractedText {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1251').decode(buf);
  }
  return { text: text.replace(/^﻿/, ''), pages: null };
}

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

async function pdfText(buf: Uint8Array): Promise<ExtractedText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Только текст: шрифты не подключаем, XFA-формы и скрипты из файла не исполняются.
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0 });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const name = (e as { name?: string } | null)?.name;
    if (name === 'PasswordException') throw new DocTextError('PDF защищён паролем — снимите защиту и загрузите ещё раз');
    throw new DocTextError('Не получилось прочитать PDF — файл повреждён');
  }
  try {
    const pages: string[] = [];
    let total = 0;
    for (let p = 1; p <= doc.numPages && total < DOC_TEXT_MAX_CHARS; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let s = '';
      for (const it of content.items as PdfTextItem[]) {
        if (typeof it.str === 'string') s += it.str;
        if (it.hasEOL) s += '\n';
      }
      pages.push(s);
      total += s.length;
      page.cleanup();
    }
    return { text: pages.join('\n\n'), pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

/**
 * Текст документа базы знаний. Пустой результат — тоже ошибка: скорее всего,
 * это скан без текстового слоя, и искать в нём нечего.
 */
export async function extractDocText(buf: Uint8Array, type: KnowledgeDocType): Promise<ExtractedText> {
  const r = type === 'pdf' ? await pdfText(buf) : type === 'docx' ? docxText(buf) : plainText(buf);
  const text = r.text.length > DOC_TEXT_MAX_CHARS ? r.text.slice(0, DOC_TEXT_MAX_CHARS) : r.text;
  if (!text.replace(/\s+/g, '')) {
    throw new DocTextError(
      type === 'pdf' ? 'В PDF не нашлось текста — похоже, это скан. Загрузите версию с текстом (например, PDF, сохранённый из Word)' : 'В документе нет текста',
    );
  }
  return { text, pages: r.pages };
}
