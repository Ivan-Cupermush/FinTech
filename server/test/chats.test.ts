import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChatDetail, ChatHistory, ChatMessage, ChatPoll, ChatPushMessage, ChatSummary } from '@offix/core';
import { createApp } from '../src/app';
import { createRealtimeHub } from '../src/realtime/hub';
import { attachSocket } from '../src/realtime/socket';
import { seedDemo, DEMO_PASSWORD, type DemoIds } from '../src/seed/demo';
import { dispatchScheduled, sendChatPush } from '../src/services/chat-jobs';
import { MSG_SELECT, type ChatRow, type MessageRow } from '../src/services/chats';
import type { PushSender } from '../src/services/push';
import { NOW, SECRET, recordingRealtime, setup, type Agent, type Ctx } from './helpers';

type Who = keyof DemoIds['users'];

const rt = recordingRealtime();
let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup({ realtime: rt });
});
beforeEach(() => {
  rt.clear();
  rt.online.clear();
});

const API = '/api/v1';
const id = (who: Who) => ctx.demo.users[who];
const later = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const HOUR = 3_600_000;

async function group(owner: Who, name: string, members: Who[], supergroup = false): Promise<string> {
  const r = await (await ctx.as(owner)).post(`${API}/chats`, { name, member_ids: members.map(id), supergroup });
  expect(r.status).toBe(201);
  return r.body.data.id;
}

async function send(who: Who | Agent, chatId: string, text: string, extra: Record<string, unknown> = {}): Promise<ChatMessage> {
  const a = typeof who === 'string' ? await ctx.as(who) : who;
  const r = await a.post(`${API}/chats/${chatId}/messages`, { text, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}

async function history(who: Who, chatId: string, query = ''): Promise<ChatHistory> {
  const r = await (await ctx.as(who)).get(`${API}/chats/${chatId}/messages${query}`);
  expect(r.status).toBe(200);
  return r.body.data;
}

async function list(who: Who): Promise<ChatSummary[]> {
  const r = await (await ctx.as(who)).get(`${API}/chats`);
  expect(r.status).toBe(200);
  return r.body.data;
}

async function detail(who: Who, chatId: string): Promise<ChatDetail> {
  const r = await (await ctx.as(who)).get(`${API}/chats/${chatId}`);
  expect(r.status).toBe(200);
  return r.body.data;
}

const unread = async (who: Who) => (await (await ctx.as(who)).get(`${API}/chats/unread`)).body.data.unread as number;

describe('демо-переписка', () => {
  it('у руководителя — личные чаты, рабочая группа и общий чат с темами', async () => {
    const chats = await list('director');
    const by = new Map(chats.map((c) => [c.id, c]));
    const { olga, igor, team, campus } = ctx.demo.chats;
    expect(by.get(olga)).toMatchObject({ type: 'private', title: 'Ольга Смирнова', unread: 2, members_count: 2 });
    expect(by.get(olga)!.peer).toMatchObject({ id: id('olga'), online: false });
    expect(by.get(igor)).toMatchObject({ type: 'private', unread: 0 });
    expect(by.get(team)).toMatchObject({ type: 'group', title: 'Заявки за 30 минут', unread: 4, members_count: 7 });
    expect(by.get(team)!.last_message).toMatchObject({ text: 'Ура! Ещё немного 💪' });
    expect(by.get(campus)).toMatchObject({ is_supergroup: true, unread: 3, members_count: 9 });
    // Последнее сообщение общего чата — самое свежее по времени.
    expect(by.get(campus)!.last_message!.text).toBe('Отличная динамика 👏');
    expect(await unread('director')).toBe(9);
  });

  it('в группе — закреп, реакции, опрос и ответ', async () => {
    const h = await history('director', ctx.demo.chats.team);
    const plan = h.messages.find((m) => m.text?.startsWith('План на неделю'))!;
    expect(plan.pinned).toBe(true);
    expect(plan.reactions).toEqual([expect.objectContaining({ emoji: '👍', count: 3, mine: true })]);
    const answer = h.messages.find((m) => m.reply_to?.id === plan.id)!;
    expect(answer.reply_to).toMatchObject({ text: plan.text });
    const poll = h.messages.find((m) => m.kind === 'poll')!;
    expect(poll.poll).toMatchObject({ anonymous: false, total_voters: 4, voted: false });
    expect(poll.poll!.options.map((o) => o.votes)).toEqual([3, 1, 0]);
    expect(h.messages.find((m) => m.text === 'Ура! Ещё немного 💪')!.edited_at).not.toBeNull();
  });

  it('темы общего чата: непрочитанные — по каждой теме', async () => {
    const d = await detail('director', ctx.demo.chats.campus);
    expect(d.topics.map((t) => [t.name, t.unread])).toEqual(
      expect.arrayContaining([
        ['Общее', 0],
        ['Объявления', 0],
        ['IT-поддержка', 1],
        ['Аналитика', 2],
      ]),
    );
    expect(d.topics[0]!.is_general).toBe(true);
    expect(d.can_manage_topics).toBe(true);
  });
});

describe('доступ', () => {
  let other: DemoIds;
  let otherToken: string;
  beforeAll(async () => {
    other = await seedDemo(ctx.db, { companyName: 'Другой вуз', now: NOW });
    const r = await request(ctx.app).post(`${API}/auth/login`).send({ email: `${other.companyId.slice(0, 8)}.director@offix.demo`, password: DEMO_PASSWORD });
    otherToken = r.body.data.token;
  });

  it('без входа — 401', async () => {
    expect((await request(ctx.app).get(`${API}/chats`)).status).toBe(401);
  });

  it('чужой чат — 404, и в своей компании, и из другой', async () => {
    expect((await (await ctx.as('anna')).get(`${API}/chats/${ctx.demo.chats.olga}`)).status).toBe(404);
    expect((await (await ctx.as('anna')).post(`${API}/chats/${ctx.demo.chats.olga}/messages`, { text: 'Привет' })).status).toBe(404);
    const r = await request(ctx.app).get(`${API}/chats/${ctx.demo.chats.team}`).set('Authorization', `Bearer ${otherToken}`);
    expect(r.status).toBe(404);
    const m = (await history('director', ctx.demo.chats.olga)).messages[0]!;
    expect((await request(ctx.app).put(`${API}/messages/${m.id}/reaction`).set('Authorization', `Bearer ${otherToken}`).send({ emoji: '👍' })).status).toBe(404);
  });

  it('сотрудника другой компании не добавить ни в личный чат, ни в группу', async () => {
    const anna = await ctx.as('anna');
    const r = await anna.post(`${API}/chats/direct`, { user_id: other.users.igor });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.user_id).toBeDefined();
    const g = await anna.post(`${API}/chats`, { name: 'Смешанная', member_ids: [other.users.igor, id('igor')] });
    expect(g.status).toBe(201);
    expect(g.body.data.members_count).toBe(2);
  });
});

describe('личные чаты', () => {
  it('один на пару: повтор и встречный вызов возвращают тот же чат', async () => {
    const r1 = await (await ctx.as('anna')).post(`${API}/chats/direct`, { user_id: id('sergey') });
    expect(r1.status).toBe(201);
    expect(r1.body.data).toMatchObject({ type: 'private', title: 'Сергей Ким', members_count: 2, last_message: null });
    expect(rt.of('chat_created')[0]!.users.sort()).toEqual([id('anna'), id('sergey')].sort());
    const r2 = await (await ctx.as('anna')).post(`${API}/chats/direct`, { user_id: id('sergey') });
    expect(r2.status).toBe(200);
    expect(r2.body.data.id).toBe(r1.body.data.id);
    const r3 = await (await ctx.as('sergey')).post(`${API}/chats/direct`, { user_id: id('anna') });
    expect(r3.body.data.id).toBe(r1.body.data.id);
  });

  it('с самим собой — «Избранное»', async () => {
    const r = await (await ctx.as('anna')).post(`${API}/chats/direct`, { user_id: id('anna') });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ title: 'Избранное', members_count: 1, peer: null });
  });

  it('из личного чата не выйти, переименовать его нельзя', async () => {
    const director = await ctx.as('director');
    expect((await director.post(`${API}/chats/${ctx.demo.chats.igor}/leave`)).status).toBe(422);
    expect((await director.patch(`${API}/chats/${ctx.demo.chats.igor}`, { name: 'Игорь' })).status).toBe(422);
    expect((await director.post(`${API}/chats/${ctx.demo.chats.igor}/members`, { user_ids: [id('anna')] })).status).toBe(422);
  });
});

