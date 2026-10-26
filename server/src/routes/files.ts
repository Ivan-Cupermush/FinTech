import { randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { Router, type Request } from 'express';
import multer from 'multer';
import { formatBytes, isBlockedFile, isWaveform, type Attachment, type AvatarEntry } from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { ApiError, forbidden, invalid, notFound } from '../http/errors';
import { idParam } from '../http/validate';
import type { Realtime } from '../realtime/hub';
import { deleteAttachments, type MediaCtx } from '../services/attachments';
import { ATT_COLS, inlineMime, serializeAttachment, type AttachmentRow, type MediaStore } from '../services/media';
import { loadOrg } from '../services/org';
import { getVisibleTask } from '../services/tasks';
import { getVisibleGoal } from '../services/goals';

/** Имя в заголовке Content-Disposition: латиница — как есть, остальное — в filename*. */
export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Видит ли человек вложение: файл сообщения — участник чата, где сообщение
 * не удалено; файл задачи или комментария — тот, кто видит задачу или цель;
 * черновик — только тот, кто его загрузил.
 */
export async function canViewAttachment(q: Queryable, actor: AuthedActor, a: AttachmentRow): Promise<boolean> {
  if (a.company_id !== actor.company_id) return false;
  if (!a.owner_type) return a.uploaded_by === actor.id;
  // Личная заметка — только владельцу.
  if (a.owner_type === 'note') {
    const { rows } = await q.query(`SELECT 1 FROM personal_notes WHERE id = $1 AND owner_id = $2`, [a.owner_id, actor.id]);
    return rows.length > 0;
  }
  // Снимок заметки в чате — отправителю и участникам чатов, где есть неудалённое сообщение с ней.
  if (a.owner_type === 'note_share') return canViewShare(q, actor, a.owner_id!);
  if (a.owner_type === 'message') {
    const { rows } = await q.query(
      `SELECT 1 FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
        WHERE m.id = $1 AND NOT m.deleted_for_all AND NOT ($2 = ANY(m.deleted_for))`,
      [a.owner_id, actor.id],
    );
    return rows.length > 0;
  }
  try {
    if (a.owner_type === 'task') {
      await getVisibleTask(q, actor, a.owner_id!, await loadOrg(q, actor.company_id));
      return true;
    }
    const c = (await q.query<{ entity_type: 'goal' | 'task'; entity_id: string }>(`SELECT entity_type, entity_id FROM comments WHERE id = $1 AND company_id = $2`, [a.owner_id, actor.company_id])).rows[0];
    if (!c) return false;
    if (c.entity_type === 'goal') await getVisibleGoal(q, actor, c.entity_id);
    else await getVisibleTask(q, actor, c.entity_id, await loadOrg(q, actor.company_id));
    return true;
  } catch {
    return false;
  }
}

/** Пересланную заметку видит отправитель и участник любого чата, куда она попала (в том числе пересылкой). */
export async function canViewShare(q: Queryable, actor: AuthedActor, shareId: string): Promise<boolean> {
  const { rows } = await q.query(
    `SELECT 1 FROM note_shares s
      WHERE s.id = $1 AND s.company_id = $2
        AND (s.sender_id = $3 OR EXISTS (
              SELECT 1 FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $3
               WHERE m.note_share_id = s.id AND NOT m.deleted_for_all AND NOT ($3 = ANY(m.deleted_for))))`,
    [shareId, actor.company_id, actor.id],
  );
  return rows.length > 0;
}

const SAFE_NAME = /^[0-9a-f]{32}\.jpg$/;

/**
 * Отдача файлов без заголовка Authorization — `<img>` и `<video>` его не
 * шлют. Превью и аватары — по случайному имени; оригиналы — по подписанной
 * ссылке на 10–20 минут, пока человек активен. Отдаём с запретом исполнять
 * что-либо (CSP sandbox, nosniff): даже если внутри окажется страница,
 * браузер её не запустит.
 */
export function filesPublicRouter(db: Db, store: MediaStore, now: () => Date): Router {
  const r = Router();

  const sendPublic = (dir: 'thumbs' | 'avatars') => async (req: Request<{ name: string }>, res: import('express').Response) => {
    const name = String(req.params.name);
    const p = SAFE_NAME.test(name) ? store.pathOf(`${dir}/${name}`) : null;
    if (!p || !existsSync(p)) throw notFound('Файл не найден');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(p, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' }, dotfiles: 'deny' });
  };
  r.get('/thumbs/:name', sendPublic('thumbs'));
  r.get('/avatars/:name', sendPublic('avatars'));

  r.get('/:id/raw', async (req, res) => {
    const id = idParam(req.params.id);
    const { e, u, s } = req.query;
    if (!store.verify(id, e, u, s, now().getTime())) throw new ApiError('FORBIDDEN', 'Ссылка на файл устарела — откройте файл ещё раз');
    const { rows } = await db.query<AttachmentRow & { active: boolean }>(
      `SELECT ${ATT_COLS}, usr.active FROM attachments a JOIN company_members cm ON cm.company_id = a.company_id AND cm.user_id = $2 JOIN users usr ON usr.id = cm.user_id WHERE a.id = $1`,
      [id, u],
    );
    const a = rows[0];
    if (!a || !a.active) throw notFound('Файл не найден');
    const p = store.pathOf(a.storage_key);
    if (!p || !existsSync(p)) throw notFound('Файл не найден');
    const inline = inlineMime(a.mime) && req.query.download !== '1';
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', a.name));
    res.sendFile(p, { headers: { 'Content-Type': inline ? a.mime : 'application/octet-stream', 'Cache-Control': 'private, max-age=600' }, dotfiles: 'deny', acceptRanges: true });
  });

  return r;
}

/** multer → промис: ошибки размера и типа становятся понятными ответами API. */
function receive(store: MediaStore, field: string, opts: { imagesOnly?: boolean; maxBytes?: number } = {}) {
  const maxBytes = opts.maxBytes ?? store.maxBytes;
  const upload = multer({
    storage: multer.diskStorage({
      destination: store.tmpDir,
      filename: (_req, _file, cb) => cb(null, `${Date.now()}-${randomBytes(12).toString('hex')}.part`),
    }),
    limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 4096, parts: 12 },
    fileFilter: (_req, file, cb) => {
      file.originalname = fixName(file.originalname);
      if (isBlockedFile(file.originalname, file.mimetype)) return cb(invalid('Не удалось загрузить файл', { file: 'Такой тип файла загрузить нельзя: страницы, скрипты и программы запрещены' }));
      if (opts.imagesOnly && !file.mimetype.startsWith('image/')) return cb(invalid('Не удалось загрузить фото', { file: 'Выберите фото в формате JPG или PNG' }));
      cb(null, true);
    },
  }).single(field);
  return (req: Request, res: import('express').Response) =>
    new Promise<Express.Multer.File>((resolve, reject) => {
      upload(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') return reject(new ApiError('PAYLOAD_TOO_LARGE', `Файл больше ${formatBytes(maxBytes)}`));
          return reject(new ApiError('BAD_REQUEST', 'Некорректная загрузка файла'));
        }
        if (err) return reject(err);
        if (!req.file) return reject(invalid('Не удалось загрузить файл', { file: 'Выберите файл' }));
        resolve(req.file);
      });
    });
}

