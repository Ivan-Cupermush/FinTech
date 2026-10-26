import {
  chatRights,
  chatTitle,
  parsePermissions,
  rightsList,
  searchTokens,
  type ChatDetail,
  type ChatMember,
  type ChatMessage,
  type ChatMessageRef,
  type ChatPoll,
  type ChatReaction,
  type ChatRights,
  type ChatSummary,
  type ChatTopic,
  type ChatType,
  type MessageKind,
} from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import type { Queryable } from '../db/db';
import { forbidden, invalid, notFound } from '../http/errors';
import type { Realtime } from '../realtime/hub';

export interface ChatRow {
  id: string;
  company_id: string;
  type: ChatType;
  name: string | null;
  is_supergroup: boolean;
  created_by: string | null;
  direct_key: string | null;
  created_at: string;
}

export interface ChatAccess {
  chat: ChatRow;
  last_read_seq: number;
  muted_until: string | null;
  admin: string[] | null;
  rights: ChatRights;
}

const CHAT_COLS = `c.id, c.company_id, c.type, c.name, c.is_supergroup, c.created_by, c.direct_key, c.created_at`;

/** Чат, если человек в нём состоит. Чужой или несуществующий — 404: не подтверждаем, что он есть. */
export async function openChat(q: Queryable, actor: AuthedActor, chatId: string): Promise<ChatAccess> {
  const { rows } = await q.query<ChatRow & { last_read_seq: number; muted_until: string | null; permissions: string[] | null; is_admin: boolean }>(
    `SELECT ${CHAT_COLS}, cm.last_read_seq, cm.muted_until, a.permissions, a.user_id IS NOT NULL AS is_admin
       FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $2
       LEFT JOIN chat_admins a ON a.chat_id = c.id AND a.user_id = $2
      WHERE c.id = $1 AND c.company_id = $3`,
    [chatId, actor.id, actor.company_id],
  );
  const r = rows[0];
  if (!r) throw notFound('Чат не найден');
  const admin = r.is_admin ? parsePermissions(r.permissions) : null;
  const chat: ChatRow = { id: r.id, company_id: r.company_id, type: r.type, name: r.name, is_supergroup: r.is_supergroup, created_by: r.created_by, direct_key: r.direct_key, created_at: r.created_at };
  return {
    chat,
    last_read_seq: r.last_read_seq,
    muted_until: r.muted_until,
    admin,
    rights: chatRights({ type: r.type, isSupergroup: r.is_supergroup, isMember: true, isCreator: r.created_by === actor.id, adminPermissions: admin }),
  };
}

export function requireRight(a: ChatAccess, perm: Parameters<ChatRights['can']>[0], message: string) {
  if (!a.rights.can(perm)) throw forbidden(message);
}

export async function memberIds(q: Queryable, chatId: string): Promise<string[]> {
  return (await q.query<{ user_id: string }>(`SELECT user_id FROM chat_members WHERE chat_id = $1`, [chatId])).rows.map((r) => r.user_id);
}

export async function maxSeq(q: Queryable, chatId: string): Promise<number> {
  return (await q.query<{ n: number }>(`SELECT COALESCE(MAX(seq), 0)::bigint AS n FROM messages WHERE chat_id = $1`, [chatId])).rows[0]?.n ?? 0;
}

/** Активные сотрудники компании из списка; остальных молча отбрасываем — их как будто нет. */
export async function companyPeople(q: Queryable, companyId: string, ids: string[]): Promise<{ id: string; display_name: string }[]> {
  if (!ids.length) return [];
  return (
    await q.query<{ id: string; display_name: string }>(
      `SELECT u.id, u.display_name FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $1 WHERE u.id = ANY($2::uuid[]) AND u.active ORDER BY u.display_name`,
      [companyId, ids],
    )
  ).rows;
}

export const directKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// ---------------------------------------------------------------- сообщения

export interface MessageRow {
  id: string;
  chat_id: string;
  seq: number;
  topic_id: string | null;
  kind: MessageKind;
  sender_id: string | null;
  sender_name: string | null;
  text: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_for_all: boolean;
  deleted_for: string[];
  pinned_at: string | null;
  client_id: string | null;
  reply_to_id: string | null;
  external_reply_id: string | null;
  forward_sender_name: string | null;
  forward_chat_title: string | null;
}

