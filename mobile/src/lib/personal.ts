import { parseOffixLink, plural, type AccountProfile, type MyNoteSummary, type Notification } from '@offix/core';
import type { HeroStat } from './fx';

/**
 * Личное пространство на телефоне: мои заметки, профиль, QR. Чистая логика —
 * без React Native, чтобы проверять тестами.
 */

export type MyNotesView = 'all' | 'favorite';

/** Параметры списка — те же, что у сайта: день или месяц, избранное, поиск. */
export function myNotesQuery(f: { date?: string | null; month?: string | null; favorite?: boolean; q?: string }): string {
  const qs = new URLSearchParams();
  if (f.date) qs.set('date', f.date);
  else if (f.month) qs.set('month', f.month);
  if (f.favorite) qs.set('favorite', '1');
  if (f.q?.trim()) qs.set('q', f.q.trim());
  return qs.toString();
}

export function myNotesStats(all: Pick<MyNoteSummary, 'note_date' | 'is_favorite'>[], today: string): HeroStat[] {
  return [
    { label: plural(all.length, ['заметка', 'заметки', 'заметок']), value: all.length },
    { label: 'на сегодня', value: all.filter((n) => n.note_date === today).length },
    { label: 'в избранном', value: all.filter((n) => n.is_favorite).length },
  ];
}

/** Пустой список: при поиске, в избранном, в выбранный день и совсем без заметок. */
export function myNotesEmpty(p: { q?: string; view: MyNotesView; date?: string | null }): { title: string; text: string } {
  if (p.q?.trim()) return { title: 'Ничего не нашлось', text: 'Проверьте написание или поищите другое слово.' };
  if (p.view === 'favorite') return { title: 'В избранном пусто', text: 'Отмечайте звёздочкой то, к чему возвращаетесь чаще всего.' };
  if (p.date) return { title: 'В этот день заметок нет', text: 'Запишите планы, мысли со встречи или черновик письма.' };
  return { title: 'Заметок пока нет', text: 'Планы на день, мысли со встречи, черновик письма — всё, что не для общей базы знаний.' };
}

export type ScanResult = { kind: 'route'; path: string } | { kind: 'url'; url: string } | { kind: 'unknown'; text: string };

/**
 * Что делать с отсканированным кодом: вход на сайте — экран подтверждения,
 * профиль коллеги — его карточка, чужая ссылка — спросить, открывать ли.
 */
export function scanTarget(raw: string): ScanResult {
  const link = parseOffixLink(raw);
  if (link.kind === 'qr_login') return { kind: 'route', path: `/qr/${link.token}` };
  if (link.kind === 'profile') return { kind: 'route', path: `/person/${link.id}` };
  if (link.kind === 'url') return { kind: 'url', url: link.url };
  return { kind: 'unknown', text: link.text };
}

export type InboxTarget = { kind: 'route'; path: string } | { kind: 'request'; id: string } | { kind: 'share'; id: string } | null;

/** Куда ведёт уведомление: запрос заметки, её свежая копия, задача или цель. */
export function inboxTarget(n: Pick<Notification, 'kind' | 'task_id' | 'goal_id' | 'data'>): InboxTarget {
  const d = n.data ?? {};
  if (n.kind === 'note_request' && d.request_id) return { kind: 'request', id: d.request_id };
  if (n.kind === 'note_request_approved' && d.note_id) return { kind: 'route', path: `/my-notes/${d.note_id}` };
  if (n.kind === 'note_request_declined' && d.share_id) return { kind: 'share', id: d.share_id };
  if (n.task_id) return { kind: 'route', path: `/task/${n.task_id}` };
  if (n.goal_id) return { kind: 'route', path: `/goal/${n.goal_id}` };
  return null;
}

/** Строка итога под отвеченным запросом заметки. */
export function requestOutcome(status: Notification['request_status']): string | null {
  if (status === 'approved') return 'Вы поделились';
  if (status === 'declined') return 'Вы отказали';
  return null;
}

/** «Последний вход — …» в профиле: по-русски и без секунд. */
export function lastLoginText(p: Pick<AccountProfile, 'last_login_at'>, now = new Date()): string {
  if (!p.last_login_at) return 'Последний вход — ещё не было';
  const d = new Date(p.last_login_at);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `Последний вход — ${sameDay ? `сегодня в ${time}` : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${time}`}`;
}

/** Адрес сайта по адресу API: ссылки в QR открываются и в браузере, и в приложении. */
export function siteOrigin(server: string): string {
  return server.trim().replace(/\/+$/, '').replace(/\/api\/v\d+$/, '');
}

/** Цвет полоски надёжности пароля — от тревожного к спокойному. */
export const STRENGTH_COLORS = ['#e0464c', '#d97a00', '#3b5bff', '#12a36a'] as const;
