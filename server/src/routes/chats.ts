import { Router } from 'express';
import { z } from 'zod';
import {
  CHAT_PERMISSIONS,
  CHAT_PINS_MAX,
  GROUP_MEMBERS_MAX,
  MESSAGE_MAX,
  TOPIC_COLORS,
  TOPIC_ICONS,
  TOPIC_NAME_MAX,
  serviceText,
  validateChatName,
  validateMessageText,
  validatePoll,
  validateScheduleAt,
  type ChatHistory,
  type ChatSearchHit,
  type ScheduledMessage,
} from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import type { Realtime } from '../realtime/hub';
import {
  MSG_SELECT,
  broadcast,
  broadcastMessage,
  chatDetail,
  companyPeople,
  directKey,
  generalTopicId,
  hydrate,
  insertMessage,
  listChats,
  markRead,
  maxSeq,
  memberIds,
  myReadSeq,
  openChat,
  openMessage,
  othersReadSeq,
  requireRight,
  resolveTopic,
  serviceMessage,
  tokensWhere,
  totalUnread,
  type ChatAccess,
  type ChatRow,
  type MessageRow,
} from '../services/chats';

export interface ChatDeps {
  db: Db;
  now: () => Date;
  rt: Realtime;
  /** После нового сообщения: push тем, кого нет в сети. */
  onMessage?: (chat: ChatRow, row: MessageRow) => void;
}

const uuid = z.string().refine(isUuid);
const textField = z.string().max(MESSAGE_MAX + 1000);

const sendSchema = z.object({
  text: textField,
  client_id: z.string().min(1).max(64).optional(),
  reply_to_id: uuid.nullable().optional(),
  external_reply_id: uuid.nullable().optional(),
  topic_id: uuid.nullable().optional(),
});

const pollSchema = z.object({
  question: z.string().max(1000),
  options: z.array(z.string().max(1000)).max(20),
  anonymous: z.boolean().default(true),
  multiple: z.boolean().default(false),
  quiz: z.boolean().default(false),
  correct_option: z.number().int().nullable().optional(),
  explanation: z.string().max(1000).nullable().optional(),
  topic_id: uuid.nullable().optional(),
  client_id: z.string().min(1).max(64).optional(),
});

const SCHEDULED_COLS = `id, chat_id, topic_id, text, send_at, created_at`;

/**
 * Чаты: `/api/v1/chats`. Видит чат и пишет в него только участник; чат
 * чужой компании или без участия — 404. Права в группе — как в Telegram
 * (core chatRights). Каждое изменение рассылается участникам в реальном
 * времени, а всё, что умеет сокет, есть и обычными запросами.
 */
