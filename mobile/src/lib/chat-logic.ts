import { isMuted, lastSeenText, matchesQuery, mediaOf, mergeMessages, messagePreview, sortChats, typingText, type Attachment, type ChatDetail, type ContactCard, type ChatHistory, type ChatMessage, type ChatPoll, type ChatReaction, type ChatSummary } from '@offix/core';
import type { HeroStat } from './fx';

/**
 * Чистая логика мессенджера на телефоне: папки и поиск списка, подписи,
 * обои переписки и разбор событий сокета в кэш ленты. Без React Native —
 * проверяется тестами, а экраны только рисуют.
 */

export type ChatFilter = 'all' | 'unread' | 'groups' | 'private';
export const CHAT_FILTERS: { value: ChatFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'unread', label: 'Новые' },
  { value: 'groups', label: 'Группы' },
  { value: 'private', label: 'Личные' },
];

/** Папка, поиск по названию и последнему сообщению, закреплённые сверху. */
export function filterChats(chats: ChatSummary[], filter: ChatFilter, q: string): ChatSummary[] {
  const list = chats.filter((c) => {
    if (filter === 'unread' && !c.unread) return false;
    if (filter === 'groups' && c.type !== 'group') return false;
    if (filter === 'private' && c.type !== 'private') return false;
    return !q.trim() || matchesQuery([c.title, c.last_message?.text, c.peer?.position], q);
  });
  return sortChats(list);
}

/** Цифры шапки: непрочитанные (без чатов «без звука») и собеседники в сети. */
export function chatsStats(chats: ChatSummary[], online: ReadonlySet<string>, now: string): HeroStat[] {
  const unread = chats.filter((c) => !isMuted(c.muted_until, now)).reduce((s, c) => s + c.unread, 0);
  const peers = new Set(chats.filter((c) => c.peer && (online.has(c.peer.id) || c.peer.online)).map((c) => c.peer!.id));
  return [
    { label: 'непрочитанных', value: unread, tone: unread ? 'warn' : undefined },
    { label: 'в сети', value: peers.size },
  ];
}

/** Вторая строка в списке: кто печатает, иначе последнее сообщение. */
export function rowPreview(c: ChatSummary, meId: string, typists: string[]): { text: string; typing: boolean } {
  if (typists.length) return { text: typingText(typists, c.type === 'group'), typing: true };
  if (!c.last_message) return { text: c.type === 'group' ? 'Группа создана' : 'Напишите первым', typing: false };
  return { text: messagePreview(c.last_message, meId, c.type === 'group'), typing: false };
}

export interface Presence {
  online: ReadonlySet<string>;
  lastSeen: ReadonlyMap<string, string>;
}

/** Собеседник в сети: по сокету, а до первых событий — по ответу сервера. */
export function isOnline(p: Presence, user: { id: string; online: boolean }): boolean {
  return p.online.has(user.id) || (user.online && !p.lastSeen.has(user.id));
}

/** Подпись под названием чата: печатает → в сети / был(а) → участники. */
export function chatStatus(chat: ChatDetail, presence: Presence, typists: string[], now: string): string {
  const group = chat.type === 'group';
  if (typists.length) return typingText(typists, group);
  if (!group) return chat.peer ? lastSeenText(isOnline(presence, chat.peer), presence.lastSeen.get(chat.peer.id) ?? chat.peer.last_seen_at, now) : 'заметки для себя';
  const on = chat.members.filter((m) => isOnline(presence, m)).length;
  return `${chat.members_count} ${membersWord(chat.members_count)}${on ? `, ${on} в сети` : ''}`;
}

export function membersWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'участник';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'участника';
  return 'участников';
}

/** Обои переписки: тот же живой градиент, что на сайте, — светлый днём, глубокий ночью. */
export function wallpaperColors(scheme: 'light' | 'dark'): readonly [string, string, string] {
  return scheme === 'dark' ? ['#2a44e8', '#07081c', '#c9822c'] : ['#9fb0ff', '#f3f1ec', '#ffcf8f'];
}

/** Сокет живёт на том же сервере, что и API: «http://host:4000/api/v1» → «http://host:4000». */
export function socketOrigin(apiBase: string): string {
  try {
    return new URL(apiBase).origin;
  } catch {
    return apiBase.replace(/\/api\/v\d+\/?$/, '');
  }
}

