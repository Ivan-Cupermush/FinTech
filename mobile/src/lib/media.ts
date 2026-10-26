import { ALBUM_MAX, dbToLevel, formatBytes, plural, detectFileKind, encodeWaveform, fileExtension, isBlockedFile, UPLOAD_MAX_MB_DEFAULT, type Attachment, type ChatMessage, type ChatStats } from '@offix/core';
import { socketOrigin } from './chat-logic';
import { ApiError } from './client';

/**
 * Файлы и медиа на телефоне — чистая логика: что выбрали, как отправить,
 * что показать в просмотре. Без React Native — проверяется тестами.
 */

/** Файл, выбранный на телефоне: из галереи, камеры, документов или записи. */
export interface PickedFile {
  key: string;
  uri: string;
  name: string;
  mime: string;
  size: number | null;
  width?: number | null;
  height?: number | null;
  /** Секунды. */
  duration?: number | null;
  /** Веб-сборка отдаёт сам файл — его и отправляем. */
  file?: Blob;
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
};

export const guessMime = (name: string, fallback = 'application/octet-stream') => MIME[fileExtension(name)] ?? fallback;

/** Последний кусок пути, если похож на имя файла: у blob: и data: имени нет. */
function nameFromUri(uri: string): string | null {
  if (/^(blob|data):/i.test(uri)) return null;
  const last = uri.split(/[?#]/)[0]!.split('/').pop() ?? '';
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // Битая кодировка — оставляем как есть.
  }
  return /\.[a-z0-9]{2,5}$/i.test(name) ? name : null;
}

export interface ImageAssetLike {
  uri: string;
  type?: string | null;
  fileName?: string | null;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  /** Миллисекунды — так отдаёт expo-image-picker. */
  duration?: number | null;
  file?: Blob;
}

/** Фото или видео из галереи и камеры → файл к отправке. */
export function fromImageAsset(a: ImageAssetLike, n: number): PickedFile {
  const video = a.type === 'video' || !!a.mimeType?.startsWith('video/');
  const name = a.fileName || nameFromUri(a.uri) || `${video ? 'video' : 'photo'}-${n + 1}.${video ? 'mp4' : 'jpg'}`;
  return {
    key: `${a.uri}#${n}`,
    uri: a.uri,
    name,
    mime: a.mimeType || guessMime(name, video ? 'video/mp4' : 'image/jpeg'),
    size: a.fileSize ?? a.file?.size ?? null,
    width: a.width || null,
    height: a.height || null,
    duration: a.duration ? Math.round(a.duration / 100) / 10 : null,
    file: a.file,
  };
}

export interface DocumentAssetLike {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
  file?: Blob;
}

/** Документ из «Файлов» → файл к отправке. */
export function fromDocumentAsset(a: DocumentAssetLike, n: number): PickedFile {
  const name = a.name || nameFromUri(a.uri) || `файл-${n + 1}`;
  return { key: `${a.uri}#${n}`, uri: a.uri, name, mime: a.mimeType || guessMime(name), size: a.size ?? a.file?.size ?? null, file: a.file };
}

/** Что не уйдёт на сервер: запрещённый тип или слишком большой файл. */
export function checkPicked(files: PickedFile[], maxMb = UPLOAD_MAX_MB_DEFAULT): { ok: PickedFile[]; problems: string[] } {
  const ok: PickedFile[] = [];
  const problems: string[] = [];
  for (const f of files) {
    if (isBlockedFile(f.name, f.mime)) problems.push(`«${f.name}»: такой тип файла отправить нельзя`);
    else if (f.size && f.size > maxMb * 1024 * 1024) problems.push(`«${f.name}» больше ${maxMb} МБ`);
    else ok.push(f);
  }
  return { ok, problems };
}

/** Как файл ляжет в ленту: фото, видео или документ («как файл» — всегда документ). */
export const pickedKind = (f: Pick<PickedFile, 'name' | 'mime'>, asFile = false) => detectFileKind({ name: f.name, mime: f.mime }, { asFile });

/** Поля формы загрузки — те же, что шлёт сайт: true → «1», пустые не шлём. */
export function uploadFields(o: { kind?: 'voice' | 'video_note'; waveform?: string | null; duration?: number | null; asFile?: boolean } = {}): [string, string][] {
  const out: [string, string][] = [];
  if (o.kind) out.push(['kind', o.kind]);
  if (o.waveform) out.push(['waveform', o.waveform]);
  if (o.duration != null && Number.isFinite(o.duration)) out.push(['duration', String(Math.round(o.duration * 10) / 10)]);
  if (o.asFile) out.push(['as_file', '1']);
  return out;
}

/** Ответ загрузки: тот же конверт {data} / {error}, что у остального API. */
export function parseUpload<T>(status: number, body: string): T {
  if (status === 0) throw new ApiError(0, 'NETWORK', 'Нет связи с сервером. Проверьте интернет');
  let json: { data?: T; error?: { code?: string; message?: string } } | null = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  if (status >= 200 && status < 300 && json?.data !== undefined) return json.data;
  if (status === 413) throw new ApiError(413, json?.error?.code ?? 'TOO_LARGE', json?.error?.message ?? 'Файл слишком большой');
  throw new ApiError(status, json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? 'Файл не загрузился, попробуйте ещё раз');
}

/** Партии альбомов: не больше 10 в сообщении, подпись — у последнего. */
export function albumBatches<T>(items: T[], caption: string, max = ALBUM_MAX): { items: T[]; caption: string }[] {
  const out: { items: T[]; caption: string }[] = [];
  for (let i = 0; i < items.length; i += max) out.push({ items: items.slice(i, i + max), caption: '' });
  if (out.length) out[out.length - 1]!.caption = caption.trim();
  return out;
}

/** Адрес файла для <Image> и плеера: сервер отдаёт путь «/api/v1/files/…», телефону нужен полный. */
export function fileUri(server: string, url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|blob:|data:|file:)/i.test(url)) return url;
  return socketOrigin(server) + url;
}

