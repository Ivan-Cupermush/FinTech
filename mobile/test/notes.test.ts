import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@offix/core';
import { listMarker, noteMeta, notesEmpty, notesLine, notesQuery } from '../src/lib/notes';

const TODAY = '2026-10-21';

describe('notesQuery', () => {
  it('как на сайте: поиск, заметки цели и только общие', () => {
    expect(notesQuery({})).toBe('');
    expect(notesQuery({ q: '  регламент ' })).toBe('q=%D1%80%D0%B5%D0%B3%D0%BB%D0%B0%D0%BC%D0%B5%D0%BD%D1%82');
    expect(notesQuery({ goalId: 'g1' })).toBe('goal_id=g1');
    expect(notesQuery({ scope: 'company' })).toBe('scope=company');
  });
  it('у цели «только общие» не имеет смысла — фильтр по цели главнее', () => {
    expect(notesQuery({ goalId: 'g1', scope: 'company' })).toBe('goal_id=g1');
  });
  it('пустой поиск не уходит на сервер', () => {
    expect(notesQuery({ q: '   ' })).toBe('');
  });
});

describe('noteMeta', () => {
  const n = { goal_title: 'Заявки за 30 минут', author_name: 'Ольга Смирнова', updated_at: '2026-10-21T09:00:00Z' };
  it('цель, автор и дата правки', () => {
    expect(noteMeta(n, TODAY)).toMatch(/^Заявки за 30 минут · Ольга Смирнова · /);
  });
  it('в заметках одной цели её название не повторяем', () => {
    expect(noteMeta(n, TODAY, false)).not.toContain('Заявки');
    expect(noteMeta({ ...n, goal_title: null }, TODAY)).toMatch(/^Ольга Смирнова · /);
  });
});

describe('notesEmpty и notesLine', () => {
  it('пустой список объясняет, почему пусто', () => {
    expect(notesEmpty({ q: 'kpi' }).title).toBe('Ничего не нашлось');
    expect(notesEmpty({ goalId: 'g1' }).title).toBe('У цели пока нет заметок');
    expect(notesEmpty({}).title).toBe('База знаний пуста');
  });
  it('строка на экране цели считает заметки по-русски', () => {
    expect(notesLine(undefined)).toBe('Договорённости и решения по цели');
    expect(notesLine(0)).toMatch(/Пока нет/);
    expect(notesLine(1)).toBe('1 заметка');
    expect(notesLine(3)).toBe('3 заметки');
    expect(notesLine(5)).toBe('5 заметок');
  });
});

describe('разметка заметки в приложении', () => {
  it('маркеры списков', () => {
    expect(listMarker(true, 0)).toBe('1.');
    expect(listMarker(true, 9)).toBe('10.');
    expect(listMarker(false, 3)).toBe('•');
  });
  it('приложение получает из ядра те же блоки, что и сайт', () => {
    const kinds = parseMarkdown('# Регламент\n\nТекст **важно**\n\n- раз\n- два\n\n1. первый\n\n- [x] сделано\n- [ ] нет\n\n> цитата\n\n```\nкод\n```\n\n---').map((b) => b.kind);
    expect(kinds).toEqual(['heading', 'paragraph', 'list', 'list', 'checklist', 'quote', 'code', 'rule']);
  });
  it('опасные ссылки не становятся ссылками', () => {
    const [b] = parseMarkdown('[жми](javascript:alert(1))');
    expect(b!.kind).toBe('paragraph');
    expect(b!.kind === 'paragraph' && b!.inline.some((i) => i.kind === 'link')).toBe(false);
  });
});