/** multer читает имя файла как latin1 — русские имена превращаются в кракозябры. */
export function fixName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

/**
 * Загрузка и выдача файлов: `/api/v1/files`. Файл сначала становится
 * черновиком (его видит только автор), а сообщение, задача или комментарий
 * затем прикрепляют его по id — так прогресс загрузки не мешает отправке.
 */
export function filesRouter(db: Db, { store, now }: MediaCtx, rt: Realtime): Router {
  const r = Router();
  const one = receive(store, 'file');
  const avatar = receive(store, 'file', { imagesOnly: true, maxBytes: Math.min(store.maxBytes, 20 * 1024 * 1024) });

  // ------------------------------------------------------------ фото профиля (до /:id)

  /** Фото профиля: квадрат 512 px без метаданных. Прежнее фото удаляется. */
  r.post('/avatar', async (req, res) => {
    const actor = actorOf(req);
    const file = await avatar(req, res);
    try {
      let key: string;
      try {
        key = await store.saveAvatar(file.path);
      } catch {
        throw invalid('Не удалось загрузить фото', { file: 'Не получилось прочитать фото — выберите снимок в формате JPG или PNG' });
      }
      const url = `/api/v1/files/${key}`;
      const old = (await db.query<{ avatar_url: string | null }>(`SELECT avatar_url FROM users WHERE id = $1`, [actor.id])).rows[0]?.avatar_url;
      await db.query(`UPDATE users SET avatar_url = $2 WHERE id = $1`, [actor.id, url]);
      await removeAvatar(store, old);
      rt.emitCompany(actor.company_id, 'avatar_changed', { user_id: actor.id, avatar_url: url });
      res.json({ data: { avatar_url: url } });
    } finally {
      await fs.rm(file.path, { force: true }).catch(() => undefined);
    }
  });

  r.delete('/avatar', async (req, res) => {
    const actor = actorOf(req);
    const old = (await db.query<{ avatar_url: string | null }>(`SELECT avatar_url FROM users WHERE id = $1`, [actor.id])).rows[0]?.avatar_url;
    await db.query(`UPDATE users SET avatar_url = NULL WHERE id = $1`, [actor.id]);
    await removeAvatar(store, old);
    rt.emitCompany(actor.company_id, 'avatar_changed', { user_id: actor.id, avatar_url: null });
    res.status(204).end();
  });

  /** Фото коллег одним списком: клиент рисует аватар по id везде, где есть человек. */
  r.get('/avatars', async (req, res) => {
    const actor = actorOf(req);
    const { rows } = await db.query<AvatarEntry>(
      `SELECT u.id, u.display_name, u.avatar_url FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $1 WHERE u.avatar_url IS NOT NULL ORDER BY u.display_name`,
      [actor.company_id],
    );
    res.json({ data: rows });
  });

  // ------------------------------------------------------------ вложения

  r.post('/', async (req, res) => {
    const actor = actorOf(req);
    const file = await one(req, res);
    try {
      const special = req.body?.kind === 'voice' || req.body?.kind === 'video_note' ? (req.body.kind as 'voice' | 'video_note') : undefined;
      const waveform = typeof req.body?.waveform === 'string' && isWaveform(req.body.waveform) ? req.body.waveform : null;
      const duration = typeof req.body?.duration === 'string' && /^\d{1,5}(\.\d+)?$/.test(req.body.duration) ? Number(req.body.duration) : null;
      const asFile = req.body?.as_file === '1' || req.body?.as_file === 'true';
      const p = await store.process({ path: file.path, originalName: file.originalname, mime: file.mimetype, size: file.size, asFile, special, waveform, duration });
      const { rows } = await db.query<AttachmentRow>(
        `INSERT INTO attachments (company_id, uploaded_by, kind, name, mime, size, storage_key, thumb_key, width, height, duration, waveform, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING ${ATT_COLS.replace(/a\./g, '')}`,
        [actor.company_id, actor.id, p.kind, p.name, p.mime, p.size, p.storage_key, p.thumb_key, p.width, p.height, p.duration, p.waveform, now().toISOString()],
      );
      const data: Attachment = serializeAttachment(store, rows[0]!, actor.id, now().getTime());
      res.status(201).json({ data });
    } finally {
      await fs.rm(file.path, { force: true }).catch(() => undefined);
    }
  });

  /** Свежая ссылка на файл (прежняя устарела) — если человек всё ещё его видит. */
  r.get('/:id', async (req, res) => {
    const actor = actorOf(req);
    const a = (await db.query<AttachmentRow>(`SELECT ${ATT_COLS} FROM attachments a WHERE a.id = $1 AND a.company_id = $2`, [idParam(req.params.id), actor.company_id])).rows[0];
    if (!a || !(await canViewAttachment(db, actor, a))) throw notFound('Файл не найден');
    res.json({ data: serializeAttachment(store, a, actor.id, now().getTime()) });
  });

  /** Отменить загрузку: удалить свой неотправленный черновик. */
  r.delete('/:id', async (req, res) => {
    const actor = actorOf(req);
    const a = (await db.query<AttachmentRow>(`SELECT ${ATT_COLS} FROM attachments a WHERE a.id = $1 AND a.company_id = $2`, [idParam(req.params.id), actor.company_id])).rows[0];
    if (!a || a.uploaded_by !== actor.id) throw notFound('Файл не найден');
    if (a.owner_type) throw forbidden('Файл уже отправлен — удалите сообщение или вложение');
    await deleteAttachments(db, store, { attachmentIds: [a.id] });
    res.status(204).end();
  });

  return r;
}

async function removeAvatar(store: MediaStore, url: string | null | undefined) {
  const m = url ? /\/files\/(avatars\/[0-9a-f]{32}\.jpg)$/.exec(url) : null;
  if (m) await store.remove([m[1]]);
}

