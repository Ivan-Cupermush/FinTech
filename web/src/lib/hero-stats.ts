import { addDays, isOverdue, plural } from '@offix/core';
import type { HeroStat } from '../ui/fx/PageHero';
import type { Notification, Task } from './types';

/**
 * Цифры для стеклянных плиток в шапках разделов. Плиток всегда две-три:
 * то, что человек хочет увидеть первым, а не всё подряд. Цифра, требующая
 * внимания, получает тон — но только когда она не ноль.
 */

const attention = (n: number, tone: HeroStat['tone']): HeroStat['tone'] => (n > 0 ? tone : undefined);

/** Риски считаются на Пульсе, поэтому «под угрозой» берём из его сводки: цели с критичным риском. */
export function goalsHeroStats(goals: { status: string }[], risks: { severity: string; goal_id: string }[] = []): HeroStat[] {
  const risky = new Set(risks.filter((r) => r.severity === 'critical').map((r) => r.goal_id)).size;
  return [
    { label: 'в работе', value: goals.filter((g) => g.status === 'active').length },
    { label: 'под угрозой', value: risky, tone: attention(risky, 'bad') },
    { label: 'черновики', value: goals.filter((g) => g.status === 'draft').length },
  ];
}

export function tasksHeroStats(tasks: Pick<Task, 'id' | 'status' | 'due_at'>[], today: string): HeroStat[] {
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const blocked = open.filter((t) => t.status === 'blocked').length;
  const overdue = open.filter((t) => t.status !== 'blocked' && isOverdue(t, today)).length;
  return [
    { label: 'в работе', value: open.filter((t) => t.status === 'in_progress').length },
    { label: 'с блокером', value: blocked, tone: attention(blocked, 'bad') },
    { label: 'просрочены', value: overdue, tone: attention(overdue, 'warn') },
  ];
}

export function notesHeroStats(notes: { goal_id: string | null; updated_at: string }[], today: string): HeroStat[] {
  const weekAgo = addDays(today, -7);
  return [
    { label: 'заметок', value: notes.length },
    { label: 'общих', value: notes.filter((n) => !n.goal_id).length },
    { label: 'обновлены за неделю', value: notes.filter((n) => n.updated_at.slice(0, 10) >= weekAgo).length },
  ];
}

/** База знаний: статьи, прочитанные помощником документы и свежие правки. */
export function knowledgeHeroStats(notes: { updated_at: string }[], readyDocs: number | undefined, today: string): HeroStat[] {
  const weekAgo = addDays(today, -7);
  return [
    { label: plural(notes.length, ['статья', 'статьи', 'статей']), value: notes.length },
    { label: readyDocs === undefined ? 'документов' : plural(readyDocs, ['документ', 'документа', 'документов']), value: readyDocs ?? '—' },
    { label: 'обновлено за неделю', value: notes.filter((n) => n.updated_at.slice(0, 10) >= weekAgo).length },
  ];
}

export function integrationsHeroStats(items: { state: string }[]): HeroStat[] {
  const failing = items.filter((i) => i.state === 'error').length;
  return [
    { label: 'подключено', value: items.length },
    { label: 'работают', value: items.filter((i) => i.state === 'ok').length },
    { label: 'с ошибкой', value: failing, tone: attention(failing, 'bad') },
  ];
}

export function inboxHeroStats(items: Pick<Notification, 'kind' | 'read_at'>[]): HeroStat[] {
  const unread = items.filter((n) => !n.read_at);
  const blockers = unread.filter((n) => n.kind === 'task_blocked').length;
  return [
    { label: 'новые', value: unread.length },
    { label: 'блокеры', value: blockers, tone: attention(blockers, 'bad') },
    { label: 'обсуждения', value: unread.filter((n) => n.kind === 'comment').length },
  ];
}

export function orgHeroStats(people: { active: boolean }[], units: { unit_type?: string }[]): HeroStat[] {
  return [
    { label: 'сотрудников', value: people.filter((p) => p.active).length },
    { label: 'подразделений', value: units.length },
  ];
}

export function reportHeroStats(h: { goals: number; health: Record<string, number>; tasks_done: number }): HeroStat[] {
  const critical = h.health.critical ?? 0;
  return [
    { label: 'целей в отчёте', value: h.goals },
    { label: 'под угрозой', value: critical, tone: attention(critical, 'bad') },
    { label: 'задач закрыто', value: h.tasks_done },
  ];
}
