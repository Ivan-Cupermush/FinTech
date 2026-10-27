import { Bell, CalendarClock, CheckCheck, MessageSquare, NotebookPen, OctagonAlert, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, todayIso } from '@offix/core';
import { api } from '../../lib/api';
import { inboxHeroStats } from '../../lib/hero-stats';
import { PageHero } from '../../ui/fx/PageHero';
import type { Notification } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Empty, Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { NoteRequestDialog, SharedNoteDialog } from '../my-notes/NoteDialogs';
import { myNotesApi } from '../my-notes/data';
import { TaskPanel } from '../tasks/TaskPanel';
import { PushSettings } from './PushSettings';

const ICONS: Record<string, typeof Bell> = {
  blocked: OctagonAlert,
  task_blocked: OctagonAlert,
  comment: MessageSquare,
  reschedule: CalendarClock,
  task_assigned: UserPlus,
  note_request: NotebookPen,
  note_request_approved: NotebookPen,
  note_request_declined: NotebookPen,
};

const PAGE = 50;

/** Сначала сегодня, затем вчера и раньше — по дням. */
export function groupByDay(items: Notification[], today: string) {
  const out: { label: string; items: Notification[] }[] = [];
  for (const n of items) {
    const day = n.created_at.slice(0, 10);
    const label = day === today ? 'Сегодня' : formatDate(day, { today });
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(n);
    else out.push({ label, items: [n] });
  }
  return out;
}

/** Лента «Входящих» страницами: новые сверху, «Показать ещё» — раньше. */
export function useInbox() {
  return useInfiniteQuery({
    queryKey: ['notifications', 'feed'],
    queryFn: ({ pageParam }) => api<Notification[]>(`/notifications?limit=${PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.created_at : undefined),
  });
}

type Open = { kind: 'task'; id: string } | { kind: 'request'; id: string } | { kind: 'share'; id: string } | null;

export function NotificationsPage() {
  const q = useInbox();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Open>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const items = q.data?.pages.flat() ?? [];
  const unread = items.filter((n) => !n.read_at);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['notifications'] });
    await qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const markRead = async (ids?: string[]) => {
    await api('/notifications/read', { body: ids ? { ids } : {} });
    await refresh();
  };
  const clearRead = async () => {
    await api('/notifications?read=1', { method: 'DELETE' });
    await refresh();
    toast('Прочитанные убраны');
  };
  const go = (n: Notification) => {
    if (!n.read_at) void markRead([n.id]);
    const d = n.data ?? {};
    if (n.kind === 'note_request' && d.request_id) setOpen({ kind: 'request', id: d.request_id });
    else if (n.kind === 'note_request_approved' && d.note_id) navigate(`/app/my-notes/${d.note_id}`);
    else if (n.kind === 'note_request_declined' && d.share_id) setOpen({ kind: 'share', id: d.share_id });
    else if (n.task_id) setOpen({ kind: 'task', id: n.task_id });
    else if (n.goal_id) navigate(`/app/goals/${n.goal_id}`);
  };
  const answer = async (n: Notification, how: 'approve' | 'decline') => {
    const id = n.data?.request_id;
    if (!id) return;
    setAnswering(`${n.id}:${how}`);
    try {
      const r = how === 'approve' ? await myNotesApi.approve(id) : await myNotesApi.decline(id);
      toast(how === 'approve' ? `Свежая версия у ${r.requester.name.split(' ')[0]}` : 'Отказали — запросивший узнает');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setAnswering(null);
    }
  };
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <PageHero
        variant="inbox"
        icon={Bell}
        title="Уведомления"
        subtitle={unread.length ? `Непрочитанных: ${unread.length}` : 'Всё прочитано'}
        stats={q.data ? inboxHeroStats(items) : undefined}
        actions={
          <>
            {unread.length > 0 && (
              <Button icon={<CheckCheck size={16} />} onClick={() => markRead()}>
                Прочитать все
              </Button>
            )}
            {items.length > unread.length && (
              <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => void clearRead()}>
                Убрать прочитанные
              </Button>
            )}
          </>
        }
      />
      {q.isLoading ? (
        <Skeleton h={200} />
      ) : items.length ? (
        <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
          {groupByDay(items, todayIso()).map((g) => (
            <section key={g.label}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                {g.label}
              </div>
              <div className="card card-tight list">
                {g.items.map((n) => {
                  const Icon = ICONS[n.kind] ?? Bell;
                  const pending = n.kind === 'note_request' && n.request_status === 'pending';
                  return (
                    <div key={n.id} className="inbox-row">
                      <button type="button" className="list-row inbox-main" onClick={() => go(n)} style={{ alignItems: 'flex-start' }}>
                        {n.actor_id && n.actor_name ? (
                          <span className="inbox-ava">
                            <Avatar name={n.actor_name} size={30} id={n.actor_id} />
                            <Icon size={12} aria-hidden />
                          </span>
                        ) : (
                          <Icon size={18} aria-hidden style={{ flex: 'none', marginTop: 2, color: n.kind.includes('blocked') ? 'var(--bad)' : 'var(--ink-3)' }} />
                        )}
                        <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                          <span style={{ fontWeight: n.read_at ? 450 : 620 }}>{n.title}</span>
                          {n.body && <span className="faint" style={{ fontSize: 13 }}>{n.body}</span>}
                          {n.kind === 'note_request' && n.request_status && n.request_status !== 'pending' && (
                            <span className="faint" style={{ fontSize: 12.5 }}>
                              {n.request_status === 'approved' ? 'Вы поделились' : 'Вы отказали'}
                            </span>
                          )}
                        </span>
                        <span className="faint num" style={{ fontSize: 12.5, flex: 'none' }}>
                          {new Date(n.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {!n.read_at && <span aria-label="Не прочитано" style={{ width: 8, height: 8, borderRadius: 8, background: 'var(--accent)', flex: 'none', marginTop: 7 }} />}
                      </button>
                      {pending && (
                        <div className="inbox-actions">
                          <Button size="sm" variant="ghost" loading={answering === `${n.id}:decline`} disabled={!!answering} onClick={() => void answer(n, 'decline')}>
                            Отказать
                          </Button>
                          <Button size="sm" variant="primary" loading={answering === `${n.id}:approve`} disabled={!!answering} onClick={() => void answer(n, 'approve')}>
                            Поделиться
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {q.hasNextPage && (
            <div style={{ textAlign: 'center' }}>
              <Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                Показать ещё
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Bell size={22} />} title="Уведомлений нет">
            Здесь появятся блокеры в вашей зоне, новые задачи, переносы сроков, комментарии к вашим целям и запросы ваших заметок.
          </Empty>
        </div>
      )}
      <div style={{ marginTop: 28 }}>
        <PushSettings />
      </div>
      {open?.kind === 'task' && <TaskPanel id={open.id} onClose={() => setOpen(null)} />}
      {open?.kind === 'request' && (
        <NoteRequestDialog
          requestId={open.id}
          onClose={() => {
            setOpen(null);
            void refresh();
          }}
        />
      )}
      {open?.kind === 'share' && <SharedNoteDialog shareId={open.id} onClose={() => setOpen(null)} />}
    </div>
  );
}
