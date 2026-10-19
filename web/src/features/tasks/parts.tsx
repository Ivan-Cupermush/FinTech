import { Ban, Check, Circle, CircleDot, Eye } from 'lucide-react';
import { BLOCKER_LABELS, diffDays, formatDate, isOverdue, plural } from '@offix/core';
import type { Task } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { TaskStatusPill } from '../../ui/Pill';

const ICON = { todo: Circle, in_progress: CircleDot, blocked: Ban, review: Eye, done: Check, cancelled: Circle } as const;

export function TaskRow({ task, today, onOpen, showAssignee = true }: { task: Task; today: string; onOpen: (id: string) => void; showAssignee?: boolean }) {
  const Icon = ICON[task.status];
  const overdue = isOverdue(task, today);
  const blockedFor = task.blocker ? diffDays(task.blocker.since.slice(0, 10), today) : 0;
  return (
    <button type="button" className="list-row" onClick={() => onOpen(task.id)}>
      <Icon size={18} aria-hidden style={{ flex: 'none', color: task.status === 'done' ? 'var(--good)' : task.status === 'blocked' ? 'var(--bad)' : 'var(--ink-3)' }} />
      <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
        <span className="clip" style={{ fontWeight: 540, textDecoration: task.status === 'done' ? 'line-through' : undefined, color: task.status === 'done' ? 'var(--ink-3)' : undefined }}>
          {task.title}
        </span>
        <span className="clip faint" style={{ fontSize: 12.5 }}>
          {task.blocker
            ? `${BLOCKER_LABELS[task.blocker.reason]}${task.blocker.note ? `: ${task.blocker.note}` : ''} · ${blockedFor > 0 ? `${blockedFor} ${plural(blockedFor, ['день', 'дня', 'дней'])}` : 'сегодня'}`
            : [task.team?.name ?? task.unit?.name, task.due_at && `до ${formatDate(task.due_at, { short: true, today })}`].filter(Boolean).join(' · ')}
        </span>
      </span>
      <TaskStatusPill status={task.status} overdue={overdue} />
      {showAssignee && task.assignee && <Avatar name={task.assignee.display_name ?? ''} size={26} />}
    </button>
  );
}
