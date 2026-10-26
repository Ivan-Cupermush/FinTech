import { describe, expect, it } from 'vitest';
import {
  buildFeed,
  canEditMessage,
  chatListTime,
  chatPushMessage,
  chatRights,
  chatTitle,
  dayLabel,
  highlightRanges,
  isMuted,
  isReaction,
  lastSeenText,
  matchesQuery,
  mergeMessages,
  messagePreview,
  muteUntil,
  normText,
  parsePermissions,
  pushRoute,
  rightsList,
  searchTokens,
  shouldPushMessage,
  sortChats,
  switchLayout,
  typingText,
  validateChatName,
  validateMessageText,
  validatePoll,
  validateScheduleAt,
  type MessageKind,
} from '../src';

const base = { type: 'group' as const, isSupergroup: false, isMember: true, isCreator: false, adminPermissions: null };

describe('chatRights', () => {
  it('не участник не может ничего', () => {
    const r = chatRights({ ...base, isMember: false, isCreator: true });
    expect(rightsList(r)).toEqual([]);
    expect(r.canManageTopics).toBe(false);
  });
  it('создатель может всё и управляет темами', () => {
    const r = chatRights({ ...base, isCreator: true });
    expect(rightsList(r)).toHaveLength(6);
    expect(r.canManageTopics).toBe(true);
  });
  it('участник обычной группы приглашает, закрепляет и меняет название', () => {
    expect(rightsList(chatRights(base))).toEqual(['change_info', 'add_users', 'pin_messages']);
  });
  it('в группе с темами участник название не меняет', () => {
    expect(rightsList(chatRights({ ...base, isSupergroup: true }))).toEqual(['add_users', 'pin_messages']);
  });
  it('администратор — только выданные права', () => {
    const r = chatRights({ ...base, adminPermissions: ['delete_messages'] });
    expect(r.isAdmin).toBe(true);
    expect(rightsList(r)).toEqual(['delete_messages']);
    expect(r.canManageTopics).toBe(false);
  });
  it('администратор с правом изменения управляет темами', () => {
    expect(chatRights({ ...base, adminPermissions: ['change_info'] }).canManageTopics).toBe(true);
  });
  it('в личном чате — только закреп', () => {
    const r = chatRights({ ...base, type: 'private', isCreator: true });
    expect(rightsList(r)).toEqual(['pin_messages']);
    expect(r.canManageTopics).toBe(false);
  });
  it('parsePermissions отбрасывает лишнее', () => {
    expect(parsePermissions(['ban_users', 'hack', 1])).toEqual(['ban_users']);
    expect(parsePermissions(null)).toEqual([]);
  });
});

describe('поиск', () => {
  it('normText: регистр и ё', () => {
    expect(normText('Ёлка ЁЖ')).toBe('елка еж');
    expect(normText(null)).toBe('');
  });
  it('switchLayout переводит раскладку в обе стороны', () => {
    expect(switchLayout('ghbdtn')).toBe('привет');
    expect(switchLayout('руддщ')).toBe('hello');
  });
  it('searchTokens: слова, варианты раскладки, не больше восьми', () => {
    expect(searchTokens('Привет, мир')).toEqual([
      ['привет', 'ghbdtn'],
      ['мир', 'vbh'],
    ]);
    expect(searchTokens('a b c d e f g h i j')).toHaveLength(8);
    expect(searchTokens('   ')).toEqual([]);
    expect(searchTokens('2024')).toEqual([['2024']]);
  });
  it('matchesQuery: части слов в любом порядке', () => {
    expect(matchesQuery(['Отчёт по продажам за октябрь'], 'окт отчет')).toBe(true);
    expect(matchesQuery(['Отчёт по продажам'], 'ghjlf')).toBe(true);
    expect(matchesQuery(['Отчёт'], 'отчет бюджет')).toBe(false);
    expect(matchesQuery(['Анна', 'план'], 'анн план')).toBe(true);
    expect(matchesQuery(['что угодно'], '')).toBe(true);
  });
  it('highlightRanges склеивает пересечения', () => {
    expect(highlightRanges('Ёжик и ежевика', 'еж')).toEqual([
      [0, 2],
      [7, 9],
    ]);
    expect(highlightRanges('абвгд', 'абв бвг')).toEqual([[0, 4]]);
    expect(highlightRanges('нет', 'да')).toEqual([]);
  });
});

