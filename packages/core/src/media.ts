/**
 * Файлы и медиа: виды вложений, запрещённые типы, волна голосового,
 * раскладка альбома, подписанные ссылки и подписи в ленте. Общая логика
 * сервера, сайта и приложения; перенесено из mesNation по смыслу.
 */

import { formatNumber } from './format';

export const MEDIA_KINDS = ['photo', 'video', 'file', 'voice', 'video_note'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const isMediaKind = (v: unknown): v is MediaKind => (MEDIA_KINDS as readonly unknown[]).includes(v);

/** Предел файла по умолчанию; на сервере меняется переменной UPLOAD_MAX_MB. */
export const UPLOAD_MAX_MB_DEFAULT = 200;
/** Сколько вложений в одном сообщении (альбом или пачка файлов). */
export const ALBUM_MAX = 10;
/** Сколько файлов в задаче и в комментарии. */
export const TASK_FILES_MAX = 30;
export const COMMENT_FILES_MAX = 5;
export const VOICE_MAX_SECONDS = 15 * 60;
export const VIDEO_NOTE_MAX_SECONDS = 60;
export const FILE_NAME_MAX = 255;
/** Подписанная ссылка на файл живёт 10–20 минут: граница округляется, чтобы ссылка не менялась и кэшировалась. */
export const FILE_LINK_TTL_SECONDS = 600;

/**
 * Типы, которые нельзя загрузить: страница или скрипт, открытые с нашего
 * адреса, получили бы доступ к сессии; исполняемые файлы — риск для коллег.
 */
export const BLOCKED_EXTENSIONS = [
  'html', 'htm', 'xhtml', 'shtml', 'mht', 'mhtml', 'svg', 'svgz', 'xml', 'xsl', 'js', 'mjs', 'cjs', 'php', 'phtml', 'jsp', 'asp', 'aspx',
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'vbe', 'jse', 'wsf', 'hta', 'cpl', 'jar', 'dll', 'sh', 'reg', 'lnk',
] as const;
const BLOCKED_MIME = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|application\/(x-)?javascript|text\/javascript|application\/xml|text\/xml|application\/x-msdownload|application\/x-sh)\b/i;

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'avif', 'tif', 'tiff'] as const;
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', '3gp', 'mkv', 'avi'] as const;
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba'] as const;

/** Расширение в нижнем регистре без точки; странное или слишком длинное — пустое. */
export function fileExtension(name: string | null | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  const ext = base.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

export function isBlockedFile(name: string | null | undefined, mime?: string | null): boolean {
  const ext = fileExtension(name);
  if ((BLOCKED_EXTENSIONS as readonly string[]).includes(ext)) return true;
  return !!mime && BLOCKED_MIME.test(mime);
}

/**
 * Каким вложением станет файл — догадка по типу и расширению. Клиент
 * рисует по ней черновик, сервер проверяет содержимое (sharp, ffprobe).
 * «Отправить как файл» — всегда документ, без сжатия и превью.
 */
export function detectFileKind(f: { name: string; mime?: string | null }, opts: { asFile?: boolean } = {}): 'photo' | 'video' | 'file' {
  if (opts.asFile) return 'file';
  const ext = fileExtension(f.name);
  const mime = (f.mime ?? '').toLowerCase();
  if (ext === 'svg' || mime === 'image/svg+xml') return 'file';
  if (mime.startsWith('image/') || (IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'photo';
  if (mime.startsWith('video/') || (VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video';
  return 'file';
}

/** Имя файла без пути и управляющих символов, не длиннее 255. */
export function safeFileName(name: string | null | undefined, fallback = 'файл'): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean || clean === '.' || clean === '..') return fallback;
  if (clean.length <= FILE_NAME_MAX) return clean;
  const ext = fileExtension(clean);
  return ext ? `${clean.slice(0, FILE_NAME_MAX - ext.length - 1)}.${ext}` : clean.slice(0, FILE_NAME_MAX);
}

/** «0 Б», «512 Б», «1,5 КБ», «12 МБ», «1,2 ГБ». */
export function formatBytes(bytes: number | null | undefined): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${Math.round(n)} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${formatNumber(v, v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Длительность записи: «0:05», «12:30», «1:02:03». */
export function formatClock(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ---------------------------------------------------------------- волна голосового

/** До 100 уровней 0..31 (5 бит на столбик, как в Telegram) строкой «0,5,31,…». */
export const WAVE_MAX = 31;
export const WAVE_SAMPLES = 100;

/** Громкость в дБ (-160..0) → 0..1. Речь обычно -45..-5 дБ. */
export function dbToLevel(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 50) / 45));
}

/** Пересэмплирование: максимум в каждом отрезке, чтобы пики не терялись. */
export function resample(levels: number[], count: number): number[] {
  if (count <= 0) return [];
  if (!levels.length) return new Array<number>(count).fill(0);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.floor((i * levels.length) / count);
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / count));
    let mx = 0;
    for (let j = a; j < b && j < levels.length; j++) mx = Math.max(mx, levels[j]!);
    out.push(mx);
  }
  return out;
}