export const MSG_SELECT = `SELECT m.id, m.chat_id, m.seq, m.topic_id, m.kind, m.sender_id, u.display_name AS sender_name, m.text, m.created_at, m.edited_at,
       m.deleted_for_all, m.deleted_for, m.pinned_at, m.client_id, m.reply_to_id, m.external_reply_id, m.forward_sender_name, m.forward_chat_title
  FROM messages m LEFT JOIN users u ON u.id = m.sender_id`;

/** Сообщение, видимое человеку: в его чате, не удалено для всех и не удалено им для себя. */
export async function openMessage(q: Queryable, actor: AuthedActor, messageId: string): Promise<{ msg: MessageRow; access: ChatAccess }> {
  const { rows } = await q.query<MessageRow>(`${MSG_SELECT} WHERE m.id = $1 AND m.company_id = $2`, [messageId, actor.company_id]);
  const msg = rows[0];
  if (!msg || msg.deleted_for_all || msg.deleted_for?.includes(actor.id)) throw notFound('Сообщение не найдено');
  const access = await openChat(q, actor, msg.chat_id);
  return { msg, access };
}

interface PollRaw {
  id: string;
  message_id: string;
  question: string;
  anonymous: boolean;
  multiple: boolean;
  quiz: boolean;
  explanation: string | null;
  closed_at: string | null;
  options: { id: string; text: string; correct: boolean }[];
  votes: { option_id: string; user_id: string }[];
}

export async function loadPolls(q: Queryable, messageIds: string[]): Promise<Map<string, PollRaw>> {
  const out = new Map<string, PollRaw>();
  if (!messageIds.length) return out;
  const polls = await q.query<Omit<PollRaw, 'options' | 'votes'>>(`SELECT id, message_id, question, anonymous, multiple, quiz, explanation, closed_at FROM polls WHERE message_id = ANY($1::uuid[])`, [messageIds]);
  if (!polls.rows.length) return out;
  const ids = polls.rows.map((p) => p.id);
  const opts = await q.query<{ id: string; poll_id: string; text: string; correct: boolean }>(`SELECT id, poll_id, text, correct FROM poll_options WHERE poll_id = ANY($1::uuid[]) ORDER BY position`, [ids]);
  const votes = await q.query<{ poll_id: string; option_id: string; user_id: string }>(`SELECT poll_id, option_id, user_id FROM poll_votes WHERE poll_id = ANY($1::uuid[]) ORDER BY voted_at`, [ids]);
  for (const p of polls.rows) {
    out.set(p.message_id, {
      ...p,
      options: opts.rows.filter((o) => o.poll_id === p.id),
      votes: votes.rows.filter((v) => v.poll_id === p.id),
    });
  }
  return out;
}

/** Опрос глазами человека: свой голос, итоги, правильный ответ викторины — после ответа или закрытия. */
export function serializePoll(p: PollRaw, viewerId: string): ChatPoll {
  const voted = p.votes.some((v) => v.user_id === viewerId);
  const closed = !!p.closed_at;
  const reveal = !p.quiz || voted || closed;
  return {
    id: p.id,
    question: p.question,
    anonymous: p.anonymous,
    multiple: p.multiple,
    quiz: p.quiz,
    closed,
    explanation: reveal ? p.explanation : null,
    total_voters: new Set(p.votes.map((v) => v.user_id)).size,
    voted,
    options: p.options.map((o) => ({
      id: o.id,
      text: o.text,
      votes: p.votes.filter((v) => v.option_id === o.id).length,
      voted: p.votes.some((v) => v.option_id === o.id && v.user_id === viewerId),
      ...(p.quiz && reveal ? { correct: o.correct } : {}),
    })),
  };
}

interface ReactionRaw {
  message_id: string;
  emoji: string;
  user_id: string;
  display_name: string;
}

export async function loadReactions(q: Queryable, messageIds: string[]): Promise<ReactionRaw[]> {
  if (!messageIds.length) return [];
  return (
    await q.query<ReactionRaw>(
      `SELECT r.message_id, r.emoji, r.user_id, u.display_name FROM message_reactions r JOIN users u ON u.id = r.user_id WHERE r.message_id = ANY($1::uuid[]) ORDER BY r.created_at, r.user_id`,
      [messageIds],
    )
  ).rows;
}

