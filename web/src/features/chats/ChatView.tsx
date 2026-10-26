import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerUpLeft,
  Forward,
  Info,
  Lock,
  LockOpen,
  MessageSquareReply,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  SquareCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { buildFeed, canEditMessage, chatListTime, lastSeenText, messagePreview, type ChatDetail, type ChatMessage, type ChatTopic } from '@offix/core';
import { ApiError } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Dialog, Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { Backdrop } from '../../ui/fx/Backdrop';
import { useMediaQuery } from '../../ui/fx/support';
import { ChatInfo } from './ChatInfo';
import { Composer, type ComposerMode } from './Composer';
import { chatApi, ck, jumpTo, loadNewer, loadOlder, markListRead, patchMessage, removeMessages, sendMessage, useChat, useChatSearch, useHistory, usePinned, useScheduled } from './data';
import { ChatPickerDialog, ConfirmDialog, PollDialog, ScheduleDialog, ScheduledDialog, TopicDialog, VotersDialog } from './dialogs';
import { Bubble, type BubbleActions } from './MessageBubble';
import { ChatAvatar, Highlighted, Menu, TypingDots, typingText } from './parts';
import { typingKey, useRealtime } from './realtime';

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось, попробуйте ещё раз');

/** Экран чата: обои из живого градиента, сверху стеклянная шапка, снизу стеклянное поле ввода. */
export function ChatScreen({ chatId }: { chatId: string }) {
  const detail = useChat(chatId);
  const [params, setParams] = useSearchParams();
  const [info, setInfo] = useState(false);
  const rt = useRealtime();
  const navigate = useNavigate();
  const topicId = params.get('topic');

  useEffect(() => {
    rt.setActive(chatId);
    return () => rt.setActive(null);
  }, [chatId, rt]);
  useEffect(() => rt.onChatDeleted((id) => id === chatId && navigate('/app/chats', { replace: true })), [chatId, navigate, rt]);

  const chat = detail.data;
  const topic = chat?.is_supergroup ? (chat.topics.find((t) => t.id === topicId) ?? null) : null;
  return (
    <Backdrop variant="wallpaper" className="chat-wall">
      {detail.isError ? (
        <div className="chat-missing">
          <h2>Чат не найден</h2>
          <p className="faint">Возможно, его удалили или вас исключили из группы.</p>
          <Link to="/app/chats" className="btn btn-secondary">
            К списку чатов
          </Link>
        </div>
      ) : !chat ? (
        <div className="chat-loading">
          <Skeleton h={64} r={24} />
          <div className="grow" />
          <Skeleton h={56} w="60%" r={20} />
          <Skeleton h={56} w="45%" r={20} />
        </div>
      ) : chat.is_supergroup && !topic ? (
        <TopicList chat={chat} onInfo={() => setInfo(true)} onOpen={(id) => setParams({ topic: id })} />
      ) : (
        <ChatView key={topic?.id ?? 'main'} chat={chat} topic={topic} onInfo={() => setInfo(true)} onTopics={() => setParams({})} />
      )}
      {info && chat && <ChatInfo chat={chat} onClose={() => setInfo(false)} />}
    </Backdrop>
  );
}

