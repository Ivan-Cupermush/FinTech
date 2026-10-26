import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { mergeMessages, type ChatDetail, type ChatHistory, type ChatMessage, type ChatPoll, type ChatReaction, type ChatSearchHit, type ChatSummary, type PollVoters, type ScheduledMessage } from '@offix/core';
import { api, newIdempotencyKey } from '../../lib/api';

/** Ключи кэша чатов. История — по чату и теме («main» — без тем). */
export const ck = {
  list: ['chats'] as const,
  unread: ['chats-unread'] as const,
  detail: (id: string) => ['chat', id] as const,
  history: (id: string, topic: string | null) => ['chat-history', id, topic ?? 'main'] as const,
  pinned: (id: string, topic: string | null) => ['chat-pinned', id, topic ?? 'main'] as const,
  scheduled: (id: string) => ['chat-scheduled', id] as const,
  search: (q: string) => ['chat-search', q] as const,
  searchIn: (id: string, q: string) => ['chat-search-in', id, q] as const,
  voters: (id: string) => ['poll-voters', id] as const,
};

const topicQuery = (topic: string | null) => (topic ? `topic_id=${topic}` : '');

export const useChats = () => useQuery({ queryKey: ck.list, queryFn: () => api<ChatSummary[]>('/chats'), staleTime: 15_000 });
export const useChatsUnread = (enabled = true) => useQuery({ queryKey: ck.unread, queryFn: () => api<{ unread: number }>('/chats/unread'), enabled, staleTime: 15_000 });
export const useChat = (id: string | null) => useQuery({ queryKey: ck.detail(id ?? ''), queryFn: () => api<ChatDetail>(`/chats/${id}`), enabled: !!id });
export const usePinned = (id: string, topic: string | null) => useQuery({ queryKey: ck.pinned(id, topic), queryFn: () => api<ChatMessage[]>(`/chats/${id}/pinned?${topicQuery(topic)}`) });
export const useScheduled = (id: string) => useQuery({ queryKey: ck.scheduled(id), queryFn: () => api<ScheduledMessage[]>(`/chats/${id}/scheduled`) });
export const useVoters = (messageId: string | null) => useQuery({ queryKey: ck.voters(messageId ?? ''), queryFn: () => api<PollVoters[]>(`/messages/${messageId}/voters`), enabled: !!messageId });

export function useGlobalSearch(q: string) {
  const query = q.trim();
  return useQuery({ queryKey: ck.search(query), queryFn: () => api<ChatSearchHit[]>(`/chats/search?q=${encodeURIComponent(query)}`), enabled: query.length >= 2, staleTime: 30_000 });
}

export function useChatSearch(id: string, q: string, topic: string | null) {
  const query = q.trim();
  return useQuery({
    queryKey: [...ck.searchIn(id, query), topic ?? 'main'],
    queryFn: () => api<ChatMessage[]>(`/chats/${id}/search?q=${encodeURIComponent(query)}&${topicQuery(topic)}`),
    enabled: query.length >= 2,
  });
}

/**
 * История — одна запись в кэше: страница последних сообщений, к которой
 * подгружаются более ранние и докладываются новые из сокета. Сама по себе
 * не перезапрашивается: всё свежее приходит событиями.
 */