/** Реакции: самые частые первыми, при равенстве — кто раньше. */
export function groupReactions(raw: ReactionRaw[], viewerId: string): ChatReaction[] {
  const by = new Map<string, ReactionRaw[]>();
  for (const r of raw) by.set(r.emoji, [...(by.get(r.emoji) ?? []), r]);
  return [...by.entries()]
    .map(([emoji, list]) => ({ emoji, count: list.length, mine: list.some((r) => r.user_id === viewerId), people: list.slice(0, 5).map((r) => r.display_name), user_ids: list.map((r) => r.user_id) }))
    .sort((a, b) => b.count - a.count);
}

const refOf = (r: MessageRow): ChatMessageRef => ({
  id: r.id,
  sender_name: r.sender_name,
  text: r.deleted_for_all ? null : r.text,
  kind: r.kind,
  deleted: r.deleted_for_all,
});

/** Строки сообщений → ответ API: цитаты, реакции, опросы и галочки прочтения. */
export async function hydrate(q: Queryable, viewerId: string, rows: MessageRow[], othersReadSeq: number): Promise<ChatMessage[]> {
  if (!rows.length) return [];
  const refIds = [...new Set(rows.flatMap((r) => [r.reply_to_id, r.external_reply_id]).filter((x): x is string => !!x))];
  const refs = new Map<string, MessageRow & { chat_type: ChatType; chat_name: string | null }>();
  if (refIds.length) {
    const { rows: rr } = await q.query<MessageRow & { chat_type: ChatType; chat_name: string | null }>(
      `SELECT m.id, m.chat_id, m.seq, m.topic_id, m.kind, m.sender_id, u.display_name AS sender_name, m.text, m.created_at, m.edited_at,
              m.deleted_for_all, m.deleted_for, m.pinned_at, m.client_id, m.reply_to_id, m.external_reply_id, m.forward_sender_name, m.forward_chat_title,
              c.type AS chat_type, c.name AS chat_name
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id JOIN chats c ON c.id = m.chat_id WHERE m.id = ANY($1::uuid[])`,
      [refIds],
    );
    for (const r of rr) refs.set(r.id, r);
  }
  const ids = rows.map((r) => r.id);
  const reactions = await loadReactions(q, ids);
  const polls = await loadPolls(q, rows.filter((r) => r.kind === 'poll').map((r) => r.id));
  return rows.map((r) => {
    const reply = r.reply_to_id ? refs.get(r.reply_to_id) : undefined;
    const ext = r.external_reply_id ? refs.get(r.external_reply_id) : undefined;
    const poll = polls.get(r.id);
    return {
      id: r.id,
      chat_id: r.chat_id,
      seq: r.seq,
      topic_id: r.topic_id,
      kind: r.kind,
      sender_id: r.sender_id,
      sender_name: r.sender_name,
      text: r.deleted_for_all ? null : r.text,
      created_at: r.created_at,
      edited_at: r.edited_at,
      deleted: r.deleted_for_all,
      pinned: !!r.pinned_at,
      client_id: r.client_id,
      reply_to: reply ? refOf(reply) : null,
      external_reply: ext ? { ...refOf(ext), chat_id: ext.chat_id, chat_title: ext.chat_type === 'group' ? (ext.chat_name ?? 'Группа') : (ext.sender_name ?? 'Личные сообщения') } : null,
      forwarded_from: r.forward_sender_name || r.forward_chat_title ? { sender_name: r.forward_sender_name, chat_title: r.forward_chat_title } : null,
      reactions: groupReactions(
        reactions.filter((x) => x.message_id === r.id),
        viewerId,
      ),
      poll: poll ? serializePoll(poll, viewerId) : null,
      read: r.sender_id === viewerId && r.seq <= othersReadSeq,
    };
  });
}

