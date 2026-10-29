import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { mergeMessages, type Attachment, type ChatDetail, type ChatGallery, type ChatStats, type ContactCard, type GalleryTab, type ChatHistory, type ChatMessage, type ChatPoll, type ChatReaction, type ChatSummary, type Me, type Member, type PollVoters, type ScheduledMessage } from '@offix/core';
import { avatarsKey } from './avatars';
import { applyChatEvent, markFailed, optimisticMessage, socketOrigin, type ExternalReply } from './chat-logic';
import { newIdempotencyKey } from './client';
import { api, useSession } from './session';

/** Ключи кэша — те же по смыслу, что на сайте. */
export const ck = {
  list: ['chats'] as const,
  unread: ['chats-unread'] as const,
  detail: (id: string) => ['chat', id] as const,
  history: (id: string, topic: string | null) => ['chat-history', id, topic ?? 'main'] as const,
  pinned: (id: string, topic: string | null) => ['chat-pinned', id, topic ?? 'main'] as const,
  gallery: (id: string, tab: GalleryTab) => ['chat-gallery', id, tab] as const,
  stats: (id: string) => ['chat-stats', id] as const,
  scheduled: (id: string) => ['chat-scheduled', id] as const,
  voters: (messageId: string) => ['poll-voters', messageId] as const,
};

const topicQuery = (topic: string | null) => (topic ? `&topic_id=${topic}` : '');

export const useChats = () => useQuery({ queryKey: ck.list, queryFn: () => api<ChatSummary[]>('/chats') });
export const useChatsUnread = (enabled: boolean) => useQuery({ queryKey: ck.unread, queryFn: () => api<{ unread: number }>('/chats/unread'), enabled });
export const useChat = (id: string) => useQuery({ queryKey: ck.detail(id), queryFn: () => api<ChatDetail>(`/chats/${id}`) });
export const usePinned = (id: string, topic: string | null) => useQuery({ queryKey: ck.pinned(id, topic), queryFn: () => api<ChatMessage[]>(`/chats/${id}/pinned${topic ? `?topic_id=${topic}` : ''}`) });
export const useHistory = (id: string, topic: string | null) =>
  useQuery({ queryKey: ck.history(id, topic), queryFn: () => api<ChatHistory>(`/chats/${id}/messages?limit=50${topicQuery(topic)}`), staleTime: Infinity });