export function chatsRouter({ db, now, rt, onMessage }: ChatDeps): Router {
  const r = Router();
  const at = () => now().toISOString();

  const deliver = async (q: Queryable, chat: ChatRow, row: MessageRow) => {
    await broadcastMessage(q, rt, chat, row);
    if (row.kind !== 'service') onMessage?.(chat, row);
  };
  const changed = (q: Queryable, chat: ChatRow, extra: string[] = []) => broadcast(q, rt, chat, 'chat_updated', { chat_id: chat.id }, extra);

  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    res.json({ data: await listChats(db, actor, rt, at()) });
  });

  r.get('/unread', async (req, res) => {
    const actor = actorOf(req);
    res.json({ data: { unread: await totalUnread(db, actor.id, actor.company_id, at()) } });
  });

  /** Поиск по всем моим чатам. */
  r.get('/search', async (req, res) => {
    const actor = actorOf(req);
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const params: unknown[] = [actor.id, actor.company_id];
    const where = tokensWhere('m.text', q, params);
    if (!where) {
      res.json({ data: [] });
      return;
    }
    const { rows } = await db.query<MessageRow & { chat_type: 'private' | 'group'; chat_name: string | null; topic_name: string | null; direct_key: string | null }>(
      `${MSG_SELECT.replace('FROM messages m', ', c.type AS chat_type, c.name AS chat_name, c.direct_key, t.name AS topic_name FROM messages m')}
         JOIN chats c ON c.id = m.chat_id JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $1
         LEFT JOIN topics t ON t.id = m.topic_id
        WHERE m.company_id = $2 AND m.kind IN ('text', 'poll') AND NOT m.deleted_for_all AND NOT ($1 = ANY(m.deleted_for)) AND ${where}
        ORDER BY m.seq DESC LIMIT 50`,
      params,
    );
    const titles = new Map((await listChats(db, actor, rt, at())).map((c) => [c.id, c.title]));
    const hydrated = await hydrate(db, actor.id, rows, 0);
    const data: ChatSearchHit[] = hydrated.map((m, i) => ({ ...m, chat_title: titles.get(m.chat_id) ?? rows[i]!.chat_name ?? 'Чат', chat_type: rows[i]!.chat_type, topic_name: rows[i]!.topic_name }));
    res.json({ data });
  });

  /** Личный чат с сотрудником: один на пару, повторный вызов вернёт тот же. С собой — «Избранное». */
  r.post('/direct', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ user_id: uuid }), req.body);
    const [peer] = await companyPeople(db, actor.company_id, [body.user_id]);
    if (!peer) throw invalid('Не удалось начать чат', { user_id: 'Сотрудник не найден' });
    const key = directKey(actor.id, peer.id);
    const { chatId, created } = await db.tx(async (q) => {
      const found = await q.query<{ id: string }>(`SELECT id FROM chats WHERE company_id = $1 AND direct_key = $2`, [actor.company_id, key]);
      if (found.rows[0]) {
        // Если я скрыл чат или вышел из него — вернём.
        await q.query(`INSERT INTO chat_members (chat_id, company_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [found.rows[0].id, actor.company_id, actor.id]);
        await q.query(`UPDATE chat_members SET hidden_at = NULL WHERE chat_id = $1 AND user_id = $2`, [found.rows[0].id, actor.id]);
        return { chatId: found.rows[0].id, created: false };
      }
      const { rows } = await q.query<{ id: string }>(`INSERT INTO chats (company_id, type, created_by, direct_key, created_at, updated_at) VALUES ($1, 'private', $2, $3, $4, $4) RETURNING id`, [
        actor.company_id,
        actor.id,
        key,
        at(),
      ]);
      for (const uid of new Set([actor.id, peer.id])) await q.query(`INSERT INTO chat_members (chat_id, company_id, user_id, joined_at) VALUES ($1, $2, $3, $4)`, [rows[0]!.id, actor.company_id, uid, at()]);
      return { chatId: rows[0]!.id, created: true };
    });
    const [chat] = await listChats(db, actor, rt, at(), chatId);
    if (created) rt.emit(actor.company_id, [actor.id, peer.id], 'chat_created', { chat_id: chatId });
    res.status(created ? 201 : 200).json({ data: chat });
  });

  /** Группа: название и участники; с supergroup — сразу с темами. */
  r.post('/', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ name: z.string().max(1000), member_ids: z.array(uuid).max(GROUP_MEMBERS_MAX), supergroup: z.boolean().optional() }), req.body);
    const nameErr = validateChatName(body.name);
    if (nameErr) throw invalid('Не удалось создать группу', { name: nameErr });
    const people = await companyPeople(
      db,
      actor.company_id,
      body.member_ids.filter((id) => id !== actor.id),
    );
    const name = body.name.trim();
    const chat = await db.tx(async (q) => {
      const { rows } = await q.query<ChatRow>(
        `INSERT INTO chats (company_id, type, name, is_supergroup, created_by, created_at, updated_at) VALUES ($1, 'group', $2, $3, $4, $5, $5)
         RETURNING id, company_id, type, name, is_supergroup, created_by, direct_key, created_at`,
        [actor.company_id, name, !!body.supergroup, actor.id, at()],
      );
      const c = rows[0]!;
      for (const uid of [actor.id, ...people.map((p) => p.id)]) await q.query(`INSERT INTO chat_members (chat_id, company_id, user_id, joined_at) VALUES ($1, $2, $3, $4)`, [c.id, actor.company_id, uid, at()]);
      if (c.is_supergroup) await q.query(`INSERT INTO topics (chat_id, company_id, name, icon, is_general, created_by, created_at) VALUES ($1, $2, 'Общее', '💬', TRUE, $3, $4)`, [c.id, actor.company_id, actor.id, at()]);
      await serviceMessage(q, c, actor.id, serviceText.created(actor.display_name, name), at());
      return c;
    });
    rt.emit(actor.company_id, [actor.id, ...people.map((p) => p.id)], 'chat_created', { chat_id: chat.id });
    const [summary] = await listChats(db, actor, rt, at(), chat.id);
    res.status(201).json({ data: summary });
  });

  r.get('/:id', async (req, res) => {
    const actor = actorOf(req);
    const a = await openChat(db, actor, idParam(req.params.id));
    res.json({ data: await chatDetail(db, actor, rt, at(), a) });
  });

  r.patch('/:id', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ name: z.string().max(1000) }), req.body);
    const err = validateChatName(body.name);
    if (err) throw invalid('Не удалось переименовать', { name: err });
    const name = body.name.trim();
    await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (a.chat.type !== 'group') throw invalid('Не удалось переименовать', { name: 'Личный чат не переименовать' });
      requireRight(a, 'change_info', 'Менять название может администратор');
      if (a.chat.name === name) return;
      await q.query(`UPDATE chats SET name = $2, updated_at = $3 WHERE id = $1`, [a.chat.id, name, at()]);
      const row = await serviceMessage(q, { ...a.chat, name }, actor.id, serviceText.renamed(actor.display_name, name), at());
      await deliver(q, a.chat, row);
      await changed(q, a.chat);
    });
    const a = await openChat(db, actor, idParam(req.params.id));
    res.json({ data: await chatDetail(db, actor, rt, at(), a) });
  });

  /** Удалить чат для всех: группу — только создатель, личный — любой из двоих. */
  r.delete('/:id', async (req, res) => {
    const actor = actorOf(req);
    const ids = await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (a.chat.type === 'group' && !a.rights.isCreator) throw forbidden('Удалить группу может только её создатель');
      const ids = await memberIds(q, a.chat.id);
      await q.query(`DELETE FROM chats WHERE id = $1`, [a.chat.id]);
      return ids;
    });
    rt.emit(actor.company_id, ids, 'chat_deleted', { chat_id: req.params.id });
    res.status(204).end();
  });

  /** Выйти из группы. Создатель передаёт группу администратору или самому давнему участнику; последний — удаляет её. */
  r.post('/:id/leave', async (req, res) => {
    const actor = actorOf(req);
    await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (a.chat.type !== 'group') throw invalid('Не удалось выйти', { chat: 'Из личного чата не выйти — его можно удалить' });
      await q.query(`DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, actor.id]);
      const left = await memberIds(q, a.chat.id);
      if (!left.length) {
        await q.query(`DELETE FROM chats WHERE id = $1`, [a.chat.id]);
        return;
      }
      if (a.rights.isCreator) {
        const heir = (
          await q.query<{ user_id: string }>(
            `SELECT cm.user_id FROM chat_members cm LEFT JOIN chat_admins ad ON ad.chat_id = cm.chat_id AND ad.user_id = cm.user_id
              WHERE cm.chat_id = $1 ORDER BY (ad.user_id IS NULL), cm.joined_at, cm.user_id LIMIT 1`,
            [a.chat.id],
          )
        ).rows[0]!.user_id;
        await q.query(`UPDATE chats SET created_by = $2 WHERE id = $1`, [a.chat.id, heir]);
        await q.query(`DELETE FROM chat_admins WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, heir]);
      }
      const row = await serviceMessage(q, a.chat, actor.id, serviceText.left(actor.display_name), at());
      await deliver(q, a.chat, row);
      await broadcast(q, rt, a.chat, 'members_changed', { chat_id: a.chat.id });
    });
    rt.emit(actor.company_id, [actor.id], 'chat_deleted', { chat_id: req.params.id });
    res.status(204).end();
  });

  r.post('/:id/members', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ user_ids: z.array(uuid).min(1).max(GROUP_MEMBERS_MAX) }), req.body);
    const added = await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (a.chat.type !== 'group') throw invalid('Не удалось добавить', { user_ids: 'В личный чат нельзя добавить участников — создайте группу' });
      requireRight(a, 'add_users', 'Приглашать участников может администратор');
      const current = new Set(await memberIds(q, a.chat.id));
      const people = (await companyPeople(q, actor.company_id, body.user_ids)).filter((p) => !current.has(p.id));
      if (!people.length) return [];
      if (current.size + people.length > GROUP_MEMBERS_MAX) throw invalid('Не удалось добавить', { user_ids: `В группе — не больше ${GROUP_MEMBERS_MAX} участников` });
      // Новичок видит историю, но старые сообщения не считаются непрочитанными.
      const seq = await maxSeq(q, a.chat.id);
      for (const p of people) await q.query(`INSERT INTO chat_members (chat_id, company_id, user_id, joined_at, last_read_seq) VALUES ($1, $2, $3, $4, $5)`, [a.chat.id, actor.company_id, p.id, at(), seq]);
      const row = await serviceMessage(
        q,
        a.chat,
        actor.id,
        serviceText.added(
          actor.display_name,
          people.map((p) => p.display_name),
        ),
        at(),
      );
      await deliver(q, a.chat, row);
      await broadcast(q, rt, a.chat, 'members_changed', { chat_id: a.chat.id });
      rt.emit(
        actor.company_id,
        people.map((p) => p.id),
        'chat_created',
        { chat_id: a.chat.id },
      );
      return people;
    });
    res.json({ data: { added: added.map((p) => p.id) } });
  });

  r.delete('/:id/members/:userId', async (req, res) => {
    const actor = actorOf(req);
    const userId = idParam(req.params.userId);
    await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (a.chat.type !== 'group') throw notFound('Участник не найден');
      if (userId === actor.id) throw invalid('Не удалось исключить', { user_id: 'Чтобы уйти из группы, выберите «Выйти»' });
      requireRight(a, 'ban_users', 'Исключать участников может администратор');
      const target = (
        await q.query<{ display_name: string; is_admin: boolean; granted_by: string | null }>(
          `SELECT u.display_name, ad.user_id IS NOT NULL AS is_admin, ad.granted_by FROM chat_members cm JOIN users u ON u.id = cm.user_id
             LEFT JOIN chat_admins ad ON ad.chat_id = cm.chat_id AND ad.user_id = cm.user_id WHERE cm.chat_id = $1 AND cm.user_id = $2`,
          [a.chat.id, userId],
        )
      ).rows[0];
      if (!target) throw notFound('Участник не найден');
      if (userId === a.chat.created_by) throw forbidden('Создателя группы исключить нельзя');
      if (target.is_admin && !a.rights.isCreator && target.granted_by !== actor.id) throw forbidden('Администратора может исключить создатель группы или тот, кто его назначил');
      await q.query(`DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, userId]);
      const row = await serviceMessage(q, a.chat, actor.id, serviceText.removed(actor.display_name, target.display_name), at());
      await deliver(q, a.chat, row);
      await broadcast(q, rt, a.chat, 'members_changed', { chat_id: a.chat.id });
    });
    rt.emit(actor.company_id, [userId], 'chat_deleted', { chat_id: req.params.id });
    res.status(204).end();
  });

  /** Назначить администратора или поменять его права. Выдать можно только те права, что есть у самого. */
  r.put('/:id/admins/:userId', async (req, res) => {
    const actor = actorOf(req);
    const userId = idParam(req.params.userId);
    const body = parseBody(z.object({ permissions: z.array(z.enum(CHAT_PERMISSIONS)).max(CHAT_PERMISSIONS.length) }), req.body);
    await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (a.chat.type !== 'group') throw notFound('Участник не найден');
      requireRight(a, 'add_admins', 'Назначать администраторов может создатель группы');
      if (userId === a.chat.created_by) throw invalid('Не удалось назначить', { user_id: 'У создателя группы и так есть все права' });
      if (userId === actor.id) throw invalid('Не удалось назначить', { user_id: 'Свои права поменять нельзя' });
      const isMember = (await q.query(`SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, userId])).rows.length > 0;
      if (!isMember) throw notFound('Участник не найден');
      const extra = body.permissions.filter((p) => !a.rights.can(p));
      if (extra.length) throw forbidden('Можно выдать только те права, что есть у вас');
      const perms = CHAT_PERMISSIONS.filter((p) => body.permissions.includes(p));
      await q.query(
        `INSERT INTO chat_admins (chat_id, user_id, permissions, granted_by, granted_at) VALUES ($1, $2, $3::text[], $4, $5)
         ON CONFLICT (chat_id, user_id) DO UPDATE SET permissions = EXCLUDED.permissions`,
        [a.chat.id, userId, perms, actor.id, at()],
      );
      await broadcast(q, rt, a.chat, 'members_changed', { chat_id: a.chat.id });
    });
    const a = await openChat(db, actor, idParam(req.params.id));
    res.json({ data: (await chatDetail(db, actor, rt, at(), a)).members.find((m) => m.id === userId) });
  });

  r.delete('/:id/admins/:userId', async (req, res) => {
    const actor = actorOf(req);
    const userId = idParam(req.params.userId);
    await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      requireRight(a, 'add_admins', 'Снимать администраторов может создатель группы');
      const row = (await q.query<{ granted_by: string | null }>(`SELECT granted_by FROM chat_admins WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, userId])).rows[0];
      if (!row) throw notFound('Администратор не найден');
      if (!a.rights.isCreator && row.granted_by !== actor.id) throw forbidden('Снять администратора может создатель группы или тот, кто его назначил');
      await q.query(`DELETE FROM chat_admins WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, userId]);
      await broadcast(q, rt, a.chat, 'members_changed', { chat_id: a.chat.id });
    });
    res.status(204).end();
  });

  /** Мои настройки чата: закреп (до 10), без звука до даты, скрыть из списка. */
  r.patch('/:id/membership', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(
      z.object({ pinned: z.boolean().optional(), muted_until: z.string().datetime({ offset: true }).nullable().optional(), hidden: z.boolean().optional() }),
      req.body,
    );
    const a = await openChat(db, actor, idParam(req.params.id));
    await db.tx(async (q) => {
      if (body.pinned === true) {
        const { rows } = await q.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM chat_members WHERE user_id = $1 AND company_id = $2 AND pinned_at IS NOT NULL AND chat_id <> $3`, [
          actor.id,
          actor.company_id,
          a.chat.id,
        ]);
        if ((rows[0]?.n ?? 0) >= CHAT_PINS_MAX) throw invalid('Не удалось закрепить', { pinned: `Закрепить можно не больше ${CHAT_PINS_MAX} чатов` });
        await q.query(`UPDATE chat_members SET pinned_at = COALESCE(pinned_at, $3) WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, actor.id, at()]);
      } else if (body.pinned === false) await q.query(`UPDATE chat_members SET pinned_at = NULL WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, actor.id]);
      if (body.muted_until !== undefined) await q.query(`UPDATE chat_members SET muted_until = $3 WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, actor.id, body.muted_until]);
      if (body.hidden !== undefined) await q.query(`UPDATE chat_members SET hidden_at = $3 WHERE chat_id = $1 AND user_id = $2`, [a.chat.id, actor.id, body.hidden ? at() : null]);
    });
    rt.emit(actor.company_id, [actor.id], 'chat_updated', { chat_id: a.chat.id });
    const [summary] = await listChats(db, actor, rt, at(), a.chat.id);
    res.json({ data: summary });
  });

  /** Прочитано до номера сообщения (в группе с темами — в теме). */
  r.post('/:id/read', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ seq: z.number().int().nonnegative(), topic_id: uuid.nullable().optional() }), req.body);
    const a = await openChat(db, actor, idParam(req.params.id));
    const topicId = a.chat.is_supergroup ? (body.topic_id ?? null) : null;
    if (a.chat.is_supergroup && !topicId) throw invalid('Не удалось отметить', { topic_id: 'Укажите тему' });
    if (topicId && !(await db.query(`SELECT 1 FROM topics WHERE id = $1 AND chat_id = $2`, [topicId, a.chat.id])).rows.length) throw notFound('Тема не найдена');
    const seq = Math.min(body.seq, await maxSeq(db, a.chat.id));
    const before = await myReadSeq(db, a.chat.id, actor.id, topicId);
    const after = await markRead(db, a.chat, actor.id, topicId, seq);
    if (after > before) await broadcast(db, rt, a.chat, 'messages_read', { chat_id: a.chat.id, topic_id: topicId, user_id: actor.id, seq: after });
    res.json({ data: { last_read_seq: after, unread: await totalUnread(db, actor.id, actor.company_id, at()) } });
  });

  /** Печатает… — запасной путь без сокета. */
  r.post('/:id/typing', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ topic_id: uuid.nullable().optional(), stop: z.boolean().optional() }), req.body);
    const a = await openChat(db, actor, idParam(req.params.id));
    const ids = (await memberIds(db, a.chat.id)).filter((id) => id !== actor.id);
    rt.emit(actor.company_id, ids, body.stop ? 'stop_typing' : 'typing', { chat_id: a.chat.id, topic_id: body.topic_id ?? null, user_id: actor.id, name: actor.display_name });
    res.status(204).end();
  });

  // ------------------------------------------------------------ история

  /**
   * История: `before`/`after` — курсор по номеру, `around` — окно вокруг
   * сообщения (переход к закрепу или найденному). Без курсора — последние.
   */
  r.get('/:id/messages', async (req, res) => {
    const actor = actorOf(req);
    const a = await openChat(db, actor, idParam(req.params.id));
    const num = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
    const limit = Math.min(Math.max(num(req.query.limit) ?? 50, 1), 100);
    const topicParam = typeof req.query.topic_id === 'string' ? req.query.topic_id : null;
    if (topicParam && !isUuid(topicParam)) throw notFound('Тема не найдена');
    const topicId = a.chat.is_supergroup ? (topicParam ?? (await generalTopicId(db, a.chat.id))) : null;
    if (topicId && !(await db.query(`SELECT 1 FROM topics WHERE id = $1 AND chat_id = $2`, [topicId, a.chat.id])).rows.length) throw notFound('Тема не найдена');

    const base = `${MSG_SELECT} WHERE m.chat_id = $1 AND NOT m.deleted_for_all AND NOT ($2 = ANY(m.deleted_for)) AND ($3::uuid IS NULL OR m.topic_id = $3::uuid)`;
    const params = [a.chat.id, actor.id, topicId];
    const page = async (cond: string, order: 'ASC' | 'DESC', value: number, n: number) =>
      (await db.query<MessageRow>(`${base} AND ${cond} ORDER BY m.seq ${order} LIMIT ${n + 1}`, [...params, value])).rows;

    let rows: MessageRow[];
    let hasBefore = false;
    let hasAfter = false;
    const before = num(req.query.before);
    const after = num(req.query.after);
    const around = typeof req.query.around === 'string' && isUuid(req.query.around) ? req.query.around : null;
    if (around) {
      const target = (await db.query<{ seq: number }>(`SELECT seq FROM messages WHERE id = $1 AND chat_id = $2`, [around, a.chat.id])).rows[0];
      if (!target) throw notFound('Сообщение не найдено');
      const half = Math.floor(limit / 2);
      const older = await page('m.seq < $4', 'DESC', target.seq, half);
      const newer = await page('m.seq >= $4', 'ASC', target.seq, limit - half);
      hasBefore = older.length > half;
      hasAfter = newer.length > limit - half;
      rows = [...older.slice(0, half).reverse(), ...newer.slice(0, limit - half)];
    } else if (after != null) {
      const newer = await page('m.seq > $4', 'ASC', after, limit);
      hasAfter = newer.length > limit;
      hasBefore = true;
      rows = newer.slice(0, limit);
    } else {
      const older = await page('m.seq < $4', 'DESC', before ?? Number.MAX_SAFE_INTEGER, limit);
      hasBefore = older.length > limit;
      rows = older.slice(0, limit).reverse();
    }
    const others = await othersReadSeq(db, a.chat.id, actor.id, topicId);
    const data: ChatHistory = {
      messages: await hydrate(db, actor.id, rows, others),
      has_before: hasBefore,
      has_after: hasAfter,
      my_last_read_seq: await myReadSeq(db, a.chat.id, actor.id, topicId),
      others_read_seq: others,
    };
    res.json({ data });
  });

  r.get('/:id/pinned', async (req, res) => {
    const actor = actorOf(req);
    const a = await openChat(db, actor, idParam(req.params.id));
    const topicId = typeof req.query.topic_id === 'string' && isUuid(req.query.topic_id) ? req.query.topic_id : null;
    const { rows } = await db.query<MessageRow>(
      `${MSG_SELECT} WHERE m.chat_id = $1 AND m.pinned_at IS NOT NULL AND NOT m.deleted_for_all AND NOT ($2 = ANY(m.deleted_for)) AND ($3::uuid IS NULL OR m.topic_id = $3::uuid) ORDER BY m.seq DESC`,
      [a.chat.id, actor.id, topicId],
    );
    res.json({ data: await hydrate(db, actor.id, rows, await othersReadSeq(db, a.chat.id, actor.id, topicId)) });
  });

  r.get('/:id/search', async (req, res) => {
    const actor = actorOf(req);
    const a = await openChat(db, actor, idParam(req.params.id));
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const topicId = typeof req.query.topic_id === 'string' && isUuid(req.query.topic_id) ? req.query.topic_id : null;
    const params: unknown[] = [a.chat.id, actor.id, topicId];
    const where = tokensWhere('m.text', q, params);
    if (!where) {
      res.json({ data: [] });
      return;
    }
    const { rows } = await db.query<MessageRow>(
      `${MSG_SELECT} WHERE m.chat_id = $1 AND m.kind IN ('text', 'poll') AND NOT m.deleted_for_all AND NOT ($2 = ANY(m.deleted_for)) AND ($3::uuid IS NULL OR m.topic_id = $3::uuid) AND ${where}
        ORDER BY m.seq DESC LIMIT 50`,
      params,
    );
    res.json({ data: await hydrate(db, actor.id, rows, await othersReadSeq(db, a.chat.id, actor.id, topicId)) });
  });

  // ------------------------------------------------------------ отправка

  /** Проверки ответа: на сообщение этого чата или (внешний ответ) другого моего чата. */
  const checkReplies = async (q: Queryable, actor: AuthedActor, a: ChatAccess, replyTo?: string | null, externalReply?: string | null) => {
    if (replyTo) {
      const ok = (await q.query(`SELECT 1 FROM messages WHERE id = $1 AND chat_id = $2 AND NOT deleted_for_all AND NOT ($3 = ANY(deleted_for))`, [replyTo, a.chat.id, actor.id])).rows.length;
      if (!ok) throw invalid('Не удалось отправить сообщение', { reply_to_id: 'Сообщение, на которое вы отвечаете, не найдено' });
    }
    if (externalReply) {
      const ok = (
        await q.query(
          `SELECT 1 FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
            WHERE m.id = $1 AND m.company_id = $3 AND m.chat_id <> $4 AND m.kind <> 'service' AND NOT m.deleted_for_all AND NOT ($2 = ANY(m.deleted_for))`,
          [externalReply, actor.id, actor.company_id, a.chat.id],
        )
      ).rows.length;
      if (!ok) throw invalid('Не удалось отправить сообщение', { external_reply_id: 'Сообщение, на которое вы отвечаете, не найдено' });
    }
  };

  r.post('/:id/messages', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(sendSchema, req.body);
    const err = validateMessageText(body.text);
    if (err) throw invalid('Не удалось отправить сообщение', { text: err });
    const chatId = idParam(req.params.id);
    // Повтор с тем же client_id — то же сообщение, без дубля.
    if (body.client_id) {
      const dup = (await db.query<MessageRow>(`${MSG_SELECT} WHERE m.sender_id = $1 AND m.client_id = $2 AND m.chat_id = $3`, [actor.id, body.client_id, chatId])).rows[0];
      if (dup) {
        const [msg] = await hydrate(db, actor.id, [dup], await othersReadSeq(db, chatId, actor.id, dup.topic_id));
        res.json({ data: msg });
        return;
      }
    }
    const { chat, row } = await db.tx(async (q) => {
      const a = await openChat(q, actor, chatId);
      const topicId = await resolveTopic(q, a, body.topic_id);
      await checkReplies(q, actor, a, body.reply_to_id, body.external_reply_id);
      const row = await insertMessage(
        q,
        a.chat,
        actor.id,
        { text: body.text.trim(), topic_id: topicId, reply_to_id: body.reply_to_id, external_reply_id: body.external_reply_id, client_id: body.client_id },
        at(),
      );
      return { chat: a.chat, row };
    });
    await deliver(db, chat, row);
    const [msg] = await hydrate(db, actor.id, [row], 0);
    res.status(201).json({ data: msg });
  });

  r.post('/:id/polls', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(pollSchema, req.body);
    const errors = validatePoll({ ...body, options: body.options });
    if (Object.keys(errors).length) throw invalid('Не удалось создать опрос', errors);
    const options = body.options.map((o) => o.trim()).filter(Boolean);
    const { chat, row } = await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      const topicId = await resolveTopic(q, a, body.topic_id);
      const row = await insertMessage(q, a.chat, actor.id, { kind: 'poll', text: body.question.trim(), topic_id: topicId, client_id: body.client_id }, at());
      const poll = (
        await q.query<{ id: string }>(`INSERT INTO polls (message_id, question, anonymous, multiple, quiz, explanation) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [
          row.id,
          body.question.trim(),
          body.anonymous,
          body.quiz ? false : body.multiple,
          body.quiz,
          body.explanation?.trim() || null,
        ])
      ).rows[0]!;
      for (const [i, text] of options.entries())
        await q.query(`INSERT INTO poll_options (poll_id, position, text, correct) VALUES ($1, $2, $3, $4)`, [poll.id, i, text, body.quiz && body.correct_option === i]);
      return { chat: a.chat, row };
    });
    await deliver(db, chat, row);
    const [msg] = await hydrate(db, actor.id, [row], 0);
    res.status(201).json({ data: msg });
  });

  // ------------------------------------------------------------ отложенные

  r.get('/:id/scheduled', async (req, res) => {
    const actor = actorOf(req);
    const a = await openChat(db, actor, idParam(req.params.id));
    const { rows } = await db.query<ScheduledMessage>(`SELECT ${SCHEDULED_COLS} FROM scheduled_messages WHERE chat_id = $1 AND sender_id = $2 ORDER BY send_at, created_at`, [a.chat.id, actor.id]);
    res.json({ data: rows });
  });

  r.post('/:id/scheduled', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ text: textField, send_at: z.string().max(40), topic_id: uuid.nullable().optional(), reply_to_id: uuid.nullable().optional() }), req.body);
    const errors: Record<string, string> = {};
    const tErr = validateMessageText(body.text);
    if (tErr) errors.text = tErr;
    const sErr = validateScheduleAt(body.send_at, at());
    if (sErr) errors.send_at = sErr;
    if (Object.keys(errors).length) throw invalid('Не удалось запланировать', errors);
    const row = await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      const topicId = await resolveTopic(q, a, body.topic_id);
      await checkReplies(q, actor, a, body.reply_to_id, null);
      return (
        await q.query<ScheduledMessage>(
          `INSERT INTO scheduled_messages (chat_id, company_id, topic_id, sender_id, text, reply_to_id, send_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${SCHEDULED_COLS}`,
          [a.chat.id, actor.company_id, topicId, actor.id, body.text.trim(), body.reply_to_id ?? null, new Date(body.send_at).toISOString(), at()],
        )
      ).rows[0]!;
    });
    rt.emit(actor.company_id, [actor.id], 'scheduled_changed', { chat_id: row.chat_id });
    res.status(201).json({ data: row });
  });

  const ownScheduled = async (q: Queryable, actor: AuthedActor, chatId: string, id: string) => {
    await openChat(q, actor, chatId);
    const row = (await q.query<ScheduledMessage>(`SELECT ${SCHEDULED_COLS} FROM scheduled_messages WHERE id = $1 AND chat_id = $2 AND sender_id = $3`, [id, chatId, actor.id])).rows[0];
    if (!row) throw notFound('Отложенное сообщение не найдено');
    return row;
  };

  r.patch('/:id/scheduled/:sid', async (req, res) => {
    const actor = actorOf(req);
    const chatId = idParam(req.params.id);
    const body = parseBody(z.object({ text: textField.optional(), send_at: z.string().max(40).optional() }), req.body);
    const errors: Record<string, string> = {};
    if (body.text !== undefined) {
      const e = validateMessageText(body.text);
      if (e) errors.text = e;
    }
    if (body.send_at !== undefined) {
      const e = validateScheduleAt(body.send_at, at());
      if (e) errors.send_at = e;
    }
    if (Object.keys(errors).length) throw invalid('Не удалось сохранить', errors);
    await ownScheduled(db, actor, chatId, idParam(req.params.sid));
    const row = (
      await db.query<ScheduledMessage>(
        `UPDATE scheduled_messages SET text = COALESCE($2, text), send_at = COALESCE($3::timestamptz, send_at) WHERE id = $1 RETURNING ${SCHEDULED_COLS}`,
        [req.params.sid, body.text?.trim() ?? null, body.send_at ? new Date(body.send_at).toISOString() : null],
      )
    ).rows[0]!;
    rt.emit(actor.company_id, [actor.id], 'scheduled_changed', { chat_id: chatId });
    res.json({ data: row });
  });

  r.delete('/:id/scheduled/:sid', async (req, res) => {
    const actor = actorOf(req);
    const chatId = idParam(req.params.id);
    await ownScheduled(db, actor, chatId, idParam(req.params.sid));
    await db.query(`DELETE FROM scheduled_messages WHERE id = $1`, [req.params.sid]);
    rt.emit(actor.company_id, [actor.id], 'scheduled_changed', { chat_id: chatId });
    res.status(204).end();
  });

  /** Отправить отложенное прямо сейчас. */
  r.post('/:id/scheduled/:sid/send', async (req, res) => {
    const actor = actorOf(req);
    const chatId = idParam(req.params.id);
    const { chat, row } = await db.tx(async (q) => {
      const s = await ownScheduled(q, actor, chatId, idParam(req.params.sid));
      const a = await openChat(q, actor, chatId);
      const full = (await q.query<{ reply_to_id: string | null }>(`DELETE FROM scheduled_messages WHERE id = $1 RETURNING reply_to_id`, [s.id])).rows[0]!;
      const row = await insertMessage(q, a.chat, actor.id, { text: s.text, topic_id: s.topic_id, reply_to_id: full.reply_to_id }, at());
      return { chat: a.chat, row };
    });
    await deliver(db, chat, row);
    rt.emit(actor.company_id, [actor.id], 'scheduled_changed', { chat_id: chatId });
    const [msg] = await hydrate(db, actor.id, [row], 0);
    res.status(201).json({ data: msg });
  });

  // ------------------------------------------------------------ темы

  const topicBody = z.object({
    name: z.string().max(1000).optional(),
    icon: z.enum(TOPIC_ICONS).optional(),
    color: z.enum(TOPIC_COLORS).optional(),
    closed: z.boolean().optional(),
  });
  const checkTopicName = (name: string | undefined, required: boolean) => {
    if (name === undefined && !required) return;
    if (!name?.trim()) throw invalid('Не удалось сохранить тему', { name: 'Назовите тему' });
    if (name.trim().length > TOPIC_NAME_MAX) throw invalid('Не удалось сохранить тему', { name: `Не длиннее ${TOPIC_NAME_MAX} символов` });
  };

  /** Включить темы: группа становится группой с темами, вся переписка — в «Общем». */
  r.post('/:id/topics/enable', async (req, res) => {
    const actor = actorOf(req);
    await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (a.chat.type !== 'group') throw invalid('Не удалось включить темы', { chat: 'Темы бывают только в группах' });
      if (!a.rights.canManageTopics) throw forbidden('Включить темы может создатель группы или администратор');
      if (a.chat.is_supergroup) return;
      const general = (await q.query<{ id: string }>(`INSERT INTO topics (chat_id, company_id, name, icon, is_general, created_by, created_at) VALUES ($1, $2, 'Общее', '💬', TRUE, $3, $4) RETURNING id`, [a.chat.id, actor.company_id, actor.id, at()])).rows[0]!;
      await q.query(`UPDATE chats SET is_supergroup = TRUE WHERE id = $1`, [a.chat.id]);
      await q.query(`UPDATE messages SET topic_id = $2 WHERE chat_id = $1 AND topic_id IS NULL`, [a.chat.id, general.id]);
      await q.query(`INSERT INTO topic_reads (topic_id, user_id, last_read_seq) SELECT $2, user_id, last_read_seq FROM chat_members WHERE chat_id = $1`, [a.chat.id, general.id]);
      const chat = { ...a.chat, is_supergroup: true };
      const row = await serviceMessage(q, chat, actor.id, serviceText.topicsOn(actor.display_name), at(), general.id);
      await deliver(q, chat, row);
      await changed(q, chat);
    });
    const a = await openChat(db, actor, idParam(req.params.id));
    res.json({ data: await chatDetail(db, actor, rt, at(), a) });
  });

  r.post('/:id/topics', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(topicBody, req.body);
    checkTopicName(body.name, true);
    const topicId = await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (!a.chat.is_supergroup) throw invalid('Не удалось создать тему', { chat: 'Сначала включите темы' });
      if (!a.rights.canManageTopics) throw forbidden('Создавать темы может создатель группы или администратор');
      const t = (
        await q.query<{ id: string }>(`INSERT INTO topics (chat_id, company_id, name, icon, color, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [
          a.chat.id,
          actor.company_id,
          body.name!.trim(),
          body.icon ?? '💬',
          body.color ?? TOPIC_COLORS[0],
          actor.id,
          at(),
        ])
      ).rows[0]!;
      const row = await serviceMessage(q, a.chat, actor.id, serviceText.topicCreated(actor.display_name, body.name!.trim()), at(), t.id);
      await deliver(q, a.chat, row);
      await changed(q, a.chat);
      return t.id;
    });
    const a = await openChat(db, actor, idParam(req.params.id));
    const detail = await chatDetail(db, actor, rt, at(), a);
    res.status(201).json({ data: detail.topics.find((t) => t.id === topicId) });
  });

  r.patch('/:id/topics/:tid', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(topicBody, req.body);
    checkTopicName(body.name, false);
    const tid = idParam(req.params.tid);
    await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (!a.rights.canManageTopics) throw forbidden('Менять темы может создатель группы или администратор');
      const { rows } = await q.query(`UPDATE topics SET name = COALESCE($3, name), icon = COALESCE($4, icon), color = COALESCE($5, color), closed = COALESCE($6, closed) WHERE id = $1 AND chat_id = $2 RETURNING id`, [
        tid,
        a.chat.id,
        body.name?.trim() ?? null,
        body.icon ?? null,
        body.color ?? null,
        body.closed ?? null,
      ]);
      if (!rows.length) throw notFound('Тема не найдена');
      await changed(q, a.chat);
    });
    const a = await openChat(db, actor, idParam(req.params.id));
    res.json({ data: (await chatDetail(db, actor, rt, at(), a)).topics.find((t) => t.id === tid) });
  });

  r.delete('/:id/topics/:tid', async (req, res) => {
    const actor = actorOf(req);
    const tid = idParam(req.params.tid);
    await db.tx(async (q) => {
      const a = await openChat(q, actor, idParam(req.params.id));
      if (!a.rights.canManageTopics) throw forbidden('Удалять темы может создатель группы или администратор');
      const t = (await q.query<{ is_general: boolean }>(`SELECT is_general FROM topics WHERE id = $1 AND chat_id = $2`, [tid, a.chat.id])).rows[0];
      if (!t) throw notFound('Тема не найдена');
      if (t.is_general) throw invalid('Не удалось удалить тему', { topic: 'Общую тему удалить нельзя' });
      await q.query(`DELETE FROM topics WHERE id = $1`, [tid]);
      await changed(q, a.chat);
    });
    res.status(204).end();
  });

  return r;
}
