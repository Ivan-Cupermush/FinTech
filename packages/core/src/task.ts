export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Не начата',
  in_progress: 'В работе',
  blocked: 'Заблокирована',
  review: 'На приёмке',
  done: 'Выполнена',
  cancelled: 'Отменена',
};

export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'review', 'done', 'todo', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  review: ['done', 'in_progress'],
  done: ['in_progress'],
  cancelled: ['todo'],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

/** Причины блокировки — руководитель видит, кому и чем помочь, а не просто красную задачу. */
export const BLOCKER_REASONS = ['approval', 'data', 'technical', 'colleague', 'resources', 'other'] as const;
export type BlockerReason = (typeof BLOCKER_REASONS)[number];

export const BLOCKER_LABELS: Record<BlockerReason, string> = {
  approval: 'Ждём согласования',
  data: 'Не хватает данных',
  technical: 'Техническая проблема',
  colleague: 'Зависим от коллеги',
  resources: 'Не хватает ресурсов',
  other: 'Другое',
};

export const TASK_ROLES = ['owner', 'executor', 'approver', 'contributor'] as const;
export type TaskRole = (typeof TASK_ROLES)[number];

export const TASK_ROLE_LABELS: Record<TaskRole, string> = {
  owner: 'Отвечает за итог',
  executor: 'Исполняет',
  approver: 'Согласует и принимает',
  contributor: 'Участвует',
};

export interface TaskLike {
  id: string;
  status: TaskStatus;
  start_at?: string | null;
  due_at?: string | null;
  done_at?: string | null;
}

export function isClosed(t: Pick<TaskLike, 'status'>): boolean {
  return t.status === 'done' || t.status === 'cancelled';
}

/** Просрочена: срок прошёл, а задача не закрыта. */
export function isOverdue(t: TaskLike, today: string): boolean {
  return !!t.due_at && !isClosed(t) && t.due_at < today;
}

/**
 * Прогресс выполнения задач — индикатор хода работ, НЕ прогресс цели.
 * Отменённые задачи не считаются ни в числителе, ни в знаменателе.
 */
export function taskProgress(tasks: readonly Pick<TaskLike, 'status'>[]): { done: number; total: number; percent: number | null } {
  const counted = tasks.filter((t) => t.status !== 'cancelled');
  const done = counted.filter((t) => t.status === 'done').length;
  return { done, total: counted.length, percent: counted.length ? Math.round((done / counted.length) * 100) : null };
}

/** Доля задач, закрытых в срок, среди закрытых задач со сроком. */
export function onTimeShare(tasks: readonly TaskLike[]): number | null {
  const closed = tasks.filter((t) => t.status === 'done' && t.due_at && t.done_at);
  if (!closed.length) return null;
  const onTime = closed.filter((t) => t.done_at!.slice(0, 10) <= t.due_at!).length;
  return Math.round((onTime / closed.length) * 100);
}
