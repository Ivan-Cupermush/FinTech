import { addDays, diffDays } from './dates';
import { isValidIsoDate } from './goal';
import { monthGrid, type CalendarCell } from './my-notes';
import { TASK_TRANSITIONS, type TaskLike, type TaskStatus } from './task';
import { plural } from './units';

/**
 * Задача и просьба. Просьба — короткое «помоги, пожалуйста» коллеге из
 * любого отдела: тот же срок, файлы, контрольные точки и обсуждение, но без
 * приёмки, согласующих и наблюдателей. Исполнитель сам отмечает «Готово»,
 * автор благодарит.
 */
export const TASK_KINDS = ['task', 'request'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABELS: Record<TaskKind, string> = { task: 'Задача', request: 'Просьба' };

/** У просьбы нет приёмки: из работы — сразу в «Выполнена». */
export const REQUEST_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['in_progress', 'done', 'blocked', 'cancelled'],
  in_progress: ['done', 'blocked', 'todo', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  review: ['done', 'in_progress'],
  done: ['in_progress'],
  cancelled: ['todo'],
};

export function canTransitionKind(kind: TaskKind, from: TaskStatus, to: TaskStatus): boolean {
  return (kind === 'request' ? REQUEST_TRANSITIONS : TASK_TRANSITIONS)[from].includes(to);
}

/** Поблагодарить можно за выполненную просьбу — автору и один раз на каждое выполнение. */
export function canThank(t: { kind: TaskKind; status: TaskStatus; created_by: string; thanked_at: string | null }, actorId: string): boolean {
  return t.kind === 'request' && t.status === 'done' && t.created_by === actorId && !t.thanked_at;
}

// ------------------------------------------------------------ контрольные точки

export const CHECKPOINT_STATUSES = ['pending', 'done', 'missed'] as const;
export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];
export const CHECKPOINTS_MAX = 20;

export interface Checkpoint {
  id: string;
  title: string;
  due_at: string;
  status: CheckpointStatus;
  done_at: string | null;
  done_by_name: string | null;
}

/** Как выглядит точка сегодня: ждёт, скоро, срок прошёл, пройдена или сорвана. */
export type CheckpointState = 'done' | 'missed' | 'late' | 'soon' | 'pending';

export function checkpointState(cp: Pick<Checkpoint, 'status' | 'due_at'>, today: string): CheckpointState {
  if (cp.status === 'done') return 'done';
  if (cp.status === 'missed') return 'missed';
  if (cp.due_at < today) return 'late';
  if (diffDays(today, cp.due_at) <= 2) return 'soon';
  return 'pending';
}

export const CHECKPOINT_STATE_LABELS: Record<CheckpointState, string> = {
  done: 'Пройдена',
  missed: 'Сорвана',
  late: 'Срок прошёл',
  soon: 'Скоро',
  pending: 'Впереди',
};

export function checkpointProgress(list: readonly Pick<Checkpoint, 'status'>[]): { done: number; total: number } {
  return { done: list.filter((c) => c.status === 'done').length, total: list.length };
}

/** Ближайшая непройденная точка — её показываем в строке задачи. */
export function nextCheckpoint<T extends Pick<Checkpoint, 'status' | 'due_at'>>(list: readonly T[]): T | null {
  return [...list].filter((c) => c.status === 'pending').sort((a, b) => a.due_at.localeCompare(b.due_at))[0] ?? null;
}

/** Точка — промежуточный срок: не позже срока самой задачи. */
export function validateCheckpoint(cp: { title?: string; due_at?: string }, taskDue: string | null): Record<string, string> {
  const errors: Record<string, string> = {};
  if (cp.title !== undefined) {
    const t = cp.title.trim();
    if (!t) errors.title = 'Назовите контрольную точку';
    else if (t.length > 200) errors.title = 'Название — не длиннее 200 символов';
  }
  if (cp.due_at !== undefined) {
    if (!isValidIsoDate(cp.due_at)) errors.due_at = 'Укажите дату в формате ГГГГ-ММ-ДД';
    else if (taskDue && cp.due_at > taskDue) errors.due_at = 'Контрольная точка — не позже срока задачи';
  }
  return errors;
}

// ------------------------------------------------------------ архив

/** Через сколько дней закрытая задача уходит в архив сама. */
export const AUTO_ARCHIVE_DAYS = 3;

/**
 * Пора ли убрать задачу в архив: выполнена или отменена больше трёх дней
 * назад и её не возвращали из архива после этого закрытия.
 */
