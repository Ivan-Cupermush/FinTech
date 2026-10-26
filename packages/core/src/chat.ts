import { mediaLabel, summarizeAttachments, type Attachment, type ContactCard, type MediaSummary } from './media';

/**
 * Мессенджер: личные чаты, группы и группы с темами. Здесь — общая логика
 * сервера, сайта и приложения: права в чате, поиск по сообщениям, проверки
 * ввода, группировка ленты и подписи. Перенесено из mesNation по смыслу,
 * модель данных — offix (UUID, компания, порядковый номер сообщения).
 */

export const CHAT_TYPES = ['private', 'group'] as const;
export type ChatType = (typeof CHAT_TYPES)[number];

export const CHAT_PERMISSIONS = ['change_info', 'delete_messages', 'ban_users', 'add_users', 'pin_messages', 'add_admins'] as const;
export type ChatPermission = (typeof CHAT_PERMISSIONS)[number];

export const CHAT_PERMISSION_LABELS: Record<ChatPermission, string> = {
  change_info: 'Менять название и темы',
  delete_messages: 'Удалять чужие сообщения',
  ban_users: 'Исключать участников',
  add_users: 'Приглашать участников',
  pin_messages: 'Закреплять сообщения',
  add_admins: 'Назначать администраторов',
};

/**
 * Обычный участник — как в Telegram по умолчанию: приглашает людей и
 * закрепляет сообщения, а в обычной группе (без тем) ещё меняет название.
 */
const MEMBER_PERMISSIONS: readonly ChatPermission[] = ['add_users', 'pin_messages'];
const BASIC_GROUP_MEMBER_PERMISSIONS: readonly ChatPermission[] = [...MEMBER_PERMISSIONS, 'change_info'];

export interface ChatRightsInput {
  type: ChatType;
  isSupergroup: boolean;
  isMember: boolean;
  isCreator: boolean;
  /** Права администратора; null — не администратор. */
  adminPermissions: readonly string[] | null;
}

export interface ChatRights {
  isMember: boolean;
  isCreator: boolean;
  isAdmin: boolean;
  can: (perm: ChatPermission) => boolean;
  /** Включать темы и управлять ими — владелец и админы с правом на изменение группы. */
  canManageTopics: boolean;
}

/** Создатель может всё, администратор — выданное, участник — базовое, не участник — ничего. */
export function chatRights(i: ChatRightsInput): ChatRights {
  const isAdmin = Array.isArray(i.adminPermissions);
  const admin = (i.adminPermissions ?? []) as readonly string[];
  const can = (perm: ChatPermission): boolean => {
    if (!i.isMember) return false;
    // В личном чате прав «группы» нет, но закрепить сообщение может любой из двоих.
    if (i.type === 'private') return perm === 'pin_messages';
    if (i.isCreator) return true;
    if (isAdmin) return admin.includes(perm);
    return (i.isSupergroup ? MEMBER_PERMISSIONS : BASIC_GROUP_MEMBER_PERMISSIONS).includes(perm);
  };
  return {
    isMember: i.isMember,
    isCreator: i.isCreator,
    isAdmin,
    can,
    canManageTopics: i.isMember && i.type === 'group' && (i.isCreator || (isAdmin && admin.includes('change_info'))),
  };
}

export function rightsList(r: ChatRights): ChatPermission[] {
  return CHAT_PERMISSIONS.filter((p) => r.can(p));
}

export function parsePermissions(v: unknown): ChatPermission[] {
  return Array.isArray(v) ? CHAT_PERMISSIONS.filter((p) => v.includes(p)) : [];
}

// ---------------------------------------------------------------- поиск

/**
 * Поиск как в Telegram: запрос делится на слова, каждое ищется как часть
 * слова в любом порядке, без учёта регистра, «ё» = «е»; слово, набранное не
 * в той раскладке («ghbdtn»), тоже находит «привет».
 */