/** Уровни 0..1 → строка для сервера; громкость нормируется по пику. */
export function encodeWaveform(levels: number[]): string {
  const clean = levels.map((v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0));
  if (!clean.length) return '';
  const peak = Math.max(0.05, ...clean);
  return resample(clean, Math.min(WAVE_SAMPLES, clean.length))
    .map((v) => Math.round((v / peak) * WAVE_MAX))
    .join(',');
}

/** Строка с сервера → уровни 0..1. Без волны — спокойная волна, своя у каждого сообщения. */
export function decodeWaveform(raw: string | null | undefined, seed: number | string = 1): number[] {
  if (raw && isWaveform(raw)) return raw.split(',').map((x) => Number(x) / WAVE_MAX);
  let h = String(seed)
    .split('')
    .reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: 48 }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return 0.15 + ((h >>> 16) % 100) / 400;
  });
}

/** Волна от клиента: 1..100 целых 0..31 через запятую. */
export function isWaveform(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw || raw.length > WAVE_SAMPLES * 3) return false;
  const parts = raw.split(',');
  return parts.length <= WAVE_SAMPLES && parts.every((p) => /^\d{1,2}$/.test(p) && Number(p) <= WAVE_MAX);
}

/** Сколько столбиков влезет в ширину: столбик 3 px и зазор 2 px. */
export const waveBars = (width: number, bar = 3, gap = 2) => Math.max(8, Math.min(WAVE_SAMPLES, Math.floor((width + gap) / (bar + gap))));