export const useGallery = (id: string, tab: GalleryTab) =>
  useInfiniteQuery({
    queryKey: ck.gallery(id, tab),
    queryFn: ({ pageParam }) => api<ChatGallery>(`/chats/${id}/media?tab=${tab}&limit=60${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_before,
  });
export const useChatStats = (id: string) => useQuery({ queryKey: ck.stats(id), queryFn: () => api<ChatStats>(`/chats/${id}/stats`), staleTime: 30_000 });
export const useScheduled = (id: string) => useQuery({ queryKey: ck.scheduled(id), queryFn: () => api<ScheduledMessage[]>(`/chats/${id}/scheduled`) });
export const useVoters = (messageId: string | null) => useQuery({ queryKey: ck.voters(messageId ?? ''), queryFn: () => api<PollVoters[]>(`/messages/${messageId}/voters`), enabled: !!messageId });
export const usePeople = (search: string) => useQuery({ queryKey: ['users', search], queryFn: () => api<Member[]>(`/users?search=${encodeURIComponent(search)}`), staleTime: 30_000 });

/** Подгрузка ранних сообщений при прокрутке вверх. */
export async function loadOlder(qc: QueryClient, id: string, topic: string | null) {
  const h = qc.getQueryData<ChatHistory>(ck.history(id, topic));
  const first = h?.messages.find((m) => !m.id.startsWith('local-'));
  if (!h || !first || !h.has_before) return;
  const page = await api<ChatHistory>(`/chats/${id}/messages?limit=50&before=${first.seq}${topicQuery(topic)}`);
  qc.setQueryData<ChatHistory>(ck.history(id, topic), (cur) => (cur ? { ...cur, has_before: page.has_before, messages: mergeMessages(cur.messages, page.messages) } : cur));
}

export function patchHistory(qc: QueryClient, chatId: string, fn: (h: ChatHistory, topic: string | null) => ChatHistory) {
  for (const [key, h] of qc.getQueriesData<ChatHistory>({ queryKey: ['chat-history', chatId] })) {
    if (h) qc.setQueryData(key, fn(h, key[2] === 'main' ? null : (key[2] as string)));
  }
}

/** Отправка: сообщение сразу в ленте, ответ сервера заменяет его по client_id. */
export async function sendMessage(qc: QueryClient, o: { chatId: string; topicId: string | null; me: { id: string; name: string }; text: string; replyTo?: ChatMessage | null; externalReply?: ExternalReply | null; clientId?: string; attachments?: Attachment[]; contact?: ContactCard | null }) {
  const clientId = o.clientId ?? newIdempotencyKey();
  const key = ck.history(o.chatId, o.topicId);
  const local = optimisticMessage({ ...o, clientId, now: new Date().toISOString() });
  qc.setQueryData<ChatHistory>(key, (h) => (h ? { ...h, messages: mergeMessages(h.messages, [local]) } : h));
  try {
    const m = await api<ChatMessage>(`/chats/${o.chatId}/messages`, {
      body: { text: o.text, client_id: clientId, topic_id: o.topicId, reply_to_id: o.replyTo?.id, external_reply_id: o.externalReply?.message.id, attachment_ids: o.attachments?.length ? o.attachments.map((a) => a.id) : undefined, contact_user_id: o.contact?.id },
    });
    qc.setQueryData<ChatHistory>(key, (h) => (h ? { ...h, messages: mergeMessages(h.messages, [m]) } : h));
    void qc.invalidateQueries({ queryKey: ck.list });
  } catch (e) {
    qc.setQueryData<ChatHistory>(key, (h) => (h ? markFailed(h, local.id) : h));
    throw e;
  }
}

/**
 * «Ответить в другом чате»: выбранное сообщение ждёт, пока откроется чат,
 * куда отвечаем, — экран забирает его при входе. Живёт в памяти приложения.
 */
export const pendingExternal = new Map<string, ExternalReply>();

export const chatApi = {
  direct: (user_id: string) => api<ChatSummary>('/chats/direct', { body: { user_id } }),
  createGroup: (v: { name: string; member_ids: string[]; supergroup: boolean }) => api<ChatSummary>('/chats', { body: v }),
  rename: (id: string, name: string) => api<ChatDetail>(`/chats/${id}`, { method: 'PATCH', body: { name } }),
  remove: (id: string) => api(`/chats/${id}`, { method: 'DELETE' }),
  leave: (id: string) => api(`/chats/${id}/leave`, { method: 'POST' }),
  addMembers: (id: string, user_ids: string[]) => api<{ added: string[] }>(`/chats/${id}/members`, { body: { user_ids } }),
  removeMember: (id: string, userId: string) => api(`/chats/${id}/members/${userId}`, { method: 'DELETE' }),
  membership: (id: string, body: { pinned?: boolean; muted_until?: string | null; hidden?: boolean }) => api<ChatSummary>(`/chats/${id}/membership`, { method: 'PATCH', body }),
  read: (id: string, seq: number, topic_id: string | null) => api<{ last_read_seq: number; unread: number }>(`/chats/${id}/read`, { body: { seq, topic_id } }),
  typing: (id: string, topic_id: string | null, stop: boolean) => api(`/chats/${id}/typing`, { body: { topic_id, stop } }),
  edit: (messageId: string, text: string) => api<ChatMessage>(`/messages/${messageId}`, { method: 'PATCH', body: { text } }),
  deleteMany: (ids: string[], mode: 'me' | 'all') => api('/messages/delete', { body: { ids, for: mode } }),
  pin: (messageId: string, pinned: boolean) => api<ChatMessage>(`/messages/${messageId}/pin`, { method: pinned ? 'POST' : 'DELETE' }),
  react: (messageId: string, emoji: string | null) =>
    emoji ? api<ChatReaction[]>(`/messages/${messageId}/reaction`, { method: 'PUT', body: { emoji } }) : api<ChatReaction[]>(`/messages/${messageId}/reaction`, { method: 'DELETE' }),
  listen: (messageId: string) => api(`/messages/${messageId}/listen`, { method: 'POST' }),
  vote: (messageId: string, option_ids: string[]) => api<ChatPoll>(`/messages/${messageId}/vote`, { body: { option_ids } }),
  unvote: (messageId: string) => api<ChatPoll>(`/messages/${messageId}/vote`, { method: 'DELETE' }),
  closePoll: (messageId: string) => api<ChatPoll>(`/messages/${messageId}/close-poll`, { method: 'POST' }),
  createPoll: (chatId: string, body: Record<string, unknown>) => api<ChatMessage>(`/chats/${chatId}/polls`, { body }),
  forward: (message_ids: string[], to_chat_id: string) => api<ChatMessage[]>('/messages/forward', { body: { message_ids, to_chat_id } }),
  schedule: (chatId: string, body: { text: string; send_at: string; topic_id?: string | null; reply_to_id?: string | null }) => api<ScheduledMessage>(`/chats/${chatId}/scheduled`, { body }),
  editScheduled: (chatId: string, sid: string, body: { text?: string; send_at?: string }) => api<ScheduledMessage>(`/chats/${chatId}/scheduled/${sid}`, { method: 'PATCH', body }),
  dropScheduled: (chatId: string, sid: string) => api(`/chats/${chatId}/scheduled/${sid}`, { method: 'DELETE' }),
  sendScheduled: (chatId: string, sid: string) => api<ChatMessage>(`/chats/${chatId}/scheduled/${sid}/send`, { method: 'POST' }),
  enableTopics: (chatId: string) => api<ChatDetail>(`/chats/${chatId}/topics/enable`, { method: 'POST' }),
  createTopic: (chatId: string, body: { name: string; icon: string; color: string }) => api(`/chats/${chatId}/topics`, { body }),
  editTopic: (chatId: string, topicId: string, body: { closed?: boolean }) => api(`/chats/${chatId}/topics/${topicId}`, { method: 'PATCH', body }),
};

// ---------------------------------------------------------------- реальное время

interface Typist {
  user_id: string;
  name: string;
  until: number;
}

interface ChatLive {
  connected: boolean;
  online: ReadonlySet<string>;
  lastSeen: ReadonlyMap<string, string>;
  typing: ReadonlyMap<string, Typist[]>;
  sendTyping: (chatId: string, topicId: string | null, stop?: boolean) => void;
}

export const typingKey = (chatId: string, topicId: string | null) => `${chatId}:${topicId ?? ''}`;

const Ctx = createContext<ChatLive>({ connected: false, online: new Set(), lastSeen: new Map(), typing: new Map(), sendTyping: () => undefined });
export const useChatLive = () => useContext(Ctx);
export const typistNames = (live: ChatLive, chatId: string, topicId: string | null) => (live.typing.get(typingKey(chatId, topicId)) ?? []).map((t) => t.name);

/**
 * Одно соединение на приложение, пока человек вошёл и приложение на экране.
 * События правят кэш на месте — лента, список и значок вкладки живут без
 * перезапросов. В фоне сокет закрываем: о новом скажет push.
 */
/** Сокет нужен, только пока человек вошёл: «кто я» берём из того же кэша, что и экраны. */
export function ChatLive({ children }: { children: ReactNode }) {
  const { token } = useSession();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/users/me'), enabled: !!token, staleTime: 60_000 });
  return <ChatLiveProvider meId={token ? me.data?.id : undefined}>{children}</ChatLiveProvider>;
}

function ChatLiveProvider({ meId, children }: { meId: string | undefined; children: ReactNode }) {
  const { token, server } = useSession();
  const qc = useQueryClient();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set());
  const [lastSeen, setLastSeen] = useState<ReadonlyMap<string, string>>(new Map());
  const [typing, setTyping] = useState<ReadonlyMap<string, Typist[]>>(new Map());
  const socket = useRef<Socket | null>(null);
  const sentTyping = useRef(new Map<string, number>());

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!token || !meId || !active) return;
    const s = io(socketOrigin(server), { path: '/socket.io', auth: { token }, transports: ['websocket'] });
    socket.current = s;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refreshList = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        void qc.invalidateQueries({ queryKey: ck.list });
        void qc.invalidateQueries({ queryKey: ck.unread });
      }, 250);
    };
    const drop = (chatId: string, topicId: string | null, userId: string) =>
      setTyping((t) => {
        const k = typingKey(chatId, topicId);
        const rest = (t.get(k) ?? []).filter((x) => x.user_id !== userId);
        const next = new Map(t);
        if (rest.length) next.set(k, rest);
        else next.delete(k);
        return next;
      });
    // События про ленту: разбирает чистая функция applyChatEvent.
    const feed = (event: string) => (p: Record<string, unknown>) => {
      patchHistory(qc, p.chat_id as string, (h, topic) => applyChatEvent(h, topic, event, p, meId));
      if (event === 'new_message') {
        const m = p.message as ChatMessage;
        if (m.sender_id) drop(m.chat_id, m.topic_id, m.sender_id);
      }
      if (event === 'message_deleted' || event === 'message_pinned') void qc.invalidateQueries({ queryKey: ['chat-pinned', p.chat_id] });
      if (event !== 'message_reactions' && event !== 'poll_updated' && event !== 'message_listened') refreshList();
    };
    // У каждого события свой формат — типы описаны в самих обработчиках.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers: Record<string, (p: any) => void> = {
      connect: () => {
        setConnected(true);
        // После обрыва догоняем пропущенное.
        void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('chat') });
      },
      disconnect: () => setConnected(false),
      online: (p: { user_ids: string[] }) => setOnline(new Set(p.user_ids)),
      presence: (p: { user_id: string; online: boolean; last_seen_at: string | null }) => {
        setOnline((o) => {
          const next = new Set(o);
          if (p.online) next.add(p.user_id);
          else next.delete(p.user_id);
          return next;
        });
        if (p.last_seen_at) setLastSeen((m) => new Map(m).set(p.user_id, p.last_seen_at!));
      },
      typing: (p: { chat_id: string; topic_id: string | null; user_id: string; name: string }) =>
        setTyping((t) => {
          const k = typingKey(p.chat_id, p.topic_id);
          const rest = (t.get(k) ?? []).filter((x) => x.user_id !== p.user_id);
          return new Map(t).set(k, [...rest, { user_id: p.user_id, name: p.name, until: Date.now() + 6000 }]);
        }),
      stop_typing: (p: { chat_id: string; topic_id: string | null; user_id: string }) => drop(p.chat_id, p.topic_id, p.user_id),
      chat_created: () => refreshList(),
      chat_updated: (p: { chat_id: string }) => {
        void qc.invalidateQueries({ queryKey: ck.detail(p.chat_id) });
        refreshList();
      },
      members_changed: (p: { chat_id: string }) => void qc.invalidateQueries({ queryKey: ck.detail(p.chat_id) }),
      avatar_changed: (p: { user_id: string }) => {
        void qc.invalidateQueries({ queryKey: avatarsKey });
        if (p.user_id === meId) void qc.invalidateQueries({ queryKey: ['me'] });
      },
      // Личное пространство: запросы заметок, свои имена коллег, профиль и выход отовсюду.
      notification: () => {
        void qc.invalidateQueries({ queryKey: ['notifications'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      },
      contact_names_changed: () => {
        void qc.invalidateQueries({ queryKey: ['contact-names'] });
        void qc.invalidateQueries({ queryKey: ['chat'] });
        refreshList();
      },
      profile_changed: (p: { user_id: string }) => {
        void qc.invalidateQueries({ queryKey: ['person', p.user_id] });
        if (p.user_id === meId) void Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['account'] })]);
        refreshList();
      },
      // Сервер закрыл сеанс (сменили пароль, «выйти везде»): проверяем токен — старый получит 401 и выход.
      session_revoked: () => void setTimeout(() => void qc.invalidateQueries({ queryKey: ['me'] }), 1500),
      // Отложенное ушло само — список «Отложенных» на экране обновится.
      scheduled_changed: (p: { chat_id: string }) => void qc.invalidateQueries({ queryKey: ck.scheduled(p.chat_id) }),
      chat_deleted: (p: { chat_id: string }) => {
        qc.removeQueries({ queryKey: ck.detail(p.chat_id) });
        refreshList();
      },
    };
    for (const e of ['new_message', 'message_edited', 'message_deleted', 'message_reactions', 'poll_updated', 'message_pinned', 'messages_read', 'message_listened']) handlers[e] = feed(e);
    for (const [e, fn] of Object.entries(handlers)) s.on(e, fn);
    return () => {
      if (pending) clearTimeout(pending);
      s.removeAllListeners();
      s.disconnect();
      socket.current = null;
      setConnected(false);
    };
  }, [token, meId, active, server, qc]);

  // «Печатает» гаснет само, если «перестал» потерялся.
  useEffect(() => {
    if (!typing.size) return;
    const t = setInterval(() => {
      const now = Date.now();
      setTyping((m) => {
        let changed = false;
        const next = new Map<string, Typist[]>();
        for (const [k, list] of m) {
          const alive = list.filter((x) => x.until > now);
          if (alive.length !== list.length) changed = true;
          if (alive.length) next.set(k, alive);
        }
        return changed ? next : m;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing.size]);

  const sendTyping = useCallback((chatId: string, topicId: string | null, stop = false) => {
    const k = typingKey(chatId, topicId);
    const now = Date.now();
    if (!stop && now - (sentTyping.current.get(k) ?? 0) < 3000) return;
    if (stop && !sentTyping.current.has(k)) return;
    if (stop) sentTyping.current.delete(k);
    else sentTyping.current.set(k, now);
    const s = socket.current;
    if (s?.connected) s.emit(stop ? 'stop_typing' : 'typing', { chat_id: chatId, topic_id: topicId });
    else void chatApi.typing(chatId, topicId, stop).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ connected, online, lastSeen, typing, sendTyping }), [connected, online, lastSeen, typing, sendTyping]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