/** До какого номера прочитали остальные: в личном — собеседник, в группе — хотя бы один. */
export async function othersReadSeq(q: Queryable, chatId: string, viewerId: string, topicId: string | null): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    `SELECT COALESCE(MAX(COALESCE(tr.last_read_seq, cm.last_read_seq)), 0)::bigint AS n
       FROM chat_members cm LEFT JOIN topic_reads tr ON tr.topic_id = $3::uuid AND tr.user_id = cm.user_id
      WHERE cm.chat_id = $1 AND cm.user_id <> $2`,
    [chatId, viewerId, topicId],
  );
  return rows[0]?.n ?? 0;
}

export async function myReadSeq(q: Queryable, chatId: string, userId: string, topicId: string | null): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    `SELECT COALESCE(tr.last_read_seq, cm.last_read_seq)::bigint AS n FROM chat_members cm
       LEFT JOIN topic_reads tr ON tr.topic_id = $3::uuid AND tr.user_id = cm.user_id WHERE cm.chat_id = $1 AND cm.user_id = $2`,
    [chatId, userId, topicId],
  );
  return rows[0]?.n ?? 0;
}

/** Отметить прочитанным до номера. Назад не откатывается. */
export async function markRead(q: Queryable, chat: ChatRow, userId: string, topicId: string | null, seq: number): Promise<number> {
  if (chat.is_supergroup && topicId) {
    const { rows } = await q.query<{ n: number }>(
      `INSERT INTO topic_reads (topic_id, user_id, last_read_seq) VALUES ($1, $2, $3)
       ON CONFLICT (topic_id, user_id) DO UPDATE SET last_read_seq = GREATEST(topic_reads.last_read_seq, EXCLUDED.last_read_seq) RETURNING last_read_seq AS n`,
      [topicId, userId, seq],
    );
    return rows[0]!.n;
  }
  const { rows } = await q.query<{ n: number }>(`UPDATE chat_members SET last_read_seq = GREATEST(last_read_seq, $3) WHERE chat_id = $1 AND user_id = $2 RETURNING last_read_seq AS n`, [chat.id, userId, seq]);
  return rows[0]?.n ?? 0;
}

export interface NewMessage {
  kind?: MessageKind;
  text: string | null;
  topic_id?: string | null;
  reply_to_id?: string | null;
  external_reply_id?: string | null;
  forwarded_from_id?: string | null;
  forward_sender_name?: string | null;
  forward_chat_title?: string | null;
  client_id?: string | null;
}

/** Записать сообщение. Своё сообщение сразу прочитано, скрытый чат возвращается в список у всех. */
export async function insertMessage(q: Queryable, chat: ChatRow, senderId: string, m: NewMessage, at: string): Promise<MessageRow> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO messages (chat_id, company_id, topic_id, kind, sender_id, text, reply_to_id, external_reply_id, forwarded_from_id, forward_sender_name, forward_chat_title, client_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      chat.id,
      chat.company_id,
      m.topic_id ?? null,
      m.kind ?? 'text',
      senderId,
      m.text,
      m.reply_to_id ?? null,
      m.external_reply_id ?? null,
      m.forwarded_from_id ?? null,
      m.forward_sender_name ?? null,
      m.forward_chat_title ?? null,
      m.client_id ?? null,
      at,
    ],
  );
  const row = (await q.query<MessageRow>(`${MSG_SELECT} WHERE m.id = $1`, [rows[0]!.id])).rows[0]!;
  if (row.kind !== 'service') {
    await markRead(q, chat, senderId, row.topic_id, row.seq);
    await q.query(`UPDATE chat_members SET hidden_at = NULL WHERE chat_id = $1 AND hidden_at IS NOT NULL`, [chat.id]);
  }
  await q.query(`UPDATE chats SET updated_at = $2 WHERE id = $1`, [chat.id, at]);
  return row;
}

export async function generalTopicId(q: Queryable, chatId: string): Promise<string | null> {
  return (await q.query<{ id: string }>(`SELECT id FROM topics WHERE chat_id = $1 AND is_general`, [chatId])).rows[0]?.id ?? null;
}

/** Служебная строка в ленте: «Анна добавляет Игоря». В группе с темами — в общую тему. */
export async function serviceMessage(q: Queryable, chat: ChatRow, actorId: string, text: string, at: string, topicId?: string | null): Promise<MessageRow> {
  const topic = chat.is_supergroup ? (topicId ?? (await generalTopicId(q, chat.id))) : null;
  return insertMessage(q, chat, actorId, { kind: 'service', text, topic_id: topic }, at);
}