describe('группы, участники и администраторы', () => {
  let chat: string;

  it('создание: название обязательно, создатель — участник, служебная строка', async () => {
    const bad = await (await ctx.as('anna')).post(`${API}/chats`, { name: '   ', member_ids: [] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.name).toBeDefined();
    chat = await group('anna', 'Пилот', ['igor', 'dima', 'anna']);
    const d = await detail('anna', chat);
    expect(d.members.map((m) => [m.id, m.role])).toEqual(
      expect.arrayContaining([
        [id('anna'), 'creator'],
        [id('igor'), 'member'],
        [id('dima'), 'member'],
      ]),
    );
    expect(d.members).toHaveLength(3);
    expect(d.last_message!.kind).toBe('service');
    expect(d.last_message!.text).toContain('создаёт группу «Пилот»');
    expect(d.my_rights).toContain('add_admins');
  });

  it('в обычной группе участник меняет название; событие уходит всем', async () => {
    const r = await (await ctx.as('igor')).patch(`${API}/chats/${chat}`, { name: 'Пилот 2' });
    expect(r.status).toBe(200);
    expect(r.body.data.title).toBe('Пилот 2');
    const ev = rt.of('new_message')[0]!;
    expect(ev.users.sort()).toEqual([id('anna'), id('igor'), id('dima')].sort());
    expect((ev.payloadFor(id('anna')) as { message: ChatMessage }).message.text).toContain('меняет название на «Пилот 2»');
    expect(rt.of('chat_updated')).toHaveLength(1);
  });

  it('участник приглашает; новичок видит историю, но она не непрочитанная', async () => {
    await send('anna', chat, 'Старт пилота в понедельник');
    const r = await (await ctx.as('dima')).post(`${API}/chats/${chat}/members`, { user_ids: [id('maria'), id('igor')] });
    expect(r.status).toBe(200);
    expect(r.body.data.added).toEqual([id('maria')]);
    expect(rt.of('chat_created')[0]!.users).toEqual([id('maria')]);
    const mine = (await list('maria')).find((c) => c.id === chat)!;
    expect(mine.unread).toBe(0);
    expect((await history('maria', chat)).messages.some((m) => m.text === 'Старт пилота в понедельник')).toBe(true);
  });

  it('исключать может только тот, у кого есть право', async () => {
    expect((await (await ctx.as('dima')).delete(`${API}/chats/${chat}/members/${id('maria')}`)).status).toBe(403);
    expect((await (await ctx.as('anna')).delete(`${API}/chats/${chat}/members/${id('maria')}`)).status).toBe(204);
    expect(rt.of('chat_deleted').at(-1)!.users).toEqual([id('maria')]);
    expect((await (await ctx.as('maria')).get(`${API}/chats/${chat}`)).status).toBe(404);
    expect((await (await ctx.as('igor')).delete(`${API}/chats/${chat}/members/${id('anna')}`)).status).toBe(403);
  });

  it('администратор получает только выданные права и выдаёт только свои', async () => {
    const anna = await ctx.as('anna');
    const r = await anna.put(`${API}/chats/${chat}/admins/${id('igor')}`, { permissions: ['ban_users', 'delete_messages'] });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ role: 'admin', permissions: ['delete_messages', 'ban_users'] });
    expect((await (await ctx.as('igor')).put(`${API}/chats/${chat}/admins/${id('dima')}`, { permissions: ['ban_users'] })).status).toBe(403);
    expect((await anna.put(`${API}/chats/${chat}/admins/${id('dima')}`, { permissions: ['add_admins', 'pin_messages'] })).status).toBe(200);
    await anna.post(`${API}/chats/${chat}/members`, { user_ids: [id('sergey')] });
    const dima = await ctx.as('dima');
    expect((await dima.put(`${API}/chats/${chat}/admins/${id('sergey')}`, { permissions: ['ban_users'] })).status).toBe(403);
    expect((await dima.put(`${API}/chats/${chat}/admins/${id('sergey')}`, { permissions: ['pin_messages'] })).status).toBe(200);
    // Игорь может исключать, но не администратора, которого назначил не он.
    expect((await (await ctx.as('igor')).delete(`${API}/chats/${chat}/members/${id('sergey')}`)).status).toBe(403);
    expect((await (await ctx.as('igor')).delete(`${API}/chats/${chat}/admins/${id('dima')}`)).status).toBe(403);
    expect((await anna.put(`${API}/chats/${chat}/admins/${id('anna')}`, { permissions: [] })).status).toBe(422);
    expect((await anna.delete(`${API}/chats/${chat}/members/${id('sergey')}`)).status).toBe(204);
  });

  it('создатель уходит — группа переходит администратору', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.delete(`${API}/chats/${chat}/admins/${id('dima')}`)).status).toBe(204);
    expect((await anna.post(`${API}/chats/${chat}/leave`)).status).toBe(204);
    expect((await anna.get(`${API}/chats/${chat}`)).status).toBe(404);
    const d = await detail('igor', chat);
    expect(d.created_by).toBe(id('igor'));
    expect(d.members.find((m) => m.id === id('igor'))!.role).toBe('creator');
    expect(d.last_message!.text).toContain('выходит из группы');
  });

  it('удалить группу может только создатель; участники получают событие', async () => {
    expect((await (await ctx.as('dima')).delete(`${API}/chats/${chat}`)).status).toBe(403);
    expect((await (await ctx.as('igor')).delete(`${API}/chats/${chat}`)).status).toBe(204);
    expect(rt.of('chat_deleted')[0]!.users.sort()).toEqual([id('igor'), id('dima')].sort());
    expect((await (await ctx.as('dima')).get(`${API}/chats/${chat}`)).status).toBe(404);
  });

  it('последний участник уходит — группа удаляется', async () => {
    const solo = await group('elena', 'Черновики', []);
    expect((await (await ctx.as('elena')).post(`${API}/chats/${solo}/leave`)).status).toBe(204);
    expect((await ctx.db.query(`SELECT 1 FROM chats WHERE id = $1`, [solo])).rows).toHaveLength(0);
  });
});

