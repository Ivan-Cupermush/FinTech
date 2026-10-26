import type { Attachment, MediaKind } from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import type { Queryable } from '../db/db';
import { invalid } from '../http/errors';
import { ATT_COLS, serializeAttachment, type AttachmentRow, type MediaStore } from './media';

export type OwnerType = 'message' | 'task' | 'comment';

/** Хранилище и часы — чтобы подписывать ссылки на файлы в ответах API. */
export interface MediaCtx {
  store: MediaStore;
  now: () => Date;
}

/** Вложения нескольких владельцев разом, в порядке отправки. */
export async function loadAttachments(q: Queryable, ownerType: OwnerType, ownerIds: string[]): Promise<Map<string, AttachmentRow[]>> {
  const out = new Map<string, AttachmentRow[]>();
  if (!ownerIds.length) return out;
  const { rows } = await q.query<AttachmentRow>(`SELECT ${ATT_COLS} FROM attachments a WHERE a.owner_type = $1 AND a.owner_id = ANY($2::uuid[]) ORDER BY a.position, a.created_at`, [
    ownerType,
    ownerIds,
  ]);
  for (const r of rows) out.set(r.owner_id!, [...(out.get(r.owner_id!) ?? []), r]);
  return out;
}

export const serializeAll = (m: MediaCtx, rows: AttachmentRow[] | undefined, viewerId: string): Attachment[] =>
  (rows ?? []).map((r) => serializeAttachment(m.store, r, viewerId, m.now().getTime()));

/**
 * Прикрепить свои черновики к сообщению, задаче или комментарию. Чужие,
 * уже прикреплённые и из другой компании — «не найдено»: id вложения не
 * даёт доступа к чужому файлу.
 */
export async function claimDrafts(
  q: Queryable,
  actor: AuthedActor,
  ids: string[],
  owner: { type: OwnerType; id: string },
  opts: { message: string; field?: string; startAt?: number } = { message: 'Не удалось прикрепить файлы' },
): Promise<AttachmentRow[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const { rows } = await q.query<AttachmentRow>(
    `SELECT ${ATT_COLS} FROM attachments a WHERE a.id = ANY($1::uuid[]) AND a.company_id = $2 AND a.uploaded_by = $3 AND a.owner_id IS NULL FOR UPDATE`,
    [unique, actor.company_id, actor.id],
  );
  if (rows.length !== unique.length) throw invalid(opts.message, { [opts.field ?? 'attachment_ids']: 'Файл не найден — загрузите его ещё раз' });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = unique.map((id) => byId.get(id)!);
  for (const [i, r] of ordered.entries()) {
    await q.query(`UPDATE attachments SET owner_type = $2, owner_id = $3, position = $4 WHERE id = $1`, [r.id, owner.type, owner.id, (opts.startAt ?? 0) + i]);
    r.owner_type = owner.type;
    r.owner_id = owner.id;
    r.position = (opts.startAt ?? 0) + i;
  }
  return ordered;
}

/** Пересылка: новые записи на те же файлы — исходник можно удалить, копия останется. */
export async function copyAttachments(q: Queryable, from: { type: OwnerType; id: string }, to: { type: OwnerType; id: string }, uploaderId: string): Promise<void> {
  await q.query(
    `INSERT INTO attachments (company_id, uploaded_by, owner_type, owner_id, position, kind, name, mime, size, storage_key, thumb_key, width, height, duration, waveform)
     SELECT company_id, $4, $3, $5, position, kind, name, mime, size, storage_key, thumb_key, width, height, duration, waveform
       FROM attachments WHERE owner_type = $1 AND owner_id = $2`,
    [from.type, from.id, to.type, uploaderId, to.id],
  );
}

/**
 * Удалить вложения владельцев. Файл на диске стирается, когда на него больше
 * не ссылается ни одна запись (пересланная копия держит файл).
 */
export async function deleteAttachments(q: Queryable, store: MediaStore, where: { type: OwnerType; ids: string[] } | { attachmentIds: string[] }): Promise<number> {
  const { rows } =
    'attachmentIds' in where
      ? await q.query<{ storage_key: string; thumb_key: string | null }>(`DELETE FROM attachments WHERE id = ANY($1::uuid[]) RETURNING storage_key, thumb_key`, [where.attachmentIds])
      : await q.query<{ storage_key: string; thumb_key: string | null }>(`DELETE FROM attachments WHERE owner_type = $1 AND owner_id = ANY($2::uuid[]) RETURNING storage_key, thumb_key`, [
          where.type,
          where.ids,
        ]);
  if (!rows.length) return 0;
  const keys = [...new Set(rows.map((r) => r.storage_key))];
  const still = new Set(
    (await q.query<{ storage_key: string }>(`SELECT DISTINCT storage_key FROM attachments WHERE storage_key = ANY($1::text[])`, [keys])).rows.map((r) => r.storage_key),
  );
  const thumbs = [...new Set(rows.map((r) => r.thumb_key).filter((t): t is string => !!t))];
  const thumbsStill = new Set(
    thumbs.length ? (await q.query<{ thumb_key: string }>(`SELECT DISTINCT thumb_key FROM attachments WHERE thumb_key = ANY($1::text[])`, [thumbs])).rows.map((r) => r.thumb_key) : [],
  );
  await store.remove([...keys.filter((k) => !still.has(k)), ...thumbs.filter((t) => !thumbsStill.has(t))]);
  return rows.length;
}

/** Черновики, которые так и не отправили, — через сутки удаляются вместе с файлами. */
export async function sweepDrafts(q: Queryable, store: MediaStore, at: Date, maxAgeHours = 24): Promise<number> {
  const { rows } = await q.query<{ id: string }>(`SELECT id FROM attachments WHERE owner_id IS NULL AND created_at < $1 LIMIT 500`, [new Date(at.getTime() - maxAgeHours * 3_600_000).toISOString()]);
  return rows.length ? deleteAttachments(q, store, { attachmentIds: rows.map((r) => r.id) }) : 0;
}

/** Каким станет сообщение по набору вложений: голосовое и кружочек — только поодиночке. */
export function messageKindFor(kinds: MediaKind[]): 'media' | 'voice' | 'video_note' | null {
  if (!kinds.length) return null;
  const special = kinds.filter((k) => k === 'voice' || k === 'video_note');
  if (special.length) return kinds.length === 1 ? (special[0] as 'voice' | 'video_note') : null;
  return 'media';
}