export const isVisual = (a: Pick<Attachment, 'kind'>) => a.kind === 'photo' || a.kind === 'video';

export interface ViewerItem {
  attachment: Attachment;
  message_id: string;
  sender_id: string | null;
  sender_name: string | null;
  created_at: string;
}

/** Просмотр листает все фото и видео загруженной ленты; кружочки и файлы — не в счёт. */
export function viewerItems(messages: ChatMessage[], messageId: string, index: number): { items: ViewerItem[]; index: number } {
  const items: ViewerItem[] = [];
  let at = 0;
  for (const m of messages) {
    if (m.deleted) continue;
    m.attachments.filter(isVisual).forEach((a, i) => {
      if (m.id === messageId && i === index) at = items.length;
      items.push({ attachment: a, message_id: m.id, sender_id: m.sender_id, sender_name: m.sender_name, created_at: m.created_at });
    });
  }
  return { items, index: at };
}

export const VOICE_RATES = [1, 1.5, 2] as const;
/** Скорость голосовых по кругу: 1× → 1,5× → 2× → 1×. */
export function nextRate(rate: number): number {
  const i = VOICE_RATES.indexOf(rate as (typeof VOICE_RATES)[number]);
  return VOICE_RATES[(i + 1) % VOICE_RATES.length]!;
}
export const rateLabel = (rate: number) => `${String(rate).replace('.', ',')}×`;

/** Доля прослушанного 0..1. */
export const progressOf = (current: number, duration: number) => (duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0);

/**
 * Волна записи: уровни громкости с микрофона копятся, на сервер уходит
 * сжатая строка. Метр выдаёт дБ (-160..0) или ничего — тогда тишина.
 */
export class LevelTrack {
  levels: number[] = [];
  push(db: number | null | undefined) {
    this.levels.push(db == null ? 0 : dbToLevel(db));
  }
  /** Последние n уровней для живой волны при записи. */
  tail(n: number): number[] {
    const t = this.levels.slice(-n);
    return t.length < n ? [...new Array<number>(n - t.length).fill(0), ...t] : t;
  }
  encode(): string {
    return encodeWaveform(this.levels);
  }
}

/** Сетка галереи: квадратные плитки по 3 в ряд с зазором. */
export function gridCell(width: number, columns = 3, gap = 2): number {
  return Math.max(0, Math.floor((width - gap * (columns - 1)) / columns));
}

const ruCount = (n: number, forms: [string, string, string]) => `${n} ${plural(n, forms)}`;

/** Строка «Медиа и файлы» в карточке чата: «12 фото и видео · 3 файла · 2 голосовых · 1,4 МБ». */
export function mediaLine(s: Pick<ChatStats, 'photos' | 'videos' | 'files' | 'voice' | 'video_notes' | 'links' | 'bytes'>): string {
  const parts: string[] = [];
  if (s.photos + s.videos) parts.push(`${s.photos + s.videos} фото и видео`);
  if (s.files) parts.push(ruCount(s.files, ['файл', 'файла', 'файлов']));
  if (s.voice + s.video_notes) parts.push(ruCount(s.voice + s.video_notes, ['голосовое', 'голосовых', 'голосовых']));
  if (s.links) parts.push(ruCount(s.links, ['ссылка', 'ссылки', 'ссылок']));
  if (!parts.length) return 'Пока ничего — фото и файлы из переписки соберутся здесь';
  if (s.bytes) parts.push(formatBytes(s.bytes));
  return parts.join(' · ');
}