describe('мои настройки чата', () => {
  it('закрепить можно не больше 10 чатов', async () => {
    const maria = await ctx.as('maria');
    const ids: string[] = [];
    for (let i = 1; i <= 11; i++) ids.push(await group('maria', `Папка ${i}`, []));
    for (const c of ids.slice(0, 10)) expect((await maria.patch(`${API}/chats/${c}/membership`, { pinned: true })).status).toBe(200);
    const over = await maria.patch(`${API}/chats/${ids[10]}/membership`, { pinned: true });
    expect(over.status).toBe(422);
    expect(over.body.error.fields.pinned).toMatch(/10/);
    // Повторный закреп уже закреплённого — не превышение.
    expect((await maria.patch(`${API}/chats/${ids[0]}/membership`, { pinned: true })).status).toBe(200);
    expect((await maria.patch(`${API}/chats/${ids[0]}/membership`, { pinned: false })).body.data.pinned).toBe(false);
    expect((await maria.patch(`${API}/chats/${ids[10]}/membership`, { pinned: true })).body.data.pinned).toBe(true);
  });

  it('без звука до даты: непрочитанные не считаются в общий значок', async () => {
    const team = ctx.demo.chats.team;
    await send('olga', team, 'Мария, посмотри, пожалуйста, вчерашние заявки');
    const before = await unread('maria');
    const maria = await ctx.as('maria');
    const r = await maria.patch(`${API}/chats/${team}/membership`, { muted_until: later(24 * HOUR) });
    expect(r.body.data).toMatchObject({ muted: true, muted_until: later(24 * HOUR) });
    expect(rt.of('chat_updated')[0]!.users).toEqual([id('maria')]);
    expect(await unread('maria')).toBe(before - 1);
    const past = await maria.patch(`${API}/chats/${team}/membership`, { muted_until: later(-HOUR) });
    expect(past.body.data).toMatchObject({ muted: false, muted_until: null });
    await maria.patch(`${API}/chats/${team}/membership`, { muted_until: null });
  });

  it('скрытый чат пропадает из списка и возвращается с новым сообщением', async () => {
    const c = await group('maria', 'Скрытая', ['sergey']);
    const maria = await ctx.as('maria');
    expect((await maria.patch(`${API}/chats/${c}/membership`, { hidden: true })).status).toBe(200);
    expect((await list('maria')).some((x) => x.id === c)).toBe(false);
    expect((await list('sergey')).some((x) => x.id === c)).toBe(true);
    await send('sergey', c, 'Есть минутка?');
    expect((await list('maria')).find((x) => x.id === c)!.unread).toBe(1);
  });
});

describe('прочтение', () => {
  it('прочитано до номера: назад не откатывается, лишнее обрезается', async () => {
    const team = ctx.demo.chats.team;
    const director = await ctx.as('director');
    const h = await history('director', team);
    const last = h.messages.at(-1)!.seq;
    const before = await unread('director');
    const r = await director.post(`${API}/chats/${team}/read`, { seq: last + 1000 });
    expect(r.body.data.last_read_seq).toBe(last);
    expect(r.body.data.unread).toBe(before - 5);
    const ev = rt.of('messages_read')[0]!;
    expect(ev.users).toContain(id('olga'));
    expect(ev.payloadFor(id('olga'))).toMatchObject({ chat_id: team, user_id: id('director'), seq: last });
    rt.clear();
    const again = await director.post(`${API}/chats/${team}/read`, { seq: 1 });
    expect(again.body.data.last_read_seq).toBe(last);
    expect(rt.of('messages_read')).toHaveLength(0);
  });

  it('в группе с темами прочтение — по теме', async () => {
    const director = await ctx.as('director');
    const { campus, topics } = ctx.demo.chats;
    expect((await director.post(`${API}/chats/${campus}/read`, { seq: 999999 })).status).toBe(422);
    const r = await director.post(`${API}/chats/${campus}/read`, { seq: 999999, topic_id: topics.analytics });
    expect(r.status).toBe(200);
    const d = await detail('director', campus);
    expect(d.topics.find((t) => t.id === topics.analytics)!.unread).toBe(0);
    expect(d.topics.find((t) => t.id === topics.it)!.unread).toBe(1);
    expect(d.unread).toBe(1);
  });

  it('галочки: «прочитано», когда собеседник дочитал', async () => {
    const chat = ctx.demo.chats.igor;
    const m = await send('director', chat, 'Стенд уже подняли?');
    expect(m.read).toBe(false);
    expect((await history('director', chat)).messages.at(-1)!.read).toBe(false);
    await (await ctx.as('igor')).post(`${API}/chats/${chat}/read`, { seq: m.seq });
    const h = await history('director', chat);
    expect(h.messages.at(-1)!.read).toBe(true);
    expect(h.others_read_seq).toBe(m.seq);
  });
});