/** Своё сообщение видно сразу, до ответа сервера; сервер вернёт его с тем же client_id. */
export function optimisticMessage(o: { chatId: string; topicId: string | null; me: { id: string; name: string }; text: string; clientId: string; now: string; replyTo?: ChatMessage | null; attachments?: Attachment[]; contact?: ContactCard | null }): ChatMessage & { failed?: boolean } {
  const r = o.replyTo;
  const atts = o.attachments ?? [];
  const kind: ChatMessage['kind'] = o.contact ? 'contact' : atts[0]?.kind === 'voice' ? 'voice' : atts[0]?.kind === 'video_note' ? 'video_note' : atts.length ? 'media' : 'text';
  return {
    id: `local-${o.clientId}`,
    chat_id: o.chatId,
    seq: Number.MAX_SAFE_INTEGER - 1000,
    topic_id: o.topicId,
    kind,
    sender_id: o.me.id,
    sender_name: o.me.name,
    text: o.text,
    created_at: o.now,
    edited_at: null,
    deleted: false,
    pinned: false,
    client_id: o.clientId,
    reply_to: r ? { id: r.id, sender_name: r.sender_name, text: r.text, kind: r.kind, deleted: r.deleted, media: mediaOf(r) } : null,
    external_reply: null,
    forwarded_from: null,
    reactions: [],
    poll: null,
    read: false,
    attachments: atts,
    contact: o.contact ?? null,
    // У своего — «прослушано кем-то», пока никем.
    listened: false,
  };
}

const patch = (h: ChatHistory, id: string, fn: (m: ChatMessage) => ChatMessage): ChatHistory => ({ ...h, messages: h.messages.map((m) => (m.id === id ? fn(m) : m)) });

/**
 * Событие сокета → новая лента (или та же, если событие не про неё).
 * `topicId` — тема открытой ленты: в группе с темами чужие темы не трогаем.
 */
export function applyChatEvent(h: ChatHistory, topicId: string | null, event: string, p: Record<string, unknown>, meId?: string): ChatHistory {
  switch (event) {
    case 'new_message': {
      const m = p.message as ChatMessage;
      if (topicId && m.topic_id !== topicId) return h;
      // В середине истории новое не приклеиваем — придёт при прокрутке вниз.
      if (h.has_after) return h;
      return { ...h, messages: mergeMessages(h.messages, [m]) };
    }
    case 'message_edited':
      return patch(h, p.id as string, (m) => ({ ...m, text: p.text as string, edited_at: p.edited_at as string }));
    case 'message_deleted': {
      const ids = new Set(p.ids as string[]);
      return { ...h, messages: h.messages.filter((m) => !ids.has(m.id)) };
    }
    case 'message_reactions':
      return patch(h, p.message_id as string, (m) => ({ ...m, reactions: p.reactions as ChatReaction[] }));
    case 'poll_updated':
      return patch(h, p.message_id as string, (m) => ({ ...m, poll: p.poll as ChatPoll }));
    case 'message_pinned':
      return patch(h, p.id as string, (m) => ({ ...m, pinned: p.pinned as boolean }));
    case 'message_listened':
      // Прослушал я (с другого устройства) или моё сообщение послушали — иначе не про меня.
      if (!meId || (p.user_id !== meId && p.sender_id !== meId)) return h;
      return patch(h, p.message_id as string, (m) => ({ ...m, listened: true }));
    case 'messages_read': {
      const seq = p.seq as number;
      if (seq <= h.others_read_seq) return h;
      return { ...h, others_read_seq: seq, messages: h.messages.map((m) => (m.seq <= seq && !m.read ? { ...m, read: true } : m)) };
    }
    default:
      return h;
  }
}

/** Отправка не удалась: сообщение остаётся в ленте с кнопкой «Повторить». */
export function markFailed(h: ChatHistory, localId: string): ChatHistory {
  return patch(h, localId, (m) => ({ ...m, failed: true }) as ChatMessage);
}

/** Реакция: снять свою, если нажата та же, иначе поставить новую. */
export function nextReaction(reactions: ChatReaction[], emoji: string): string | null {
  return reactions.find((r) => r.mine)?.emoji === emoji ? null : emoji;
}