const EN_LAYOUT = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU_LAYOUT = 'йцукенгшщзхъфывапролджэячсмитьбюё';

export const normText = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/ё/g, 'е');

export function switchLayout(s: string): string {
  return [...s]
    .map((ch) => {
      const en = EN_LAYOUT.indexOf(ch);
      if (en >= 0) return RU_LAYOUT[en]!;
      const ru = RU_LAYOUT.indexOf(ch);
      return ru >= 0 ? EN_LAYOUT[ru]! : ch;
    })
    .join('')
    .replace(/ё/g, 'е');
}

/** Слова запроса и их варианты: как набрано и в другой раскладке. Не больше восьми слов. */
export function searchTokens(q: string): string[][] {
  const words = normText(q)
    .split(/[\s,.;:!?()«»"“”„]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 8);
  return words.map((w) => {
    const alts = new Set([w]);
    const switched = switchLayout(w);
    // Раскладку меняем, только если слово целиком набрано в одной раскладке.
    if (switched !== w && (/^[a-z[\];',.`]+$/.test(w) || /^[а-яе]+$/.test(w))) alts.add(switched);
    return [...alts];
  });
}

/** Подходит ли текст под запрос: каждое слово (или его вариант) есть хотя бы в одном поле. */
export function matchesQuery(fields: (string | null | undefined)[], q: string): boolean {
  const tokens = searchTokens(q);
  if (!tokens.length) return true;
  const hay = fields.map(normText);
  return tokens.every((alts) => alts.some((a) => hay.some((h) => h.includes(a))));
}

/** Где подсветить совпадение: отрезки [начало, конец) первого подходящего слова. */
export function highlightRanges(text: string, q: string): [number, number][] {
  const hay = normText(text);
  const out: [number, number][] = [];
  for (const alts of searchTokens(q)) {
    for (const a of alts) {
      let i = hay.indexOf(a);
      while (i >= 0 && a) {
        out.push([i, i + a.length]);
        i = hay.indexOf(a, i + a.length);
      }
    }
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

// ---------------------------------------------------------------- ввод

export const MESSAGE_MAX = 4000;
export const CHAT_NAME_MAX = 80;
export const CHAT_PINS_MAX = 10;
export const GROUP_MEMBERS_MAX = 500;
export const TOPIC_NAME_MAX = 60;
export const EDIT_WINDOW_HOURS = 48;
export const BULK_DELETE_MAX = 100;
export const FORWARD_MAX = 50;

/** Реакции — фиксированный набор, одна на человека. */
export const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🙏', '👎', '🎉', '👏', '💯', '🤝'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const isReaction = (v: unknown): v is Reaction => (REACTIONS as readonly unknown[]).includes(v);

/** Цвета тем в группе: из палитры offix, а не произвольные. */
export const TOPIC_COLORS = ['#2f4bff', '#8a72ff', '#2fc6d8', '#3fd6a0', '#ffb547', '#ff7ac0', '#ee8466'] as const;
export const TOPIC_ICONS = ['💬', '📌', '📊', '🎓', '🛠️', '📅', '💡', '📣', '✅', '📁'] as const;

export function validateMessageText(text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return 'Напишите сообщение';
  if (text.length > MESSAGE_MAX) return `Не длиннее ${MESSAGE_MAX} символов`;
  return null;
}

export function validateChatName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'Назовите группу';
  if (name.trim().length > CHAT_NAME_MAX) return `Не длиннее ${CHAT_NAME_MAX} символов`;
  return null;
}

/** Можно ли ещё поправить сообщение (текст или подпись к медиа): своё, не удалённое, не служебное, в пределах 48 часов. */
export function canEditMessage(m: { sender_id: string | null; kind: string; deleted: boolean; created_at: string }, userId: string, now: string): boolean {
  if ((m.kind !== 'text' && m.kind !== 'media') || m.deleted || m.sender_id !== userId) return false;
  return Date.parse(now) - Date.parse(m.created_at) <= EDIT_WINDOW_HOURS * 3_600_000;
}

/** Отложенное сообщение: не раньше чем через минуту и не позже чем через год. */
export function validateScheduleAt(at: unknown, now: string): string | null {
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return 'Укажите дату и время';
  const d = Date.parse(at) - Date.parse(now);
  if (d < 60_000) return 'Время отправки — хотя бы через минуту';
  if (d > 366 * 86_400_000) return 'Не дальше чем через год';
  return null;
}

export interface PollDraft {
  question: string;
  options: string[];
  anonymous: boolean;
  multiple: boolean;
  quiz: boolean;
  correct_option?: number | null;
  explanation?: string | null;
}

export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 10;

export function validatePoll(p: PollDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!p.question?.trim()) e.question = 'Задайте вопрос';
  else if (p.question.trim().length > 255) e.question = 'Не длиннее 255 символов';
  const opts = (p.options ?? []).map((o) => o.trim()).filter(Boolean);
  if (opts.length < POLL_OPTIONS_MIN) e.options = 'Нужно хотя бы два варианта';
  else if (opts.length > POLL_OPTIONS_MAX) e.options = `Не больше ${POLL_OPTIONS_MAX} вариантов`;
  else if (new Set(opts.map(normText)).size !== opts.length) e.options = 'Варианты повторяются';
  else if (opts.some((o) => o.length > 100)) e.options = 'Вариант — не длиннее 100 символов';
  if (p.quiz) {
    if (p.multiple) e.multiple = 'В викторине один правильный ответ';
    if (p.correct_option == null || p.correct_option < 0 || p.correct_option >= opts.length) e.correct_option = 'Отметьте правильный ответ';
  }
  if (p.explanation && p.explanation.length > 200) e.explanation = 'Не длиннее 200 символов';
  return e;
}

// ---------------------------------------------------------------- данные API

export interface ChatPerson {
  id: string;
  display_name: string;
  position: string | null;
}

export interface ChatMessageRef {
  id: string;
  sender_name: string | null;
  text: string | null;
  kind: MessageKind;
  deleted: boolean;
  /** Вложения или контакт — для подписи «📷 Фото», «🎤 Голосовое сообщение». */
  media?: MediaSummary | null;
}

/** media — фото, видео и файлы (альбом до 10); voice и video_note — одно вложение; contact — карточка сотрудника. */
export const MESSAGE_KINDS = ['text', 'service', 'poll', 'media', 'voice', 'video_note', 'contact'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export interface ChatPollOption {
  id: string;
  text: string;
  votes: number;
  voted: boolean;
  /** В викторине после ответа или закрытия. */
  correct?: boolean;
}

export interface ChatPoll {
  id: string;
  question: string;
  anonymous: boolean;
  multiple: boolean;
  quiz: boolean;
  closed: boolean;
  explanation: string | null;
  total_voters: number;
  voted: boolean;
  options: ChatPollOption[];
}

export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
  /** Первые несколько, кто поставил — для подсказки. */
  people: string[];
  /** Кто поставил — чтобы после события в реальном времени знать, моя ли реакция. */
  user_ids: string[];
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  seq: number;
  topic_id: string | null;
  kind: MessageKind;
  sender_id: string | null;
  sender_name: string | null;
  text: string | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  pinned: boolean;
  client_id: string | null;
  reply_to: ChatMessageRef | null;
  /** Ответ на сообщение из другого чата. */
  external_reply: (ChatMessageRef & { chat_id: string; chat_title: string }) | null;
  forwarded_from: { sender_name: string | null; chat_title: string | null } | null;
  reactions: ChatReaction[];
  poll: ChatPoll | null;
  /** Своё сообщение прочитано собеседником (в группе — хотя бы одним). */
  read: boolean;
  /** Фото, видео, файлы, голосовое или кружочек — в порядке отправки. */
  attachments: Attachment[];
  contact: ContactCard | null;
  /** Голосовое и кружочек: для получателя — я прослушал, для автора — прослушал кто-то другой. */
  listened: boolean;
}

export interface ChatTopic {
  id: string;
  name: string;
  icon: string;
  color: string;
  closed: boolean;
  /** Общая тема: появляется при включении тем, удалить нельзя. */
  is_general: boolean;
  last_message: (ChatMessageRef & { created_at: string; sender_id: string | null }) | null;
  unread: number;
  messages: number;
  /** До какого номера я прочитал эту тему. */
  last_read_seq: number;
}

export interface ChatSummary {
  id: string;
  type: ChatType;
  is_supergroup: boolean;
  title: string;
  /** Собеседник в личном чате. */
  peer: (ChatPerson & { online: boolean; last_seen_at: string | null }) | null;
  members_count: number;
  last_message: (ChatMessageRef & { created_at: string; sender_id: string | null }) | null;
  unread: number;
  pinned: boolean;
  muted: boolean;
  muted_until: string | null;
  created_at: string;
  /** Для сортировки: время последнего сообщения или создания. */
  activity_at: string;
}

export interface ChatMember extends ChatPerson {
  role: 'creator' | 'admin' | 'member';
  permissions: ChatPermission[];
  online: boolean;
  last_seen_at: string | null;
}

export interface ChatDetail extends ChatSummary {
  created_by: string | null;
  members: ChatMember[];
  my_rights: ChatPermission[];
  can_manage_topics: boolean;
  topics: ChatTopic[];
  /** Последний прочитанный мной номер — для разделителя «Новые». */
  my_last_read_seq: number;
  /** Номер, до которого прочитали остальные — для галочек. */
  others_read_seq: number;
}

/** История чата: страница сообщений и отметки прочтения. */
export interface ChatHistory {
  messages: ChatMessage[];
  has_before: boolean;
  has_after: boolean;
  my_last_read_seq: number;
  others_read_seq: number;
}

export interface ChatSearchHit extends ChatMessage {
  chat_title: string;
  chat_type: ChatType;
  topic_name: string | null;
}

export interface PollVoters {
  option_id: string;
  people: ChatPerson[];
}

export interface ScheduledMessage {
  id: string;
  chat_id: string;
  topic_id: string | null;
  text: string;
  send_at: string;
  created_at: string;
}

// ---------------------------------------------------------------- подписи и лента

/** Название чата: у группы — имя, у личного — собеседник, со мной самим — «Избранное». */
export function chatTitle(c: { type: ChatType; name: string | null }, peerName: string | null): string {
  if (c.type === 'group') return c.name?.trim() || 'Группа';
  return peerName ?? 'Избранное';
}

/** Сводка вложений полного сообщения: контакт или файлы. Ссылке на сообщение её присылает сервер. */
export function mediaOf(m: { media?: MediaSummary | null; attachments?: readonly { kind: Attachment['kind']; name: string }[]; contact?: { display_name: string } | null }): MediaSummary | null {
  if (m.media !== undefined) return m.media;
  if (m.contact) return { kind: 'contact', count: 1, name: m.contact.display_name };
  return summarizeAttachments([...(m.attachments ?? [])]);
}

type PreviewSource = {
  kind: MessageKind;
  text: string | null;
  deleted: boolean;
  sender_id?: string | null;
  sender_name: string | null;
  media?: MediaSummary | null;
  attachments?: readonly { kind: Attachment['kind']; name: string }[];
  contact?: { display_name: string } | null;
};

/** Текст без отправителя: «📷 Смета», «🎤 Голосовое сообщение», «📊 Вопрос» — для цитаты, закрепа и ответа. */
export function messageBody(m: PreviewSource): string {
  if (m.deleted) return 'Сообщение удалено';
  const text = (m.text ?? '').replace(/\s+/g, ' ').trim();
  const media = mediaOf(m);
  if (media) {
    const label = mediaLabel(media);
    // С подписью — значок и подпись: «📷 Смета на ноябрь».
    return text && (media.kind === 'photo' || media.kind === 'video' || media.kind === 'file') && media.count === 1 ? `${label.split(' ')[0]} ${text}` : text ? `${label}, ${text}` : label;
  }
  return m.kind === 'poll' ? `📊 ${m.text ?? 'Опрос'}` : text;
}

/** Строка в списке чатов: «Вы: …», «Анна: …» в группе, служебное — как есть. */
export function messagePreview(m: PreviewSource | null, meId: string, isGroup: boolean): string {
  if (!m) return 'Нет сообщений';
  if (m.deleted) return 'Сообщение удалено';
  const body = messageBody(m);
  if (m.kind === 'service') return body;
  if (m.sender_id === meId) return `Вы: ${body}`;
  return isGroup && m.sender_name ? `${m.sender_name.split(' ')[0]}: ${body}` : body;
}

/** «в сети», «был(а) 5 минут назад», «был(а) вчера в 18:20», «был(а) 12 окт». */
export function lastSeenText(online: boolean, lastSeen: string | null, now: string): string {
  if (online) return 'в сети';
  if (!lastSeen) return 'не заходил(а)';
  const diff = Date.parse(now) - Date.parse(lastSeen);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'был(а) только что';
  if (min < 60) return `был(а) ${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.floor(min / 60);
  if (h < 24 && sameMoscowDay(lastSeen, now)) return `был(а) в ${moscowTime(lastSeen)}`;
  if (sameMoscowDay(lastSeen, new Date(Date.parse(now) - 86_400_000).toISOString())) return `был(а) вчера в ${moscowTime(lastSeen)}`;
  return `был(а) ${moscowDateShort(lastSeen)}`;
}

/** Кто печатает: «печатает» в личном, «Анна печатает», «Анна и Игорь печатают», «3 человека печатают». */
export function typingText(names: string[], group: boolean): string {
  if (!names.length) return '';
  if (!group) return 'печатает';
  const first = names.map((n) => n.split(' ')[0]!);
  if (first.length === 1) return `${first[0]} печатает`;
  if (first.length === 2) return `${first[0]} и ${first[1]} печатают`;
  return `${first.length} ${plural(first.length, 'человек', 'человека', 'человек')} печатают`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const MSK = 3 * 3_600_000;
const mskDate = (iso: string) => new Date(Date.parse(iso) + MSK);
export const moscowDay = (iso: string) => mskDate(iso).toISOString().slice(0, 10);
const sameMoscowDay = (a: string, b: string) => moscowDay(a) === moscowDay(b);
export function moscowTime(iso: string): string {
  const d = mskDate(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function moscowDateShort(iso: string): string {
  const d = mskDate(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Время в списке чатов: сегодня — часы, на этой неделе — день, раньше — дата. */
export function chatListTime(iso: string, now: string): string {
  if (sameMoscowDay(iso, now)) return moscowTime(iso);
  const days = (Date.parse(moscowDay(now)) - Date.parse(moscowDay(iso))) / 86_400_000;
  if (days < 7) return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][mskDate(iso).getUTCDay()]!;
  return moscowDateShort(iso);
}

/** Подпись дня в ленте: «Сегодня», «Вчера», «12 октября», другой год — с годом. */
export function dayLabel(day: string, now: string): string {
  const today = moscowDay(now);
  if (day === today) return 'Сегодня';
  if (day === moscowDay(new Date(Date.parse(now) - 86_400_000).toISOString())) return 'Вчера';
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_FULL[m! - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`;
}

export type FeedItem<M> = { type: 'day'; key: string; label: string } | { type: 'new'; key: string } | { type: 'message'; key: string; message: M; first: boolean; last: boolean };

/**
 * Лента чата: разделители дней, отметка «Новые» после последнего прочитанного
 * и склейка подряд идущих сообщений одного человека (в пределах 5 минут) —
 * имя и хвостик пузыря показываются только на краях группы.
 */
export function buildFeed<M extends { id: string; seq: number; sender_id: string | null; kind: MessageKind; created_at: string }>(messages: M[], opts: { now: string; lastReadSeq?: number | null; meId?: string }): FeedItem<M>[] {
  const items: FeedItem<M>[] = [];
  const sorted = [...messages].sort((a, b) => a.seq - b.seq);
  let day = '';
  let newShown = false;
  const joinable = (a: M | undefined, b: M | undefined) =>
    !!a && !!b && a.kind !== 'service' && b.kind !== 'service' && a.sender_id === b.sender_id && moscowDay(a.created_at) === moscowDay(b.created_at) && Date.parse(b.created_at) - Date.parse(a.created_at) < 5 * 60_000;
  sorted.forEach((m, i) => {
    const d = moscowDay(m.created_at);
    if (d !== day) {
      day = d;
      items.push({ type: 'day', key: `day-${d}`, label: dayLabel(d, opts.now) });
    }
    if (!newShown && opts.lastReadSeq != null && m.seq > opts.lastReadSeq && m.sender_id !== opts.meId && m.kind !== 'service') {
      newShown = true;
      items.push({ type: 'new', key: 'new' });
    }
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    items.push({ type: 'message', key: m.id, message: m, first: !joinable(prev, m) || items[items.length - 1]?.type !== 'message', last: !joinable(m, next) });
  });
  return items;
}

/** Слияние ленты: новое сообщение заменяет своё по id или по client_id (отправка с этого устройства). */
export function mergeMessages<M extends { id: string; seq: number; client_id?: string | null }>(list: M[], incoming: M[]): M[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) {
    if (m.client_id) {
      for (const [k, v] of byId) if (v.client_id === m.client_id && k !== m.id && k.startsWith('local-')) byId.delete(k);
    }
    byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Порядок списка чатов: закреплённые (по времени закрепа), затем по активности. */
export function sortChats<C extends { pinned: boolean; activity_at: string; pinned_at?: string | null }>(chats: C[]): C[] {
  return [...chats].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return Date.parse(b.activity_at) - Date.parse(a.activity_at);
  });
}

/** Пресеты «без звука». */
export const MUTE_PRESETS = [
  { key: '1h', label: 'На час', hours: 1 },
  { key: '8h', label: 'На 8 часов', hours: 8 },
  { key: '1d', label: 'На сутки', hours: 24 },
  { key: '7d', label: 'На неделю', hours: 24 * 7 },
  { key: 'forever', label: 'Навсегда', hours: null },
] as const;

/** «Навсегда» — далёкая дата: проще сравнивать, чем хранить отдельный флаг. */
export function muteUntil(hours: number | null, now: string): string {
  return hours === null ? '2100-01-01T00:00:00.000Z' : new Date(Date.parse(now) + hours * 3_600_000).toISOString();
}

export const isMuted = (mutedUntil: string | null | undefined, now: string) => !!mutedUntil && Date.parse(mutedUntil) > Date.parse(now);

/** Служебные тексты. */
export const serviceText = {
  created: (who: string, name: string) => `${who} создаёт группу «${name}»`,
  renamed: (who: string, name: string) => `${who} меняет название на «${name}»`,
  added: (who: string, names: string[]) => `${who} добавляет ${names.join(', ')}`,
  removed: (who: string, name: string) => `${who} исключает ${name}`,
  left: (who: string) => `${who} выходит из группы`,
  topicsOn: (who: string) => `${who} включает темы`,
  topicCreated: (who: string, name: string) => `${who} создаёт тему «${name}»`,
  pinned: (who: string) => `${who} закрепляет сообщение`,
};