describe('история', () => {
  let chat: string;
  const msgs: ChatMessage[] = [];
  beforeAll(async () => {
    chat = await group('anna', 'История', ['igor']);
    const anna = await ctx.as('anna');
    for (let i = 1; i <= 30; i++) msgs.push(await send(anna, chat, `m${i}`));
  });
  const texts = (h: ChatHistory) => h.messages.map((m) => m.text);

  it('без курсора — последние, before — раньше', async () => {
    const h = await history('igor', chat, '?limit=10');
    expect(texts(h)).toEqual(Array.from({ length: 10 }, (_, i) => `m${21 + i}`));
    expect(h).toMatchObject({ has_before: true, has_after: false });
    const prev = await history('igor', chat, `?limit=10&before=${msgs[20]!.seq}`);
    expect(texts(prev)).toEqual(Array.from({ length: 10 }, (_, i) => `m${11 + i}`));
    const all = await history('igor', chat, '?limit=1000');
    expect(all.messages).toHaveLength(31);
    expect(all.has_before).toBe(false);
  });

  it('after — новее, around — окно вокруг сообщения', async () => {
    const next = await history('igor', chat, `?limit=5&after=${msgs[9]!.seq}`);
    expect(texts(next)).toEqual(['m11', 'm12', 'm13', 'm14', 'm15']);
    expect(next.has_after).toBe(true);
    const around = await history('igor', chat, `?limit=10&around=${msgs[14]!.id}`);
    expect(texts(around)).toEqual(['m10', 'm11', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19']);
    expect(around).toMatchObject({ has_before: true, has_after: true });
    expect((await (await ctx.as('igor')).get(`${API}/chats/${chat}/messages?around=${ctx.demo.chats.team}`)).status).toBe(404);
  });

  it('удалённое для себя пропадает только у себя', async () => {
    expect((await (await ctx.as('anna')).delete(`${API}/messages/${msgs[29]!.id}`)).status).toBe(204);
    expect(rt.of('message_deleted')[0]!.users).toEqual([id('anna')]);
    expect(texts(await history('anna', chat, '?limit=1'))).toEqual(['m29']);
    expect(texts(await history('igor', chat, '?limit=1'))).toEqual(['m30']);
  });
});

describe('отправка', () => {
  let chat: string;
  beforeAll(async () => {
    chat = await group('anna', 'Отправка', ['igor']);
  });

  it('повтор с тем же client_id не создаёт дубль', async () => {
    const anna = await ctx.as('anna');
    const r1 = await anna.post(`${API}/chats/${chat}/messages`, { text: 'Привет', client_id: 'c-1' });
    const r2 = await anna.post(`${API}/chats/${chat}/messages`, { text: 'Привет', client_id: 'c-1' });
    expect([r1.status, r2.status]).toEqual([201, 200]);
    expect(r2.body.data.id).toBe(r1.body.data.id);
    expect(rt.of('new_message')).toHaveLength(1);
    const r3 = await (await ctx.as('igor')).post(`${API}/chats/${chat}/messages`, { text: 'Привет', client_id: 'c-1' });
    expect(r3.status).toBe(201);
    expect(r3.body.data.id).not.toBe(r1.body.data.id);
  });

  it('новое сообщение уходит только участникам', async () => {
    await send('igor', chat, 'Как дела?');
    const ev = rt.of('new_message')[0]!;
    expect(ev.users.sort()).toEqual([id('anna'), id('igor')].sort());
    expect(ev.payloadFor(id('anna'))).toMatchObject({ chat_id: chat, message: { text: 'Как дела?', sender_id: id('igor') } });
  });

  it('текст обязателен и ограничен; темы в обычной группе нет', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.post(`${API}/chats/${chat}/messages`, { text: '   ' })).body.error.fields.text).toBeDefined();
    expect((await anna.post(`${API}/chats/${chat}/messages`, { text: 'я'.repeat(4001) })).status).toBe(422);
    const t = await anna.post(`${API}/chats/${chat}/messages`, { text: 'в тему', topic_id: ctx.demo.chats.topics.general });
    expect(t.body.error.fields.topic_id).toBeDefined();
  });

  it('ответ — на сообщение этого чата; ответ в другом чате — на сообщение моего чата', async () => {
    const base = await send('igor', chat, 'Вопрос по пилоту');
    const reply = await send('anna', chat, 'Отвечаю', { reply_to_id: base.id });
    expect(reply.reply_to).toMatchObject({ id: base.id, text: 'Вопрос по пилоту', sender_name: base.sender_name });
    const anna = await ctx.as('anna');
    const teamMsg = (await history('anna', ctx.demo.chats.team)).messages.find((m) => m.kind === 'text')!;
    const wrong = await anna.post(`${API}/chats/${chat}/messages`, { text: 'Ответ', reply_to_id: teamMsg.id });
    expect(wrong.body.error.fields.reply_to_id).toBeDefined();
    const ext = await send(anna, chat, 'Как в рабочей группе', { external_reply_id: teamMsg.id });
    expect(ext.external_reply).toMatchObject({ id: teamMsg.id, chat_id: ctx.demo.chats.team, chat_title: 'Заявки за 30 минут' });
    const secret = (await history('director', ctx.demo.chats.olga)).messages[0]!;
    const denied = await anna.post(`${API}/chats/${chat}/messages`, { text: 'Ответ', external_reply_id: secret.id });
    expect(denied.body.error.fields.external_reply_id).toBeDefined();
  });

  it('изменить можно своё и в течение 48 часов', async () => {
    const m = await send('anna', chat, 'Опечтка');
    const anna = await ctx.as('anna');
    const r = await anna.patch(`${API}/messages/${m.id}`, { text: 'Опечатка' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ text: 'Опечатка', edited_at: NOW.toISOString() });
    expect(rt.of('message_edited')[0]!.payloadFor(id('igor'))).toMatchObject({ id: m.id, text: 'Опечатка' });
    expect((await (await ctx.as('igor')).patch(`${API}/messages/${m.id}`, { text: 'Чужое' })).status).toBe(403);
    await ctx.db.query(`UPDATE messages SET created_at = $2 WHERE id = $1`, [m.id, later(-49 * HOUR)]);
    expect((await anna.patch(`${API}/messages/${m.id}`, { text: 'Поздно' })).status).toBe(403);
  });

  it('удалить для всех: своё — да, чужое — только с правом', async () => {
    const mine = await send('anna', chat, 'Удалю');
    const his = await send('igor', chat, 'Моё');
    const anna = await ctx.as('anna');
    const igor = await ctx.as('igor');
    expect((await igor.delete(`${API}/messages/${mine.id}?for=all`)).status).toBe(403);
    rt.clear();
    expect((await anna.delete(`${API}/messages/${mine.id}?for=all`)).status).toBe(204);
    expect(rt.of('message_deleted')[0]!.users.sort()).toEqual([id('anna'), id('igor')].sort());
    expect((await history('igor', chat)).messages.some((m) => m.id === mine.id)).toBe(false);
    expect((await igor.put(`${API}/messages/${mine.id}/reaction`, { emoji: '👍' })).status).toBe(404);
    // Создатель группы удаляет чужое.
    expect((await anna.delete(`${API}/messages/${his.id}?for=all`)).status).toBe(204);
    // В личном чате чужое для всех не удалить.
    const igorsMsg = (await history('director', ctx.demo.chats.igor)).messages.find((m) => m.sender_id === id('igor'))!;
    expect((await (await ctx.as('director')).delete(`${API}/messages/${igorsMsg.id}?for=all`)).status).toBe(403);
  });

  it('удаление пачкой — только из одного чата', async () => {
    const a = await send('anna', chat, 'раз');
    const b = await send('anna', chat, 'два');
    const other = await send('anna', ctx.demo.chats.team, 'из другого чата');
    const anna = await ctx.as('anna');
    const mixed = await anna.post(`${API}/messages/delete`, { ids: [a.id, other.id], for: 'all' });
    expect(mixed.body.error.fields.ids).toBeDefined();
    expect((await anna.post(`${API}/messages/delete`, { ids: [a.id, b.id], for: 'all' })).status).toBe(204);
    const left = (await history('igor', chat)).messages.map((m) => m.id);
    expect(left).not.toContain(a.id);
    expect(left).not.toContain(b.id);
  });
});

