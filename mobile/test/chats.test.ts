import { describe, expect, it } from 'vitest';
import type { ChatDetail, ChatHistory, ChatMessage, ChatSummary } from '@offix/core';
import { applyChatEvent, chatsStats, chatStatus, filterChats, markFailed, membersWord, nextReaction, optimisticMessage, rowPreview, socketOrigin, wallpaperColors } from '../src/lib/chat-logic';
import { hexToRgb } from '../src/lib/fx';

const NOW = '2026-10-19T12:00:00.000Z';

const summary = (id: string, over: Partial<ChatSummary> = {}): ChatSummary => ({
  id,
  type: 'group',
  is_supergroup: false,
  title: `Чат ${id}`,
  peer: null,
  members_count: 3,
  last_message: null,
  unread: 0,
  pinned: false,
  muted: false,
  muted_until: null,
  created_at: '2026-10-01T09:00:00.000Z',
  activity_at: '2026-10-19T09:00:00.000Z',
  ...over,
});

const msg = (id: string, seq: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  chat_id: 'c1',
  seq,
  topic_id: null,
  kind: 'text',
  sender_id: 'u-anna',
  sender_name: 'Анна Королёва',
  text: `Сообщение ${seq}`,
  created_at: '2026-10-19T09:00:00.000Z',
  edited_at: null,
  deleted: false,
  pinned: false,
  client_id: null,
  reply_to: null,
  external_reply: null,
  forwarded_from: null,
  reactions: [],
  poll: null,
  read: false,
  ...over,
});

const history = (messages: ChatMessage[], over: Partial<ChatHistory> = {}): ChatHistory => ({ messages, has_before: false, has_after: false, my_last_read_seq: 0, others_read_seq: 0, ...over });

const OLGA = summary('olga', {
  type: 'private',
  title: 'Ольга Смирнова',
  members_count: 2,
  peer: { id: 'u-olga', display_name: 'Ольга Смирнова', position: 'Руководитель офиса', online: true, last_seen_at: null },
  unread: 2,
  activity_at: '2026-10-19T08:00:00.000Z',
});
const TEAM = summary('team', { title: 'Заявки за 30 минут', unread: 4, last_message: { id: 'm', sender_id: 'u-anna', sender_name: 'Анна Королёва', text: 'Очередь разобрана', kind: 'text', deleted: false, created_at: '2026-10-19T09:00:00.000Z' } });
const MUTED = summary('muted', { title: 'Флудилка', unread: 30, muted: true, muted_until: '2100-01-01T00:00:00.000Z', pinned: true, activity_at: '2026-10-18T09:00:00.000Z' });

describe('список чатов', () => {
  it('закреплённые сверху, дальше — по свежести', () => {
    expect(filterChats([OLGA, TEAM, MUTED], 'all', '').map((c) => c.id)).toEqual(['muted', 'team', 'olga']);
  });
  it('папки и поиск по названию и последнему сообщению, «ё» как «е»', () => {
    expect(filterChats([OLGA, TEAM, MUTED], 'private', '').map((c) => c.id)).toEqual(['olga']);
    expect(filterChats([OLGA, TEAM, summary('read')], 'unread', '').map((c) => c.id)).toEqual(['team', 'olga']);
    expect(filterChats([OLGA, TEAM], 'all', 'очередь').map((c) => c.id)).toEqual(['team']);
    expect(filterChats([OLGA, TEAM], 'all', 'королева').map((c) => c.id)).toEqual([]);
    expect(filterChats([OLGA, TEAM], 'all', 'руководитель').map((c) => c.id)).toEqual(['olga']);
  });
  it('цифры шапки: «без звука» не считаем, собеседник в сети — один раз', () => {
    expect(chatsStats([OLGA, TEAM, MUTED], new Set(), NOW)).toEqual([
      { label: 'непрочитанных', value: 6, tone: 'warn' },
      { label: 'в сети', value: 1 },
    ]);
    expect(chatsStats([summary('a')], new Set(), NOW)[0]).toEqual({ label: 'непрочитанных', value: 0, tone: undefined });
  });
  it('вторая строка: печатает важнее последнего сообщения', () => {
    expect(rowPreview(TEAM, 'u-dir', [])).toEqual({ text: 'Анна: Очередь разобрана', typing: false });
    expect(rowPreview(TEAM, 'u-dir', ['Ольга Смирнова'])).toEqual({ text: 'Ольга печатает', typing: true });
    expect(rowPreview(OLGA, 'u-dir', ['Ольга Смирнова'])).toEqual({ text: 'печатает', typing: true });
    expect(rowPreview(summary('x'), 'u-dir', []).text).toBe('Группа создана');
  });
});

