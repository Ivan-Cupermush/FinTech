/**
 * Push-уведомления на телефон. Push — это короткая копия уведомления из
 * «Входящих»: само уведомление сохраняется всегда, а push можно приглушить
 * по темам и на ночь. Логика общая: сервер решает, слать ли push, приложение
 * показывает те же настройки и ведёт по нажатию на тот же экран.
 */

export const NOTIFICATION_KINDS = ['goal_assigned', 'task_assigned', 'task_blocked', 'task_unblocked', 'reschedule', 'kpi_achieved', 'comment', 'goal_activated'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Темы push в настройках: человеку проще выбрать четыре темы, чем восемь типов. */
export const PUSH_TOPICS = ['tasks', 'blockers', 'goals', 'comments'] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

export const PUSH_TOPIC_LABELS: Record<PushTopic, { title: string; hint: string }> = {
  tasks: { title: 'Мои задачи', hint: 'Новая задача, перенос срока' },
  blockers: { title: 'Блокеры', hint: 'Задача в вашей зоне заблокирована или снова в работе' },
  goals: { title: 'Цели', hint: 'Вас назначили владельцем, цель запущена, KPI достиг цели' },
  comments: { title: 'Обсуждения', hint: 'Ответы и упоминания' },
};

export const KIND_TOPIC: Record<NotificationKind, PushTopic> = {
  task_assigned: 'tasks',
  reschedule: 'tasks',
  task_blocked: 'blockers',
  task_unblocked: 'blockers',
  goal_assigned: 'goals',
  goal_activated: 'goals',
  kpi_achieved: 'goals',
  comment: 'comments',
};

export interface PushSettings {
  /** Темы, по которым push не нужен. По умолчанию приходят все. */
  muted: PushTopic[];
  /** Тихие часы 22:00–08:00 по Москве: push не будит, уведомление ждёт во «Входящих». */
  quiet_hours: boolean;
}

export const DEFAULT_PUSH_SETTINGS: PushSettings = { muted: [], quiet_hours: true };

export const QUIET_FROM_HOUR = 22;
export const QUIET_TO_HOUR = 8;
const MOSCOW_OFFSET_HOURS = 3;

/** Час по Москве (UTC+3, без перехода на летнее время). */
export function moscowHour(at: string): number {
  return (new Date(at).getUTCHours() + MOSCOW_OFFSET_HOURS) % 24;
}

export function isQuietHour(at: string): boolean {
  const h = moscowHour(at);
  return h >= QUIET_FROM_HOUR || h < QUIET_TO_HOUR;
}

/** Блокер на критическом пути не ждёт утра: это то, ради чего push и нужен. */
const URGENT: ReadonlySet<NotificationKind> = new Set(['task_blocked']);

export type PushDecision = { send: true } | { send: false; reason: 'muted' | 'quiet_hours' | 'unknown_kind' };

/** Слать ли push по уведомлению. Уведомление во «Входящих» остаётся в любом случае. */
export function shouldPush(kind: string, settings: PushSettings, at: string): PushDecision {
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) return { send: false, reason: 'unknown_kind' };
  const k = kind as NotificationKind;
  if (settings.muted.includes(KIND_TOPIC[k])) return { send: false, reason: 'muted' };
  if (settings.quiet_hours && isQuietHour(at) && !URGENT.has(k)) return { send: false, reason: 'quiet_hours' };
  return { send: true };
}

export function parsePushSettings(v: unknown): PushSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof PushSettings, unknown>>;
  const muted = Array.isArray(o.muted) ? PUSH_TOPICS.filter((t) => (o.muted as unknown[]).includes(t)) : DEFAULT_PUSH_SETTINGS.muted;
  const quiet = typeof o.quiet_hours === 'boolean' ? o.quiet_hours : DEFAULT_PUSH_SETTINGS.quiet_hours;
  return { muted, quiet_hours: quiet };
}

/** Токен Expo: ExponentPushToken[…] или ExpoPushToken[…]. */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/;
export function isExpoPushToken(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 200 && EXPO_TOKEN.test(v);
}

export interface PushNotificationInput {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  goal_id: string | null;
  task_id: string | null;
}

export interface PushMessage {
  to: string;
  title: string;
  body?: string;
  sound: 'default';
  badge: number;
  /** Канал Android: блокеры громче остального. */
  channelId: 'default' | 'urgent';
  priority: 'default' | 'high';
  data: { notification_id: string; kind: string; goal_id: string | null; task_id: string | null };
}

const TITLE_MAX = 120;
const BODY_MAX = 240;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Сообщение для Expo Push API. Бейдж — сколько непрочитанных во «Входящих». */
export function pushMessage(token: string, n: PushNotificationInput, unread: number): PushMessage {
  const urgent = URGENT.has(n.kind as NotificationKind);
  return {
    to: token,
    title: cut(n.title, TITLE_MAX),
    ...(n.body ? { body: cut(n.body, BODY_MAX) } : {}),
    sound: 'default',
    badge: Math.max(0, unread),
    channelId: urgent ? 'urgent' : 'default',
    priority: urgent ? 'high' : 'default',
    data: { notification_id: n.id, kind: n.kind, goal_id: n.goal_id, task_id: n.task_id },
  };
}

/** Куда вести по нажатию на push: задача важнее цели, иначе — «Входящие». */
export function pushRoute(data: { task_id?: string | null; goal_id?: string | null } | null | undefined): string {
  if (data?.task_id) return `/task/${data.task_id}`;
  if (data?.goal_id) return `/goal/${data.goal_id}`;
  return '/inbox';
}
