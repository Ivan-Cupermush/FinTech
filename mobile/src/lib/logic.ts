import type { HeroStat } from './fx';
import { PUSH_TOPICS, canTransitionKind, lightOf, diffDays, duePresets, formatDate, formatNumber, isOverdue, plural, templateDueDate, UNITS, type Dashboard, type DiscussionSummary, type EffectTarget, type GoalTemplate, type Notification, type Task } from '@offix/core';

/** Короткая подпись срока для строк списка: «через 3 дня», «просрочено на 2 дня». */
export function dueText(due: string | null, today: string): { text: string; overdue: boolean } {
  if (!due) return { text: 'Без срока', overdue: false };
  const left = diffDays(today, due);
  if (left < 0) return { text: `просрочено на ${-left} ${plural(-left, ['день', 'дня', 'дней'])}`, overdue: true };
  if (left === 0) return { text: 'сегодня', overdue: false };
  if (left === 1) return { text: 'завтра', overdue: false };
  return { text: `до ${formatDate(due, { short: true, today })} · через ${left} ${plural(left, ['день', 'дня', 'дней'])}`, overdue: false };
}

/**
 * Действия над задачей, доступные исполнителю в текущем статусе — по одному главному.
 * У просьбы нет приёмки: из работы — сразу «Выполнено».
 */
export function taskActions(t: Pick<Task, 'status'> & { kind?: Task['kind'] }): { status: Task['status']; label: string; primary: boolean }[] {
  const kind = t.kind ?? 'task';
  const all = ((): { status: Task['status']; label: string; primary: boolean }[] => {
    switch (t.status) {
      case 'todo':
        return [
          { status: 'in_progress', label: 'Взять в работу', primary: true },
          { status: 'blocked', label: 'Есть блокер', primary: false },
        ];
      case 'in_progress':
        return kind === 'request'
          ? [
              { status: 'done', label: 'Выполнено', primary: true },
              { status: 'blocked', label: 'Есть блокер', primary: false },
            ]
          : [
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
  })();
  return all.filter((a) => canTransitionKind(kind, t.status, a.status));
}

/** Вкладки задач: те же запросы, что на сайте. Архив — отдельно, в остальных его нет. */
export const TASK_SCOPES = [
  { value: 'mine', label: 'Мои', filter: 'mine=1' },
  { value: 'all', label: 'Все', filter: '' },
  { value: 'requests', label: 'Мои просьбы', filter: 'created=1&kind=request' },
  { value: 'watching', label: 'Наблюдаю', filter: 'watching=1' },
  { value: 'archive', label: 'Архив', filter: 'archived=1' },
] as const;
export type TaskScope = (typeof TASK_SCOPES)[number]['value'];

export const TASK_SCOPE_EMPTY: Record<TaskScope, { title: string; text: string }> = {
  mine: { title: 'Задач нет', text: 'Задачи появляются из дорожных карт целей, а просьбы — от коллег.' },
  all: { title: 'Задач нет', text: 'Задачи появляются из дорожных карт целей.' },
  requests: { title: 'Вы ещё ни о чём не просили', text: 'Нужна помощь коллеги из другого отдела? Отправьте просьбу — он отметит «Выполнено», а вы поблагодарите.' },
  watching: { title: 'Вы ни за чем не наблюдаете', text: 'Наблюдателя добавляет автор задачи: вы видите ход работы и отмечаете контрольные точки.' },
  archive: { title: 'Архив пуст', text: 'Выполненные и отменённые задачи уходят сюда сами через три дня.' },
};

const LIGHT_RANK = { red: 0, yellow: 1, green: 2 } as const;

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
  // Внутри секции — по светофору: красные, потом жёлтые, дальше по сроку.
  const rank = (t: Task) => {
    const l = lightOf(t, today);
    return l ? LIGHT_RANK[l.light] : 3;
  };
  const order = (a: Task, b: Task) => rank(a) - rank(b) || (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999');
  return sections.filter((s) => s.data.length).map((s) => ({ ...s, data: [...s.data].sort(order) }));
}

/** «Доброе утро» — по локальному времени устройства. */
export function greeting(hour: number): string {
  return hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
}

const attention = (n: number, tone: HeroStat['tone']): HeroStat['tone'] => (n > 0 ? tone : undefined);

/** Три цифры в шапке Пульса: что горит, кому помочь и сколько своих задач. */
export function pulseStats(d: Pick<Dashboard, 'risks' | 'help_needed' | 'my_tasks'>): HeroStat[] {
  const critical = d.risks.filter((r) => r.severity === 'critical').length;
  return [
    { label: 'под угрозой', value: critical, tone: attention(critical, 'bad') },
    { label: 'ждут помощи', value: d.help_needed.length },
    { label: 'мои задачи', value: d.my_tasks.length },
  ];
}

/** Маршрут приложения для шага «Что поднимет цифры». */
export function effectRoute(t: EffectTarget): string {
  if (t.kind === 'goal') return `/goal/${t.id}`;
  if (t.kind === 'blocked_tasks') return '/tasks';
  return '/goals';
}

/**
 * Линии мини-графика в координатах w×h. Пропуски (null) рвут линию:
 * «нечего считать» и «ноль» — разные вещи.
 */
export function sparkSegments(values: readonly (number | null)[], w: number, h: number, max?: number, min = 0, pad = 0): { x: number; y: number }[][] {
  const known = values.filter((v): v is number => v !== null);
  const hi = max ?? Math.max(1, ...known);
  const span = hi - min || 1;
  const x = (i: number) => (values.length < 2 ? w / 2 : pad + (i / (values.length - 1)) * (w - 2 * pad));
  const y = (v: number) => h - 3 - ((Math.min(hi, Math.max(min, v)) - min) / span) * (h - 6);
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push({ x: x(i), y: y(v) });
  });
  if (cur.length) out.push(cur);
  return out;
}

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/**
 * Карточка «Уведомления на телефон» во «Входящих». Разрешение спрашиваем
 * только по нажатию, с объяснением зачем, а не всплывающим окном при запуске.
 */