describe('пересылка, закреп и реакции', () => {
  let chat: string;
  beforeAll(async () => {
    chat = await group('anna', 'Пересылка', ['igor']);
  });

  it('пересылка хранит автора и чат первоисточника', async () => {
    const team = await history('anna', ctx.demo.chats.team);
    const sergey = team.messages.find((m) => m.text?.startsWith('Медиана за неделю'))!;
    const anna = await ctx.as('anna');
    const r = await anna.post(`${API}/messages/forward`, { message_ids: [sergey.id], to_chat_id: chat });
    expect(r.status).toBe(201);
    const fwd = r.body.data[0] as ChatMessage;
    expect(fwd).toMatchObject({ sender_id: id('anna'), text: sergey.text, forwarded_from: { sender_name: sergey.sender_name, chat_title: 'Заявки за 30 минут' } });
    // Пересылка пересланного ведёт к первоисточнику.
    const direct = (await (await ctx.as('igor')).post(`${API}/chats/direct`, { user_id: id('anna') })).body.data.id;
    const again = await (await ctx.as('igor')).post(`${API}/messages/forward`, { message_ids: [fwd.id], to_chat_id: direct });
    expect(again.body.data[0].forwarded_from).toEqual({ sender_name: sergey.sender_name, chat_title: 'Заявки за 30 минут' });
    const poll = team.messages.find((m) => m.kind === 'poll')!;
    expect((await anna.post(`${API}/messages/forward`, { message_ids: [poll.id], to_chat_id: chat })).status).toBe(422);
    expect((await anna.post(`${API}/messages/forward`, { message_ids: [sergey.id], to_chat_id: ctx.demo.chats.olga })).status).toBe(404);
    const secret = (await history('director', ctx.demo.chats.olga)).messages[0]!;
    expect((await anna.post(`${API}/messages/forward`, { message_ids: [secret.id], to_chat_id: chat })).status).toBe(404);
  });

  it('закреп: в группе — со служебной строкой, список закреплённых', async () => {
    const m = await send('anna', chat, 'Важно: дедлайн в пятницу');
    const igor = await ctx.as('igor');
    const r = await igor.post(`${API}/messages/${m.id}/pin`);
    expect(r.body.data.pinned).toBe(true);
    expect(rt.of('message_pinned')[0]!.payloadFor(id('anna'))).toMatchObject({ id: m.id, pinned: true });
    const service = rt.of('new_message').map((e) => (e.payloadFor(id('anna')) as { message: ChatMessage }).message);
    expect(service.at(-1)).toMatchObject({ kind: 'service', text: expect.stringContaining('закрепляет сообщение') });
    const pinned = await igor.get(`${API}/chats/${chat}/pinned`);
    expect(pinned.body.data.map((x: ChatMessage) => x.id)).toEqual([m.id]);
    expect((await igor.post(`${API}/messages/${service.at(-1)!.id}/pin`)).status).toBe(422);
    expect((await igor.delete(`${API}/messages/${m.id}/pin`)).body.data.pinned).toBe(false);
    expect((await igor.get(`${API}/chats/${chat}/pinned`)).body.data).toEqual([]);
  });

  it('реакция: одна от человека, повторная заменяет', async () => {
    const m = await send('anna', chat, 'Запускаем?');
    const igor = await ctx.as('igor');
    expect((await igor.put(`${API}/messages/${m.id}/reaction`, { emoji: '👍' })).body.data).toEqual([expect.objectContaining({ emoji: '👍', count: 1, mine: true })]);
    expect((await igor.put(`${API}/messages/${m.id}/reaction`, { emoji: '❤️' })).body.data).toEqual([expect.objectContaining({ emoji: '❤️', count: 1 })]);
    rt.clear();
    const both = await (await ctx.as('anna')).put(`${API}/messages/${m.id}/reaction`, { emoji: '❤️' });
    expect(both.body.data[0]).toMatchObject({ emoji: '❤️', count: 2, mine: true });
    const ev = rt.of('message_reactions')[0]!;
    expect((ev.payloadFor(id('igor')) as { reactions: { mine: boolean }[] }).reactions[0]!.mine).toBe(true);
    expect((await igor.put(`${API}/messages/${m.id}/reaction`, { emoji: '🦄' })).status).toBe(400);
    expect((await igor.delete(`${API}/messages/${m.id}/reaction`)).body.data[0]).toMatchObject({ count: 1, mine: false });
  });
});