export function useHistory(id: string, topic: string | null) {
  return useQuery({
    queryKey: ck.history(id, topic),
    queryFn: () => api<ChatHistory>(`/chats/${id}/messages?limit=50&${topicQuery(topic)}`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export async function loadOlder(qc: QueryClient, id: string, topic: string | null) {
  const cur = qc.getQueryData<ChatHistory>(ck.history(id, topic));
  const first = cur?.messages.find((m) => !m.id.startsWith('local-'));
  if (!cur || !first || !cur.has_before) return;
  const page = await api<ChatHistory>(`/chats/${id}/messages?limit=50&before=${first.seq}&${topicQuery(topic)}`);
  qc.setQueryData<ChatHistory>(ck.history(id, topic), (h) => (h ? { ...h, messages: mergeMessages(h.messages, page.messages), has_before: page.has_before } : h));
}

export async function loadNewer(qc: QueryClient, id: string, topic: string | null) {
  const cur = qc.getQueryData<ChatHistory>(ck.history(id, topic));
  const last = [...(cur?.messages ?? [])].reverse().find((m) => !m.id.startsWith('local-'));
  if (!cur || !last || !cur.has_after) return;
  const page = await api<ChatHistory>(`/chats/${id}/messages?limit=50&after=${last.seq}&${topicQuery(topic)}`);
  qc.setQueryData<ChatHistory>(ck.history(id, topic), (h) => (h ? { ...h, messages: mergeMessages(h.messages, page.messages), has_after: page.has_after } : h));
}

/** Переход к сообщению (закреп, поиск): окно истории вокруг него. */
export async function jumpTo(qc: QueryClient, id: string, topic: string | null, messageId: string) {
  const cur = qc.getQueryData<ChatHistory>(ck.history(id, topic));
  if (cur?.messages.some((m) => m.id === messageId)) return;
  const page = await api<ChatHistory>(`/chats/${id}/messages?limit=60&around=${messageId}&${topicQuery(topic)}`);
  qc.setQueryData(ck.history(id, topic), page);
}

// ---------------------------------------------------------------- правка кэша

/** Все загруженные истории чата (по всем темам). */
function eachHistory(qc: QueryClient, chatId: string, fn: (h: ChatHistory) => ChatHistory) {
  for (const [key, h] of qc.getQueriesData<ChatHistory>({ queryKey: ['chat-history', chatId] })) if (h) qc.setQueryData(key, fn(h));
}

export function patchMessage(qc: QueryClient, chatId: string, messageId: string, patch: (m: ChatMessage) => ChatMessage) {
  eachHistory(qc, chatId, (h) => ({ ...h, messages: h.messages.map((m) => (m.id === messageId ? patch(m) : m)) }));
}

export function addMessages(qc: QueryClient, chatId: string, messages: ChatMessage[]) {
  for (const [key, h] of qc.getQueriesData<ChatHistory>({ queryKey: ['chat-history', chatId] })) {
    if (!h) continue;
    const topic = key[2] === 'main' ? null : key[2];
    const fit = messages.filter((m) => (topic ? m.topic_id === topic : true));
    // Если открыто окно в середине истории, новое не приклеиваем — оно придёт при прокрутке вниз.
    if (fit.length && !h.has_after) qc.setQueryData(key, { ...h, messages: mergeMessages(h.messages, fit) });
  }
}

export function removeMessages(qc: QueryClient, chatId: string, ids: string[]) {
  const set = new Set(ids);
  eachHistory(qc, chatId, (h) => ({ ...h, messages: h.messages.filter((m) => !set.has(m.id)) }));
}

export function setOthersRead(qc: QueryClient, chatId: string, seq: number) {
  eachHistory(qc, chatId, (h) => (seq > h.others_read_seq ? { ...h, others_read_seq: seq, messages: h.messages.map((m) => (m.seq <= seq && !m.read ? { ...m, read: true } : m)) } : h));
}

/** Список чатов без перезапроса: у чата обнулить непрочитанные. */
export function markListRead(qc: QueryClient, chatId: string) {
  qc.setQueryData<ChatSummary[]>(ck.list, (l) => l?.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)));
}

// ---------------------------------------------------------------- действия

export interface SendInput {
  text: string;
  topic_id?: string | null;
  reply_to?: ChatMessage | null;
  external_reply?: ChatMessage | null;
}

/** Отправка с мгновенным появлением в ленте: локальное сообщение заменяется настоящим по client_id. */
export async function sendMessage(qc: QueryClient, chatId: string, topic: string | null, me: { id: string; display_name: string }, input: SendInput, clientId = newIdempotencyKey()) {
  const key = ck.history(chatId, topic);
  const local: ChatMessage & { failed?: boolean } = {
    id: `local-${clientId}`,
    chat_id: chatId,
    seq: Number.MAX_SAFE_INTEGER - 1000 + Math.random(),
    topic_id: topic,
    kind: 'text',
    sender_id: me.id,
    sender_name: me.display_name,
    text: input.text,
    created_at: new Date().toISOString(),
    edited_at: null,
    deleted: false,
    pinned: false,
    client_id: clientId,
    reply_to: input.reply_to ? { id: input.reply_to.id, sender_name: input.reply_to.sender_name, text: input.reply_to.text, kind: input.reply_to.kind, deleted: false } : null,
    external_reply: null,
    forwarded_from: null,
    reactions: [],
    poll: null,
    read: false,
  };
  qc.setQueryData<ChatHistory>(key, (h) => (h ? { ...h, messages: mergeMessages(h.messages, [local]) } : h));
  try {
    const msg = await api<ChatMessage>(`/chats/${chatId}/messages`, {
      body: { text: input.text, client_id: clientId, topic_id: topic, reply_to_id: input.reply_to?.id, external_reply_id: input.external_reply?.id },
    });
    qc.setQueryData<ChatHistory>(key, (h) => (h ? { ...h, messages: mergeMessages(h.messages, [msg]) } : h));
    void qc.invalidateQueries({ queryKey: ck.list });
    return msg;
  } catch (e) {
    qc.setQueryData<ChatHistory>(key, (h) => (h ? { ...h, messages: h.messages.map((m) => (m.id === local.id ? ({ ...m, failed: true } as ChatMessage) : m)) } : h));
    throw e;
  }
}

export function useChatAction<V, R = unknown>(fn: (v: V) => Promise<R>, opts: { invalidate?: (v: V) => readonly unknown[][]; onSuccess?: (r: R, v: V) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      for (const key of opts.invalidate?.(v) ?? []) void qc.invalidateQueries({ queryKey: key });
      opts.onSuccess?.(r, v);
    },
  });
}

