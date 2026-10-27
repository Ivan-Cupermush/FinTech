import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { formatBytes, formatDate, noteTitle, parseMarkdown, type Inline } from '@offix/core';

/**
 * Личная заметка в PDF: шапка в цветах offix, дата и автор, заголовок и
 * текст с разметкой (заголовки, списки, чек-листы, цитаты, код), список
 * вложений. Встроенные шрифты PDF не знают кириллицы — встраиваем Onest.
 */

function fontsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Исходники: src/services → ../../assets; сборка: dist/index.js → ./assets.
  for (const d of [join(here, '..', '..', 'assets', 'fonts'), join(here, 'assets', 'fonts'), join(here, '..', 'assets', 'fonts')]) if (existsSync(join(d, 'Onest_400Regular.ttf'))) return d;
  throw new Error('Не найден шрифт для PDF (server/assets/fonts)');
}

export interface NoteForPdf {
  title: string;
  body: string;
  note_date: string;
  author: string;
  company: string | null;
  files: { name: string; size: number }[];
  /** Дата выгрузки — «сегодня» для подписи даты без года. */
  today: string;
}

const INK = '#141625';
const INK_3 = '#6b6f85';
const ACCENT = '#3050ff';
const LINE = '#e6e8f2';

export function renderNotePdf(note: NoteForPdf): Promise<Buffer> {
  const fonts = fontsDir();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 64, bottom: 64, left: 60, right: 60 }, info: { Title: noteTitle(note.title), Author: note.author, Creator: 'offix' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('regular', join(fonts, 'Onest_400Regular.ttf'));
    doc.registerFont('bold', join(fonts, 'Onest_600SemiBold.ttf'));

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // Фирменная полоса сверху: синий к фиолетовому, как градиент на сайте.
    const grad = doc.linearGradient(0, 0, doc.page.width, 0);
    grad.stop(0, '#2f4bff').stop(1, '#7a6bff');
    doc.rect(0, 0, doc.page.width, 8).fill(grad);

    const meta = [formatDate(note.note_date, { today: note.today }), note.author, note.company].filter(Boolean).join('  ·  ');
    doc.font('regular').fontSize(10).fillColor(INK_3).text(meta, left, 52, { width });
    doc.moveDown(0.8);
    doc.font('bold').fontSize(24).fillColor(INK).text(noteTitle(note.title), { width, lineGap: 2 });
    doc.moveDown(0.5);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1).strokeColor(LINE).stroke();
    doc.moveDown(1);

    const inline = (parts: Inline[], size: number, opts: { color?: string; indent?: number } = {}) => {
      const color = opts.color ?? INK;
      const x = left + (opts.indent ?? 0);
      const w = width - (opts.indent ?? 0);
      if (!parts.length) return;
      parts.forEach((p, i) => {
        const last = i === parts.length - 1;
        const font = p.kind === 'bold' ? 'bold' : 'regular';
        doc.font(font).fontSize(size).fillColor(p.kind === 'link' ? ACCENT : p.kind === 'code' ? '#3a3f5c' : color);
        const o: PDFKit.Mixins.TextOptions = { continued: !last, lineGap: 4, width: w, oblique: p.kind === 'italic' ? 10 : false, underline: p.kind === 'link', ...(p.kind === 'link' ? { link: p.href } : {}) };
        if (i === 0) doc.text(p.text, x, doc.y, o);
        else doc.text(p.text, o);
      });
    };

    for (const b of parseMarkdown(note.body)) {
      switch (b.kind) {
        case 'heading':
          doc.moveDown(0.4);
          inline(b.inline, b.level === 1 ? 18 : b.level === 2 ? 15 : 13);
          doc.moveDown(0.3);
          break;
        case 'paragraph':
          inline(b.inline, 12);
          doc.moveDown(0.6);
          break;
        case 'quote': {
          const top = doc.y;
          inline(b.inline, 12, { color: INK_3, indent: 14 });
          doc.rect(left, top, 3, doc.y - top).fill(ACCENT);
          doc.moveDown(0.6);
          break;
        }
        case 'list':
          b.items.forEach((it, i) => {
            const y = doc.y;
            doc.font('regular').fontSize(12).fillColor(INK_3).text(b.ordered ? `${i + 1}.` : '•', left + 4, y, { width: 18 });
            doc.y = y;
            inline(it, 12, { indent: 22 });
            doc.moveDown(0.15);
          });
          doc.moveDown(0.45);
          break;
        case 'checklist':
          b.items.forEach((it) => {
            const y = doc.y;
            doc.roundedRect(left + 2, y + 2, 11, 11, 3).lineWidth(1.2).strokeColor(it.done ? ACCENT : '#b8bccf').stroke();
            if (it.done) doc.moveTo(left + 4.5, y + 7.5).lineTo(left + 7, y + 10).lineTo(left + 11, y + 4.5).lineWidth(1.6).strokeColor(ACCENT).stroke();
            doc.y = y;
            inline(it.inline, 12, { indent: 22, color: it.done ? INK_3 : INK });
            doc.moveDown(0.15);
          });
          doc.moveDown(0.45);
          break;
        case 'code': {
          const top = doc.y;
          doc.font('regular').fontSize(10.5);
          const h = doc.heightOfString(b.text, { width: width - 24 }) + 16;
          doc.roundedRect(left, top, width, h, 8).fill('#f3f4fa');
          doc.fillColor('#3a3f5c').text(b.text, left + 12, top + 8, { width: width - 24 });
          doc.y = top + h;
          doc.moveDown(0.6);
          break;
        }
        case 'rule':
          doc.moveTo(left, doc.y + 4).lineTo(left + width, doc.y + 4).lineWidth(1).strokeColor(LINE).stroke();
          doc.moveDown(1);
          break;
      }
    }

    if (note.files.length) {
      doc.moveDown(0.8);
      doc.font('bold').fontSize(12).fillColor(INK).text('Вложения', left, doc.y, { width });
      doc.moveDown(0.3);
      for (const f of note.files) doc.font('regular').fontSize(11).fillColor(INK_3).text(`— ${f.name} · ${formatBytes(f.size)}`, { width });
    }

    // Подпись внизу каждой страницы.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Подпись — в поле страницы: без этого pdfkit решит, что места нет, и начнёт новую.
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('regular').fontSize(9).fillColor('#a0a4b8').text(`offix · личная заметка · ${i + 1} из ${range.count}`, left, doc.page.height - 40, { width, align: 'right', lineBreak: false });
      doc.page.margins.bottom = keep;
    }
    doc.end();
  });
}
