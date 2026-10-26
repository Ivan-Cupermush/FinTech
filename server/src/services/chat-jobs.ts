import { chatPushMessage, chatTitle, messagePreview, shouldPushMessage, type ChatPushMessage } from '@offix/core';
import type { Db } from '../db/db';
import type { Realtime } from '../realtime/hub';
import { broadcastMessage, insertMessage, totalUnread, type ChatRow, type MessageRow } from './chats';
import { loadPushSettings, type PushSender } from './push';

export interface ChatPushResult {
  sent: number;
  skipped: number;
}

/**
 * Push о новом сообщении — напрямую, мимо «Входящих». Получают участники,
 * которых сейчас нет в сети (в сети — увидят сообщение в открытом чате),
 * если у них не выключена тема «Сообщения», чат не без звука и не ночь.
 */
export async function sendChatPush(db: Db, sender: PushSender<ChatPushMessage>, rt: Realtime, chat: ChatRow, row: MessageRow, at: string): Promise<ChatPushResult> {
  const result: ChatPushResult = { sent: 0, skipped: 0 };
  if (row.kind === 'service' || !row.sender_id) return result;
  const { rows: members } = await db.query<{ user_id: string; muted_until: string | null }>(`SELECT user_id, muted_until FROM chat_members WHERE chat_id = $1 AND user_id <> $2`, [chat.id, row.sender_id]);
  const messages: ChatPushMessage[] = [];
  const text = messagePreview({ kind: row.kind, text: row.text, deleted: false, sender_id: null, sender_name: null }, '', false);
  for (const m of members) {
    if (rt.isOnline(chat.company_id, m.user_id) || !shouldPushMessage(await loadPushSettings(db, m.user_id, chat.company_id), m.muted_until, at).send) {
      result.skipped++;
      continue;
    }
    const devices = await db.query<{ token: string }>(`SELECT token FROM push_devices WHERE user_id = $1 AND company_id = $2 AND disabled_at IS NULL ORDER BY last_seen_at DESC LIMIT 10`, [m.user_id, chat.company_id]);
    if (!devices.rows.length) {
      result.skipped++;
      continue;
    }
    const unread = await totalUnread(db, m.user_id, chat.company_id, at);
    const title = chatTitle(chat, row.sender_name ?? 'Сотрудник');
    for (const d of devices.rows) messages.push(chatPushMessage(d.token, { chat_id: chat.id, message_id: row.id, chat_title: title, sender_name: row.sender_name ?? 'Сотрудник', is_group: chat.type === 'group', text }, unread));
    result.sent++;
  }
  if (messages.length) await sender.send(messages);
  return result;
}

/**
 * Отложенные сообщения, время которых пришло. Если автор уже не в чате —
 * сообщение просто снимается. SKIP LOCKED — чтобы два процесса не отправили дважды.
 */
export async function dispatchScheduled(db: Db, rt: Realtime, at: string, onMessage?: (chat: ChatRow, row: MessageRow) => void): Promise<number> {
  const sent = await db.tx(async (q) => {
    const { rows } = await q.query<{ id: string; chat_id: string; topic_id: string | null; sender_id: string; text: string; reply_to_id: string | null }>(
      `DELETE FROM scheduled_messages WHERE id IN (SELECT id FROM scheduled_messages WHERE send_at <= $1 ORDER BY send_at LIMIT 100 FOR UPDATE SKIP LOCKED)
       RETURNING id, chat_id, topic_id, sender_id, text, reply_to_id`,
      [at],
    );
    const out: { chat: ChatRow; row: MessageRow }[] = [];
    for (const s of rows) {
      const chat = (
        await q.query<ChatRow>(
          `SELECT c.id, c.company_id, c.type, c.name, c.is_supergroup, c.created_by, c.direct_key, c.created_at FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $2 WHERE c.id = $1`,
          [s.chat_id, s.sender_id],
        )
      ).rows[0];
      if (!chat) continue;
      const row = await insertMessage(q, chat, s.sender_id, { text: s.text, topic_id: s.topic_id, reply_to_id: s.reply_to_id }, at);
      out.push({ chat, row });
      rt.emit(chat.company_id, [s.sender_id], 'scheduled_changed', { chat_id: chat.id });
    }
    return out;
  });
  for (const { chat, row } of sent) {
    await broadcastMessage(db, rt, chat, row);
    onMessage?.(chat, row);
  }
  return sent.length;
}

export function startScheduledLoop(db: Db, rt: Realtime, opts: { intervalMs?: number; now?: () => Date; onMessage?: (chat: ChatRow, row: MessageRow) => void; onError?: (e: unknown) => void } = {}): () => void {
  const now = opts.now ?? (() => new Date());
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await dispatchScheduled(db, rt, now().toISOString(), opts.onMessage);
    } catch (e) {
      opts.onError?.(e);
    } finally {
      running = false;
    }
  }, opts.intervalMs ?? 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Push после нового сообщения — в фоне, чтобы ответ отправителю не ждал Expo. */
export function messagePushHook(db: Db, sender: PushSender<ChatPushMessage>, rt: Realtime, now: () => Date, onError: (e: unknown) => void = (e) => console.error('chat push:', e)) {
  return (chat: ChatRow, row: MessageRow) => {
    sendChatPush(db, sender, rt, chat, row, now().toISOString()).catch(onError);
  };
}
