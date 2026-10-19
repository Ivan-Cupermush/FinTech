import { diffDays, formatDate, isOverdue, plural, type Task } from '@offix/core';

/** Короткая подпись срока для строк списка: «через 3 дня», «просрочено на 2 дня». */
export function dueText(due: string | null, today: string): { text: string; overdue: boolean } {
  if (!due) return { text: 'Без срока', overdue: false };
  const left = diffDays(today, due);
  if (left < 0) return { text: `просрочено на ${-left} ${plural(-left, ['день', 'дня', 'дней'])}`, overdue: true };
  if (left === 0) return { text: 'сегодня', overdue: false };
  if (left === 1) return { text: 'завтра', overdue: false };
  return { text: `до ${formatDate(due, { short: true, today })} · через ${left} ${plural(left, ['день', 'дня', 'дней'])}`, overdue: false };
}

/** Действия над задачей, доступные исполнителю в текущем статусе — по одному главному. */
export function taskActions(t: Pick<Task, 'status'>): { status: Task['status']; label: string; primary: boolean }[] {
  switch (t.status) {
    case 'todo':
      return [
        { status: 'in_progress', label: 'Взять в работу', primary: true },
        { status: 'blocked', label: 'Есть блокер', primary: false },
      ];
    case 'in_progress':
      return [
        { status: 'review', label: 'На проверку', primary: true },
        { status: 'done', label: 'Готово', primary: false },
        { status: 'blocked', label: 'Есть блокер', primary: false },
      ];
    case 'blocked':
      return [{ status: 'in_progress', label: 'Блокер снят', primary: true }];
    case 'review':
      return [
        { status: 'done', label: 'Принять', primary: true },
        { status: 'in_progress', label: 'Вернуть в работу', primary: false },
      ];
    case 'done':
      return [{ status: 'in_progress', label: 'Открыть снова', primary: false }];
    default:
      return [];
  }
}

/** Секции списка задач на телефоне: блокеры и просрочка сверху. */
export function taskSections(tasks: Task[], today: string) {
  const open = tasks.filter((t) => t.status !== 'cancelled');
  const sections = [
    { key: 'blocked', title: 'Заблокированы', data: open.filter((t) => t.status === 'blocked') },
    { key: 'overdue', title: 'Просрочены', data: open.filter((t) => t.status !== 'blocked' && isOverdue(t, today)) },
    { key: 'active', title: 'В работе', data: open.filter((t) => (t.status === 'in_progress' || t.status === 'review') && !isOverdue(t, today)) },
    { key: 'todo', title: 'К выполнению', data: open.filter((t) => t.status === 'todo' && !isOverdue(t, today)) },
    { key: 'done', title: 'Готово', data: open.filter((t) => t.status === 'done') },
  ];
  const byDue = (a: Task, b: Task) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999');
  return sections.filter((s) => s.data.length).map((s) => ({ ...s, data: [...s.data].sort(byDue) }));
}

/** «Доброе утро» — по локальному времени устройства. */
export function greeting(hour: number): string {
  return hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
}
