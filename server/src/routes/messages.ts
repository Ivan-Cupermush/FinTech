import { Router } from 'express';
import { z } from 'zod';
import { BULK_DELETE_MAX, FORWARD_MAX, MESSAGE_MAX, REACTIONS, canEditMessage, chatTitle, serviceText, validateMessageText, type PollVoters } from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Queryable } from '../db/db';
import { conflict, forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { copyAttachments, deleteAttachments } from '../services/attachments';
import {
  MSG_SELECT,
  broadcast,
  groupReactions,
  hydrate,
  insertMessage,
  loadPolls,
  loadReactions,
  openChat,
  openMessage,
  othersReadSeq,
  requireRight,
  resolveTopic,
  serializePoll,
  serviceMessage,
  broadcastMessage,
  type ChatAccess,
  type ChatRow,
  type MessageRow,
} from '../services/chats';
import type { ChatDeps } from './chats';

const uuid = z.string().refine(isUuid);

/** Удалить для всех: своё — всегда, чужое — с правом удалять сообщения (в группе). */
function canDeleteForAll(a: ChatAccess, m: MessageRow, actorId: string): boolean {
  if (m.sender_id === actorId && m.kind !== 'service') return true;
  return a.chat.type === 'group' && a.rights.can('delete_messages');
}

/**
 * Действия с сообщением: `/api/v1/messages/:id`. Сообщение видит только
 * участник его чата; удалённое для всех или «для себя» — 404.
 */
export function messagesRouter({ db, now, rt, onMessage, media }: ChatDeps): Router {
  const r = Router();
  const at = () => now().toISOString();

  const reloadOne = async (q: Queryable, actor: AuthedActor, id: string) => {
    const row = (await q.query<MessageRow>(`${MSG_SELECT} WHERE m.id = $1`, [id])).rows[0]!;
    const [msg] = await hydrate(q, actor.id, [row], await othersReadSeq(q, row.chat_id, actor.id, row.topic_id), media);
    return msg!;
  };

  /** Удаление пачкой: все сообщения — из одного чата. */
  const removeMessages = async (actor: AuthedActor, ids: string[], mode: 'me' | 'all') => {
    const { chat, removed } = await db.tx(async (q) => {
      const { rows } = await q.query<MessageRow>(`${MSG_SELECT} WHERE m.id = ANY($1::uuid[]) AND m.company_id = $2`, [ids, actor.company_id]);
      const visible = rows.filter((m) => !m.deleted_for_all && !m.deleted_for?.includes(actor.id));
      if (!visible.length || visible.length !== new Set(ids).size) throw notFound('Сообщение не найдено');
      const chats = new Set(visible.map((m) => m.chat_id));
      if (chats.size > 1) throw invalid('Не удалось удалить', { ids: 'Сообщения из разных чатов' });
      const a = await openChat(q, actor, visible[0]!.chat_id);
      if (mode === 'all') {
        if (visible.some((m) => !canDeleteForAll(a, m, actor.id))) throw forbidden('Чужие сообщения может удалить администратор');
        await q.query(`UPDATE messages SET deleted_for_all = TRUE, text = NULL, pinned_at = NULL, contact_user_id = NULL WHERE id = ANY($1::uuid[])`, [visible.map((m) => m.id)]);
        await q.query(`DELETE FROM message_reactions WHERE message_id = ANY($1::uuid[])`, [visible.map((m) => m.id)]);
        // Удалено для всех — файлы стираются с диска (если их не держит пересланная копия).
        await deleteAttachments(q, media.store, { type: 'message', ids: visible.map((m) => m.id) });
      } else {
        await q.query(`UPDATE messages SET deleted_for = array_append(deleted_for, $2) WHERE id = ANY($1::uuid[]) AND NOT ($2 = ANY(deleted_for))`, [visible.map((m) => m.id), actor.id]);
      }
      return { chat: a.chat, removed: visible.map((m) => m.id) };
    });
    const payload = { chat_id: chat.id, ids: removed };
    if (mode === 'all') await broadcast(db, rt, chat, 'message_deleted', payload);
    else rt.emit(actor.company_id, [actor.id], 'message_deleted', payload);
    await broadcast(db, rt, chat, 'chat_updated', { chat_id: chat.id });
  };

  /** Удалить несколько: `{ ids, for: 'me' | 'all' }`. */
  r.post('/delete', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ ids: z.array(uuid).min(1).max(BULK_DELETE_MAX), for: z.enum(['me', 'all']).default('me') }), req.body);
    await removeMessages(actor, body.ids, body.for);
    res.status(204).end();
  });

  /** Переслать в другой (или этот же) чат. Автор и чат исходника сохраняются в подписи. */
  r.post('/forward', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ message_ids: z.array(uuid).min(1).max(FORWARD_MAX), to_chat_id: uuid, topic_id: uuid.nullable().optional() }), req.body);
    const { chat, rows } = await db.tx(async (q) => {
      const target = await openChat(q, actor, body.to_chat_id);
      const topicId = await resolveTopic(q, target, body.topic_id);
      const { rows: src } = await q.query<MessageRow & { chat_type: 'private' | 'group'; chat_name: string | null }>(
        `${MSG_SELECT.replace('FROM messages m', ', c.type AS chat_type, c.name AS chat_name FROM messages m')}
           JOIN chats c ON c.id = m.chat_id JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
          WHERE m.id = ANY($1::uuid[]) AND m.company_id = $3 AND NOT m.deleted_for_all AND NOT ($2 = ANY(m.deleted_for)) ORDER BY m.seq`,
        [body.message_ids, actor.id, actor.company_id],
      );
      if (src.length !== new Set(body.message_ids).size) throw notFound('Сообщение не найдено');
      if (src.some((m) => m.kind === 'service' || m.kind === 'poll')) throw invalid('Не удалось переслать', { message_ids: 'Служебные сообщения и опросы не пересылаются' });
      const out: MessageRow[] = [];
      for (const m of src) {
        out.push(
          await insertMessage(
            q,
            target.chat,
            actor.id,
            {
              kind: m.kind,
              text: m.text,
              contact_user_id: m.contact_user_id,
              topic_id: topicId,
              forwarded_from_id: m.id,
              // Пересылка пересланного ведёт к первоисточнику.
              forward_sender_name: m.forward_sender_name ?? m.sender_name,
              forward_chat_title: m.forward_sender_name || m.forward_chat_title ? m.forward_chat_title : m.chat_type === 'group' ? chatTitle({ type: 'group', name: m.chat_name }, null) : null,
            },
            at(),
          ),
        );
        // Файлы пересылаются той же записью на диске — без копирования байтов.
        if (m.kind === 'media' || m.kind === 'voice' || m.kind === 'video_note') await copyAttachments(q, { type: 'message', id: m.id }, { type: 'message', id: out[out.length - 1]!.id }, actor.id);
      }
      return { chat: target.chat, rows: out };
    });
    for (const row of rows) await broadcastMessage(db, rt, chat, row, media);
    if (rows[0]) onMessage?.(chat, rows[rows.length - 1]!);
    res.status(201).json({ data: await hydrate(db, actor.id, rows, 0, media) });
  });

  r.patch('/:id', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ text: z.string().max(MESSAGE_MAX + 1000) }), req.body);
    const { msg, access } = await openMessage(db, actor, idParam(req.params.id));
    // Подпись к медиа можно и стереть; текст сообщения — нет.
    const err = msg.kind === 'media' ? (body.text.length > MESSAGE_MAX ? `Не длиннее ${MESSAGE_MAX} символов` : null) : validateMessageText(body.text);
    if (err) throw invalid('Не удалось изменить сообщение', { text: err });
    if (msg.sender_id !== actor.id) throw forbidden('Изменить можно только своё сообщение');
    if (!canEditMessage({ ...msg, deleted: msg.deleted_for_all }, actor.id, at())) throw forbidden('Сообщение уже нельзя изменить');
    const text = body.text.trim() || (msg.kind === 'media' ? null : body.text.trim());
    if (text !== msg.text) {
      await db.query(`UPDATE messages SET text = $2, edited_at = $3 WHERE id = $1`, [msg.id, text, at()]);
      await broadcast(db, rt, access.chat, 'message_edited', { chat_id: access.chat.id, id: msg.id, text, edited_at: at() });
    }
    res.json({ data: await reloadOne(db, actor, msg.id) });
  });

  r.delete('/:id', async (req, res) => {
    const actor = actorOf(req);
    const mode = req.query.for === 'all' ? 'all' : 'me';
    await removeMessages(actor, [idParam(req.params.id)], mode);
    res.status(204).end();
  });

  const setPin = async (actor: AuthedActor, id: string, pinned: boolean) => {
    const { msg, access } = await openMessage(db, actor, id);
    if (msg.kind === 'service') throw invalid('Не удалось закрепить', { message: 'Служебное сообщение не закрепить' });
    requireRight(access, 'pin_messages', 'Закреплять сообщения может администратор');
    if (!!msg.pinned_at === pinned) return { access, msg };
    await db.tx(async (q) => {
      await q.query(`UPDATE messages SET pinned_at = $2, pinned_by = $3 WHERE id = $1`, [msg.id, pinned ? at() : null, pinned ? actor.id : null]);
      if (pinned && access.chat.type === 'group') {
        const row = await serviceMessage(q, access.chat, actor.id, serviceText.pinned(actor.display_name), at(), msg.topic_id);
        await broadcastMessage(q, rt, access.chat, row, media);
      }
    });
    await broadcast(db, rt, access.chat, 'message_pinned', { chat_id: access.chat.id, id: msg.id, pinned, topic_id: msg.topic_id });
    return { access, msg };
  };

  r.post('/:id/pin', async (req, res) => {
    const actor = actorOf(req);
    const { msg } = await setPin(actor, idParam(req.params.id), true);
    res.json({ data: await reloadOne(db, actor, msg.id) });
  });

  r.delete('/:id/pin', async (req, res) => {
    const actor = actorOf(req);
    const { msg } = await setPin(actor, idParam(req.params.id), false);
    res.json({ data: await reloadOne(db, actor, msg.id) });
  });

  /** Реакция: одна от человека, повторная заменяет прежнюю. */
  const reactionsChanged = async (chat: ChatRow, messageId: string) => {
    const raw = await loadReactions(db, [messageId]);
    await broadcast(db, rt, chat, 'message_reactions', (uid: string) => ({ chat_id: chat.id, message_id: messageId, reactions: groupReactions(raw, uid) }));
  };

  r.put('/:id/reaction', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ emoji: z.enum(REACTIONS) }), req.body);
    const { msg, access } = await openMessage(db, actor, idParam(req.params.id));
    if (msg.kind === 'service') throw invalid('Не удалось поставить реакцию', { message: 'На служебное сообщение реакцию не поставить' });
    await db.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = EXCLUDED.created_at`,
      [msg.id, actor.id, body.emoji, at()],
    );
    await reactionsChanged(access.chat, msg.id);
    res.json({ data: groupReactions(await loadReactions(db, [msg.id]), actor.id) });
  });

  r.delete('/:id/reaction', async (req, res) => {
    const actor = actorOf(req);
    const { msg, access } = await openMessage(db, actor, idParam(req.params.id));
    await db.query(`DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2`, [msg.id, actor.id]);
    await reactionsChanged(access.chat, msg.id);
    res.json({ data: groupReactions(await loadReactions(db, [msg.id]), actor.id) });
  });

  // ------------------------------------------------------------ голосовые

  /**
   * Прослушал голосовое или посмотрел кружочек. Своё не считается. Автор и
   * сам слушатель получают событие: у автора гаснет точка «не прослушано».
   */
  r.post('/:id/listen', async (req, res) => {
    const actor = actorOf(req);
    const { msg, access } = await openMessage(db, actor, idParam(req.params.id));
    if (msg.kind !== 'voice' && msg.kind !== 'video_note') throw invalid('Не удалось отметить', { message: 'Это не голосовое и не видеосообщение' });
    if (msg.sender_id !== actor.id) {
      const { rows } = await db.query(`INSERT INTO message_listens (message_id, user_id, listened_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING message_id`, [msg.id, actor.id, at()]);
      if (rows.length) await broadcast(db, rt, access.chat, 'message_listened', { chat_id: access.chat.id, message_id: msg.id, user_id: actor.id, sender_id: msg.sender_id });
    }
    res.status(204).end();
  });

  // ------------------------------------------------------------ опросы

  const openPoll = async (q: Queryable, actor: AuthedActor, id: string) => {
    const { msg, access } = await openMessage(q, actor, id);
    const poll = (await loadPolls(q, [msg.id])).get(msg.id);
    if (!poll) throw notFound('Опрос не найден');
    return { msg, access, poll };
  };

  const pollChanged = async (chat: ChatRow, messageId: string) => {
    const poll = (await loadPolls(db, [messageId])).get(messageId)!;
    await broadcast(db, rt, chat, 'poll_updated', (uid: string) => ({ chat_id: chat.id, message_id: messageId, poll: serializePoll(poll, uid) }));
    return poll;
  };

  r.post('/:id/vote', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ option_ids: z.array(uuid).min(1).max(10) }), req.body);
    const { msg, access } = await db.tx(async (q) => {
      const { msg, access, poll } = await openPoll(q, actor, idParam(req.params.id));
      if (poll.closed_at) throw conflict('Опрос закрыт');
      if (poll.votes.some((v) => v.user_id === actor.id)) throw conflict('Вы уже проголосовали');
      const ids = [...new Set(body.option_ids)];
      if (!poll.multiple && ids.length > 1) throw invalid('Не удалось проголосовать', { option_ids: 'Выберите один вариант' });
      if (ids.some((id) => !poll.options.some((o) => o.id === id))) throw invalid('Не удалось проголосовать', { option_ids: 'Вариант не найден' });
      for (const id of ids) await q.query(`INSERT INTO poll_votes (poll_id, option_id, user_id, voted_at) VALUES ($1, $2, $3, $4)`, [poll.id, id, actor.id, at()]);
      return { msg, access };
    });
    const poll = await pollChanged(access.chat, msg.id);
    res.json({ data: serializePoll(poll, actor.id) });
  });

  /** Отозвать голос — кроме викторины: там ответ окончательный. */
  r.delete('/:id/vote', async (req, res) => {
    const actor = actorOf(req);
    const { msg, access, poll } = await openPoll(db, actor, idParam(req.params.id));
    if (poll.quiz) throw conflict('В викторине ответ не изменить');
    if (poll.closed_at) throw conflict('Опрос закрыт');
    await db.query(`DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2`, [poll.id, actor.id]);
    const updated = await pollChanged(access.chat, msg.id);
    res.json({ data: serializePoll(updated, actor.id) });
  });

  r.post('/:id/close-poll', async (req, res) => {
    const actor = actorOf(req);
    const { msg, access, poll } = await openPoll(db, actor, idParam(req.params.id));
    if (msg.sender_id !== actor.id && !(access.chat.type === 'group' && access.rights.can('delete_messages'))) throw forbidden('Закрыть опрос может автор');
    if (!poll.closed_at) await db.query(`UPDATE polls SET closed_at = $2 WHERE id = $1`, [poll.id, at()]);
    const updated = await pollChanged(access.chat, msg.id);
    res.json({ data: serializePoll(updated, actor.id) });
  });

  r.get('/:id/voters', async (req, res) => {
    const actor = actorOf(req);
    const { poll } = await openPoll(db, actor, idParam(req.params.id));
    if (poll.anonymous) throw forbidden('Опрос анонимный');
    const { rows } = await db.query<{ option_id: string; id: string; display_name: string; position: string | null }>(
      `SELECT v.option_id, u.id, u.display_name, u.position FROM poll_votes v JOIN users u ON u.id = v.user_id WHERE v.poll_id = $1 ORDER BY v.voted_at, u.display_name`,
      [poll.id],
    );
    const data: PollVoters[] = poll.options.map((o) => ({ option_id: o.id, people: rows.filter((v) => v.option_id === o.id).map(({ id, display_name, position }) => ({ id, display_name, position })) }));
    res.json({ data });
  });

  return r;
}