describe('опросы', () => {
  let chat: string;
  beforeAll(async () => {
    chat = await group('anna', 'Опросы', ['igor']);
  });
  const create = async (body: Record<string, unknown>) => (await ctx.as('anna')).post(`${API}/chats/${chat}/polls`, body);

  it('проверка вариантов и викторины', async () => {
    expect((await create({ question: 'Где обедаем?', options: ['Столовая'] })).body.error.fields.options).toBeDefined();
    expect((await create({ question: 'Где обедаем?', options: ['Столовая', 'столовая '] })).body.error.fields.options).toMatch(/повторяются/);
    expect((await create({ question: 'Столица?', options: ['A', 'B'], quiz: true })).body.error.fields.correct_option).toBeDefined();
    expect((await create({ question: '', options: ['A', 'B'] })).body.error.fields.question).toBeDefined();
  });

  it('голос, отзыв, закрытие и кто как проголосовал', async () => {
    const r = await create({ question: 'Где обедаем?', options: ['Столовая', 'Кафе'], anonymous: false });
    expect(r.status).toBe(201);
    const msg = r.body.data as ChatMessage;
    expect(msg).toMatchObject({ kind: 'poll', text: 'Где обедаем?' });
    const [o1, o2] = msg.poll!.options.map((o) => o.id);
    const igor = await ctx.as('igor');
    expect((await igor.post(`${API}/messages/${msg.id}/vote`, { option_ids: [o1, o2] })).status).toBe(422);
    const v = await igor.post(`${API}/messages/${msg.id}/vote`, { option_ids: [o1] });
    expect(v.body.data).toMatchObject({ voted: true, total_voters: 1 });
    expect(rt.of('poll_updated').at(-1)!.payloadFor(id('anna'))).toMatchObject({ poll: { voted: false, total_voters: 1 } });
    expect((await igor.post(`${API}/messages/${msg.id}/vote`, { option_ids: [o2] })).status).toBe(409);
    expect((await igor.delete(`${API}/messages/${msg.id}/vote`)).body.data.total_voters).toBe(0);
    await igor.post(`${API}/messages/${msg.id}/vote`, { option_ids: [o2] });
    const voters = await (await ctx.as('anna')).get(`${API}/messages/${msg.id}/voters`);
    expect(voters.body.data).toEqual([
      { option_id: o1, people: [] },
      { option_id: o2, people: [expect.objectContaining({ id: id('igor') })] },
    ]);
    expect((await igor.post(`${API}/messages/${msg.id}/close-poll`)).status).toBe(403);
    expect((await (await ctx.as('anna')).post(`${API}/messages/${msg.id}/close-poll`)).body.data.closed).toBe(true);
    expect((await (await ctx.as('anna')).post(`${API}/messages/${msg.id}/vote`, { option_ids: [o1] })).status).toBe(409);
  });

  it('анонимный опрос не раскрывает голоса', async () => {
    const msg = (await create({ question: 'Нравится новый портал?', options: ['Да', 'Нет'] })).body.data as ChatMessage;
    expect(msg.poll!.anonymous).toBe(true);
    expect((await (await ctx.as('anna')).get(`${API}/messages/${msg.id}/voters`)).status).toBe(403);
  });

  it('викторина: правильный ответ виден после ответа, ответ окончательный', async () => {
    const msg = (await create({ question: 'Сколько минут — цель?', options: ['20', '30', '40'], quiz: true, correct_option: 1, explanation: 'Цель — 30 минут' })).body.data as ChatMessage;
    expect(msg.poll!.options.every((o) => o.correct === undefined)).toBe(true);
    expect(msg.poll!.explanation).toBeNull();
    const igor = await ctx.as('igor');
    const v = await igor.post(`${API}/messages/${msg.id}/vote`, { option_ids: [msg.poll!.options[0]!.id] });
    const poll = v.body.data as ChatPoll;
    expect(poll.options.map((o) => o.correct)).toEqual([false, true, false]);
    expect(poll.explanation).toBe('Цель — 30 минут');
    expect((await igor.delete(`${API}/messages/${msg.id}/vote`)).status).toBe(409);
    const annaView = (await history('anna', chat)).messages.find((m) => m.id === msg.id)!;
    expect(annaView.poll!.options[1]!.correct).toBeUndefined();
  });
});

describe('отложенные сообщения', () => {
  let chat: string;
  beforeAll(async () => {
    chat = await group('anna', 'Отложенные', ['igor']);
  });

  it('создать, изменить, отправить сейчас; видит только автор', async () => {
    const anna = await ctx.as('anna');
    const soon = await anna.post(`${API}/chats/${chat}/scheduled`, { text: 'Напоминание', send_at: later(30_000) });
    expect(soon.body.error.fields.send_at).toBeDefined();
    const r = await anna.post(`${API}/chats/${chat}/scheduled`, { text: 'Напоминание', send_at: later(2 * HOUR) });
    expect(r.status).toBe(201);
    expect(rt.of('scheduled_changed')[0]!.users).toEqual([id('anna')]);
    expect((await (await ctx.as('igor')).get(`${API}/chats/${chat}/scheduled`)).body.data).toEqual([]);
    const sid = r.body.data.id;
    expect((await (await ctx.as('igor')).patch(`${API}/chats/${chat}/scheduled/${sid}`, { text: 'Чужое' })).status).toBe(404);
    expect((await anna.patch(`${API}/chats/${chat}/scheduled/${sid}`, { text: 'Напоминание: отчёт' })).body.data.text).toBe('Напоминание: отчёт');
    const sent = await anna.post(`${API}/chats/${chat}/scheduled/${sid}/send`);
    expect(sent.status).toBe(201);
    expect(sent.body.data.text).toBe('Напоминание: отчёт');
    expect((await anna.get(`${API}/chats/${chat}/scheduled`)).body.data).toEqual([]);
  });

  it('отправщик шлёт то, чему пришло время; ушедшего из чата — снимает', async () => {
    const anna = await ctx.as('anna');
    await anna.post(`${API}/chats/${chat}/scheduled`, { text: 'Через час', send_at: later(HOUR) });
    await anna.post(`${API}/chats/${chat}/scheduled`, { text: 'Через три часа', send_at: later(3 * HOUR) });
    const temp = await group('igor', 'Временная', ['anna']);
    await (await ctx.as('igor')).post(`${API}/chats/${temp}/scheduled`, { text: 'Не дойдёт', send_at: later(1.5 * HOUR) });
    await (await ctx.as('igor')).post(`${API}/chats/${temp}/leave`);
    rt.clear();
    expect(await dispatchScheduled(ctx.db, rt, later(2 * HOUR))).toBe(1);
    expect(rt.of('new_message')).toHaveLength(1);
    expect(await dispatchScheduled(ctx.db, rt, later(2 * HOUR))).toBe(0);
    expect((await history('igor', chat)).messages.at(-1)!.text).toBe('Через час');
    expect((await history('anna', temp)).messages.some((m) => m.text === 'Не дойдёт')).toBe(false);
    const left = (await anna.get(`${API}/chats/${chat}/scheduled`)).body.data;
    expect(left.map((s: { text: string }) => s.text)).toEqual(['Через три часа']);
  });
});