function ChatHeader({ chat, topic, onBack, onInfo, children, sub }: { chat: ChatDetail; topic: ChatTopic | null; onBack?: () => void; onInfo: () => void; children?: React.ReactNode; sub?: React.ReactNode }) {
  const rt = useRealtime();
  const narrow = useMediaQuery('(max-width: 900px)');
  const navigate = useNavigate();
  const now = new Date().toISOString();
  const group = chat.type === 'group';
  const typists = rt.typing.get(typingKey(chat.id, topic?.id ?? null)) ?? [];
  const peerOnline = !!chat.peer && (rt.online.has(chat.peer.id) || (chat.peer.online && !rt.lastSeen.has(chat.peer.id)));
  const onlineCount = chat.members.filter((m) => rt.online.has(m.id) || (m.online && !rt.lastSeen.has(m.id))).length;
  const status = typists.length ? (
    <span className="is-typing">
      <TypingDots /> {typingText(
        typists.map((t) => t.name),
        group,
      )}
    </span>
  ) : (
    (sub ??
    (topic
      ? chat.title
      : group
        ? `${chat.members_count} участников${onlineCount ? `, ${onlineCount} в сети` : ''}`
        : chat.peer
          ? lastSeenText(peerOnline, rt.lastSeen.get(chat.peer.id) ?? chat.peer.last_seen_at, now)
          : 'заметки для себя'))
  );
  const back = onBack ?? (narrow ? () => navigate('/app/chats') : undefined);
  return (
    <div className="chat-head-glass wall-glass">
      <header className="chat-head">
        {back && <Button variant="ghost" size="sm" icon={<ArrowLeft size={18} />} onClick={back} aria-label={topic ? 'К темам' : 'К списку чатов'} />}
        <button type="button" className="chat-head-who" onClick={onInfo} aria-label={`${topic ? topic.name : chat.title}: информация о чате`}>
          {topic ? (
            <span className="topic-icon is-head" style={{ '--c': topic.color } as CSSProperties}>
              {topic.icon}
            </span>
          ) : (
            <ChatAvatar title={chat.title} group={group} online={peerOnline} size={40} />
          )}
          <span className="chat-head-text">
            <b className="clip">{topic ? topic.name : chat.title}</b>
            <span className="clip chat-head-sub">{status}</span>
          </span>
        </button>
        <div className="chat-head-actions">
          {children}
          <Button variant="ghost" size="sm" icon={<Info size={18} />} onClick={onInfo} aria-label="Информация" />
        </div>
      </header>
    </div>
  );
}

// ---------------------------------------------------------------- темы