/** «0:05,3» — таймер записи. */
export function recordTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const d = Math.floor((total % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')},${d}`;
}

// ---------------------------------------------------------------- альбом

export interface AlbumCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Раскладка альбома (упрощённая мозаика Telegram): одна картинка — по своим
 * пропорциям; две — рядом (или одна под другой, если обе широкие); три —
 * большая слева и две справа; четыре — 2×2; больше — строками по 2–3.
 * ratios — ширина/высота каждого снимка.
 */
export function albumLayout(ratios: number[], maxW: number, maxH: number, gap = 2): { cells: AlbumCell[]; width: number; height: number } {
  const n = ratios.length;
  if (!n) return { cells: [], width: 0, height: 0 };
  const r = ratios.map((x) => (x > 0 && Number.isFinite(x) ? Math.min(Math.max(x, 0.4), 2.6) : 1));
  const W = maxW;
  if (n === 1) {
    let w = W;
    let h = w / r[0]!;
    if (h > maxH) {
      h = maxH;
      w = Math.max(h * r[0]!, W * 0.55);
    }
    return { cells: [{ x: 0, y: 0, w, h }], width: w, height: h };
  }
  if (n === 2) {
    if (r[0]! > 1.2 && r[1]! > 1.2) {
      const h0 = Math.min(maxH / 2, W / r[0]!);
      const h1 = Math.min(maxH / 2, W / r[1]!);
      return { cells: [{ x: 0, y: 0, w: W, h: h0 }, { x: 0, y: h0 + gap, w: W, h: h1 }], width: W, height: h0 + h1 + gap };
    }
    const h = Math.min(maxH, (W - gap) / (r[0]! + r[1]!));
    const w0 = Math.round(((W - gap) * r[0]!) / (r[0]! + r[1]!));
    return { cells: [{ x: 0, y: 0, w: w0, h }, { x: w0 + gap, y: 0, w: W - w0 - gap, h }], width: W, height: h };
  }
  if (n === 3) {
    const H = Math.min(maxH, W * 0.75);
    const leftW = Math.round(W * 0.62);
    const rightW = W - leftW - gap;
    const half = (H - gap) / 2;
    return {
      cells: [
        { x: 0, y: 0, w: leftW, h: H },
        { x: leftW + gap, y: 0, w: rightW, h: half },
        { x: leftW + gap, y: half + gap, w: rightW, h: half },
      ],
      width: W,
      height: H,
    };
  }
  const rows: number[] = [];
  let left = n;
  while (left > 0) {
    if (left === 4 || left === 2) {
      rows.push(2);
      left -= 2;
    } else {
      rows.push(Math.min(3, left));
      left -= Math.min(3, left);
    }
  }
  const cells: AlbumCell[] = [];
  let y = 0;
  for (const count of rows) {
    const w = (W - gap * (count - 1)) / count;
    const rowH = Math.min(W / 2, w);
    for (let k = 0; k < count; k++) cells.push({ x: k * (w + gap), y, w, h: rowH });
    y += rowH + gap;
  }
  return { cells, width: W, height: y - gap };
}

// ---------------------------------------------------------------- подписанные ссылки

/**
 * Ссылка на файл: `/api/v1/files/<id>/raw?e=<срок>&u=<кто>&s=<подпись>`.
 * Подпись (HMAC) ставит сервер; здесь — строка, которую подписывают, и
 * разбор срока, чтобы клиент вовремя попросил свежую ссылку.
 */
export const fileLinkPayload = (id: string, exp: number, userId: string) => `file:${id}:${exp}:${userId}`;

/** Срок ссылки: следующая граница десятиминутки плюс ещё десять минут. */
export function fileLinkExpiry(nowMs: number, ttl = FILE_LINK_TTL_SECONDS): number {
  return (Math.floor(nowMs / 1000 / ttl) + 2) * ttl;
}

export function parseFileLink(url: string | null | undefined): { id: string; exp: number } | null {
  if (!url) return null;
  const m = /\/files\/([0-9a-f-]{36})\/raw\?(.*)$/i.exec(url);
  if (!m) return null;
  const exp = Number(/(?:^|&)e=(\d+)/.exec(m[2]!)?.[1]);
  return Number.isFinite(exp) && exp > 0 ? { id: m[1]!.toLowerCase(), exp } : null;
}

/** Ссылка ещё жива с запасом (по умолчанию минута): не подписанная — живая всегда. */
export function fileLinkFresh(url: string | null | undefined, nowMs: number, marginSec = 60): boolean {
  if (!url) return false;
  const p = parseFileLink(url);
  return !p || p.exp * 1000 - marginSec * 1000 > nowMs;
}

// ---------------------------------------------------------------- данные API

export interface Attachment {
  id: string;
  kind: MediaKind;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Секунды: видео, голосовое, кружочек. */
  duration: number | null;
  /** Волна голосового: «0,5,31,…». */
  waveform: string | null;
  /** Подписанная ссылка на оригинал (живёт 10–20 минут). */
  url: string;
  /** Превью (JPEG до 1280 px) — по случайному имени, без подписи. */
  thumb_url: string | null;
  uploaded_by: string | null;
  created_at: string;
}

/** Краткая сводка вложений для превью в списке чатов и в цитате. */
export interface MediaSummary {
  kind: MediaKind | 'contact';
  count: number;
  /** Имя первого файла или имя контакта. */
  name: string | null;
}

export const GALLERY_TABS = ['media', 'files', 'voice', 'links'] as const;
export type GalleryTab = (typeof GALLERY_TABS)[number];
export const GALLERY_TAB_LABELS: Record<GalleryTab, string> = { media: 'Медиа', files: 'Файлы', voice: 'Голосовые', links: 'Ссылки' };

export interface ChatGalleryItem {
  message_id: string;
  seq: number;
  sender_id: string | null;
  sender_name: string | null;
  created_at: string;
  attachment: Attachment | null;
  link: { url: string; host: string; text: string | null } | null;
}

export interface ChatGallery {
  items: ChatGalleryItem[];
  /** Курсор следующей страницы: seq последнего сообщения. */
  next_before: number | null;
}

export interface ChatStats {
  messages: number;
  photos: number;
  videos: number;
  files: number;
  voice: number;
  video_notes: number;
  links: number;
  /** Сколько места занимают файлы чата. */
  bytes: number;
  first_message_at: string | null;
  top_senders: { id: string; display_name: string; messages: number }[];
}

export interface ContactCard {
  id: string;
  display_name: string;
  position: string | null;
  avatar_url: string | null;
}

export interface AvatarEntry {
  id: string;
  display_name: string;
  avatar_url: string;
}

/** Справочник фото: по id и по имени — только однозначные имена, у тёзок фото по имени не угадываем. */
export interface AvatarDirectory {
  byId: ReadonlyMap<string, string>;
  byName: ReadonlyMap<string, string>;
}

export function buildAvatarDirectory(list: AvatarEntry[], toSrc: (url: string) => string | null | undefined = (u) => u): AvatarDirectory {
  const byId = new Map<string, string>();
  const names = new Map<string, string | null>();
  for (const a of list) {
    const src = a.avatar_url ? toSrc(a.avatar_url) : null;
    if (!src) continue;
    byId.set(a.id, src);
    const key = a.display_name.trim().toLowerCase();
    names.set(key, names.has(key) ? null : src);
  }
  const byName = new Map<string, string>();
  for (const [k, v] of names) if (v) byName.set(k, v);
  return { byId, byName };
}

/** Фото человека: по id, а где id нет — по имени. */
export function avatarFor(dir: AvatarDirectory, id?: string | null, name?: string | null): string | undefined {
  if (id) return dir.byId.get(id);
  return name ? dir.byName.get(name.trim().toLowerCase()) : undefined;
}

// ---------------------------------------------------------------- подписи

const pluralRu = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** «📷 Фото», «🖼 3 фото», «🎬 Видео», «📎 отчёт.pdf», «📎 4 файла», «🎤 Голосовое сообщение», «⚪ Видеосообщение», «👤 Анна Смирнова». */
export function mediaLabel(m: MediaSummary): string {
  const n = Math.max(1, m.count);
  switch (m.kind) {
    case 'photo':
      return n > 1 ? `🖼 ${n} ${pluralRu(n, 'фото', 'фото', 'фото')}` : '📷 Фото';
    case 'video':
      return n > 1 ? `🖼 ${n} ${pluralRu(n, 'медиа', 'медиа', 'медиа')}` : '🎬 Видео';
    case 'file':
      return n > 1 ? `📎 ${n} ${pluralRu(n, 'файл', 'файла', 'файлов')}` : `📎 ${m.name ?? 'Файл'}`;
    case 'voice':
      return '🎤 Голосовое сообщение';
    case 'video_note':
      return '⚪ Видеосообщение';
    case 'contact':
      return `👤 ${m.name ?? 'Контакт'}`;
  }
}

/** Сводка по списку вложений: альбом из фото и видео — «медиа», иначе вид первого. */
export function summarizeAttachments(list: { kind: MediaKind; name: string }[]): MediaSummary | null {
  if (!list.length) return null;
  const kinds = new Set(list.map((a) => a.kind));
  const kind: MediaKind = kinds.size === 1 ? list[0]!.kind : kinds.has('file') ? 'file' : 'video';
  return { kind, count: list.length, name: list[0]!.name };
}

/** Ссылки в тексте: http(s), без хвостовой пунктуации, без повторов. */
export function extractLinks(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"«»]+/gi)) {
    let url = m[0];
    while (/[.,;:!?)\]}'’”]$/.test(url)) {
      // Закрывающую скобку оставляем, если открывающая — внутри ссылки (википедия).
      if (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
      url = url.slice(0, -1);
    }
    if (url.length > 10 && !out.includes(url)) out.push(url);
  }
  return out;
}

export function linkHost(url: string): string {
  const m = /^https?:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url);
  return m ? m[1]!.toLowerCase().replace(/^www\./, '') : url;
}

/** Вид галереи по вложению: фото и видео — «Медиа», кружочки — к голосовым, как в Telegram. */
export function galleryTabOf(kind: MediaKind): Exclude<GalleryTab, 'links'> {
  if (kind === 'photo' || kind === 'video') return 'media';
  if (kind === 'file') return 'files';
  return 'voice';
}