export function shouldAutoArchive(
  t: { status: TaskStatus; done_at: string | null; closed_at: string | null; archived_at: string | null; unarchived_at: string | null },
  now: string,
  days = AUTO_ARCHIVE_DAYS,
): boolean {
  if (t.archived_at || (t.status !== 'done' && t.status !== 'cancelled')) return false;
  const closed = t.closed_at ?? t.done_at;
  if (!closed) return false;
  if (t.unarchived_at && t.unarchived_at >= closed) return false;
  return Date.parse(closed) <= Date.parse(now) - days * 86_400_000;
}

/** Убрать в архив руками можно только закрытую задачу: живую работу архив не прячет. */
export function canArchive(t: { status: TaskStatus; archived_at: string | null }): string | null {
  if (t.archived_at) return 'Задача уже в архиве';
  if (t.status !== 'done' && t.status !== 'cancelled') return 'В архив убирают выполненные и отменённые задачи';
  return null;
}

export function archiveNote(t: { archived_at: string | null; archived_by_name?: string | null }, today: string): string | null {
  if (!t.archived_at) return null;
  const ago = diffDays(t.archived_at.slice(0, 10), today);
  const when = ago <= 0 ? 'сегодня' : ago === 1 ? 'вчера' : `${ago} ${plural(ago, ['день', 'дня', 'дней'])} назад`;
  return t.archived_by_name ? `Убрана в архив ${when} · ${t.archived_by_name}` : `Убрана в архив ${when} автоматически — через ${AUTO_ARCHIVE_DAYS} дня после закрытия`;
}

// ------------------------------------------------------------ календарь задач

export interface TaskCalendarDay {
  date: string;
  count: number;
  /** Сколько из них просрочено — красная точка в календаре. */
  late: number;
}

/** Задачи на дни месяца по сроку: открытые и выполненные в этом месяце. */
export function taskCalendar(tasks: readonly (TaskLike & { archived_at?: string | null })[], month: string, today: string): TaskCalendarDay[] {
  const days = new Map<string, TaskCalendarDay>();
  for (const t of tasks) {
    if (!t.due_at || t.status === 'cancelled' || t.due_at.slice(0, 7) !== month) continue;
    const d = days.get(t.due_at) ?? { date: t.due_at, count: 0, late: 0 };
    d.count++;
    if (t.status !== 'done' && t.due_at < today) d.late++;
    days.set(t.due_at, d);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface TaskCalendarCell extends CalendarCell {
  late: number;
}

export function taskMonthGrid(month: string, days: readonly TaskCalendarDay[], opts: { today?: string; selected?: string | null } = {}): TaskCalendarCell[][] {
  const late = new Map(days.map((d) => [d.date, d.late]));
  return monthGrid(month, { ...opts, counts: Object.fromEntries(days.map((d) => [d.date, d.count])) }).map((w) => w.map((c) => ({ ...c, late: late.get(c.date) ?? 0 })));
}

/** Задачи выбранного дня; без дня — неделя от сегодня. */
export function tasksForDay<T extends TaskLike>(tasks: readonly T[], date: string | null, today: string): T[] {
  const until = addDays(today, 6);
  return tasks
    .filter((t) => t.status !== 'cancelled' && !!t.due_at && (date ? t.due_at === date : t.due_at >= today && t.due_at <= until))
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
}

// ------------------------------------------------------------ «Входящие»

export interface InboxTaskState {
  kind: TaskKind;
  status: TaskStatus;
  thanked: boolean;
  /** Я автор. */
  mine: boolean;
  /** Я исполнитель. */
  assignee: boolean;
}

/**
 * Кнопка прямо в уведомлении, чтобы не открывать задачу: исполнитель берёт
 * новую просьбу в работу, автор благодарит за выполненную. Подпись — когда
 * кнопка уже не нужна.
 */
export function inboxTaskAction(n: { kind: string; task_state?: InboxTaskState | null }): { action: 'start' | 'thank' | null; note: string | null } {
  const t = n.task_state;
  if (!t) return { action: null, note: null };
  if (n.kind === 'task_request' && t.assignee) {
    if (t.status === 'todo') return { action: 'start', note: null };
    if (t.status === 'done') return { action: null, note: t.thanked ? 'Выполнено · вас поблагодарили' : 'Выполнено' };
    if (t.status === 'cancelled') return { action: null, note: 'Просьбу отменили' };
    return { action: null, note: 'В работе' };
  }
  if (n.kind === 'task_done' && t.kind === 'request' && t.mine) {
    if (t.thanked) return { action: null, note: 'Вы поблагодарили' };
    if (t.status === 'done') return { action: 'thank', note: null };
    return { action: null, note: 'Просьбу вернули в работу' };
  }
  return { action: null, note: null };
}
