import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { DocTextError, docxXmlToText, extractDocText, plainText } from '../src/services/doc-text';
import { makeDocx, makePdf } from './kb-fixtures';

describe('текст документов базы знаний', () => {
  it('DOCX: абзацы с новой строки, сущности XML раскодированы', async () => {
    const r = await extractDocText(makeDocx(['Регламент приёмки заявок', 'Срок ответа — 2 дня & не больше', 'Подпись: «Директор»']), 'docx');
    expect(r.pages).toBeNull();
    expect(r.text.split('\n').filter(Boolean)).toEqual(['Регламент приёмки заявок', 'Срок ответа — 2 дня & не больше', 'Подпись: «Директор»']);
  });

  it('DOCX: табуляции, переносы и служебные теги', () => {
    const xml = '<w:p><w:r><w:t>Шаг</w:t><w:tab/><w:t>1</w:t><w:br/><w:t>Дальше &#1071;&#x44F;</w:t></w:r><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>';
    expect(docxXmlToText(xml)).toBe('Шаг\t1\nДальше Яя\n');
  });

  it('битый DOCX — понятная ошибка', async () => {
    await expect(extractDocText(new Uint8Array([1, 2, 3, 4]), 'docx')).rejects.toThrow(DocTextError);
    await expect(extractDocText(zipSync({ 'a.txt': strToU8('x') }), 'docx')).rejects.toThrow(/не документ Word/);
  });

  it('PDF с кириллицей: текст и число страниц', async () => {
    const pdf = await makePdf('Регламент закупок', 'Закупку до 100 000 рублей согласует руководитель отдела.\n\nКрупнее — финансовый директор.');
    const r = await extractDocText(pdf, 'pdf');
    expect(r.pages).toBe(1);
    expect(r.text).toContain('Регламент закупок');
    expect(r.text.replace(/\s+/g, ' ')).toContain('согласует руководитель отдела');
  });

  it('битый PDF — понятная ошибка', async () => {
    await expect(extractDocText(Buffer.from('%PDF-1.4 это не pdf'), 'pdf')).rejects.toThrow(/PDF/);
  });

  it('текст: UTF-8 с BOM и старый Windows-1251', () => {
    expect(plainText(new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('Привет')])).text).toBe('Привет');
    // «Привет» в Windows-1251.
    expect(plainText(new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])).text).toBe('Привет');
  });

  it('пустой документ — ошибка, а не пустая база', async () => {
    await expect(extractDocText(Buffer.from('   \n\n  '), 'text')).rejects.toThrow('В документе нет текста');
  });
});
