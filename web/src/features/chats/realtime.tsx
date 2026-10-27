import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { messagePreview, type ChatMessage, type ChatPoll, type ChatReaction, type ChatSummary } from '@offix/core';
import { connectChatSocket, type ChatSocket } from '../../lib/socket';
import { useAuth } from '../../lib/auth';
import { avatarsKey } from '../../lib/avatars';
import { useToast } from '../../ui/Toast';
import { addMessages, chatApi, ck, patchMessage, removeMessages, setOthersRead } from './data';

export interface Typist {
  user_id: string;
  name: string;
  until: number;
}

interface Realtime {
  connected: boolean;
  online: ReadonlySet<string>;
  lastSeen: ReadonlyMap<string, string>;
  typing: ReadonlyMap<string, Typist[]>;
  /** «Печатаю» — не чаще раза в три секунды; stop — сразу. */
  sendTyping: (chatId: string, topicId: string | null, stop?: boolean) => void;
  /** Открытый сейчас чат: о его сообщениях не всплывают уведомления. */
  setActive: (chatId: string | null) => void;
  /** Подписка на удаление чата — открытый экран уходит в список. */
  onChatDeleted: (fn: (chatId: string) => void) => () => void;
}

const Ctx = createContext<Realtime>({
  connected: false,
  online: new Set(),
  lastSeen: new Map(),
  typing: new Map(),
  sendTyping: () => undefined,
  setActive: () => undefined,
  onChatDeleted: () => () => undefined,
});

export const useRealtime = () => useContext(Ctx);
export const typingKey = (chatId: string, topicId: string | null) => `${chatId}:${topicId ?? ''}`;

const TYPING_TTL = 6000;

/** О чём сразу говорим всплывашкой: просьбу ждут, «спасибо» приятно увидеть сразу. */
const LIVE_TOASTS = new Set(['task_request', 'task_done', 'task_thanks', 'function_granted']);

/**
 * Связь с сервером в реальном времени: одно соединение на вкладку. События
 * сразу правят кэш — открытая лента, список чатов и значки обновляются без
 * перезапросов. Пока соединения нет, список и значок обновляются раз в 20 секунд.
 */