/** Тема для нового сообщения: в группе с темами обязательна (по умолчанию — общая), в остальных — нельзя. */
export async function resolveTopic(q: Queryable, a: ChatAccess, topicId: string | null | undefined): Promise<string | null> {
  if (!a.chat.is_supergroup) {
    if (topicId) throw invalid('Не удалось отправить сообщение', { topic_id: 'В этом чате нет тем' });
    return null;
  }
  const id = topicId ?? (await generalTopicId(q, a.chat.id));
  const { rows } = await q.query<{ id: string; closed: boolean }>(`SELECT id, closed FROM topics WHERE id = $1::uuid AND chat_id = $2`, [id, a.chat.id]);
  const t = rows[0];
  if (!t) throw invalid('Не удалось отправить сообщение', { topic_id: 'Тема не найдена' });
  if (t.closed && !a.rights.canManageTopics) throw forbidden('Тема закрыта');
  return t.id;
}

// ---------------------------------------------------------------- список и карточка чата

interface ListRow extends ChatRow {
  pinned_at: string | null;
  muted_until: string | null;
  hidden_at: string | null;
  members_count: number;
  unread: number;
  lm_id: string | null;
  lm_kind: MessageKind | null;
  lm_text: string | null;
  lm_sender_id: string | null;
  lm_sender_name: string | null;
  lm_created_at: string | null;
  lm_deleted: boolean | null;
  peer_id: string | null;
  peer_name: string | null;
  peer_position: string | null;
  peer_last_seen_at: string | null;
}

const UNREAD_FILTER = `m.seq > COALESCE(tr.last_read_seq, cm.last_read_seq) AND m.kind <> 'service'
            AND m.sender_id IS DISTINCT FROM cm.user_id AND NOT m.deleted_for_all AND NOT (cm.user_id = ANY(m.deleted_for))`;

export async function listChats(q: Queryable, actor: AuthedActor, rt: Realtime, at: string, chatId?: string): Promise<ChatSummary[]> {
  const { rows } = await q.query<ListRow>(
    `SELECT ${CHAT_COLS}, cm.pinned_at, cm.muted_until, cm.hidden_at,
            (SELECT COUNT(*)::int FROM chat_members x WHERE x.chat_id = c.id) AS members_count,
            (SELECT COUNT(*)::int FROM messages m LEFT JOIN topic_reads tr ON tr.topic_id = m.topic_id AND tr.user_id = cm.user_id
              WHERE m.chat_id = c.id AND ${UNREAD_FILTER}) AS unread,
            lm.id AS lm_id, lm.kind AS lm_kind, lm.text AS lm_text, lm.sender_id AS lm_sender_id, lm.sender_name AS lm_sender_name, lm.created_at AS lm_created_at, FALSE AS lm_deleted,
            peer.id AS peer_id, peer.display_name AS peer_name, peer.position AS peer_position, peer.last_seen_at AS peer_last_seen_at
       FROM chat_members cm JOIN chats c ON c.id = cm.chat_id
       LEFT JOIN LATERAL (
         SELECT m.id, m.kind, m.text, m.sender_id, u.display_name AS sender_name, m.created_at FROM messages m LEFT JOIN users u ON u.id = m.sender_id
          WHERE m.chat_id = c.id AND NOT m.deleted_for_all AND NOT (cm.user_id = ANY(m.deleted_for)) ORDER BY m.seq DESC LIMIT 1
       ) lm ON TRUE
       LEFT JOIN LATERAL (
         SELECT u.id, u.display_name, u.position, u.last_seen_at FROM chat_members o JOIN users u ON u.id = o.user_id
          WHERE c.type = 'private' AND o.chat_id = c.id AND o.user_id <> cm.user_id LIMIT 1
       ) peer ON TRUE
      WHERE cm.user_id = $1 AND cm.company_id = $2 AND ($3::uuid IS NULL OR c.id = $3::uuid)`,
    [actor.id, actor.company_id, chatId ?? null],
  );
  const out: ChatSummary[] = [];
  for (const r of rows) {
    // Скрытый чат возвращается сам, как только в нём появляется новое сообщение (insertMessage).
    if (!chatId && r.hidden_at) continue;
    const self = r.direct_key === `${actor.id}:${actor.id}`;
    const peerName = r.type === 'private' ? (self ? null : (r.peer_name ?? 'Удалённый аккаунт')) : null;
    out.push({
      id: r.id,
      type: r.type,
      is_supergroup: r.is_supergroup,
      title: chatTitle(r, peerName),
      peer:
        r.type === 'private' && r.peer_id
          ? { id: r.peer_id, display_name: r.peer_name!, position: r.peer_position, online: rt.isOnline(actor.company_id, r.peer_id), last_seen_at: r.peer_last_seen_at }
          : null,
      members_count: r.members_count,
      last_message: r.lm_id ? { id: r.lm_id, kind: r.lm_kind!, text: r.lm_text, sender_id: r.lm_sender_id, sender_name: r.lm_sender_name, created_at: r.lm_created_at!, deleted: false } : null,
      unread: r.unread,
      pinned: !!r.pinned_at,
      muted: !!r.muted_until && Date.parse(r.muted_until) > Date.parse(at),
      muted_until: r.muted_until && Date.parse(r.muted_until) > Date.parse(at) ? r.muted_until : null,
      created_at: r.created_at,
      activity_at: r.lm_created_at ?? r.created_at,
    });
  }
  return out;
}