describe('темы', () => {
  let chat: string;
  let budget: string;

  it('включить темы может создатель; вся переписка — в «Общем»', async () => {
    chat = await group('anna', 'Проект', ['igor', 'dima']);
    const before = await send('anna', chat, 'До тем');
    expect((await (await ctx.as('igor')).post(`${API}/chats/${chat}/topics/enable`)).status).toBe(403);
    const r = await (await ctx.as('anna')).post(`${API}/chats/${chat}/topics/enable`);
    expect(r.status).toBe(200);
    const d = r.body.data as ChatDetail;
    expect(d.is_supergroup).toBe(true);
    expect(d.topics.map((t) => t.name)).toEqual(['Общее']);
    const general = await history('igor', chat, `?topic_id=${d.topics[0]!.id}`);
    expect(general.messages.find((m) => m.id === before.id)!.topic_id).toBe(d.topics[0]!.id);
    // В группе с темами участник название не меняет.
    expect((await (await ctx.as('igor')).patch(`${API}/chats/${chat}`, { name: 'Мой проект' })).status).toBe(403);
  });

  it('тему создаёт создатель; сообщения и непрочитанные — по темам', async () => {
    expect((await (await ctx.as('igor')).post(`${API}/chats/${chat}/topics`, { name: 'Бюджет' })).status).toBe(403);
    const anna = await ctx.as('anna');
    expect((await anna.post(`${API}/chats/${chat}/topics`, { name: '  ' })).body.error.fields.name).toBeDefined();
    const r = await anna.post(`${API}/chats/${chat}/topics`, { name: 'Бюджет', icon: '📊', color: '#3fd6a0' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ name: 'Бюджет', icon: '📊', color: '#3fd6a0', is_general: false });
    budget = r.body.data.id;
    const m = await send('igor', chat, 'Смета готова', { topic_id: budget });
    expect(m.topic_id).toBe(budget);
    const plain = await send('igor', chat, 'Без темы');
    expect(plain.topic_id).not.toBe(budget);
    const topics = (await detail('anna', chat)).topics;
    expect(topics.find((t) => t.id === budget)).toMatchObject({ unread: 1, last_message: expect.objectContaining({ text: 'Смета готова' }) });
    const inBudget = await history('anna', chat, `?topic_id=${budget}`);
    expect(inBudget.messages.map((x) => x.text)).toEqual([expect.stringContaining('создаёт тему «Бюджет»'), 'Смета готова']);
    await anna.post(`${API}/chats/${chat}/read`, { seq: m.seq, topic_id: budget });
    expect((await detail('anna', chat)).topics.find((t) => t.id === budget)!.unread).toBe(0);
  });

  it('в закрытой теме пишет только тот, кто управляет темами', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.patch(`${API}/chats/${chat}/topics/${budget}`, { closed: true })).body.data.closed).toBe(true);
    expect((await (await ctx.as('igor')).post(`${API}/chats/${chat}/messages`, { text: 'Ещё', topic_id: budget })).status).toBe(403);
    await send(anna, chat, 'Итог по смете', { topic_id: budget });
  });

  it('общую тему не удалить; удалённая уносит свои сообщения', async () => {
    const anna = await ctx.as('anna');
    const general = (await detail('anna', chat)).topics.find((t) => t.is_general)!;
    expect((await anna.delete(`${API}/chats/${chat}/topics/${general.id}`)).body.error.fields.topic).toBeDefined();
    expect((await anna.delete(`${API}/chats/${chat}/topics/${budget}`)).status).toBe(204);
    expect((await ctx.db.query(`SELECT 1 FROM messages WHERE topic_id = $1`, [budget])).rows).toHaveLength(0);
    expect((await (await ctx.as('igor')).get(`${API}/chats/${chat}/messages?topic_id=${budget}`)).status).toBe(404);
  });

  it('группа сразу с темами; в обычной группе темы не создать', async () => {
    const sg = await group('anna', 'Сразу с темами', ['igor'], true);
    expect((await detail('igor', sg)).topics).toEqual([expect.objectContaining({ name: 'Общее', is_general: true })]);
    const plain = await group('anna', 'Без тем', []);
    expect((await (await ctx.as('anna')).post(`${API}/chats/${plain}/topics`, { name: 'Тема' })).body.error.fields.chat).toBeDefined();
  });
});

describe('поиск', () => {
  it('по всем моим чатам: части слов, тема в результате', async () => {
    const r = await (await ctx.as('director')).get(`${API}/chats/search?q=${encodeURIComponent('медиан')}`);
    const hits = r.body.data as { chat_id: string; chat_title: string; topic_name: string | null }[];
    expect(hits.find((h) => h.chat_id === ctx.demo.chats.team)!.chat_title).toBe('Заявки за 30 минут');
    expect(hits.find((h) => h.chat_id === ctx.demo.chats.campus)!.topic_name).toBe('Аналитика');
  });

  it('ё = е и запрос в другой раскладке', async () => {
    const chat = await group('elena', 'Новый год', []);
    await send('elena', chat, 'Ёлочные игрушки закупили');
    const elena = await ctx.as('elena');
    expect((await elena.get(`${API}/chats/search?q=${encodeURIComponent('елочн')}`)).body.data).toHaveLength(1);
    const switched = await elena.get(`${API}/chats/search?q=vtlbfyf`);
    expect(switched.body.data.map((m: ChatMessage) => m.text)).toContain('Выгрузил время обработки за неделю: медиана 34 минуты, было 41. Таблица в базе знаний.');
  });

  it('чужие чаты не ищутся; в чате — только этот чат', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.get(`${API}/chats/search?q=${encodeURIComponent('гибкий график')}`)).body.data).toEqual([]);
    const inTeam = await anna.get(`${API}/chats/${ctx.demo.chats.team}/search?q=${encodeURIComponent('заявк')}`);
    expect(inTeam.body.data.length).toBeGreaterThan(0);
    expect(inTeam.body.data.every((m: ChatMessage) => m.chat_id === ctx.demo.chats.team)).toBe(true);
    expect((await anna.get(`${API}/chats/search?q=`)).body.data).toEqual([]);
  });
});