export function ChatRealtimeProvider({ meId, children }: { meId: string | undefined; children: ReactNode }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  // Тост — через ссылку: соединение не пересоздаём, когда меняется функция.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set());
  const [lastSeen, setLastSeen] = useState<ReadonlyMap<string, string>>(new Map());
  const [typing, setTyping] = useState<ReadonlyMap<string, Typist[]>>(new Map());
  const socket = useRef<ChatSocket | null>(null);
  const active = useRef<string | null>(null);
  const deletedListeners = useRef(new Set<(id: string) => void>());
  const lastTyping = useRef(new Map<string, number>());

  useEffect(() => {
    if (!token || !meId) return;
    const s = connectChatSocket(token);
    socket.current = s;
    let first = true;
    let pending: ReturnType<typeof setTimeout> | null = null;
    // Пачку событий (рассылка, прочтения) сводим в один перезапрос списка.
    const refreshList = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        void qc.invalidateQueries({ queryKey: ck.list });
        void qc.invalidateQueries({ queryKey: ck.unread });
      }, 250);
    };
    const dropTypist = (chatId: string, topicId: string | null, userId: string) =>
      setTyping((t) => {
        const k = typingKey(chatId, topicId);
        const list = t.get(k)?.filter((x) => x.user_id !== userId) ?? [];
        const next = new Map(t);
        if (list.length) next.set(k, list);
        else next.delete(k);
        return next;
      });

    const on: Record<string, (p: never) => void> = {
      connect: () => {
        setConnected(true);
        // После обрыва догоняем всё, что пропустили.
        if (!first) void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('chat') });
        first = false;
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
      new_message: (p: { chat_id: string; message: ChatMessage }) => {
        addMessages(qc, p.chat_id, [p.message]);
        if (p.message.sender_id) dropTypist(p.chat_id, p.message.topic_id, p.message.sender_id);
        if (p.message.kind === 'service') void qc.invalidateQueries({ queryKey: ck.detail(p.chat_id) });
        refreshList();
        notifyDesktop(qc.getQueryData<ChatSummary[]>(ck.list)?.find((c) => c.id === p.chat_id), p.message, meId, active.current);
      },
      message_edited: (p: { chat_id: string; id: string; text: string; edited_at: string }) => {
        patchMessage(qc, p.chat_id, p.id, (m) => ({ ...m, text: p.text, edited_at: p.edited_at }));
        refreshList();
      },
      message_deleted: (p: { chat_id: string; ids: string[] }) => {
        removeMessages(qc, p.chat_id, p.ids);
        void qc.invalidateQueries({ queryKey: ['chat-pinned', p.chat_id] });
        refreshList();
      },
      message_reactions: (p: { chat_id: string; message_id: string; reactions: ChatReaction[] }) => patchMessage(qc, p.chat_id, p.message_id, (m) => ({ ...m, reactions: p.reactions })),
      poll_updated: (p: { chat_id: string; message_id: string; poll: ChatPoll }) => patchMessage(qc, p.chat_id, p.message_id, (m) => ({ ...m, poll: p.poll })),
      message_pinned: (p: { chat_id: string; id: string; pinned: boolean }) => {
        patchMessage(qc, p.chat_id, p.id, (m) => ({ ...m, pinned: p.pinned }));
        void qc.invalidateQueries({ queryKey: ['chat-pinned', p.chat_id] });
      },
      messages_read: (p: { chat_id: string; user_id: string; seq: number }) => {
        if (p.user_id === meId) refreshList();
        else setOthersRead(qc, p.chat_id, p.seq);
      },
      chat_created: () => refreshList(),
      chat_updated: (p: { chat_id: string }) => {
        void qc.invalidateQueries({ queryKey: ck.detail(p.chat_id) });
        refreshList();
      },
      members_changed: (p: { chat_id: string }) => {
        void qc.invalidateQueries({ queryKey: ck.detail(p.chat_id) });
        refreshList();
      },
      chat_deleted: (p: { chat_id: string }) => {
        qc.removeQueries({ queryKey: ck.detail(p.chat_id) });
        qc.removeQueries({ queryKey: ['chat-history', p.chat_id] });
        deletedListeners.current.forEach((fn) => fn(p.chat_id));
        refreshList();
      },
      typing: (p: { chat_id: string; topic_id: string | null; user_id: string; name: string }) =>
        setTyping((t) => {
          const k = typingKey(p.chat_id, p.topic_id);
          const list = (t.get(k) ?? []).filter((x) => x.user_id !== p.user_id);
          return new Map(t).set(k, [...list, { user_id: p.user_id, name: p.name, until: Date.now() + TYPING_TTL }]);
        }),
      stop_typing: (p: { chat_id: string; topic_id: string | null; user_id: string }) => dropTypist(p.chat_id, p.topic_id, p.user_id),
      scheduled_changed: (p: { chat_id: string }) => void qc.invalidateQueries({ queryKey: ck.scheduled(p.chat_id) }),
      // Автор видит, что голосовое прослушали; слушатель — у себя на другом устройстве.
      message_listened: (p: { chat_id: string; message_id: string; user_id: string; sender_id: string | null }) => {
        if (p.user_id === meId || p.sender_id === meId) patchMessage(qc, p.chat_id, p.message_id, (m) => ({ ...m, listened: true }));
      },
      avatar_changed: (p: { user_id: string }) => {
        void qc.invalidateQueries({ queryKey: avatarsKey });
        if (p.user_id === meId) void qc.invalidateQueries({ queryKey: ['me'] });
      },
      // Новое во «Входящих»: запрос заметки, просьба коллеги, «спасибо», новая функция.
      notification: (p: { kind?: string; title?: string }) => {
        void qc.invalidateQueries({ queryKey: ['notifications'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
        if (p.kind?.startsWith('task_')) {
          void qc.invalidateQueries({ queryKey: ['tasks'] });
          void qc.invalidateQueries({ queryKey: ['task'] });
        }
        if (p.kind === 'function_granted') void qc.invalidateQueries({ queryKey: ['functions'] });
        if (p.title && LIVE_TOASTS.has(p.kind ?? '')) toastRef.current(p.title);
      },
      contact_names_changed: () => {
        void qc.invalidateQueries({ queryKey: ['contact-names'] });
        void qc.invalidateQueries({ queryKey: ['chat'] });
        refreshList();
      },
      profile_changed: (p: { user_id: string }) => {
        void qc.invalidateQueries({ queryKey: ['users'] });
        void qc.invalidateQueries({ queryKey: ['person', p.user_id] });
        if (p.user_id === meId) void qc.invalidateQueries({ queryKey: ['me'] });
        refreshList();
      },
      // Сеансы завершили (смена пароля, «выйти везде»). Это устройство могло
      // уже получить новый токен — проверяем чуть позже, старый токен выйдет сам.
      session_revoked: () => {
        setTimeout(() => void qc.invalidateQueries({ queryKey: ['me'] }), 1500);
      },
    };
    for (const [event, fn] of Object.entries(on)) s.on(event, fn);
    return () => {
      if (pending) clearTimeout(pending);
      for (const [event, fn] of Object.entries(on)) s.off(event, fn);
      s.disconnect();
      socket.current = null;
      setConnected(false);
    };
  }, [token, meId, qc]);

  // «Печатает» гаснет само, если «перестал» потерялся по дороге.
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

  // Без соединения — простой опрос, чтобы значок и список не застывали.
  useEffect(() => {
    if (connected || !token) return;
    const t = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ck.list });
      void qc.invalidateQueries({ queryKey: ck.unread });
    }, 20_000);
    return () => clearInterval(t);
  }, [connected, token, qc]);

  const sendTyping = useCallback((chatId: string, topicId: string | null, stop = false) => {
    const k = typingKey(chatId, topicId);
    const now = Date.now();
    if (!stop && now - (lastTyping.current.get(k) ?? 0) < 3000) return;
    if (stop && !lastTyping.current.has(k)) return;
    if (stop) lastTyping.current.delete(k);
    else lastTyping.current.set(k, now);
    const s = socket.current;
    if (s?.connected) s.emit(stop ? 'stop_typing' : 'typing', { chat_id: chatId, topic_id: topicId });
    else void chatApi.typing(chatId, topicId, stop).catch(() => undefined);
  }, []);

  const value = useMemo<Realtime>(
    () => ({
      connected,
      online,
      lastSeen,
      typing,
      sendTyping,
      setActive: (id) => {
        active.current = id;
      },
      onChatDeleted: (fn) => {
        deletedListeners.current.add(fn);
        return () => {
          deletedListeners.current.delete(fn);
        };
      },
    }),
    [connected, online, lastSeen, typing, sendTyping],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Уведомление на рабочем столе — если вкладка в фоне, чат не открыт, не без звука и разрешение уже дано. */
function notifyDesktop(chat: ChatSummary | undefined, m: ChatMessage, meId: string, activeChat: string | null) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (m.kind === 'service' || m.sender_id === meId || chat?.muted) return;
  if (!document.hidden && activeChat === m.chat_id) return;
  try {
    const title = chat?.title ?? m.sender_name ?? 'Сообщение';
    const n = new Notification(title, { body: messagePreview(m, meId, chat?.type === 'group'), tag: `chat-${m.chat_id}`, icon: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      window.location.assign(`/app/chats/${m.chat_id}`);
    };
  } catch {
    /* браузер запретил — живём без уведомлений */
  }
}
