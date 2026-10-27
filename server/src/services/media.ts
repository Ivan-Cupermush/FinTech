import { execFile } from 'node:child_process';
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  VIDEO_NOTE_MAX_SECONDS,
  VOICE_MAX_SECONDS,
  detectFileKind,
  encodeWaveform,
  fileExtension,
  fileLinkExpiry,
  fileLinkPayload,
  isWaveform,
  safeFileName,
  type Attachment,
  type MediaKind,
} from '@offix/core';
import type { UploadsConfig } from '../config';

const run = promisify(execFile);

/**
 * Хранилище файлов на диске и обработка медиа. Раскладка внутри UPLOADS_DIR:
 *
 *  - files/ab/<32 hex>.<ext> — оригиналы; отдаются только по подписанной ссылке;
 *  - thumbs/<32 hex>.jpg — превью фото и кадры-обложки видео (случайное имя);
 *  - avatars/<32 hex>.jpg — фото профиля (случайное имя, открыты всем в компании);
 *  - tmp/ — загрузки в процессе.
 *
 * sharp читает размеры и делает превью; ffmpeg (если установлен) — обложку и
 * длительность видео, перекодирует голосовые и кружочки из браузера и
 * снимает волну голосового. Без ffmpeg всё работает, только беднее.
 */
export interface MediaStore {
  readonly root: string;
  readonly tmpDir: string;
  readonly maxBytes: number;
  hasFfmpeg(): Promise<boolean>;
  process(input: UploadInput): Promise<ProcessedUpload>;
  saveAvatar(tmpPath: string): Promise<string>;
  /** Абсолютный путь по ключу; ключ вне хранилища — null. */
  pathOf(key: string): string | null;
  /** Удалить файлы, не падая, если их уже нет. */
  remove(keys: (string | null | undefined)[]): Promise<void>;
  sign(id: string, userId: string, nowMs: number): string;
  verify(id: string, exp: unknown, userId: unknown, sig: unknown, nowMs: number): boolean;
}

export interface UploadInput {
  path: string;
  originalName: string;
  mime: string;
  size: number;
  /** «Отправить как файл»: без сжатия и превью. */
  asFile?: boolean;
  /** Голосовое или кружочек — записаны в приложении. */
  special?: 'voice' | 'video_note';
  /** Волна от клиента (запись на телефоне знает громкость). */
  waveform?: string | null;
  /** Длительность от клиента — если ffprobe нет. */
  duration?: number | null;
}

export interface ProcessedUpload {
  kind: MediaKind;
  name: string;
  mime: string;
  size: number;
  storage_key: string;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  waveform: string | null;
}

/** Каким типом отдавать файл в браузер: медиа, PDF и текст — как есть, остальное — «скачать». */
const INLINE_MIME = /^(image\/(jpeg|png|gif|webp|avif|bmp|heic|heif)|video\/(mp4|webm|quicktime|3gpp|x-matroska)|audio\/(mp4|mpeg|ogg|webm|wav|x-wav|aac|flac|x-m4a)|application\/pdf|text\/plain)$/;
export const inlineMime = (mime: string) => INLINE_MIME.test(mime);

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', weba: 'audio/webm',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Тип файла: от браузера, если он правдоподобный, иначе по расширению. */
export function guessMime(name: string, given: string | null | undefined): string {
  const g = (given ?? '').toLowerCase().split(';')[0]!.trim();
  if (/^[a-z]+\/[a-z0-9.+-]+$/.test(g) && g !== 'application/octet-stream') return g;
  return MIME_BY_EXT[fileExtension(name)] ?? 'application/octet-stream';
}

const hex = (n = 16) => randomBytes(n).toString('hex');
const round2 = (n: number) => Math.round(n * 100) / 100;