describe('push о сообщениях', () => {
  const IGOR_PHONE = 'ExponentPushToken[igor-phone-0001]';
  const sender = () => {
    const sent: ChatPushMessage[] = [];
    const s: PushSender<ChatPushMessage> & { sent: ChatPushMessage[] } = {
      sent,
      async send(messages) {
        sent.push(...messages);
        return messages.map(() => ({ status: 'ok' as const }));
      },
    };
    return s;
  };
  const rows = async (chatId: string, messageId: string) => ({
    chat: (await ctx.db.query<ChatRow>(`SELECT id, company_id, type, name, is_supergroup, created_by, direct_key, created_at FROM chats WHERE id = $1`, [chatId])).rows[0]!,
    row: (await ctx.db.query<MessageRow>(`${MSG_SELECT} WHERE m.id = $1`, [messageId])).rows[0]!,
  });

  beforeAll(async () => {
    expect((await (await ctx.as('igor')).post(`${API}/push/devices`, { token: IGOR_PHONE, platform: 'ios' })).status).toBe(201);
  });

  it('тому, кого нет в сети: в группе — «Имя: текст», значок — все непрочитанные', async () => {
    const m = await send('anna', ctx.demo.chats.team, 'Очередь разобрана');
    const s = sender();
    const { chat, row } = await rows(ctx.demo.chats.team, m.id);
    const result = await sendChatPush(ctx.db, s, rt, chat, row, NOW.toISOString());
    expect(result.sent).toBe(1);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ to: IGOR_PHONE, title: 'Заявки за 30 минут', data: { kind: 'message', chat_id: chat.id, message_id: m.id } });
    expect(s.sent[0]!.body).toBe('Анна Королёва: Очередь разобрана');
    expect(s.sent[0]!.badge).toBeGreaterThan(0);
  });

  it('в сети, чат без звука или тема «Сообщения» выключена — не шлём', async () => {
    const m = await send('anna', ctx.demo.chats.team, 'Ещё одно');
    const { chat, row } = await rows(ctx.demo.chats.team, m.id);
    const s = sender();
    rt.online.add(id('igor'));
    expect((await sendChatPush(ctx.db, s, rt, chat, row, NOW.toISOString())).sent).toBe(0);
    rt.online.clear();
    const igor = await ctx.as('igor');
    await igor.patch(`${API}/chats/${chat.id}/membership`, { muted_until: later(HOUR) });
    expect((await sendChatPush(ctx.db, s, rt, chat, row, NOW.toISOString())).sent).toBe(0);
    await igor.patch(`${API}/chats/${chat.id}/membership`, { muted_until: null });
    expect((await igor.put(`${API}/push/settings`, { muted: ['messages'], quiet_hours: false })).status).toBe(200);
    expect((await sendChatPush(ctx.db, s, rt, chat, row, NOW.toISOString())).sent).toBe(0);
    await igor.put(`${API}/push/settings`, { muted: [], quiet_hours: false });
    expect((await sendChatPush(ctx.db, s, rt, chat, row, NOW.toISOString())).sent).toBe(1);
    expect(s.sent).toHaveLength(1);
  });

  it('в личном чате заголовок — имя отправителя', async () => {
    const m = await send('director', ctx.demo.chats.igor, 'Зайди, пожалуйста');
    const { chat, row } = await rows(ctx.demo.chats.igor, m.id);
    const s = sender();
    await sendChatPush(ctx.db, s, rt, chat, row, NOW.toISOString());
    expect(s.sent[0]).toMatchObject({ title: 'Алексей Петров', body: 'Зайди, пожалуйста' });
  });
});

describe('сокет', () => {
  let server: HttpServer;
  let url: string;
  const sockets: Socket[] = [];
  const pushes: ChatPushMessage[] = [];
  const DIMA_PHONE = 'ExponentPushToken[dima-phone-0001]';

  beforeAll(async () => {
    const hub = createRealtimeHub();
    const app = createApp({
      db: ctx.db,
      config: { jwtSecret: SECRET, corsOrigins: ['http://localhost:5173'] } as Parameters<typeof createApp>[0]['config'],
      now: () => NOW,
      rateLimit: false,
      realtime: hub,
      messagePush: {
        async send(messages) {
          pushes.push(...messages);
          return messages.map(() => ({ status: 'ok' as const }));
        },
      },
    });
    server = createServer(app);
    attachSocket(server, hub, { db: ctx.db, secret: SECRET, corsOrigins: ['http://localhost:5173'], now: () => NOW });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await (await ctx.as('dima')).post(`${API}/push/devices`, { token: DIMA_PHONE, platform: 'android' });
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  /** Подключиться и сразу начать записывать события, чтобы не пропустить первые. */
  function connect(token: string) {
    const s = connectSocket(url, { path: '/socket.io', auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
    const got: { event: string; payload: unknown }[] = [];
    s.onAny((event, payload) => got.push({ event, payload }));
    sockets.push(s);
    s.connect();
    return { s, got };
  }

  function waitFor<T = Record<string, unknown>>(rec: { got: { event: string; payload: unknown }[] }, event: string, pred: (p: T) => boolean = () => true, ms = 4000): Promise<T> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const hit = rec.got.find((g) => g.event === event && pred(g.payload as T));
        if (hit) return resolve(hit.payload as T);
        if (Date.now() - started > ms) return reject(new Error(`нет события ${event}`));
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  const until = async (cond: () => boolean, ms = 4000) => {
    const started = Date.now();
    while (!cond()) {
      if (Date.now() - started > ms) throw new Error('не дождались');
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it('без токена или с чужой подписью — отказ', async () => {
    const bad = connectSocket(url, { path: '/socket.io', auth: { token: 'nope' }, transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(bad);
    const err = await new Promise<Error>((resolve) => bad.on('connect_error', resolve));
    expect(err.message).toBe('UNAUTHORIZED');
  });

  it('в сети, печатает, новые сообщения, вышел из сети и push тем, кого нет', async () => {
    const anna = connect(await ctx.token('anna'));
    const online = await waitFor<{ user_ids: string[] }>(anna, 'online');
    expect(online.user_ids).toContain(id('anna'));

    const igor = connect(await ctx.token('igor'));
    await waitFor(anna, 'presence', (p) => p.user_id === id('igor') && p.online === true);
    const elena = connect(await ctx.token('elena'));
    await waitFor(elena, 'online');

    // «Печатает» — только участникам чата.
    anna.s.emit('typing', { chat_id: ctx.demo.chats.team });
    expect(await waitFor(igor, 'typing')).toMatchObject({ chat_id: ctx.demo.chats.team, user_id: id('anna'), name: expect.any(String) });
    anna.s.emit('typing', { chat_id: 'не uuid' });
    await new Promise((r) => setTimeout(r, 100));
    expect(elena.got.some((g) => g.event === 'typing')).toBe(false);

    // Сообщение по HTTP приходит в сокет; push — Диме (не в сети), но не Игорю (в сети).
    const r = await request(server)
      .post(`${API}/chats/${ctx.demo.chats.team}/messages`)
      .set('Authorization', `Bearer ${await ctx.token('anna')}`)
      .send({ text: 'Сокет на связи' });
    expect(r.status).toBe(201);
    const nm = await waitFor<{ chat_id: string; message: ChatMessage }>(igor, 'new_message', (p) => p.message.text === 'Сокет на связи');
    expect(nm.chat_id).toBe(ctx.demo.chats.team);
    expect(elena.got.some((g) => g.event === 'new_message')).toBe(false);
    await until(() => pushes.length > 0);
    expect(pushes.map((p) => p.to)).toEqual([DIMA_PHONE]);

    // Последняя вкладка закрыта — «был(а) в сети».
    igor.s.disconnect();
    const off = await waitFor(anna, 'presence', (p) => p.user_id === id('igor') && p.online === false);
    expect(off.last_seen_at).toBe(NOW.toISOString());
    const seen = (await ctx.db.query<{ last_seen_at: string }>(`SELECT last_seen_at FROM users WHERE id = $1`, [id('igor')])).rows[0]!;
    expect(seen.last_seen_at).toBe(NOW.toISOString());
  });
});