export async function loadTopics(q: Queryable, chatId: string, userId: string): Promise<ChatTopic[]> {
  const { rows } = await q.query<{
    id: string;
    name: string;
    icon: string;
    color: string;
    closed: boolean;
    is_general: boolean;
    created_at: string;
    messages: number;
    unread: number;
    last_read_seq: number;
    lm_id: string | null;
    lm_kind: MessageKind | null;
    lm_text: string | null;
    lm_sender_id: string | null;
    lm_sender_name: string | null;
    lm_created_at: string | null;
  }>(
    `SELECT t.id, t.name, t.icon, t.color, t.closed, t.is_general, t.created_at,
            COALESCE(tr.last_read_seq, cm.last_read_seq)::bigint AS last_read_seq,
            (SELECT COUNT(*)::int FROM messages m WHERE m.topic_id = t.id AND m.kind <> 'service' AND NOT m.deleted_for_all) AS messages,
            (SELECT COUNT(*)::int FROM messages m WHERE m.topic_id = t.id AND ${UNREAD_FILTER}) AS unread,
            lm.id AS lm_id, lm.kind AS lm_kind, lm.text AS lm_text, lm.sender_id AS lm_sender_id, lm.sender_name AS lm_sender_name, lm.created_at AS lm_created_at
       FROM topics t JOIN chat_members cm ON cm.chat_id = t.chat_id AND cm.user_id = $2
       LEFT JOIN topic_reads tr ON tr.topic_id = t.id AND tr.user_id = $2
       LEFT JOIN LATERAL (
         SELECT m.id, m.kind, m.text, m.sender_id, u.display_name AS sender_name, m.created_at FROM messages m LEFT JOIN users u ON u.id = m.sender_id
          WHERE m.topic_id = t.id AND NOT m.deleted_for_all AND NOT ($2 = ANY(m.deleted_for)) ORDER BY m.seq DESC LIMIT 1
       ) lm ON TRUE
      WHERE t.chat_id = $1
      ORDER BY t.is_general DESC, COALESCE(lm.created_at, t.created_at) DESC`,
    [chatId, userId],
  );
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    color: t.color,
    closed: t.closed,
    is_general: t.is_general,
    unread: t.unread,
    messages: t.messages,
    last_read_seq: t.last_read_seq,
    last_message: t.lm_id ? { id: t.lm_id, kind: t.lm_kind!, text: t.lm_text, sender_id: t.lm_sender_id, sender_name: t.lm_sender_name, created_at: t.lm_created_at!, deleted: false } : null,
  }));
}

