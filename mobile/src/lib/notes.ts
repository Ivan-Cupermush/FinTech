import { addDays, formatDate, plural, type NoteSummary } from '@offix/core';
import type { HeroStat } from './fx';

/**
 * База знаний на телефоне: читать и искать. Писать заметки удобнее
 * на сайте — там предпросмотр разметки и большая клавиатура.
 */

export type NotesScope = 'all' | 'company';

/** Параметры списка так же, как у сайта: поиск, заметки цели или только общие. */
export function notesQuery(p: { q?: string; goalId?: string; scope?: NotesScope }): string {
  const qs = new URLSearchParams();
  if (p.q?.trim()) qs.set('q', p.q.trim());
  if (p.goalId) qs.set('goal_id', p.goalId);
  else if (p.scope === 'company') qs.set('scope', 'company');
  return qs.toString();
}

/** Подпись под заметкой: к какой цели, кто писал и когда правили. */
export function noteMeta(n: Pick<NoteSummary, 'goal_title' | 'author_name' | 'updated_at'>, today: string, withGoal = true): string {
  const parts = [n.author_name, formatDate(n.updated_at.slice(0, 10), { short: true, today })];
  if (withGoal && n.goal_title) parts.unshift(n.goal_title);
  return parts.join(' · ');
}

export function notesStats(notes: Pick<NoteSummary, 'goal_id' | 'updated_at'>[], today: string): HeroStat[] {
  const weekAgo = addDays(today, -7);
  return [
    { label: 'заметок', value: notes.length },
    { label: 'общих', value: notes.filter((n) => !n.goal_id).length },
    { label: 'за неделю', value: notes.filter((n) => n.updated_at.slice(0, 10) >= weekAgo).length },
  ];
}

/** Маркер пункта списка: «1.» у нумерованного, точка у обычного. */
export function listMarker(ordered: boolean, index: number): string {
  return ordered ? `${index + 1}.` : '•';
}

/** Пустой список: при поиске — «ничего не нашлось», у цели и в общей базе — что здесь будет. */
export function notesEmpty(p: { q?: string; goalId?: string }): { title: string; text: string } {
  if (p.q?.trim()) return { title: 'Ничего не нашлось', text: 'Попробуйте другое слово — ищем по заголовку и тексту заметки.' };
  if (p.goalId) return { title: 'У цели пока нет заметок', text: 'Договорённости и решения по цели записывают на сайте — здесь их будет удобно перечитать.' };
  return { title: 'База знаний пуста', text: 'Регламенты и решения пишутся на сайте, а читать их можно и с телефона.' };
}

/** Строка «Заметки» на экране цели. */
export function notesLine(count: number | undefined): string {
  if (count === undefined) return 'Договорённости и решения по цели';
  if (!count) return 'Пока нет — пишутся на сайте';
  return `${count} ${plural(count, ['заметка', 'заметки', 'заметок'])}`;
}