export function pushCard(perm: PushPermission): { title: string; text: string; action: 'enable' | 'settings' | 'configure' | null; label?: string } {
  switch (perm) {
    case 'granted':
      return { title: 'Уведомления включены', text: 'Блокеры приходят сразу, остальное — с 8:00 до 22:00.', action: 'configure', label: 'Настроить' };
    case 'denied':
      return { title: 'Уведомления выключены', text: 'Разрешите их в настройках телефона, чтобы узнавать о блокерах сразу.', action: 'settings', label: 'Открыть настройки' };
    case 'undetermined':
      return { title: 'Узнавайте о блокерах сразу', text: 'Push придёт, когда задача в вашей зоне заблокирована или вам поставили задачу.', action: 'enable', label: 'Включить' };
    default:
      return { title: 'Push работают в приложении на телефоне', text: 'Здесь уведомления видны во «Входящих».', action: null };
  }
}

/** «40 → 30 мин» — KPI шаблона в строке списка. */
export function templateKpiText(t: Pick<GoalTemplate, 'kpi'>): string {
  const u = UNITS[t.kpi.unit];
  return `${formatNumber(t.kpi.baseline, u.decimals)} → ${formatNumber(t.kpi.target, u.decimals)} ${u.short}`;
}

/** Сроки для цели из шаблона: сначала «по плану шаблона», затем обычные, без повторов дат. */
export function templateDueChoices(t: Pick<GoalTemplate, 'plan_days'>, today: string): { label: string; value: string }[] {
  const all = [{ label: 'По плану', value: templateDueDate(t, today) }, ...duePresets(today)];
  return all.filter((d, i) => all.findIndex((x) => x.value === d.value) === i);
}

/** Подпись строки «Обсуждение» на экране цели и задачи. */
export function discussionLine(s: DiscussionSummary | undefined): { text: string; unread: number } {
  if (!s || !s.total) return { text: 'Пока нет комментариев — задайте вопрос здесь, а не в мессенджере', unread: 0 };
  const total = `${s.total} ${plural(s.total, ['комментарий', 'комментария', 'комментариев'])}`;
  return { text: s.unread ? `${total} · ${s.unread} ${plural(s.unread, ['новый', 'новых', 'новых'])}` : total, unread: s.unread };
}

/** Шапка «Входящих»: сколько непрочитанного и сколько из этого — блокеры. */
export function inboxStats(items: Pick<Notification, 'kind' | 'read_at'>[]): HeroStat[] {
  const unread = items.filter((n) => !n.read_at);
  const blockers = unread.filter((n) => n.kind === 'task_blocked').length;
  return [
    { label: 'новые', value: unread.length },
    { label: 'блокеры', value: blockers, tone: attention(blockers, 'bad') },
    { label: 'обсуждения', value: unread.filter((n) => n.kind === 'comment').length },
  ];
}

/** Шапка задач: что в работе, что заблокировано и что просрочено. */
export function tasksStats(tasks: Pick<Task, 'id' | 'status' | 'due_at'>[], today: string): HeroStat[] {
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const blocked = open.filter((t) => t.status === 'blocked').length;
  const overdue = open.filter((t) => t.status !== 'blocked' && isOverdue(t, today)).length;
  return [
    { label: 'в работе', value: open.filter((t) => t.status === 'in_progress').length },
    { label: 'с блокером', value: blocked, tone: attention(blocked, 'bad') },
    { label: 'просрочены', value: overdue, tone: attention(overdue, 'warn') },
  ];
}

/** Шапка обсуждения: сколько сказано, сколько людей в разговоре и сколько нового для меня. */
export function discussionStats(comments: { author_id: string }[], unread: number): HeroStat[] {
  return [
    { label: 'реплик', value: comments.length },
    { label: 'участников', value: new Set(comments.map((c) => c.author_id)).size },
    { label: 'новых', value: unread },
  ];
}

/** Подпись в шапке настроек push: сколько тем включено и молчит ли телефон ночью. */
export function pushSummary(s: { muted: readonly string[]; quiet_hours: boolean }, devices: number): string {
  if (!devices) return 'Телефон ещё не привязан — включите уведомления во «Входящих».';
  const on = PUSH_TOPICS.filter((t) => !s.muted.includes(t)).length;
  const topics = on === PUSH_TOPICS.length ? 'Все темы включены' : on ? `Включено ${on} из ${PUSH_TOPICS.length} тем` : 'Все темы выключены';
  return `${topics}${s.quiet_hours ? ' · ночью тихо' : ''}.`;
}
