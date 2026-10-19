import { describe, expect, it } from 'vitest';
import { noteExcerpt, parseInline, parseMarkdown, plainText, safeHref, searchWords, validateNote } from '../src';

const FENCE = '`'.repeat(3);

describe('заметка', () => {
  it('заголовок обязателен, длина ограничена', () => {
    expect(validateNote({ title: ' ', body: '' })).toEqual({ title: 'Введите заголовок' });
    expect(validateNote({ title: 'x'.repeat(201) }).title).toMatch(/не длиннее/);
    expect(validateNote({ title: 'Регламент', body: 'x'.repeat(50_001) }).body).toBe('Заметка слишком длинная');
    expect(validateNote({ title: 'Регламент', body: 'Текст' })).toEqual({});
  });
});

describe('разметка', () => {
  it('заголовки, абзацы, списки, чек-лист, цитата, код, линия', () => {
    const md = ['# Регламент', '', 'Первый абзац', 'продолжается.', '', '- раз', '- два', '', '1. первое', '2. второе', '', '- [x] сделано', '- [ ] нет', '', '> важно', '', FENCE, 'SELECT 1;', FENCE, '', '---'].join('\n');
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'checklist', 'quote', 'code', 'rule']);
    expect(blocks[1]).toEqual({ kind: 'paragraph', inline: [{ kind: 'text', text: 'Первый абзац продолжается.' }] });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[4]).toMatchObject({ items: [{ done: true }, { done: false }] });
    expect(blocks[6]).toEqual({ kind: 'code', text: 'SELECT 1;' });
  });

  it('чек-лист сразу после списка — отдельный блок', () => {
    expect(parseMarkdown(['- раз', '- [x] готово'].join('\n')).map((b) => b.kind)).toEqual(['list', 'checklist']);
  });

  it('внутри строки: жирный, курсив, код, ссылка', () => {
    expect(parseInline('**Срок** — *5 дней*, `код` и [СЭД](https://sed.example)')).toEqual([
      { kind: 'bold', text: 'Срок' },
      { kind: 'text', text: ' — ' },
      { kind: 'italic', text: '5 дней' },
      { kind: 'text', text: ', ' },
      { kind: 'code', text: 'код' },
      { kind: 'text', text: ' и ' },
      { kind: 'link', text: 'СЭД', href: 'https://sed.example' },
    ]);
  });

  it('опасные ссылки остаются текстом, HTML — просто текст', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('mailto:a@b.ru')).toBe('mailto:a@b.ru');
    expect(parseInline('[жми](javascript:x)')).toEqual([{ kind: 'text', text: 'жми' }]);
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([{ kind: 'paragraph', inline: [{ kind: 'text', text: '<script>alert(1)</script>' }] }]);
  });

  it('текст без разметки и отрывок вокруг найденного', () => {
    expect(plainText('# Заголовок\n\n**Жирный** текст')).toBe('Заголовок Жирный текст');
    const long = `${'вступление '.repeat(30)}главное: срок согласования пять дней ${'хвост '.repeat(30)}`;
    const ex = noteExcerpt(long, 'срок согласования', 60);
    expect(ex).toContain('срок согласования');
    expect(ex.startsWith('…')).toBe(true);
    expect(noteExcerpt('коротко')).toBe('коротко');
  });

  it('слова поиска без спецсимволов LIKE', () => {
    expect(searchWords('  Срок 100% _договор ')).toEqual(['срок', '100', 'договор']);
  });
});
