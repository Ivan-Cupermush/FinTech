import { Ban, Check, Circle, CircleDot, Eye, Flag, HandHelping } from 'lucide-react';
import { BLOCKER_LABELS, TASK_LIGHT_LABELS, checkpointProgress, diffDays, formatDate, isOverdue, lightOf, plural, type TaskLightView } from '@offix/core';
import type { Task } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { TaskStatusPill } from '../../ui/Pill';
import './tasks.css';

const ICON = { todo: Circle, in_progress: CircleDot, blocked: Ban, review: Eye, done: Check, cancelled: Circle } as const;

/** Светофор задачи: цвет — это риск, подсказка объясняет почему. */
export function LightDot({ view }: { view: TaskLightView | null }) {
  if (!view) return null;
  return (
    <span className={`light-dot is-${view.light}`} title={view.reason} role="img" aria-label={`${TASK_LIGHT_LABELS[view.light]}: ${view.reason}`} />
  );
}

export function TaskRow({
  task,
  today,
  onOpen,
  showAssignee = true,
  meta,
  critical,
}: {
  task: Task;
  today: string;
  onOpen: (id: string) => void;
  showAssignee?: boolean;
  /** Своя вторая строка — например, когда и кто убрал задачу в архив. */
  meta?: string | null;
  /** На критическом пути цели: блокировка и просрочка здесь — красный. */
  critical?: boolean;
}) {
  const Icon = ICON[task.status];
  const overdue = isOverdue(task, today);
  const blockedFor = task.blocker ? diffDays(task.blocker.since.slice(0, 10), today) : 0;
  const cps = checkpointProgress(task.checkpoints ?? []);
  const request = task.kind === 'request';
  const line =
    meta ??
    (task.blocker
      ? `${BLOCKER_LABELS[task.blocker.reason]}${task.blocker.note ? `: ${task.blocker.note}` : ''} · ${blockedFor > 0 ? `${blockedFor} ${plural(blockedFor, ['день', 'дня', 'дней'])}` : 'сегодня'}`
      : [request && task.created_by_name && `от ${task.created_by_name}`, task.team?.name ?? task.unit?.name, task.due_at && `до ${formatDate(task.due_at, { short: true, today })}`].filter(Boolean).join(' · '));
  return (
    <button type="button" className="list-row task-row" onClick={() => onOpen(task.id)}>
      <Icon size={18} aria-hidden style={{ flex: 'none', color: task.status === 'done' ? 'var(--good)' : task.status === 'blocked' ? 'var(--bad)' : 'var(--ink-3)' }} />
      <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
        <span className="row" style={{ gap: 8, minWidth: 0 }}>
          {request && (
            <span className="task-kind">
              <HandHelping size={12} aria-hidden /> Просьба
            </span>
          )}
          <span className="clip" style={{ fontWeight: 540, textDecoration: task.status === 'done' ? 'line-through' : undefined, color: task.status === 'done' ? 'var(--ink-3)' : undefined }}>
            {task.title}
          </span>
        </span>
        <span className="row faint" style={{ gap: 10, fontSize: 12.5, minWidth: 0 }}>
          {line && <span className="clip">{line}</span>}
          {cps.total > 0 && (
            <span className="task-cps num" title="Контрольные точки">
              <Flag size={12} aria-hidden /> {cps.done}/{cps.total}
            </span>
          )}
        </span>
      </span>
      <LightDot view={meta === undefined ? lightOf(task, today, { critical }) : null} />
      <TaskStatusPill status={task.status} overdue={overdue} />
      {showAssignee && task.assignee && <Avatar name={task.assignee.display_name ?? ''} size={26} />}
    </button>
  );
}
