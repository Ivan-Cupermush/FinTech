import { describe, expect, it } from 'vitest';
import {
  buildThread,
  commentPreview,
  extractMentions,
  insertMention,
  isDiscussionEntity,
  mentionQuery,
  mentionSuggestions,
  splitMentions,
  unreadCount,
  validateComment,
  type DiscussionComment,
} from '../src';

const people = [
  { id: 'anna', display_name: 'Анна Королёва' },
  { id: 'anna2', display_name: 'Анна' },
  { id: 'olga', display_name: 'Ольга Смирнова' },
  { id: 'dima', display_name: 'Дмитрий Орлов' },
];

const c = (id: string, at: string, over: Partial<DiscussionComment> = {}): DiscussionComment => ({
  id,
  parent_id: null,
  body: id,
  author_id: 'olga',
  author_name: 'Ольга Смирнова',
  mention_ids: [],
  created_at: at,
  attachments: [],
  ...over,
});

describe('комментарий', () => {
  it('пустой и слишком длинный — ошибка', () => {
    expect(validateComment('  ')).toBe('Напишите комментарий');
    expect(validateComment(undefined)).toBe('Напишите комментарий');
    expect(validateComment('x'.repeat(4001))).toMatch(/не длиннее/);
    expect(validateComment('Готово')).toBeNull();
  });
  it('обсуждать можно цель и задачу', () => {
    expect(isDiscussionEntity('goal')).toBe(true);
    expect(isDiscussionEntity('task')).toBe(true);
    expect(isDiscussionEntity('note')).toBe(false);
  });
  it('превью в одну строку с многоточием', () => {
    expect(commentPreview('Первая\n\nвторая   строка')).toBe('Первая вторая строка');
    expect(commentPreview('a'.repeat(300), 10)).toBe('aaaaaaaaa…');
  });
});

describe('упоминания', () => {
  it('находит людей по «@Имя Фамилия», без учёта регистра', () => {
    expect(extractMentions('@Ольга Смирнова, посмотрите. И @дмитрий орлов тоже', people)).toEqual(['olga', 'dima']);
  });
  it('длинное имя важнее короткого: «@Анна Королёва» — не «Анна»', () => {
    expect(extractMentions('@Анна Королёва', people)).toEqual(['anna']);
    expect(extractMentions('@Анна, привет', people)).toEqual(['anna2']);
  });
  it('часть слова и почта — не упоминание', () => {
    expect(extractMentions('@Анне передайте', people)).toEqual([]);
    expect(extractMentions('pochta@Анна', people)).toEqual([]);
  });
  it('повтор — один раз', () => {
    expect(extractMentions('@Ольга Смирнова и снова @Ольга Смирнова', people)).toEqual(['olga']);
  });
  it('куски для подсветки', () => {
    expect(splitMentions('Привет, @Ольга Смирнова! Готово', people)).toEqual([
      { text: 'Привет, ' },
      { text: '@Ольга Смирнова', mention: 'olga' },
      { text: '! Готово' },
    ]);
    expect(splitMentions('без упоминаний', people)).toEqual([{ text: 'без упоминаний' }]);
  });
});

describe('подсказка при наборе «@»', () => {
  it('ловит набранное после @ у курсора', () => {
    expect(mentionQuery('Спасибо, @Ол', 12)).toEqual({ query: 'Ол', start: 9 });
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 });
    expect(mentionQuery('Ольга Смирнова', 5)).toBeNull();
    expect(mentionQuery('mail@host', 9)).toBeNull();
    expect(mentionQuery('@Ольга Смирнова привет', 22)).toBeNull();
  });
  it('подставляет имя и ставит курсор после пробела', () => {
    expect(insertMention('Спасибо, @Ол', 12, 'Ольга Смирнова')).toEqual({ text: 'Спасибо, @Ольга Смирнова ', caret: 25 });
    expect(insertMention('@Дм посмотри', 3, 'Дмитрий Орлов')).toEqual({ text: '@Дмитрий Орлов посмотри', caret: 15 });
  });
  it('сотрудники по началу имени или фамилии, «ё» = «е»', () => {
    expect(mentionSuggestions(people, 'ор').map((p) => p.id)).toEqual(['dima']);
    expect(mentionSuggestions(people, 'королев').map((p) => p.id)).toEqual(['anna']);
    expect(mentionSuggestions(people, '', 2)).toHaveLength(2);
  });
});

describe('ветка', () => {
  it('ответы — под корнем одним уровнем, по времени', () => {
    const t = buildThread([
      c('b', '2026-10-19T10:00:00Z'),
      c('a', '2026-10-19T09:00:00Z'),
      c('a2', '2026-10-19T11:00:00Z', { parent_id: 'a' }),
      c('a1', '2026-10-19T10:30:00Z', { parent_id: 'a' }),
      c('a2x', '2026-10-19T12:00:00Z', { parent_id: 'a2' }),
    ]);
    expect(t.map((n) => n.comment.id)).toEqual(['a', 'b']);
    expect(t[0]!.replies.map((r) => r.id)).toEqual(['a1', 'a2', 'a2x']);
    expect(t[1]!.replies).toEqual([]);
  });
  it('ответ на удалённый комментарий становится корнем', () => {
    const t = buildThread([c('x', '2026-10-19T10:00:00Z', { parent_id: 'gone' })]);
    expect(t.map((n) => n.comment.id)).toEqual(['x']);
  });
  it('новые — только чужие после прочтения', () => {
    const list = [c('1', '2026-10-19T09:00:00Z'), c('2', '2026-10-19T11:00:00Z'), c('3', '2026-10-19T12:00:00Z', { author_id: 'me' })];
    expect(unreadCount(list, 'me', null)).toBe(2);
    expect(unreadCount(list, 'me', '2026-10-19T10:00:00Z')).toBe(1);
    expect(unreadCount(list, 'me', '2026-10-19T13:00:00Z')).toBe(0);
  });
});