describe('проверки ввода', () => {
  it('текст сообщения', () => {
    expect(validateMessageText('  ')).toBe('Напишите сообщение');
    expect(validateMessageText(5)).toBe('Напишите сообщение');
    expect(validateMessageText('x'.repeat(4001))).toMatch(/4000/);
    expect(validateMessageText('Привет')).toBeNull();
  });
  it('название группы', () => {
    expect(validateChatName('')).toBe('Назовите группу');
    expect(validateChatName('x'.repeat(81))).toMatch(/80/);
    expect(validateChatName('Продажи')).toBeNull();
  });
  it('реакции — только из набора', () => {
    expect(isReaction('🔥')).toBe(true);
    expect(isReaction('🦄')).toBe(false);
  });
  it('править можно своё текстовое сообщение 48 часов', () => {
    const m = { sender_id: 'u1', kind: 'text', deleted: false, created_at: '2026-10-01T10:00:00Z' };
    expect(canEditMessage(m, 'u1', '2026-10-03T09:59:00Z')).toBe(true);
    expect(canEditMessage(m, 'u1', '2026-10-03T10:01:00Z')).toBe(false);
    expect(canEditMessage(m, 'u2', '2026-10-01T11:00:00Z')).toBe(false);
    expect(canEditMessage({ ...m, deleted: true }, 'u1', '2026-10-01T11:00:00Z')).toBe(false);
    expect(canEditMessage({ ...m, kind: 'poll' }, 'u1', '2026-10-01T11:00:00Z')).toBe(false);
  });
  it('время отложенной отправки', () => {
    const now = '2026-10-01T10:00:00Z';
    expect(validateScheduleAt('2026-10-01T10:00:30Z', now)).toMatch(/минуту/);
    expect(validateScheduleAt('2028-01-01T10:00:00Z', now)).toMatch(/год/);
    expect(validateScheduleAt('мусор', now)).toMatch(/Укажите/);
    expect(validateScheduleAt('2026-10-01T12:00:00Z', now)).toBeNull();
  });
  it('опрос', () => {
    const ok = { question: 'Когда созвон?', options: ['Утром', 'Вечером'], anonymous: true, multiple: false, quiz: false };
    expect(validatePoll(ok)).toEqual({});
    expect(validatePoll({ ...ok, question: ' ' }).question).toBeDefined();
    expect(validatePoll({ ...ok, options: ['Одно', ' '] }).options).toMatch(/два/);
    expect(validatePoll({ ...ok, options: ['Да', 'да'] }).options).toMatch(/повторяются/);
    expect(validatePoll({ ...ok, options: Array.from({ length: 11 }, (_, i) => `в${i}`) }).options).toMatch(/10/);
    expect(validatePoll({ ...ok, quiz: true }).correct_option).toBeDefined();
    expect(validatePoll({ ...ok, quiz: true, multiple: true, correct_option: 0 }).multiple).toBeDefined();
    expect(validatePoll({ ...ok, quiz: true, correct_option: 1 })).toEqual({});
    expect(validatePoll({ ...ok, explanation: 'x'.repeat(201) }).explanation).toBeDefined();
  });
});

