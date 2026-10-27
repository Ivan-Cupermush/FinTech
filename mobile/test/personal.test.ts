import { describe, expect, it } from 'vitest';
import { inboxTarget, lastLoginText, myNotesEmpty, myNotesQuery, myNotesStats, requestOutcome, scanTarget, siteOrigin, STRENGTH_COLORS } from '../src/lib/personal';

const TOKEN = 'A'.repeat(32);
const UID = '0b5f1f0e-1c1d-4f6a-9a3b-2a8d9e7c6b5a';

describe('мои заметки на телефоне', () => {
  it('параметры списка — как у сайта: день важнее месяца, поиск без пробелов', () => {
    expect(myNotesQuery({})).toBe('');
    expect(myNotesQuery({ date: '2026-10-19', month: '2026-10' })).toBe('date=2026-10-19');
    expect(myNotesQuery({ month: '2026-10', favorite: true })).toBe('month=2026-10&favorite=1');
    expect(myNotesQuery({ q: '  отчёт ' })).toBe('q=%D0%BE%D1%82%D1%87%D1%91%D1%82');
  });

  it('шапка: сколько всего, на сегодня и в избранном', () => {
    const stats = myNotesStats(
      [
        { note_date: '2026-10-19', is_favorite: true },
        { note_date: '2026-10-19', is_favorite: false },
        { note_date: '2026-10-18', is_favorite: true },
      ],
      '2026-10-19',
    );
    expect(stats).toEqual([
      { label: 'заметки', value: 3 },
      { label: 'на сегодня', value: 2 },
      { label: 'в избранном', value: 2 },
    ]);
    expect(myNotesStats([], '2026-10-19')[0]).toEqual({ label: 'заметок', value: 0 });
  });

  it('пустой список объясняет, что делать', () => {
    expect(myNotesEmpty({ q: 'x', view: 'all' }).title).toBe('Ничего не нашлось');
    expect(myNotesEmpty({ view: 'favorite' }).title).toBe('В избранном пусто');
    expect(myNotesEmpty({ view: 'all', date: '2026-10-19' }).title).toBe('В этот день заметок нет');
    expect(myNotesEmpty({ view: 'all' }).title).toBe('Заметок пока нет');
  });
});

describe('сканер QR', () => {
  it('код входа — на подтверждение, профиль — в карточку коллеги', () => {
    expect(scanTarget(`https://offix.example/qr/${TOKEN}`)).toEqual({ kind: 'route', path: `/qr/${TOKEN}` });
    expect(scanTarget(`https://offix.example/app/people/${UID.toUpperCase()}`)).toEqual({ kind: 'route', path: `/person/${UID}` });
    expect(scanTarget(`offix://qr/${TOKEN}`)).toEqual({ kind: 'route', path: `/qr/${TOKEN}` });
  });
  it('чужая ссылка и текст — не открываем молча', () => {
    expect(scanTarget('https://evil.example/qr/short')).toEqual({ kind: 'url', url: 'https://evil.example/qr/short' });
    expect(scanTarget('просто текст')).toEqual({ kind: 'unknown', text: 'просто текст' });
    expect(scanTarget(`https://offix.example/app/people/not-a-uuid`).kind).toBe('url');
  });
  it('адрес сайта по адресу API — для ссылки в моём QR', () => {
    expect(siteOrigin('https://offix.example/api/v1')).toBe('https://offix.example');
    expect(siteOrigin('http://10.0.0.5:4000/api/v1/')).toBe('http://10.0.0.5:4000');
    expect(siteOrigin('https://offix.example')).toBe('https://offix.example');
  });
});

describe('входящие', () => {
  const n = (over: Partial<Parameters<typeof inboxTarget>[0]>) => ({ kind: 'comment', task_id: null, goal_id: null, data: {}, ...over });
  it('запрос заметки, её свежая копия и отказ ведут каждый в своё место', () => {
    expect(inboxTarget(n({ kind: 'note_request', data: { request_id: 'r1' } }))).toEqual({ kind: 'request', id: 'r1' });
    expect(inboxTarget(n({ kind: 'note_request_approved', data: { note_id: 'n1' } }))).toEqual({ kind: 'route', path: '/my-notes/n1' });
    expect(inboxTarget(n({ kind: 'note_request_declined', data: { share_id: 's1' } }))).toEqual({ kind: 'share', id: 's1' });
  });
  it('задача и цель — как раньше; без ссылки — никуда', () => {
    expect(inboxTarget(n({ task_id: 't1', goal_id: 'g1' }))).toEqual({ kind: 'route', path: '/task/t1' });
    expect(inboxTarget(n({ goal_id: 'g1' }))).toEqual({ kind: 'route', path: '/goal/g1' });
    expect(inboxTarget(n({ kind: 'note_request' }))).toBeNull();
  });
  it('включили функцию — ведёт в профиль, где видно, что именно', () => {
    expect(inboxTarget(n({ kind: 'function_granted' }))).toEqual({ kind: 'route', path: '/profile' });
  });
  it('итог отвеченного запроса', () => {
    expect(requestOutcome('approved')).toBe('Вы поделились');
    expect(requestOutcome('declined')).toBe('Вы отказали');
    expect(requestOutcome('pending')).toBeNull();
    expect(requestOutcome(null)).toBeNull();
  });
});

describe('профиль', () => {
  it('последний вход — по-русски', () => {
    const now = new Date('2026-10-19T15:00:00');
    expect(lastLoginText({ last_login_at: null }, now)).toBe('Последний вход — ещё не было');
    expect(lastLoginText({ last_login_at: new Date('2026-10-19T09:05:00').toISOString() }, now)).toMatch(/^Последний вход — сегодня в 09:05$/);
    expect(lastLoginText({ last_login_at: new Date('2026-10-02T18:30:00').toISOString() }, now)).toMatch(/^Последний вход — 2 октября в 18:30$/);
  });
  it('полоска надёжности — четыре цвета на четыре уровня', () => {
    expect(STRENGTH_COLORS).toHaveLength(4);
  });
});