describe('шапка переписки', () => {
  const detail = (over: Partial<ChatDetail>): ChatDetail => ({
    ...summary('team', { members_count: 3 }),
    created_by: 'u-dir',
    members: [
      { id: 'u-dir', display_name: 'Алексей Петров', position: null, role: 'creator', permissions: [], online: true, last_seen_at: null },
      { id: 'u-anna', display_name: 'Анна Королёва', position: null, role: 'member', permissions: [], online: false, last_seen_at: null },
      { id: 'u-olga', display_name: 'Ольга Смирнова', position: null, role: 'member', permissions: [], online: false, last_seen_at: null },
    ],
    my_rights: [],
    can_manage_topics: false,
    topics: [],
    my_last_read_seq: 0,
    others_read_seq: 0,
    ...over,
  });
  const none = { online: new Set<string>(), lastSeen: new Map<string, string>() };
  it('группа: участники и кто в сети; сокет главнее ответа сервера', () => {
    expect(chatStatus(detail({}), none, [], NOW)).toBe('3 участника, 1 в сети');
    expect(chatStatus(detail({}), { online: new Set(['u-anna']), lastSeen: new Map([['u-dir', NOW]]) }, [], NOW)).toBe('3 участника, 1 в сети');
    expect(chatStatus(detail({}), none, ['Анна Королёва', 'Ольга Смирнова'], NOW)).toBe('Анна и Ольга печатают');
  });
  it('личный: в сети или когда был(а)', () => {
    const peer = { id: 'u-olga', display_name: 'Ольга', position: null, online: false, last_seen_at: '2026-10-19T11:55:00.000Z' };
    expect(chatStatus(detail({ type: 'private', peer }), none, [], NOW)).toBe('был(а) 5 минут назад');
    expect(chatStatus(detail({ type: 'private', peer }), { online: new Set(['u-olga']), lastSeen: new Map() }, [], NOW)).toBe('в сети');
  });
  it('склонение «участник»', () => {
    expect([1, 2, 5, 11, 21, 22, 112].map(membersWord)).toEqual(['участник', 'участника', 'участников', 'участников', 'участник', 'участника', 'участников']);
  });
});

describe('события сокета в ленте', () => {
  const base = history([msg('m1', 1), msg('m2', 2, { sender_id: 'u-dir' })]);
  it('новое сообщение встаёт в конец, своё — заменяет черновое по client_id', () => {
    const local = optimisticMessage({ chatId: 'c1', topicId: null, me: { id: 'u-dir', name: 'Алексей Петров' }, text: 'Принято', clientId: 'k1', now: NOW });
    expect(local.id).toBe('local-k1');
    const withLocal = { ...base, messages: [...base.messages, local] };
    const h = applyChatEvent(withLocal, null, 'new_message', { chat_id: 'c1', message: msg('m3', 3, { sender_id: 'u-dir', client_id: 'k1', text: 'Принято' }) });
    expect(h.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
  it('чужая тема и окно в середине истории не трогаются', () => {
    const m = msg('m3', 3, { topic_id: 't2' });
    expect(applyChatEvent(base, 't1', 'new_message', { message: m })).toBe(base);
    const middle = { ...base, has_after: true };
    expect(applyChatEvent(middle, null, 'new_message', { message: msg('m9', 9) })).toBe(middle);
  });
  it('правка, удаление, реакции, закреп и опрос — по месту', () => {
    let h = applyChatEvent(base, null, 'message_edited', { id: 'm1', text: 'Исправлено', edited_at: NOW });
    expect(h.messages[0]).toMatchObject({ text: 'Исправлено', edited_at: NOW });
    h = applyChatEvent(h, null, 'message_reactions', { message_id: 'm1', reactions: [{ emoji: '🔥', count: 2, mine: true, people: [], user_ids: [] }] });
    expect(h.messages[0]!.reactions[0]!.count).toBe(2);
    h = applyChatEvent(h, null, 'message_pinned', { id: 'm2', pinned: true });
    expect(h.messages[1]!.pinned).toBe(true);
    h = applyChatEvent(h, null, 'message_deleted', { ids: ['m1'] });
    expect(h.messages.map((m) => m.id)).toEqual(['m2']);
    expect(applyChatEvent(h, null, 'chat_updated', {})).toBe(h);
  });
  it('прочтение собеседником ставит две галочки, но не откатывается назад', () => {
    const h = applyChatEvent(base, null, 'messages_read', { user_id: 'u-anna', seq: 2 });
    expect(h.others_read_seq).toBe(2);
    expect(h.messages.every((m) => m.read)).toBe(true);
    expect(applyChatEvent(h, null, 'messages_read', { seq: 1 })).toBe(h);
  });
  it('неудачная отправка помечается, ответ сохраняет цитату', () => {
    const local = optimisticMessage({ chatId: 'c1', topicId: null, me: { id: 'u-dir', name: 'Алексей' }, text: 'Да', clientId: 'k2', now: NOW, replyTo: msg('m1', 1) });
    expect(local.reply_to).toMatchObject({ id: 'm1', sender_name: 'Анна Королёва' });
    const h = markFailed({ ...base, messages: [...base.messages, local] }, 'local-k2');
    expect((h.messages[2] as ChatMessage & { failed?: boolean }).failed).toBe(true);
  });
  it('та же реакция снимается, другая — ставится', () => {
    const rs = [{ emoji: '👍', count: 1, mine: true, people: [], user_ids: [] }];
    expect(nextReaction(rs, '👍')).toBeNull();
    expect(nextReaction(rs, '🔥')).toBe('🔥');
  });
});

describe('связь и обои', () => {
  it('сокет — на том же сервере, что API', () => {
    expect(socketOrigin('http://192.168.1.5:4000/api/v1')).toBe('http://192.168.1.5:4000');
    expect(socketOrigin('https://offix.example.ru/api/v1')).toBe('https://offix.example.ru');
  });
  it('обои светлые днём и глубокие ночью, все цвета валидны', () => {
    const [light, dark] = [wallpaperColors('light'), wallpaperColors('dark')];
    expect(light).not.toEqual(dark);
    for (const c of [...light, ...dark]) expect(hexToRgb(c)).toHaveLength(3);
    const lum = (hex: string) => hexToRgb(hex).reduce((s, x) => s + x, 0) / 3;
    expect(lum(light[1])).toBeGreaterThan(0.8);
    expect(lum(dark[1])).toBeLessThan(0.15);
  });
});