export async function chatDetail(q: Queryable, actor: AuthedActor, rt: Realtime, at: string, a: ChatAccess): Promise<ChatDetail> {
  const [summary] = await listChats(q, actor, rt, at, a.chat.id);
  const { rows } = await q.query<{ id: string; display_name: string; position: string | null; last_seen_at: string | null; is_admin: boolean; permissions: string[] | null }>(
    `SELECT u.id, u.display_name, u.position, u.last_seen_at, a.user_id IS NOT NULL AS is_admin, a.permissions
       FROM chat_members cm JOIN users u ON u.id = cm.user_id LEFT JOIN chat_admins a ON a.chat_id = cm.chat_id AND a.user_id = cm.user_id
      WHERE cm.chat_id = $1 ORDER BY cm.joined_at, u.display_name`,
    [a.chat.id],
  );
  const members: ChatMember[] = rows.map((m) => {
    const role = m.id === a.chat.created_by && a.chat.type === 'group' ? 'creator' : m.is_admin ? 'admin' : 'member';
    const r = chatRights({ type: a.chat.type, isSupergroup: a.chat.is_supergroup, isMember: true, isCreator: role === 'creator', adminPermissions: m.is_admin ? parsePermissions(m.permissions) : null });
    return { id: m.id, display_name: m.display_name, position: m.position, role, permissions: rightsList(r), online: rt.isOnline(actor.company_id, m.id), last_seen_at: m.last_seen_at };
  });
  const rank = { creator: 0, admin: 1, member: 2 } as const;
  members.sort((x, y) => rank[x.role] - rank[y.role] || Number(y.online) - Number(x.online) || x.display_name.localeCompare(y.display_name, 'ru'));
  return {
    ...summary!,
    created_by: a.chat.created_by,
    members,
    my_rights: rightsList(a.rights),
    can_manage_topics: a.rights.canManageTopics,
    topics: a.chat.is_supergroup ? await loadTopics(q, a.chat.id, actor.id) : [],
    my_last_read_seq: a.last_read_seq,
    others_read_seq: a.chat.is_supergroup ? 0 : await othersReadSeq(q, a.chat.id, actor.id, null),
  };
}

/** Сколько непрочитанных сообщений во всех чатах — для значка в меню и на иконке приложения. */
export async function totalUnread(q: Queryable, userId: string, companyId: string, at: string, opts: { includeMuted?: boolean } = {}): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM chat_members cm JOIN messages m ON m.chat_id = cm.chat_id
       LEFT JOIN topic_reads tr ON tr.topic_id = m.topic_id AND tr.user_id = cm.user_id
      WHERE cm.user_id = $1 AND cm.company_id = $2 AND ${UNREAD_FILTER}
        AND ($4 OR cm.muted_until IS NULL OR cm.muted_until <= $3::timestamptz)`,
    [userId, companyId, at, opts.includeMuted ?? false],
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------- поиск

const SEARCH_NORM = (expr: string) => `translate(lower(COALESCE(${expr}, '')), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе')`;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Условие «каждое слово запроса — часть текста» для SQL. Параметры добавляются в params. */
export function tokensWhere(expr: string, query: string, params: unknown[]): string | null {
  const tokens = searchTokens(query);
  if (!tokens.length) return null;
  return tokens
    .map((alts) => {
      params.push(alts.map((a) => `%${escapeLike(a)}%`));
      return `${SEARCH_NORM(expr)} LIKE ANY($${params.length}::text[])`;
    })
    .join(' AND ');
}

// ---------------------------------------------------------------- рассылка событий

/** Разослать событие всем участникам чата (состав читаем заново — исключённые не получат). */
export async function broadcast(q: Queryable, rt: Realtime, chat: Pick<ChatRow, 'id' | 'company_id'>, event: string, payload: unknown | ((uid: string) => unknown), extra: string[] = []) {
  const ids = await memberIds(q, chat.id);
  rt.emit(chat.company_id, [...ids, ...extra], event, payload);
}

/** Новое сообщение в реальном времени: у получателей своей реакции и голоса ещё нет — payload общий. */
export async function broadcastMessage(q: Queryable, rt: Realtime, chat: ChatRow, row: MessageRow) {
  const [msg] = await hydrate(q, row.sender_id ?? '', [row], 0);
  await broadcast(q, rt, chat, 'new_message', { chat_id: chat.id, message: msg });
}