describe('подписи', () => {
  it('название чата', () => {
    expect(chatTitle({ type: 'group', name: ' Продажи ' }, null)).toBe('Продажи');
    expect(chatTitle({ type: 'group', name: null }, null)).toBe('Группа');
    expect(chatTitle({ type: 'private', name: null }, 'Анна Смирнова')).toBe('Анна Смирнова');
    expect(chatTitle({ type: 'private', name: null }, null)).toBe('Избранное');
  });
  it('превью последнего сообщения', () => {
    const m = { kind: 'text' as MessageKind, text: 'Привет\n  всем', deleted: false, sender_id: 'u2', sender_name: 'Анна Смирнова' };
    expect(messagePreview(null, 'u1', false)).toBe('Нет сообщений');
    expect(messagePreview(m, 'u1', false)).toBe('Привет всем');
    expect(messagePreview(m, 'u1', true)).toBe('Анна: Привет всем');
    expect(messagePreview(m, 'u2', true)).toBe('Вы: Привет всем');
    expect(messagePreview({ ...m, deleted: true }, 'u1', true)).toBe('Сообщение удалено');
    expect(messagePreview({ ...m, kind: 'poll', text: 'Обед?' }, 'u1', false)).toBe('📊 Обед?');
    expect(messagePreview({ ...m, kind: 'service', text: 'Анна создаёт группу' }, 'u2', true)).toBe('Анна создаёт группу');
  });
  it('был(а) в сети', () => {
    const now = '2026-10-10T12:00:00Z'; // 15:00 МСК
    expect(lastSeenText(true, null, now)).toBe('в сети');
    expect(lastSeenText(false, null, now)).toBe('не заходил(а)');
    expect(lastSeenText(false, '2026-10-10T11:59:40Z', now)).toBe('был(а) только что');
    expect(lastSeenText(false, '2026-10-10T11:55:00Z', now)).toBe('был(а) 5 минут назад');
    expect(lastSeenText(false, '2026-10-10T11:39:00Z', now)).toBe('был(а) 21 минуту назад');
    expect(lastSeenText(false, '2026-10-10T07:00:00Z', now)).toBe('был(а) в 10:00');
    expect(lastSeenText(false, '2026-10-09T15:20:00Z', now)).toBe('был(а) вчера в 18:20');
    expect(lastSeenText(false, '2026-10-01T15:20:00Z', now)).toBe('был(а) 1 окт');
  });
  it('время в списке чатов', () => {
    const now = '2026-10-10T12:00:00Z'; // суббота
    expect(chatListTime('2026-10-10T06:05:00Z', now)).toBe('09:05');
    expect(chatListTime('2026-10-08T06:05:00Z', now)).toBe('чт');
    expect(chatListTime('2026-09-20T06:05:00Z', now)).toBe('20 сен');
  });
  it('подпись дня', () => {
    const now = '2026-10-10T12:00:00Z';
    expect(dayLabel('2026-10-10', now)).toBe('Сегодня');
    expect(dayLabel('2026-10-09', now)).toBe('Вчера');
    expect(dayLabel('2026-10-01', now)).toBe('1 октября');
    expect(dayLabel('2025-12-31', now)).toBe('31 декабря 2025');
  });
});

