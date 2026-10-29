import { strToU8, zipSync } from 'fflate';
import { renderNotePdf } from '../src/services/note-pdf';

/** Минимальный DOCX: zip с word/document.xml — так его сохраняет Word. */
export function makeDocx(paragraphs: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) });
}

/** PDF с кириллицей — тем же генератором, что выгружает заметки. */
export async function makePdf(title: string, body: string): Promise<Buffer> {
  return renderNotePdf({ title, body, note_date: '2026-10-19', author: 'Ольга Смирнова', company: 'Демо', files: [], today: '2026-10-19' });
}
