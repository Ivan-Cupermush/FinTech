import { Bell, CalendarClock, CheckCheck, MessageSquare, OctagonAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatDate, todayIso } from '@offix/core';
import { api } from '../../lib/api';
import { inboxHeroStats } from '../../lib/hero-stats';
import { useNotifications } from '../../lib/queries';
import { PageHero } from '../../ui/fx/PageHero';
import type { Notification } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Empty, Skeleton } from '../../ui/Misc';
import { TaskPanel } from '../tasks/TaskPanel';
import { PushSettings } from './PushSettings';

const ICONS: Record<string, typeof Bell> = {
  blocked: OctagonAlert,
  task_blocked: OctagonAlert,
  comment: MessageSquare,
  reschedule: CalendarClock,
  task_assigned: UserPlus,
};

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

export function NotificationsPage() {
  const q = useNotifications();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState<string | null>(null);
  const unread = (q.data ?? []).filter((n) => !n.read_at);
  const markRead = async (ids?: string[]) => {
    await api('/notifications/read', { body: ids ? { ids } : {} });
    await qc.invalidateQueries({ queryKey: ['notifications'] });
    await qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const open = (n: Notification) => {
    if (!n.read_at) void markRead([n.id]);
    if (n.task_id) setTaskId(n.task_id);
    else if (n.goal_id) navigate(`/app/goals/${n.goal_id}`);
  };
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <PageHero
        variant="inbox"
        icon={Bell}
        title="Уведомления"
        subtitle={unread.length ? `Непрочитанных: ${unread.length}` : 'Всё прочитано'}
        stats={q.data ? inboxHeroStats(q.data) : undefined}
        actions={
          unread.length > 0 && (
            <Button icon={<CheckCheck size={16} />} onClick={() => markRead()}>
              Прочитать все
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <Skeleton h={200} />
      ) : q.data?.length ? (
        <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
          {groupByDay(q.data, todayIso()).map((g) => (
            <section key={g.label}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                {g.label}
              </div>
              <div className="card card-tight list">
                {g.items.map((n) => {
                  const Icon = ICONS[n.kind] ?? Bell;
                  return (
                    <button key={n.id} type="button" className="list-row" onClick={() => open(n)} style={{ alignItems: 'flex-start' }}>
                      <Icon size={18} aria-hidden style={{ flex: 'none', marginTop: 2, color: n.kind.includes('blocked') ? 'var(--bad)' : 'var(--ink-3)' }} />
                      <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                        <span style={{ fontWeight: n.read_at ? 450 : 620 }}>{n.title}</span>
                        {n.body && <span className="faint" style={{ fontSize: 13 }}>{n.body}</span>}
                      </span>
                      <span className="faint num" style={{ fontSize: 12.5, flex: 'none' }}>
                        {new Date(n.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {!n.read_at && <span aria-label="Не прочитано" style={{ width: 8, height: 8, borderRadius: 8, background: 'var(--accent)', flex: 'none', marginTop: 7 }} />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Bell size={22} />} title="Уведомлений нет">
            Здесь появятся блокеры в вашей зоне, новые задачи, переносы сроков и комментарии к вашим целям.
          </Empty>
        </div>
      )}
      <div style={{ marginTop: 28 }}>
        <PushSettings />
      </div>
      {taskId && <TaskPanel id={taskId} onClose={() => setTaskId(null)} />}
    </div>
  );
}