function TopicList({ chat, onInfo, onOpen }: { chat: ChatDetail; onInfo: () => void; onOpen: (id: string) => void }) {
  const [dialog, setDialog] = useState<null | 'new' | ChatTopic>(null);
  const [menu, setMenu] = useState<{ t: ChatTopic; at: DOMRect } | null>(null);
  const [drop, setDrop] = useState<ChatTopic | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const rt = useRealtime();
  const now = new Date().toISOString();
  const refresh = () => void qc.invalidateQueries({ queryKey: ck.detail(chat.id) });
  return (
    <div className="chat-view">
      <ChatHeader chat={chat} topic={null} onInfo={onInfo} sub={`${chat.topics.length} тем · ${chat.members_count} участников`}>
        {chat.can_manage_topics && <Button variant="ghost" size="sm" icon={<Plus size={18} />} onClick={() => setDialog('new')} aria-label="Новая тема" />}
      </ChatHeader>
      <div className="topics" role="list" aria-label="Темы">
        {chat.topics.map((t) => {
          const typists = rt.typing.get(typingKey(chat.id, t.id)) ?? [];
          return (
            <div key={t.id} className="topic-row" role="listitem" style={{ '--c': t.color } as CSSProperties}>
              <button type="button" className="topic-open" onClick={() => onOpen(t.id)} aria-label={`${t.name}${t.unread ? `, ${t.unread} непрочитанных` : ''}`}>
                <span className="topic-icon">{t.icon}</span>
                <span className="chat-row-main">
                  <span className="chat-row-top">
                    <span className="chat-row-title clip">
                      {t.name}
                      {t.closed && <Lock size={13} aria-label="Закрыта" className="chat-row-icon" />}
                    </span>
                    <span className="chat-row-time">{t.last_message ? chatListTime(t.last_message.created_at, now) : ''}</span>
                  </span>
                  <span className="chat-row-bottom">
                    {typists.length ? (
                      <span className="chat-row-preview is-typing">
                        <TypingDots /> {typingText(
                          typists.map((x) => x.name),
                          true,
                        )}
                      </span>
                    ) : (
                      <span className="chat-row-preview clip">{t.last_message ? messagePreview(t.last_message, me.data?.id ?? '', true) : 'Сообщений пока нет'}</span>
                    )}
                    {t.unread > 0 && <span className="chat-badge">{t.unread}</span>}
                  </span>
                </span>
              </button>
              {chat.can_manage_topics && (
                <Button variant="ghost" size="sm" icon={<MoreHorizontal size={16} />} aria-label={`Действия с темой ${t.name}`} onClick={(e) => setMenu({ t, at: e.currentTarget.getBoundingClientRect() })} />
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <Menu
          anchor={menu.at}
          label={`Действия с темой ${menu.t.name}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Изменить', icon: <Pencil size={16} />, onSelect: () => setDialog(menu.t) },
            {
              label: menu.t.closed ? 'Открыть тему' : 'Закрыть тему',
              icon: menu.t.closed ? <LockOpen size={16} /> : <Lock size={16} />,
              onSelect: () =>
                chatApi
                  .editTopic(chat.id, menu.t.id, { closed: !menu.t.closed })
                  .then(refresh)
                  .catch((e) => toast(errText(e), 'error')),
            },
            !menu.t.is_general && { label: 'Удалить тему', icon: <Trash2 size={16} />, danger: true, onSelect: () => setDrop(menu.t) },
          ]}
        />
      )}
      {dialog && <TopicDialog chatId={chat.id} topic={dialog === 'new' ? undefined : dialog} onClose={() => setDialog(null)} />}
      {drop && (
        <ConfirmDialog
          title="Удалить тему?"
          action="Удалить"
          danger
          onClose={() => setDrop(null)}
          onConfirm={async () => {
            await chatApi.dropTopic(chat.id, drop.id);
            refresh();
          }}
        >
          Тема «{drop.name}» и все её сообщения исчезнут у всех участников.
        </ConfirmDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- переписка

type Dialogs =
  | { kind: 'poll' }
  | { kind: 'schedule'; text: string }
  | { kind: 'scheduled' }
  | { kind: 'forward'; ids: string[] }
  | { kind: 'external'; message: ChatMessage }
  | { kind: 'voters'; message: ChatMessage }
  | { kind: 'delete'; messages: ChatMessage[] }
  | null;

function ChatView({ chat, topic, onInfo, onTopics }: { chat: ChatDetail; topic: ChatTopic | null; onInfo: () => void; onTopics: () => void }) {
  const topicId = topic?.id ?? null;
  const history = useHistory(chat.id, topicId);
  const pinned = usePinned(chat.id, topicId);
  const scheduled = useScheduled(chat.id);
  const me = useMe();
  const rt = useRealtime();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { jump?: string; externalReply?: ChatMessage; fromTitle?: string } | null;
  const meId = me.data?.id ?? '';
  const group = chat.type === 'group';
  const can = (p: string) => chat.my_rights.includes(p as never);

  const [mode, setMode] = useState<ComposerMode>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [menu, setMenu] = useState<{ m: ChatMessage; at: DOMRect | { x: number; y: number } } | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const [pinIndex, setPinIndex] = useState(0);
  const [below, setBelow] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const search = useChatSearch(chat.id, searchOpen ? q : '', topicId);

  const feed = useRef<HTMLDivElement>(null);
  const readMark = useRef<number | null>(null);
  const sentRead = useRef(0);
  const restore = useRef<{ height: number; top: number } | null>(null);
  const loading = useRef(false);
  const firstScroll = useRef(true);
  const lastCount = useRef(0);
  const jumping = useRef(!!navState?.jump);

  const data = history.data;
  if (readMark.current === null && data) readMark.current = data.my_last_read_seq;
  const messages = data?.messages ?? [];
  const now = new Date().toISOString();
  const items = useMemo(() => buildFeed(messages, { now, lastReadSeq: readMark.current, meId }), [messages, meId]); // eslint-disable-line react-hooks/exhaustive-deps
  const typists = rt.typing.get(typingKey(chat.id, topicId)) ?? [];

  const scrollToBottom = (smooth = false) => {
    const el = feed.current;
    if (el?.scrollTo) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    else if (el) el.scrollTop = el.scrollHeight;
    setBelow(0);
  };

  const scrollToMessage = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = document.getElementById(`m-${id}`);
      el?.scrollIntoView?.({ block: 'center' });
      setFlash(id);
      setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
    });
  }, []);

  const jump = useCallback(
    async (id: string) => {
      jumping.current = true;
      try {
        await jumpTo(qc, chat.id, topicId, id);
        scrollToMessage(id);
      } catch {
        toast('Сообщение не найдено — возможно, его удалили', 'error');
      } finally {
        setTimeout(() => (jumping.current = false), 300);
      }
    },
    [qc, chat.id, topicId, scrollToMessage, toast],
  );

  // Переход из поиска или ответ из другого чата — один раз при открытии.
  useEffect(() => {
    const st = navState;
    if (!st) return;
    if (st.jump) void jump(st.jump);
    if (st.externalReply) setMode({ kind: 'external', message: st.externalReply, chatTitle: st.fromTitle ?? 'другого чата' });
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Прокрутка: при открытии — к «Новым» или в конец; новое внизу — следом, если читаем конец.
  useLayoutEffect(() => {
    const el = feed.current;
    if (!el || !data) return;
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (jumping.current) {
      firstScroll.current = false;
    } else if (firstScroll.current) {
      firstScroll.current = false;
      const divider = el.querySelector('.feed-new');
      if (divider) (divider as HTMLElement).scrollIntoView?.({ block: 'start' });
      else el.scrollTop = el.scrollHeight;
    } else if (messages.length > lastCount.current) {
      const last = messages[messages.length - 1];
      if (atBottom || last?.sender_id === meId) scrollToBottom(true);
      else setBelow((b) => b + (messages.length - lastCount.current));
    }
    lastCount.current = messages.length;
  }, [messages, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = async () => {
    const el = feed.current;
    if (!el || !data) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(bottom);
    if (bottom) setBelow(0);
    if (loading.current) return;
    if (el.scrollTop < 240 && data.has_before) {
      loading.current = true;
      restore.current = { height: el.scrollHeight, top: el.scrollTop };
      await loadOlder(qc, chat.id, topicId).catch(() => (restore.current = null));
      loading.current = false;
    } else if (bottom && data.has_after) {
      loading.current = true;
      await loadNewer(qc, chat.id, topicId).catch(() => undefined);
      loading.current = false;
    }
  };

  // Прочитано: когда конец ленты виден и вкладка активна.
  useEffect(() => {
    const lastReal = [...messages].reverse().find((m) => !m.id.startsWith('local-'));
    if (!lastReal || !atBottom || data?.has_after) return;
    const run = () => {
      // Уже прочитанное повторно не отмечаем.
      if (document.visibilityState === 'hidden' || lastReal.seq <= Math.max(sentRead.current, data?.my_last_read_seq ?? 0)) return;
      sentRead.current = lastReal.seq;
      chatApi
        .read(chat.id, lastReal.seq, topicId)
        .then((r) => {
          if (!chat.is_supergroup) markListRead(qc, chat.id);
          qc.setQueryData(ck.unread, { unread: r.unread });
          void qc.invalidateQueries({ queryKey: ck.list });
          if (chat.is_supergroup) void qc.invalidateQueries({ queryKey: ck.detail(chat.id) });
        })
        .catch(() => (sentRead.current = 0));
    };
    const t = setTimeout(run, 400);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', run);
    };
  }, [messages, atBottom, chat.id, chat.is_supergroup, topicId, qc, data?.has_after, data?.my_last_read_seq]);

  const send = async (text: string) => {
    const m = mode;
    setMode(null);
    try {
      await sendMessage(qc, chat.id, topicId, { id: meId, display_name: me.data?.display_name ?? '' }, { text, topic_id: topicId, reply_to: m?.kind === 'reply' ? m.message : null, external_reply: m?.kind === 'external' ? m.message : null });
    } catch (e) {
      toast(errText(e), 'error');
    }
  };

  const actions: BubbleActions = useMemo(
    () => ({
      reply: (m) => setMode({ kind: 'reply', message: m }),
      react: (m, emoji) => {
        chatApi
          .react(m.id, emoji)
          .then((reactions) => patchMessage(qc, chat.id, m.id, (x) => ({ ...x, reactions })))
          .catch((e) => toast(errText(e), 'error'));
      },
      menu: (m, at) => setMenu({ m, at }),
      jump: (id) => void jump(id),
      openExternal: (cid, mid) => navigate(`/app/chats/${cid}`, { state: { jump: mid } }),
      toggleSelect: (m) =>
        setSelected((s) => {
          const next = new Set(s ?? []);
          if (next.has(m.id)) next.delete(m.id);
          else next.add(m.id);
          return next.size ? next : null;
        }),
      vote: (m, ids) => {
        chatApi
          .vote(m.id, ids)
          .then((poll) => patchMessage(qc, chat.id, m.id, (x) => ({ ...x, poll })))
          .catch((e) => toast(errText(e), 'error'));
      },
      unvote: (m) => {
        chatApi
          .unvote(m.id)
          .then((poll) => patchMessage(qc, chat.id, m.id, (x) => ({ ...x, poll })))
          .catch((e) => toast(errText(e), 'error'));
      },
      closePoll: (m) => {
        chatApi
          .closePoll(m.id)
          .then((poll) => patchMessage(qc, chat.id, m.id, (x) => ({ ...x, poll })))
          .catch((e) => toast(errText(e), 'error'));
      },
      voters: (m) => setDialog({ kind: 'voters', message: m }),
      retry: (m) => {
        removeMessages(qc, chat.id, [m.id]);
        void sendMessage(qc, chat.id, topicId, { id: meId, display_name: me.data?.display_name ?? '' }, { text: m.text ?? '', topic_id: topicId }, m.client_id ?? undefined).catch((e) => toast(errText(e), 'error'));
      },
    }),
    [qc, chat.id, topicId, jump, navigate, toast, meId, me.data?.display_name],
  );

  const canDeleteForAll = (m: ChatMessage) => (m.sender_id === meId && m.kind !== 'service') || (group && can('delete_messages'));
  const editLast = () => {
    const m = [...messages].reverse().find((x) => !x.id.startsWith('local-') && canEditMessage({ ...x, deleted: x.deleted }, meId, new Date().toISOString()));
    if (m) setMode({ kind: 'edit', message: m });
  };

  // Esc снимает выделение.
  useEffect(() => {
    if (!selected) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selected]);

  const hits = search.data ?? [];
  const goHit = (i: number) => {
    const h = hits[i];
    if (!h) return;
    setHitIndex(i);
    void jump(h.id);
  };

  const pins = pinned.data ?? [];
  const pin = pins[Math.min(pinIndex, pins.length - 1)];
  const closedForMe = !!topic?.closed && !chat.can_manage_topics;
  const selectedMessages = selected ? messages.filter((m) => selected.has(m.id)) : [];

  return (
    <div className="chat-view">
      {selected ? (
        <div className="chat-select-bar" role="toolbar" aria-label="Выбранные сообщения">
          <Button variant="ghost" size="sm" icon={<X size={18} />} onClick={() => setSelected(null)} aria-label="Снять выделение" />
          <b>Выбрано: {selected.size}</b>
          <span className="grow" />
          <Button variant="secondary" size="sm" icon={<Forward size={16} />} disabled={selectedMessages.some((m) => m.kind !== 'text')} onClick={() => setDialog({ kind: 'forward', ids: selectedMessages.map((m) => m.id) })}>
            Переслать
          </Button>
          <Button variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={() => setDialog({ kind: 'delete', messages: selectedMessages })}>
            Удалить
          </Button>
        </div>
      ) : (
        <ChatHeader chat={chat} topic={topic} onInfo={onInfo} onBack={topic ? onTopics : undefined}>
          <Button variant="ghost" size="sm" icon={<Search size={18} />} onClick={() => setSearchOpen((s) => !s)} aria-label="Поиск в чате" aria-pressed={searchOpen} />
        </ChatHeader>
      )}

      {searchOpen && (
        <div className="chat-searchbar">
          <Search size={16} aria-hidden />
          <input type="search" autoFocus placeholder="Поиск в переписке" aria-label="Поиск в переписке" value={q} onChange={(e) => (setQ(e.target.value), setHitIndex(0))} onKeyDown={(e) => e.key === 'Enter' && goHit(Math.min(hitIndex + (e.shiftKey ? -1 : 1), hits.length - 1))} />
          <span className="faint">{q.trim().length >= 2 ? (hits.length ? `${hitIndex + 1} из ${hits.length}` : search.isFetching ? '…' : 'нет') : ''}</span>
          <Button variant="ghost" size="sm" icon={<ChevronUp size={16} />} aria-label="Раньше" disabled={hitIndex >= hits.length - 1} onClick={() => goHit(hitIndex + 1)} />
          <Button variant="ghost" size="sm" icon={<ChevronDown size={16} />} aria-label="Позже" disabled={hitIndex <= 0} onClick={() => goHit(hitIndex - 1)} />
          <Button variant="ghost" size="sm" icon={<X size={16} />} aria-label="Закрыть поиск" onClick={() => (setSearchOpen(false), setQ(''))} />
        </div>
      )}

      {pin && !searchOpen && (
        <div className="pinned-bar">
          <button
            type="button"
            className="pinned-main"
            onClick={() => {
              void jump(pin.id);
              setPinIndex((i) => (i + 1) % pins.length);
            }}
          >
            <span className="pinned-rail" aria-hidden>
              {pins.map((p, i) => (
                <i key={p.id} className={i === Math.min(pinIndex, pins.length - 1) ? 'on' : ''} />
              ))}
            </span>
            <span className="pinned-text">
              <b>{pins.length > 1 ? `Закреплённое ${Math.min(pinIndex, pins.length - 1) + 1} из ${pins.length}` : 'Закреплённое сообщение'}</b>
              <span className="clip">{pin.kind === 'poll' ? `📊 ${pin.text}` : pin.text}</span>
            </span>
          </button>
          {can('pin_messages') && (
            <Button variant="ghost" size="sm" icon={<PinOff size={16} />} aria-label="Открепить" onClick={() => chatApi.pin(pin.id, false).then(() => qc.invalidateQueries({ queryKey: ck.pinned(chat.id, topicId) })).catch((e) => toast(errText(e), 'error'))} />
          )}
        </div>
      )}

      <div className="feed" ref={feed} onScroll={onScroll} role="log" aria-label="Сообщения" aria-live="polite">
        {history.isLoading && (
          <div className="feed-loading">
            <Skeleton h={44} w="50%" r={18} />
            <Skeleton h={44} w="38%" r={18} />
          </div>
        )}
        {data && !data.has_before && (
          <div className="feed-start">
            <ChatAvatar title={topic?.name ?? chat.title} group={group} size={64} icon={topic ? topic.icon : undefined} />
            <b>{topic ? topic.name : chat.title}</b>
            <span className="faint">{group ? (topic ? 'Начало темы' : 'Начало группы') : 'Начало переписки'}</span>
          </div>
        )}
        {items.map((it) =>
          it.type === 'day' ? (
            <div key={it.key} className="feed-day">
              <span>{it.label}</span>
            </div>
          ) : it.type === 'new' ? (
            <div key={it.key} className="feed-new">
              <span>Новые сообщения</span>
            </div>
          ) : (
            <Bubble
              key={it.key}
              m={it.message}
              meId={meId}
              group={group}
              first={it.first}
              last={it.last}
              selecting={!!selected}
              selected={!!selected?.has(it.message.id)}
              flash={flash === it.message.id}
              highlight={searchOpen && q.trim().length >= 2 ? q : undefined}
              canClosePoll={group && can('delete_messages')}
              actions={actions}
            />
          ),
        )}
        {typists.length > 0 && (
          <div className="feed-typing">
            <TypingDots /> {typingText(
              typists.map((t) => t.name),
              group,
            )}
          </div>
        )}
      </div>

      {(!atBottom || below > 0) && (
        <button type="button" className="feed-down" onClick={() => scrollToBottom(true)} aria-label={below ? `Вниз, новых: ${below}` : 'Вниз'}>
          <ArrowDown size={18} />
          {below > 0 && <span>{below}</span>}
        </button>
      )}

      {searchOpen && q.trim().length >= 2 && hits.length > 0 && (
        <div className="chat-hits-inline" aria-label="Найдено в переписке">
          {hits.slice(0, 6).map((h, i) => (
            <button key={h.id} type="button" className={i === hitIndex ? 'is-on' : ''} onClick={() => goHit(i)}>
              <b>{h.sender_name?.split(' ')[0]}</b> <Highlighted text={h.text ?? ''} q={q} />
            </button>
          ))}
        </div>
      )}

      {closedForMe ? (
        <div className="chat-closed">
          <Lock size={16} aria-hidden /> Тема закрыта — писать в ней могут администраторы
        </div>
      ) : (
        <Composer
          chatId={chat.id}
          topicId={topicId}
          placeholder={topic ? `Сообщение в «${topic.name}»` : 'Сообщение'}
          mode={mode}
          onCancelMode={() => setMode(null)}
          onSend={send}
          onEdit={(m, text) => {
            setMode(null);
            chatApi
              .edit(m.id, text)
              .then((x) => patchMessage(qc, chat.id, m.id, () => x))
              .catch((e) => toast(errText(e), 'error'));
          }}
          onEditLast={editLast}
          onTyping={(stop) => rt.sendTyping(chat.id, topicId, stop)}
          onPoll={() => setDialog({ kind: 'poll' })}
          onSchedule={(text) => setDialog({ kind: 'schedule', text })}
          scheduledCount={scheduled.data?.length ?? 0}
          onShowScheduled={() => setDialog({ kind: 'scheduled' })}
        />
      )}

      {menu && (
        <Menu
          anchor={menu.at}
          align={menu.m.sender_id === meId ? 'end' : 'start'}
          label="Действия с сообщением"
          onClose={() => setMenu(null)}
          items={[
            { label: 'Ответить', icon: <CornerUpLeft size={16} />, onSelect: () => setMode({ kind: 'reply', message: menu.m }) },
            menu.m.kind === 'text' && { label: 'Ответить в другом чате', icon: <MessageSquareReply size={16} />, onSelect: () => setDialog({ kind: 'external', message: menu.m }) },
            menu.m.kind === 'text' && { label: 'Переслать', icon: <Forward size={16} />, onSelect: () => setDialog({ kind: 'forward', ids: [menu.m.id] }) },
            !!menu.m.text && {
              label: 'Копировать текст',
              icon: <Copy size={16} />,
              onSelect: () => {
                void navigator.clipboard?.writeText(menu.m.text ?? '').then(() => toast('Текст скопирован'));
              },
            },
            can('pin_messages') && {
              label: menu.m.pinned ? 'Открепить' : 'Закрепить',
              icon: menu.m.pinned ? <PinOff size={16} /> : <Pin size={16} />,
              onSelect: () =>
                chatApi
                  .pin(menu.m.id, !menu.m.pinned)
                  .then((x) => {
                    patchMessage(qc, chat.id, x.id, () => x);
                    void qc.invalidateQueries({ queryKey: ck.pinned(chat.id, topicId) });
                  })
                  .catch((e) => toast(errText(e), 'error')),
            },
            canEditMessage(menu.m, meId, new Date().toISOString()) && { label: 'Изменить', icon: <Pencil size={16} />, onSelect: () => setMode({ kind: 'edit', message: menu.m }) },
            { label: 'Выделить', icon: <SquareCheck size={16} />, onSelect: () => setSelected(new Set([menu.m.id])) },
            { label: 'Удалить', icon: <Trash2 size={16} />, danger: true, onSelect: () => setDialog({ kind: 'delete', messages: [menu.m] }) },
          ]}
        />
      )}

      {dialog?.kind === 'poll' && <PollDialog chatId={chat.id} topicId={topicId} onClose={() => setDialog(null)} onCreated={() => scrollToBottom(true)} />}
      {dialog?.kind === 'schedule' && <ScheduleDialog chatId={chat.id} topicId={topicId} initialText={dialog.text} onClose={() => setDialog(null)} onDone={() => void qc.invalidateQueries({ queryKey: ck.scheduled(chat.id) })} />}
      {dialog?.kind === 'scheduled' && <ScheduledDialog chatId={chat.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'voters' && dialog.message.poll && <VotersDialog messageId={dialog.message.id} options={dialog.message.poll.options} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'forward' && (
        <ChatPickerDialog
          title={dialog.ids.length > 1 ? `Переслать ${dialog.ids.length} сообщения` : 'Переслать сообщение'}
          onClose={() => setDialog(null)}
          onPick={async (target, title) => {
            try {
              await chatApi.forward(dialog.ids, target);
              setDialog(null);
              setSelected(null);
              void qc.invalidateQueries({ queryKey: ck.list });
              toast(`Переслано в «${title}»`);
              if (target !== chat.id) navigate(`/app/chats/${target}`);
            } catch (e) {
              toast(errText(e), 'error');
            }
          }}
        />
      )}
      {dialog?.kind === 'external' && (
        <ChatPickerDialog
          title="Ответить в другом чате"
          exclude={chat.id}
          onClose={() => setDialog(null)}
          onPick={(target) => {
            const message = dialog.message;
            setDialog(null);
            navigate(`/app/chats/${target}`, { state: { externalReply: message, fromTitle: topic ? `${chat.title} · ${topic.name}` : chat.title } });
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          count={dialog.messages.length}
          forAll={dialog.messages.every(canDeleteForAll)}
          peerName={chat.type === 'private' ? chat.title : null}
          onClose={() => setDialog(null)}
          onDelete={async (how) => {
            await chatApi.deleteMany(
              dialog.messages.map((m) => m.id),
              how,
            );
            removeMessages(
              qc,
              chat.id,
              dialog.messages.map((m) => m.id),
            );
            setSelected(null);
            void qc.invalidateQueries({ queryKey: ck.list });
          }}
        />
      )}
    </div>
  );
}

function DeleteDialog({ count, forAll, peerName, onDelete, onClose }: { count: number; forAll: boolean; peerName: string | null; onDelete: (how: 'me' | 'all') => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async (how: 'me' | 'all') => {
    setBusy(true);
    try {
      await onDelete(how);
      onClose();
    } catch (e) {
      toast(errText(e), 'error');
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={count > 1 ? `Удалить ${count} сообщения?` : 'Удалить сообщение?'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => run('me')} disabled={busy}>
            Только у меня
          </Button>
          {forAll && (
            <Button variant="danger" onClick={() => run('all')} loading={busy}>
              {peerName ? 'У обоих' : 'У всех'}
            </Button>
          )}
        </>
      }
    >
      <p className="faint">{forAll ? 'Удалённое у всех исчезнет из переписки каждого участника.' : 'Сообщение исчезнет только у вас — остальные его увидят.'}</p>
    </Dialog>
  );
}
