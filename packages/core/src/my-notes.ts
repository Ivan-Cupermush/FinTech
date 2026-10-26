import type { Attachment } from './media';
import { noteExcerpt } from './notes';

/**
 * Личные заметки сотрудника: свой ежедневник, отдельно от общей «Базы
 * знаний». Заметка привязана к дню календаря, бывает в «Избранном», хранит
 * файлы, выгружается в PDF и отправляется в чат. В чат уходит снимок: что
 * отправили, то и получили, даже если автор потом заметку изменит.
 */

export const MY_NOTE_LIMITS = { title: 200, body: 50_000, files: 20 } as const;

/** Заголовок не обязателен: пустая заметка в списке — «Без названия». */
export const UNTITLED = 'Без названия';

export interface MyNoteSummary {
  id: string;
  title: string;
  excerpt: string;
  note_date: string;
  is_favorite: boolean;
  files_count: number;
  updated_at: string;
}

export interface MyNote extends Omit<MyNoteSummary, 'excerpt'> {
  body: string;
  created_at: string;
  attachments: Attachment[];
}

export interface MyNoteDay {
  date: string;
  count: number;
}

/** Пересланная заметка в чате: снимок на момент отправки. */
export interface NoteShareCard {
  id: string;
  title: string;
  excerpt: string;
  files_count: number;
  sender_id: string | null;
}

export interface NoteShareView {
  id: string;
  title: string;
  body: string;
  attachments: Attachment[];
  sender_id: string | null;
  sender_name: string | null;
  created_at: string;
  is_owner: boolean;
  /** Уже сохранена у меня: id моей копии. */
  accepted_note_id: string | null;
  /** Автору — его заметка; остальным — null. */
  original_note_id: string | null;
  original_exists: boolean;
  my_request: NoteRequestState | null;
}

export type NoteRequestStatus = 'pending' | 'approved' | 'declined';

export interface NoteRequestState {
  id: string;
  status: NoteRequestStatus;
  result_note_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** Запрос свежей версии: автор видит, чем поделится, запросивший — только название. */
export interface NoteRequestView extends NoteRequestState {
  is_owner: boolean;
  requester: { id: string; name: string };
  owner: { id: string; name: string };
  shared: { id: string; title: string; created_at: string };
  note: { id: string | null; title: string; preview: string | null; files_count: number | null; updated_at: string; changed_since_share: boolean } | null;
}

export interface MyNoteInput {
  title?: unknown;
  body?: unknown;
  note_date?: unknown;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

export function isIsoDay(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function isIsoMonth(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_MONTH.test(v)) return false;
  const m = Number(v.slice(5));
  return m >= 1 && m <= 12;
}

export function validateMyNote(n: MyNoteInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (n.title !== undefined && n.title !== null) {
    if (typeof n.title !== 'string') errors.title = 'Заголовок должен быть строкой';
    else if (n.title.trim().length > MY_NOTE_LIMITS.title) errors.title = `Заголовок — не длиннее ${MY_NOTE_LIMITS.title} символов`;
  }
  if (n.body !== undefined && n.body !== null) {
    if (typeof n.body !== 'string') errors.body = 'Текст должен быть строкой';
    else if (n.body.length > MY_NOTE_LIMITS.body) errors.body = 'Заметка слишком длинная';
  }
  if (n.note_date !== undefined && n.note_date !== null && !isIsoDay(n.note_date)) errors.note_date = 'Выберите день в календаре';
  return errors;
}

/** Пустая заметка не нужна: без заголовка, текста и файлов её не сохраняем. */
export function isBlankNote(n: { title?: string | null; body?: string | null; files?: number }): boolean {
  return !(n.title ?? '').trim() && !(n.body ?? '').trim() && !(n.files ?? 0);
}

export const noteTitle = (t: string | null | undefined) => (t ?? '').trim() || UNTITLED;

export function myNoteSummary(n: { id: string; title: string; body: string; note_date: string; is_favorite: boolean; files_count: number; updated_at: string }, query = ''): MyNoteSummary {
  return { id: n.id, title: n.title, excerpt: noteExcerpt(n.body, query), note_date: n.note_date, is_favorite: n.is_favorite, files_count: n.files_count, updated_at: n.updated_at };
}

/**
 * Свободное имя для копии, как в Проводнике: «План», а если такой уже
 * есть — «План (2)», «План (3)»… Длинное название укорачивается так, чтобы
 * номер влез в предел.
 */
export function freeCopyTitle(title: string, taken: Iterable<string>, max = MY_NOTE_LIMITS.title): string {
  const base = noteTitle(title).slice(0, max);
  const used = new Set([...taken].map((t) => noteTitle(t)));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const name = base.slice(0, max - suffix.length).trimEnd() + suffix;
    if (!used.has(name)) return name;
  }
}

// ---------------------------------------------------------------- календарь

export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export const monthOf = (day: string) => day.slice(0, 7);

/** «2026-10» ± n месяцев. */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/** «Октябрь 2026». */
export function monthTitle(month: string): string {
  return `${MONTHS_NOM[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

export interface CalendarCell {
  date: string;
  day: number;
  /** День соседнего месяца, дорисованный до полной недели. */
  outside: boolean;
  today: boolean;
  selected: boolean;
  count: number;
  weekend: boolean;
}

/**
 * Сетка месяца: недели с понедельника, дни соседних месяцев добивают первую
 * и последнюю недели. Всегда 6 строк — календарь не прыгает по высоте,
 * когда листаешь месяцы.
 */
export function monthGrid(month: string, opts: { today?: string; selected?: string | null; counts?: Record<string, number> | readonly MyNoteDay[] } = {}): CalendarCell[][] {
  const first = new Date(`${month}-01T00:00:00Z`);
  const shift = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - shift * 86_400_000);
  const counts: Record<string, number> = Array.isArray(opts.counts) ? Object.fromEntries((opts.counts as readonly MyNoteDay[]).map((d) => [d.date, d.count])) : ((opts.counts as Record<string, number>) ?? {});
  const weeks: CalendarCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86_400_000).toISOString().slice(0, 10);
      row.push({
        date,
        day: Number(date.slice(8)),
        outside: date.slice(0, 7) !== month,
        today: date === opts.today,
        selected: date === opts.selected,
        count: counts[date] ?? 0,
        weekend: d >= 5,
      });
    }
    weeks.push(row);
  }
  return weeks;
}

/** Подпись дня над списком: «Сегодня», «Вчера», «Завтра» или «12 октября». */
export function noteDayLabel(date: string, today: string): string {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'Сегодня';
  if (diff === -1) return 'Вчера';
  if (diff === 1) return 'Завтра';
  const [y, m, d] = date.split('-').map(Number);
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${d} ${MONTHS[m! - 1]}${String(y) === today.slice(0, 4) ? '' : ` ${y}`}`;
}

/** Имя PDF-файла из заголовка: без символов, которые не любят файловые системы. */
export function notePdfName(title: string): string {
  const base = noteTitle(title).replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || 'Заметка'}.pdf`;
}