export function createMediaStore(cfg: UploadsConfig, secret: string): MediaStore {
  const root = resolve(cfg.dir);
  const dirs = { files: join(root, 'files'), thumbs: join(root, 'thumbs'), avatars: join(root, 'avatars'), tmp: join(root, 'tmp') };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const key = Buffer.from(hkdfSync('sha256', secret, 'offix', 'file-links', 32));
  const bin = (name: 'ffmpeg' | 'ffprobe') => (cfg.ffmpegDir ? join(cfg.ffmpegDir, name) : name);

  let ffmpegChecked: Promise<boolean> | null = null;
  const hasFfmpeg = () => {
    if (cfg.ffmpegDir === null) return Promise.resolve(false);
    ffmpegChecked ??= Promise.all([run(bin('ffprobe'), ['-version'], { timeout: 5000 }), run(bin('ffmpeg'), ['-version'], { timeout: 5000 })]).then(
      () => true,
      () => false,
    );
    return ffmpegChecked;
  };

  const pathOf = (k: string): string | null => {
    if (!/^(files\/[0-9a-f]{2}\/[0-9a-f]{32}(\.[a-z0-9]{1,10})?|thumbs\/[0-9a-f]{32}\.jpg|avatars\/[0-9a-f]{32}\.jpg)$/.test(k)) return null;
    const full = resolve(root, k);
    return full.startsWith(root + sep) ? full : null;
  };

  /** Новое место для оригинала: files/ab/<hex>.<ext>. */
  const newFileKey = (ext: string) => {
    const id = hex();
    mkdirSync(join(dirs.files, id.slice(0, 2)), { recursive: true });
    return `files/${id.slice(0, 2)}/${id}${ext ? `.${ext}` : ''}`;
  };

  const probe = async (file: string): Promise<{ width: number | null; height: number | null; duration: number | null; hasVideo: boolean }> => {
    const { stdout } = await run(
      bin('ffprobe'),
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation:format=duration', '-of', 'json', file],
      { timeout: 20_000 },
    );
    const p = JSON.parse(stdout) as {
      streams?: { codec_type?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
      format?: { duration?: string };
    };
    const v = p.streams?.find((s) => s.codec_type === 'video');
    const rot = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180 === 90;
    const d = Number(p.format?.duration);
    return {
      width: (rot ? v?.height : v?.width) ?? null,
      height: (rot ? v?.width : v?.height) ?? null,
      duration: Number.isFinite(d) ? round2(d) : null,
      hasVideo: !!v,
    };
  };

  const poster = async (file: string, duration: number | null): Promise<string | null> => {
    const thumb = `thumbs/${hex()}.jpg`;
    try {
      await run(bin('ffmpeg'), ['-y', '-v', 'error', '-ss', duration && duration > 2 ? '1' : '0', '-i', file, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', join(root, thumb)], {
        timeout: 30_000,
      });
      return existsSync(join(root, thumb)) ? thumb : null;
    } catch {
      return null;
    }
  };

  /** Волна по звуку: громкость (RMS) отрезков → 0..1 → «0,5,31,…». */
  const waveOf = async (file: string): Promise<string | null> => {
    try {
      const { stdout } = await run(bin('ffmpeg'), ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], {
        timeout: 30_000,
        encoding: 'buffer',
        maxBuffer: 8000 * 2 * VOICE_MAX_SECONDS + 1024,
      });
      const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
      if (!samples.length) return null;
      const chunks = 100;
      const size = Math.max(1, Math.floor(samples.length / chunks));
      const levels: number[] = [];
      for (let i = 0; i < samples.length; i += size) {
        let sum = 0;
        const end = Math.min(samples.length, i + size);
        for (let j = i; j < end; j++) sum += samples[j]! * samples[j]!;
        levels.push(Math.sqrt(sum / (end - i)) / 32768);
      }
      const w = encodeWaveform(levels);
      return isWaveform(w) ? w : null;
    } catch {
      return null;
    }
  };

  const fileSize = async (p: string) => (await fs.stat(p)).size;

  /** Фото: поворот по EXIF, без метаданных (геометка), не больше 2560 px; превью 960 px. */
  const processPhoto = async (input: UploadInput, name: string): Promise<ProcessedUpload | null> => {
    let meta: sharp.Metadata;
    try {
      meta = await sharp(input.path, { failOn: 'error' }).metadata();
    } catch {
      return null; // не картинка или формат, который sharp не читает (HEIC без кодека) — пусть будет файлом
    }
    if (!meta.width || !meta.height || !meta.format) return null;
    const animated = (meta.pages ?? 1) > 1;
    const swap = (meta.orientation ?? 1) >= 5;
    const thumb = `thumbs/${hex()}.jpg`;
    await sharp(input.path, { animated: false }).rotate().resize(960, 960, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80, mozjpeg: true }).toFile(join(root, thumb));
    // Анимацию (GIF) и PNG с прозрачностью не пережимаем в JPEG.
    const keep = animated || meta.format === 'gif' || (meta.format === 'png' && meta.hasAlpha);
    let storage: string;
    let mime: string;
    let width = (swap ? meta.height : meta.width) ?? null;
    let height = (swap ? meta.width : meta.height) ?? null;
    let outName = name;
    if (keep) {
      storage = newFileKey(meta.format === 'gif' ? 'gif' : 'png');
      if (meta.format === 'png') await sharp(input.path).rotate().png().toFile(join(root, storage));
      else await fs.copyFile(input.path, join(root, storage));
      mime = meta.format === 'gif' ? 'image/gif' : 'image/png';
    } else {
      storage = newFileKey('jpg');
      const info = await sharp(input.path).rotate().resize(2560, 2560, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toFile(join(root, storage));
      width = info.width;
      height = info.height;
      mime = 'image/jpeg';
      outName = fileExtension(name) === 'jpg' || fileExtension(name) === 'jpeg' ? name : `${name.replace(/\.[^.]+$/, '')}.jpg`;
    }
    return { kind: 'photo', name: safeFileName(outName), mime, size: await fileSize(join(root, storage)), storage_key: storage, thumb_key: thumb, width, height, duration: null, waveform: null };
  };

  /** Сохранить загруженный файл как есть (документ или медиа без обработки). */
  const keepOriginal = async (input: UploadInput, name: string, kind: MediaKind): Promise<ProcessedUpload> => {
    const storage = newFileKey(fileExtension(name));
    await fs.copyFile(input.path, join(root, storage));
    return { kind, name, mime: guessMime(name, input.mime), size: input.size, storage_key: storage, thumb_key: null, width: null, height: null, duration: null, waveform: null };
  };

  const processVideo = async (input: UploadInput, name: string): Promise<ProcessedUpload> => {
    const out = await keepOriginal(input, name, 'video');
    if (!(await hasFfmpeg())) return out;
    try {
      const p = await probe(join(root, out.storage_key));
      if (!p.hasVideo) return { ...out, kind: 'file' };
      return { ...out, width: p.width, height: p.height, duration: p.duration, thumb_key: await poster(join(root, out.storage_key), p.duration) };
    } catch {
      return out;
    }
  };

  /**
   * Голосовое и кружочек из браузера приходят в WebM: его не перемотать, а
   * iPhone его не играет. Пересохраняем в AAC/M4A и квадратный H.264/MP4.
   */
  const processRecording = async (input: UploadInput, name: string, kind: 'voice' | 'video_note'): Promise<ProcessedUpload> => {
    const clientDuration = input.duration != null && Number.isFinite(input.duration) ? round2(Math.min(Math.max(input.duration, 0), kind === 'voice' ? VOICE_MAX_SECONDS : VIDEO_NOTE_MAX_SECONDS)) : null;
    const clientWave = isWaveform(input.waveform) ? input.waveform : null;
    if (!(await hasFfmpeg())) {
      const out = await keepOriginal(input, name, kind);
      return { ...out, duration: clientDuration, waveform: kind === 'voice' ? clientWave : null };
    }
    const outExt = kind === 'voice' ? 'm4a' : 'mp4';
    const storage = newFileKey(outExt);
    const target = join(root, storage);
    const args =
      kind === 'voice'
        ? ['-y', '-v', 'error', '-i', input.path, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', target]
        : [
            '-y', '-v', 'error', '-i', input.path,
            // Кружочек — квадрат: обрезаем по центру, как Telegram.
            '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=480:480",
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', target,
          ];
    try {
      await run(bin('ffmpeg'), args, { timeout: 180_000 });
    } catch {
      await fs.rm(target, { force: true });
      const out = await keepOriginal(input, name, kind);
      return { ...out, duration: clientDuration, waveform: kind === 'voice' ? clientWave : null };
    }
    const p = await probe(target).catch(() => null);
    const base = safeFileName(`${name.replace(/\.[^.]+$/, '')}.${outExt}`);
    return {
      kind,
      name: base,
      mime: kind === 'voice' ? 'audio/mp4' : 'video/mp4',
      size: await fileSize(target),
      storage_key: storage,
      thumb_key: kind === 'video_note' ? await poster(target, p?.duration ?? null) : null,
      width: kind === 'video_note' ? 480 : null,
      height: kind === 'video_note' ? 480 : null,
      duration: p?.duration ?? clientDuration,
      waveform: kind === 'voice' ? (clientWave ?? (await waveOf(target))) : null,
    };
  };

  return {
    root,
    tmpDir: dirs.tmp,
    maxBytes: cfg.maxBytes,
    hasFfmpeg,
    pathOf,

    async process(input) {
      const name = safeFileName(input.originalName);
      if (input.special) return processRecording(input, name, input.special);
      const guess = detectFileKind({ name, mime: input.mime }, { asFile: input.asFile });
      if (guess === 'photo') {
        const photo = await processPhoto(input, name);
        if (photo) return photo;
      }
      if (guess === 'video') return processVideo(input, name);
      return keepOriginal(input, name, 'file');
    },

    async saveAvatar(tmpPath) {
      const k = `avatars/${hex()}.jpg`;
      try {
        await sharp(tmpPath, { failOn: 'error' }).rotate().resize(512, 512, { fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toFile(join(root, k));
      } catch {
        await fs.rm(join(root, k), { force: true });
        throw new Error('not-an-image');
      }
      return k;
    },

    async remove(keys) {
      for (const k of keys) {
        const p = k ? pathOf(k) : null;
        if (p) await fs.rm(p, { force: true }).catch(() => undefined);
      }
    },

    sign(id, userId, nowMs) {
      const exp = fileLinkExpiry(nowMs);
      const sig = createHmac('sha256', key).update(fileLinkPayload(id, exp, userId)).digest('base64url');
      return `/api/v1/files/${id}/raw?e=${exp}&u=${userId}&s=${sig}`;
    },

    verify(id, exp, userId, sig, nowMs) {
      if (typeof exp !== 'string' || typeof userId !== 'string' || typeof sig !== 'string' || !/^\d{1,12}$/.test(exp)) return false;
      if (Number(exp) * 1000 < nowMs) return false;
      const want = createHmac('sha256', key).update(fileLinkPayload(id, Number(exp), userId)).digest();
      const got = Buffer.from(sig, 'base64url');
      return got.length === want.length && timingSafeEqual(got, want);
    },
  };
}

// ---------------------------------------------------------------- строки базы

export interface AttachmentRow {
  id: string;
  company_id: string;
  uploaded_by: string | null;
  owner_type: 'message' | 'task' | 'comment' | 'note' | 'note_share' | 'kb_doc' | null;
  owner_id: string | null;
  position: number;
  kind: MediaKind;
  name: string;
  mime: string;
  size: number | string;
  storage_key: string;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  waveform: string | null;
  created_at: string;
}

export const ATT_COLS = `a.id, a.company_id, a.uploaded_by, a.owner_type, a.owner_id, a.position, a.kind, a.name, a.mime, a.size, a.storage_key, a.thumb_key, a.width, a.height, a.duration, a.waveform, a.created_at`;

/** Вложение для ответа API: ссылка на оригинал подписана для этого человека. */
export function serializeAttachment(store: MediaStore, row: AttachmentRow, viewerId: string, nowMs: number): Attachment {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    width: row.width,
    height: row.height,
    duration: row.duration === null ? null : round2(Number(row.duration)),
    waveform: row.waveform,
    url: store.sign(row.id, viewerId, nowMs),
    thumb_url: row.thumb_key ? `/api/v1/files/${row.thumb_key}` : null,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
  };
}
