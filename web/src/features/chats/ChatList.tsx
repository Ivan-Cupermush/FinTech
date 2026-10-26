import { useQueryClient } from '@tanstack/react-query';
import { Archive, Bell, BellOff, CheckCheck, MessagesSquare, MoreHorizontal, Pin, PinOff, Search, SquarePen, X } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MUTE_PRESETS, chatListTime, isMuted, matchesQuery, messagePreview, muteUntil, sortChats, typingText, type ChatSearchHit, type ChatSummary } from '@offix/core';
import { ApiError } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { PageHero } from '../../ui/fx/PageHero';
import { useMediaQuery } from '../../ui/fx/support';
import { chatApi, ck, markListRead, useChats, useGlobalSearch } from './data';
import { ChatAvatar, Highlighted, Menu, TypingDots } from './parts';
import { typingKey, useRealtime } from './realtime';

type Filter = 'all' | 'unread' | 'groups' | 'private';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'unread', label: 'Непрочитанные' },
  { value: 'groups', label: 'Группы' },
  { value: 'private', label: 'Личные' },
];

/** Список чатов: поиск по названиям и по сообщениям, папки-фильтры, закреп и «без звука». */
export function ChatList({ activeId, onCreate }: { activeId: string | null; onCreate: () => void }) {
  const chats = useChats();
  const me = useMe();
  const rt = useRealtime();
  const narrow = useMediaQuery('(max-width: 900px)');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const hits = useGlobalSearch(q);
  const now = new Date().toISOString();

  const list = useMemo(() => {
    const all = sortChats(chats.data ?? []);
    return all.filter((c) => {
      if (filter === 'unread' && !c.unread) return false;
      if (filter === 'groups' && c.type !== 'group') return false;
      if (filter === 'private' && c.type !== 'private') return false;
      return matchesQuery([c.title, c.peer?.position], q);
    });
  }, [chats.data, filter, q]);

  const unread = (chats.data ?? []).filter((c) => !c.muted).reduce((s, c) => s + c.unread, 0);
  const onlineNow = (chats.data ?? []).filter((c) => c.peer && (rt.online.has(c.peer.id) || c.peer.online)).length;

  return (
    <div className="chat-list-pane">
      {narrow ? (
        <PageHero
          variant="chats"
          icon={MessagesSquare}
          eyebrow="Мессенджер"
          title="Чаты"
          subtitle="Личные переписки, рабочие группы и темы"
          stats={[
            { label: 'непрочитанных', value: unread, tone: unread ? 'warn' : undefined },
            { label: 'собеседников в сети', value: onlineNow },
          ]}
          actions={
            <Button variant="primary" icon={<SquarePen size={16} />} onClick={onCreate}>
              Новый чат
            </Button>
          }
          className="chats-hero"
        />
      ) : (
        <div className="chat-list-head">
          <div>
            <h1>Чаты</h1>
            <p className="faint">{unread ? `${unread} непрочитанных` : 'Всё прочитано'}</p>
          </div>
          <Button variant="primary" size="sm" icon={<SquarePen size={16} />} onClick={onCreate} aria-label="Новый чат" title="Новый чат" />
        </div>
      )}
      <label className="chat-search">
        <Search size={16} aria-hidden />
        <input type="search" placeholder="Поиск по чатам и сообщениям" aria-label="Поиск по чатам" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button type="button" className="chat-search-clear" onClick={() => setQ('')} aria-label="Очистить поиск">
            <X size={14} />
          </button>
        )}
      </label>
      <div className="chat-filters" role="tablist" aria-label="Папки">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" role="tab" aria-selected={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
            {f.value === 'unread' && unread > 0 && <span className="count">{unread}</span>}
          </button>
        ))}
      </div>
      <div className="chat-list" role="list" aria-label="Чаты">
        {chats.isLoading &&
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="chat-row is-skeleton">
              <Skeleton h={48} w={48} r={24} />
              <div className="grow stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                <Skeleton h={14} w="60%" />
                <Skeleton h={12} w="85%" />
              </div>
            </div>
          ))}
        {list.map((c) => (
          <ChatRow key={c.id} chat={c} active={c.id === activeId} meId={me.data?.id ?? ''} now={now} q={q} />
        ))}
        {chats.data && !list.length && !q && (
          <div className="chat-list-empty">
            <MessagesSquare size={28} aria-hidden />
            <p>{filter === 'unread' ? 'Непрочитанных нет — всё под контролем' : 'Чатов пока нет'}</p>
            {filter === 'all' && (
              <Button variant="secondary" size="sm" onClick={onCreate}>
                Написать коллеге
              </Button>
            )}
          </div>
        )}
        {q.trim().length >= 2 && <SearchHits hits={hits.data ?? []} loading={hits.isFetching} q={q} chatsFound={list.length} />}
      </div>
    </div>
  );
}