export const chatApi = {
  direct: (user_id: string) => api<ChatSummary>('/chats/direct', { body: { user_id } }),
  createGroup: (v: { name: string; member_ids: string[]; supergroup: boolean }) => api<ChatSummary>('/chats', { body: v }),
  rename: (id: string, name: string) => api<ChatDetail>(`/chats/${id}`, { method: 'PATCH', body: { name } }),
  remove: (id: string) => api(`/chats/${id}`, { method: 'DELETE' }),
  leave: (id: string) => api(`/chats/${id}/leave`, { method: 'POST' }),
  addMembers: (id: string, user_ids: string[]) => api<{ added: string[] }>(`/chats/${id}/members`, { body: { user_ids } }),
  removeMember: (id: string, userId: string) => api(`/chats/${id}/members/${userId}`, { method: 'DELETE' }),
  setAdmin: (id: string, userId: string, permissions: string[]) => api(`/chats/${id}/admins/${userId}`, { method: 'PUT', body: { permissions } }),
  dropAdmin: (id: string, userId: string) => api(`/chats/${id}/admins/${userId}`, { method: 'DELETE' }),
  membership: (id: string, body: { pinned?: boolean; muted_until?: string | null; hidden?: boolean }) => api<ChatSummary>(`/chats/${id}/membership`, { method: 'PATCH', body }),
  read: (id: string, seq: number, topic_id: string | null) => api<{ last_read_seq: number; unread: number }>(`/chats/${id}/read`, { body: { seq, topic_id } }),
  typing: (id: string, topic_id: string | null, stop: boolean) => api(`/chats/${id}/typing`, { body: { topic_id, stop } }),
  edit: (messageId: string, text: string) => api<ChatMessage>(`/messages/${messageId}`, { method: 'PATCH', body: { text } }),
  deleteMany: (ids: string[], mode: 'me' | 'all') => api('/messages/delete', { body: { ids, for: mode } }),
  forward: (message_ids: string[], to_chat_id: string) => api<ChatMessage[]>('/messages/forward', { body: { message_ids, to_chat_id } }),
  pin: (messageId: string, pinned: boolean) => api<ChatMessage>(`/messages/${messageId}/pin`, { method: pinned ? 'POST' : 'DELETE' }),
  react: (messageId: string, emoji: string | null) =>
    emoji ? api<ChatReaction[]>(`/messages/${messageId}/reaction`, { method: 'PUT', body: { emoji } }) : api<ChatReaction[]>(`/messages/${messageId}/reaction`, { method: 'DELETE' }),
  vote: (messageId: string, option_ids: string[]) => api<ChatPoll>(`/messages/${messageId}/vote`, { body: { option_ids } }),
  unvote: (messageId: string) => api<ChatPoll>(`/messages/${messageId}/vote`, { method: 'DELETE' }),
  closePoll: (messageId: string) => api<ChatPoll>(`/messages/${messageId}/close-poll`, { method: 'POST' }),
  createPoll: (chatId: string, body: Record<string, unknown>) => api<ChatMessage>(`/chats/${chatId}/polls`, { body }),
  schedule: (chatId: string, body: { text: string; send_at: string; topic_id?: string | null; reply_to_id?: string | null }) => api<ScheduledMessage>(`/chats/${chatId}/scheduled`, { body }),
  editScheduled: (chatId: string, sid: string, body: { text?: string; send_at?: string }) => api<ScheduledMessage>(`/chats/${chatId}/scheduled/${sid}`, { method: 'PATCH', body }),
  dropScheduled: (chatId: string, sid: string) => api(`/chats/${chatId}/scheduled/${sid}`, { method: 'DELETE' }),
  sendScheduled: (chatId: string, sid: string) => api<ChatMessage>(`/chats/${chatId}/scheduled/${sid}/send`, { method: 'POST' }),
  enableTopics: (chatId: string) => api<ChatDetail>(`/chats/${chatId}/topics/enable`, { method: 'POST' }),
  createTopic: (chatId: string, body: { name: string; icon: string; color: string }) => api(`/chats/${chatId}/topics`, { body }),
  editTopic: (chatId: string, topicId: string, body: { name?: string; icon?: string; color?: string; closed?: boolean }) => api(`/chats/${chatId}/topics/${topicId}`, { method: 'PATCH', body }),
  dropTopic: (chatId: string, topicId: string) => api(`/chats/${chatId}/topics/${topicId}`, { method: 'DELETE' }),
};