describe('лента', () => {
  const msg = (seq: number, sender: string | null, at: string, kind: MessageKind = 'text') => ({ id: `m${seq}`, seq, sender_id: sender, kind, created_at: at });
  const now = '2026-10-10T12:00:00Z';

  it('разделители дней и склейка подряд идущих сообщений', () => {
    const feed = buildFeed([msg(3, 'a', '2026-10-10T09:01:00Z'), msg(1, 'a', '2026-10-09T09:00:00Z'), msg(2, 'a', '2026-10-10T09:00:00Z'), msg(4, 'b', '2026-10-10T09:02:00Z')], { now });
    expect(feed.map((i) => (i.type === 'message' ? `${i.message.id}:${+i.first}${+i.last}` : i.type === 'day' ? i.label : 'new'))).toEqual(['Вчера', 'm1:11', 'Сегодня', 'm2:10', 'm3:01', 'm4:11']);
  });
  it('больше пяти минут — новая группа, служебное не склеивается', () => {
    const feed = buildFeed([msg(1, 'a', '2026-10-10T09:00:00Z'), msg(2, 'a', '2026-10-10T09:06:00Z'), msg(3, null, '2026-10-10T09:07:00Z', 'service')], { now });
    expect(feed.filter((i) => i.type === 'message').map((i) => i.type === 'message' && `${+i.first}${+i.last}`)).toEqual(['11', '11', '11']);
  });
  it('отметка «Новые» — перед первым чужим непрочитанным', () => {
    const feed = buildFeed([msg(1, 'b', '2026-10-10T09:00:00Z'), msg(2, 'me', '2026-10-10T09:01:00Z'), msg(3, 'b', '2026-10-10T09:02:00Z'), msg(4, 'b', '2026-10-10T09:03:00Z')], { now, lastReadSeq: 1, meId: 'me' });
    const keys = feed.map((i) => i.key);
    expect(keys.indexOf('new')).toBe(keys.indexOf('m3') - 1);
    expect(keys.filter((k) => k === 'new')).toHaveLength(1);
    // Отметка разрывает группу: m3 начинается заново.
    const m3 = feed.find((i) => i.key === 'm3');
    expect(m3?.type === 'message' && m3.first).toBe(true);
  });
  it('без непрочитанного отметки нет', () => {
    expect(buildFeed([msg(1, 'b', '2026-10-10T09:00:00Z')], { now, lastReadSeq: 1, meId: 'me' }).some((i) => i.type === 'new')).toBe(false);
  });
  it('mergeMessages заменяет черновик отправки по client_id и сортирует', () => {
    const local = { id: 'local-1', seq: Number.MAX_SAFE_INTEGER, client_id: 'c1' };
    const merged = mergeMessages([{ id: 'a', seq: 1, client_id: null }, local], [{ id: 'b', seq: 2, client_id: 'c1' }, { id: 'a', seq: 1, client_id: null }]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
  });
  it('sortChats: закреплённые сверху, затем по активности', () => {
    const c = (id: string, pinned: boolean, at: string) => ({ id, pinned, activity_at: at });
    expect(sortChats([c('a', false, '2026-10-01T00:00:00Z'), c('b', true, '2026-09-01T00:00:00Z'), c('c', false, '2026-10-05T00:00:00Z')]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('без звука: пресеты и проверка', () => {
    const now2 = '2026-10-10T12:00:00Z';
    expect(muteUntil(1, now2)).toBe('2026-10-10T13:00:00.000Z');
    expect(muteUntil(null, now2).startsWith('2100')).toBe(true);
    expect(isMuted(muteUntil(1, now2), now2)).toBe(true);
    expect(isMuted('2026-10-10T11:00:00Z', now2)).toBe(false);
    expect(isMuted(null, now2)).toBe(false);
  });
});

describe('push о сообщениях', () => {
  const s = { muted: [], quiet_hours: true };
  const day = '2026-10-10T09:00:00Z';
  it('шлёт днём, молчит ночью, без звука и при выключенной теме', () => {
    expect(shouldPushMessage(s, null, day)).toEqual({ send: true });
    expect(shouldPushMessage(s, null, '2026-10-10T21:00:00Z')).toEqual({ send: false, reason: 'quiet_hours' });
    expect(shouldPushMessage({ ...s, quiet_hours: false }, null, '2026-10-10T21:00:00Z')).toEqual({ send: true });
    expect(shouldPushMessage(s, '2026-10-11T00:00:00Z', day)).toEqual({ send: false, reason: 'muted' });
    expect(shouldPushMessage(s, '2026-10-01T00:00:00Z', day)).toEqual({ send: true });
    expect(shouldPushMessage({ muted: ['messages'], quiet_hours: false }, null, day)).toEqual({ send: false, reason: 'muted' });
  });
  it('в группе — название чата и автор в тексте, в личном — имя собеседника', () => {
    const m = { chat_id: 'c1', message_id: 'm1', chat_title: 'Продажи', sender_name: 'Анна', is_group: true, text: 'Всем   привет' };
    const g = chatPushMessage('ExponentPushToken[abcdefgh]', m, 3);
    expect(g.title).toBe('Продажи');
    expect(g.body).toBe('Анна: Всем привет');
    expect(g.badge).toBe(3);
    expect(g.data).toEqual({ kind: 'message', chat_id: 'c1', message_id: 'm1' });
    const p = chatPushMessage('ExponentPushToken[abcdefgh]', { ...m, is_group: false }, -1);
    expect(p.title).toBe('Анна');
    expect(p.body).toBe('Всем привет');
    expect(p.badge).toBe(0);
  });
  it('нажатие ведёт в чат', () => {
    expect(pushRoute({ chat_id: 'c1', task_id: 't1' })).toBe('/chat/c1');
  });
});

describe('кто печатает', () => {
  it('в личном — без имени, в группе — по именам', () => {
    expect(typingText([], true)).toBe('');
    expect(typingText(['Ольга Смирнова'], false)).toBe('печатает');
    expect(typingText(['Ольга Смирнова'], true)).toBe('Ольга печатает');
    expect(typingText(['Ольга Смирнова', 'Игорь Лебедев'], true)).toBe('Ольга и Игорь печатают');
  });
  it('много людей — числом, с верным окончанием', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `Имя${i} Фамилия`);
    expect(typingText(names(3), true)).toBe('3 человека печатают');
    expect(typingText(names(5), true)).toBe('5 человек печатают');
    expect(typingText(names(22), true)).toBe('22 человека печатают');
  });
});
