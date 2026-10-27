/**
 * Аккаунт сотрудника: профиль, пароль, сеансы, свои имена для коллег и
 * QR-коды (профиль и вход на сайт с телефона). Правила общие для сервера,
 * сайта и приложения: сообщение об ошибке одно и то же везде.
 */

import type { CompanyRole } from './access';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const DISPLAY_NAME_MAX = 120;
export const CONTACT_NAME_MAX = 120;

/** Самые частые пароли из утечек: их подбирают первыми. */
const COMMON = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty123', 'qwertyui', '11111111', '00000000', 'йцукенгш', 'iloveyou', 'admin123', 'offix123', 'offix-demo']);

/** GET /account: свой профиль и сведения о входе. */
export interface AccountProfile {
  id: string;
  email: string;
  display_name: string;
  position: string | null;
  avatar_url: string | null;
  role: CompanyRole;
  company_name: string;
  last_login_at: string | null;
  password_changed_at: string | null;
  joined_at: string;
}

/** Карточка коллеги: настоящие данные и моё имя для него. */
export interface PersonCard {
  id: string;
  display_name: string;
  /** Моё имя для коллеги или null. */
  my_name: string | null;
  position: string | null;
  email: string;
  avatar_url: string | null;
  role: CompanyRole;
  active: boolean;
  units: { id: string; name: string; is_manager: boolean }[];
  online: boolean;
  last_seen_at: string | null;
  is_me: boolean;
}

/** Мои группы для «Добавить в группу»: где он уже есть и куда я могу добавлять. */
export interface PersonGroup {
  id: string;
  name: string;
  is_supergroup: boolean;
  members: number;
  is_member: boolean;
  can_add: boolean;
}