function ChatRow({ chat: c, active, meId, now, q }: { chat: ChatSummary; active: boolean; meId: string; now: string; q: string }) {
  const rt = useRealtime();
  const qc = useQueryClient();
  const toast = useToast();
  const [menu, setMenu] = useState<DOMRect | { x: number; y: number } | null>(null);
  const typists = [...rt.typing.entries()].filter(([k]) => k.startsWith(`${c.id}:`)).flatMap(([, v]) => v);
  const online = !!c.peer && (rt.online.has(c.peer.id) || (c.peer.online && !rt.lastSeen.has(c.peer.id)));
  const muted = isMuted(c.muted_until, now);
  const preview = c.last_message ? messagePreview(c.last_message, meId, c.type === 'group') : c.type === 'group' ? `${c.members_count} участников` : 'Нет сообщений';

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ck.list });
      void qc.invalidateQueries({ queryKey: ck.unread });
      if (ok) toast(ok);
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось', 'error');
    }
  };
  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    setMenu(e.type === 'contextmenu' ? { x: e.clientX, y: e.clientY } : (e.currentTarget as HTMLElement).getBoundingClientRect());
  };

  return (
    <div className={`chat-row ${active ? 'is-active' : ''} ${c.unread && !muted ? 'is-unread' : ''}`} role="listitem" onContextMenu={openMenu}>
      <Link to={`/app/chats/${c.id}`} className="chat-row-link" aria-current={active ? 'page' : undefined} aria-label={`${c.title}${c.unread ? `, ${c.unread} непрочитанных` : ''}`}>
        <ChatAvatar title={c.title} group={c.type === 'group'} online={online} userId={c.peer?.id} icon={c.type === 'private' && !c.peer ? <Archive size={20} /> : undefined} />
        <span className="chat-row-main">
          <span className="chat-row-top">
            <span className="chat-row-title clip">{q ? <Highlighted text={c.title} q={q} /> : c.title}</span>
            {muted && <BellOff size={13} className="chat-row-icon" aria-label="Без звука" />}
            <span className="chat-row-time">{c.last_message ? chatListTime(c.last_message.created_at, now) : ''}</span>
          </span>
          <span className="chat-row-bottom">
            {typists.length ? (
              <span className="chat-row-preview is-typing">
                <TypingDots /> {typingText(
                  typists.map((t) => t.name),
                  c.type === 'group',
                )}
              </span>
            ) : (
              <span className="chat-row-preview clip">{preview}</span>
            )}
            {c.pinned && !c.unread && <Pin size={13} className="chat-row-icon" aria-label="Закреплён" />}
            {c.unread > 0 && <span className={`chat-badge ${muted ? 'is-muted' : ''}`}>{c.unread > 99 ? '99+' : c.unread}</span>}
          </span>
        </span>
      </Link>
      <button type="button" className="chat-row-more" aria-label={`Действия с чатом ${c.title}`} onClick={openMenu}>
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <Menu
          anchor={menu}
          align={'width' in menu ? 'end' : 'start'}
          label={`Действия с чатом ${c.title}`}
          onClose={() => setMenu(null)}
          items={[
            { label: c.pinned ? 'Открепить' : 'Закрепить', icon: c.pinned ? <PinOff size={16} /> : <Pin size={16} />, onSelect: () => act(() => chatApi.membership(c.id, { pinned: !c.pinned })) },
            muted
              ? { label: 'Включить звук', icon: <Bell size={16} />, onSelect: () => act(() => chatApi.membership(c.id, { muted_until: null })) }
              : { label: 'Без звука на сутки', icon: <BellOff size={16} />, onSelect: () => act(() => chatApi.membership(c.id, { muted_until: muteUntil(MUTE_PRESETS[2].hours, new Date().toISOString()) })) },
            !muted && { label: 'Без звука навсегда', icon: <BellOff size={16} />, onSelect: () => act(() => chatApi.membership(c.id, { muted_until: muteUntil(null, new Date().toISOString()) })) },
            c.unread > 0 && {
              label: 'Отметить прочитанным',
              icon: <CheckCheck size={16} />,
              onSelect: () =>
                act(async () => {
                  markListRead(qc, c.id);
                  await chatApi.read(c.id, Number.MAX_SAFE_INTEGER, null).catch(() => undefined);
                }),
            },
            { label: 'Скрыть из списка', icon: <Archive size={16} />, onSelect: () => act(() => chatApi.membership(c.id, { hidden: true }), 'Чат скрыт — вернётся с новым сообщением') },
          ]}
        />
      )}
    </div>
  );
}

function SearchHits({ hits, loading, q, chatsFound }: { hits: ChatSearchHit[]; loading: boolean; q: string; chatsFound: number }) {
  const navigate = useNavigate();
  const now = new Date().toISOString();
  return (
    <section className="chat-hits" aria-label="Найдено в сообщениях">
      <div className="chat-hits-title">Сообщения{loading ? '…' : hits.length ? ` · ${hits.length}` : ''}</div>
      {!loading && !hits.length && <p className="chat-hits-empty">{chatsFound ? 'В сообщениях ничего не нашлось' : 'Ничего не нашлось — попробуйте часть слова'}</p>}
      {hits.map((h) => (
        <button
          key={h.id}
          type="button"
          className="chat-hit"
          onClick={() => navigate(`/app/chats/${h.chat_id}${h.topic_id && h.chat_type === 'group' ? `?topic=${h.topic_id}` : ''}`, { state: { jump: h.id } })}
        >
          <ChatAvatar title={h.chat_title} group={h.chat_type === 'group'} size={40} />
          <span className="chat-row-main">
            <span className="chat-row-top">
              <span className="chat-row-title clip">
                {h.chat_title}
                {h.topic_name ? <span className="faint"> · {h.topic_name}</span> : null}
              </span>
              <span className="chat-row-time">{chatListTime(h.created_at, now)}</span>
            </span>
            <span className="chat-row-preview clip">
              {h.chat_type === 'group' && h.sender_name ? `${h.sender_name.split(' ')[0]}: ` : ''}
              <Highlighted text={h.text ?? ''} q={q} />
            </span>
          </span>
        </button>
      ))}
    </section>
  );
}