/** Ошибка нового пароля или null. Длина важнее «сложности»: фраза из слов надёжнее «P@ssw0rd». */
export function passwordError(password: string, ctx: { email?: string | null; name?: string | null } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Пароль — не короче ${PASSWORD_MIN} символов`;
  if (password.length > PASSWORD_MAX) return `Пароль — не длиннее ${PASSWORD_MAX} символов`;
  if (password.trim() !== password) return 'Уберите пробелы в начале и в конце пароля';
  const low = password.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(password)) return 'Этот пароль слишком простой — его подберут первым';
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && low.includes(local)) return 'Пароль не должен повторять почту';
  if (ctx.email && low === ctx.email.toLowerCase()) return 'Пароль не должен повторять почту';
  return null;
}

/** Надёжность для полоски под полем: 0 — слабый, 3 — хороший. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (password.length < PASSWORD_MIN || passwordError(password)) return 0;
  const classes = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\p{L}\d]/u].filter((r) => r.test(password)).length;
  const score = (password.length >= 12 ? 1 : 0) + (password.length >= 16 ? 1 : 0) + (classes >= 3 ? 1 : 0) + (classes >= 2 ? 0.5 : 0);
  return score >= 2.5 ? 3 : score >= 1.5 ? 2 : 1;
}

export const PASSWORD_STRENGTH_LABELS = ['Слабый', 'Средний', 'Хороший', 'Надёжный'] as const;

export function displayNameError(name: unknown): string | null {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return 'Как вас зовут?';
  if (n.length > DISPLAY_NAME_MAX) return `Имя — не длиннее ${DISPLAY_NAME_MAX} символов`;
  return null;
}

/** Временный пароль после сброса: читаемый, без похожих символов (0/O, 1/l). */
export function tempPassword(random: (n: number) => number): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 8) out += '-';
    out += alphabet[random(alphabet.length)];
  }
  return out;
}

// ---------------------------------------------------------------- свои имена

/** Своё имя для коллеги видно только мне: в чатах, задачах и поиске. */
export interface ContactName {
  user_id: string;
  name: string;
}

export function contactNameError(name: unknown): string | null {
  if (typeof name !== 'string') return 'Введите имя';
  if (name.trim().length > CONTACT_NAME_MAX) return `Имя — не длиннее ${CONTACT_NAME_MAX} символов`;
  return null;
}

export type ContactBook = ReadonlyMap<string, string>;

export const contactBook = (list: readonly ContactName[]): ContactBook => new Map(list.filter((c) => c.name.trim()).map((c) => [c.user_id, c.name.trim()]));

/** Как показать человека: моё имя для него, иначе настоящее. */
export function nameFor(book: ContactBook, id: string | null | undefined, real: string | null | undefined): string {
  return (id ? book.get(id) : undefined) ?? real ?? '';
}

type Signed = { sender_id?: string | null; sender_name: string | null };

/** Лента глазами читателя: подписи отправителей и цитат — моими именами для коллег. */
export function renameSenders<T extends Signed & { reply_to?: Signed | null; external_reply?: Signed | null }>(list: readonly T[], book: ContactBook): T[] {
  if (!book.size) return list as T[];
  const fix = <S extends Signed>(x: S): S => {
    const alias = x.sender_id ? book.get(x.sender_id) : undefined;
    return alias && alias !== x.sender_name ? { ...x, sender_name: alias } : x;
  };
  return list.map((m) => {
    const next = fix(m);
    const reply = m.reply_to ? fix(m.reply_to) : m.reply_to;
    const ext = m.external_reply ? fix(m.external_reply) : m.external_reply;
    return next === m && reply === m.reply_to && ext === m.external_reply ? m : { ...next, reply_to: reply, external_reply: ext };
  });
}

// ---------------------------------------------------------------- QR

/** Код входа живёт полторы минуты: сайт сам показывает новый. */
export const QR_LOGIN_TTL_SECONDS = 90;
const QR_TOKEN = /^[A-Za-z0-9_-]{24,64}$/;
export const isQrLoginToken = (v: unknown): v is string => typeof v === 'string' && QR_TOKEN.test(v);

export type QrLoginStatus = 'pending' | 'scanned' | 'approved' | 'declined' | 'expired';

/** Что видит телефон, отсканировав код: какое устройство просит вход. */
export interface QrLoginInfo {
  status: QrLoginStatus;
  device: DeviceInfo;
  ip: string | null;
  created_at: string;
  expires_at: string;
}

/** Что видит сайт, пока ждёт: кто отсканировал — «Подтвердите вход на телефоне». */
export type QrPollResult =
  | { status: 'pending' | 'declined' | 'expired' }
  | { status: 'scanned'; user: { display_name: string } }
  | { status: 'approved'; token: string; user: { id: string; display_name: string; role: string }; company: { id: string; name: string } };

/**
 * Ссылки в QR-кодах offix — обычные адреса сайта: камера телефона без
 * приложения откроет их в браузере, а приложение узнает и откроет у себя.
 */
export const qrLoginUrl = (origin: string, token: string) => `${trimSlash(origin)}/qr/${token}`;
export const profileUrl = (origin: string, userId: string) => `${trimSlash(origin)}/app/people/${userId}`;
const trimSlash = (s: string) => s.replace(/\/+$/, '');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OffixLink = { kind: 'qr_login'; token: string } | { kind: 'profile'; id: string } | { kind: 'url'; url: string } | { kind: 'text'; text: string };

/** Что за код отсканировали: вход, профиль коллеги, чужая ссылка или просто текст. */
export function parseOffixLink(raw: string): OffixLink {
  const text = raw.trim();
  const m = /^(?:https?:\/\/[^/\s]+|offix:\/)?\/(qr|app\/people)\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(text);
  if (m) {
    const [, head, value] = m;
    if (head!.toLowerCase() === 'qr' && isQrLoginToken(value)) return { kind: 'qr_login', token: value! };
    if (head!.toLowerCase() === 'app/people' && UUID.test(value!)) return { kind: 'profile', id: value!.toLowerCase() };
  }
  if (/^https?:\/\/\S+$/i.test(text)) return { kind: 'url', url: text };
  return { kind: 'text', text };
}

export interface DeviceInfo {
  kind: 'desktop' | 'phone' | 'tablet' | 'unknown';
  /** «Chrome на Windows», «Safari на iPhone». */
  label: string;
}

/** Устройство по User-Agent — чтобы на телефоне было видно, кто просит вход. */
export function describeDevice(ua: string | null | undefined): DeviceInfo {
  const s = ua ?? '';
  if (!s.trim()) return { kind: 'unknown', label: 'Неизвестное устройство' };
  const browser = /YaBrowser\//.test(s)
    ? 'Яндекс Браузер'
    : /Edg\//.test(s)
      ? 'Edge'
      : /OPR\/|Opera/.test(s)
        ? 'Opera'
        : /Firefox\//.test(s)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(s)
            ? 'Chrome'
            : /Safari\//.test(s)
              ? 'Safari'
              : 'Браузер';
  const os = /iPad/.test(s)
    ? 'iPad'
    : /iPhone/.test(s)
      ? 'iPhone'
      : /Android/.test(s)
        ? 'Android'
        : /Windows/.test(s)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(s)
            ? 'Mac'
            : /CrOS/.test(s)
              ? 'Chromebook'
              : /Linux/.test(s)
                ? 'Linux'
                : null;
  const kind: DeviceInfo['kind'] = /iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s)) ? 'tablet' : /iPhone|Mobile/.test(s) ? 'phone' : os ? 'desktop' : 'unknown';
  return { kind, label: os ? `${browser} на ${os}` : browser };
}

// ---------------------------------------------------------------- рисунок QR

export interface QrMatrix {
  size: number;
  dark: (row: number, col: number) => boolean;
}

const inFinder = (r: number, c: number, n: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

function roundRect(x: number, y: number, w: number, h: number, rad: number, reverse = false): string {
  const r = Math.min(rad, w / 2, h / 2);
  const f = (v: number) => +v.toFixed(2);
  return reverse
    ? `M${f(x + r)} ${f(y)}A${f(r)} ${f(r)} 0 0 0 ${f(x)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 0 ${f(x + r)} ${f(y + h)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 0 ${f(x + w)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 0 ${f(x + w - r)} ${f(y)}Z`
    : `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

/** Вырез под знак offix: ~22% стороны, той же чётности, что и сторона, — знак ровно по центру. */
export function qrHole(n: number): number {
  let h = Math.round(n * 0.22);
  if (h % 2 !== n % 2) h += 1;
  return h;
}

/**
 * QR в стиле offix: модули — круглые точки, «глазки» — скруглённые
 * квадраты, середина свободна под знак. Код с высокой коррекцией ошибок
 * (H, 30%) читается и с вырезом. Пути — SVG, их рисует и сайт, и приложение.
 */
export function qrPaths(m: QrMatrix, cell: number, holeModules = qrHole(m.size)): { dots: string; eyes: string; hole: number; size: number } {
  const n = m.size;
  const lo = Math.floor((n - holeModules) / 2);
  const hi = lo + holeModules;
  const r = cell * 0.42;
  const parts: string[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!m.dark(row, col) || inFinder(row, col, n)) continue;
      if (holeModules > 0 && row >= lo && row < hi && col >= lo && col < hi) continue;
      const cx = (col + 0.5) * cell;
      const cy = (row + 0.5) * cell;
      const f = (v: number) => +v.toFixed(2);
      parts.push(`M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`);
    }
  }
  const eye = (x: number, y: number) => {
    const s = 7 * cell;
    const outer = cell * 2.2;
    return roundRect(x, y, s, s, outer) + roundRect(x + cell, y + cell, s - 2 * cell, s - 2 * cell, Math.max(0, outer - cell * 0.9), true) + roundRect(x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, cell);
  };
  return { dots: parts.join(''), eyes: eye(0, 0) + eye((n - 7) * cell, 0) + eye(0, (n - 7) * cell), hole: holeModules * cell, size: n * cell };
}
