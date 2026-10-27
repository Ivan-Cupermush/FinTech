import { Router } from 'express';
import { z } from 'zod';
import {
  MESSAGE_MAX,
  MY_NOTE_LIMITS,
  freeCopyTitle,
  isBlankNote,
  isIsoDay,
  isIsoMonth,
  myNoteSummary,
  noteTitle,
  notePdfName,
  searchWords,
  todayIso,
  validateMyNote,
  type MyNote,
  type MyNoteDay,
  type NoteRequestState,
  type NoteRequestView,
  type NoteShareView,
} from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { ApiError, forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { claimDrafts, copyAttachments, deleteAttachments, loadAttachments, serializeAll } from '../services/attachments';
import { MSG_SELECT, broadcastMessage, hydrate, insertMessage, openChat, resolveTopic, type MessageRow } from '../services/chats';
import { notify } from '../services/notify';
import { renderNotePdf } from '../services/note-pdf';
import { canViewShare, contentDisposition } from './files';
import type { ChatDeps } from './chats';

interface NoteRow {
  id: string;
  owner_id: string;
  title: string;
  body: string;
  note_date: string;
  is_favorite: boolean;
  files_count: number;
  created_at: string;
  updated_at: string;
}

const NOTE_COLS = `n.id, n.owner_id, n.title, n.body, n.note_date, n.is_favorite, n.created_at, n.updated_at,
  (SELECT COUNT(*)::int FROM attachments a WHERE a.owner_type = 'note' AND a.owner_id = n.id) AS files_count`;

const MSG = 'Не удалось сохранить заметку';
const uuid = z.string().refine(isUuid);
const createSchema = z.object({
  title: z.string().max(1000).default(''),
  body: z.string().max(100_000).default(''),
  note_date: z.string().max(20).optional(),
  is_favorite: z.boolean().default(false),
  attachment_ids: z.array(uuid).max(MY_NOTE_LIMITS.files).optional(),
});
const patchSchema = z.object({
  title: z.string().max(1000).optional(),
  body: z.string().max(100_000).optional(),
  note_date: z.string().max(20).optional(),
  is_favorite: z.boolean().optional(),
});
const shareSchema = z.object({
  chat_id: uuid,
  topic_id: uuid.nullable().optional(),
  text: z.string().max(MESSAGE_MAX + 1000).default(''),
  client_id: z.string().min(1).max(64).optional(),
});

/** Своя заметка; чужая и несуществующая — 404, не подтверждаем, что она есть. */
async function ownNote(q: Queryable, actor: AuthedActor, id: string, lock = false): Promise<NoteRow> {
  const { rows } = await q.query<NoteRow>(`SELECT ${NOTE_COLS} FROM personal_notes n WHERE n.id = $1 AND n.owner_id = $2 AND n.company_id = $3${lock ? ' FOR UPDATE' : ''}`, [id, actor.id, actor.company_id]);
  if (!rows[0]) throw notFound('Заметка не найдена');
  return rows[0];
}

async function takenTitles(q: Queryable, ownerId: string, base: string): Promise<string[]> {
  const t = noteTitle(base);
  const { rows } = await q.query<{ title: string }>(`SELECT title FROM personal_notes WHERE owner_id = $1 AND (title = $2 OR left(title, char_length($2) + 2) = $2 || ' (' OR ($2 = 'Без названия' AND title = ''))`, [ownerId, t]);
  return rows.map((r) => r.title);
}

/** Заметка-копия у человека: текст и файлы (записи на те же файлы на диске). */
async function copyNoteTo(q: Queryable, actor: { id: string; company_id: string }, src: { title: string; body: string }, files: { type: 'note' | 'note_share'; id: string }, at: string, opts: { exactTitle?: boolean } = {}): Promise<string> {
  const title = opts.exactTitle ? src.title : freeCopyTitle(src.title, await takenTitles(q, actor.id, src.title));
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO personal_notes (company_id, owner_id, title, body, note_date, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
    [actor.company_id, actor.id, title, src.body, at.slice(0, 10), at],
  );
  await copyAttachments(q, files, { type: 'note', id: rows[0]!.id }, actor.id);
  return rows[0]!.id;
}

interface ShareRow {
  id: string;
  company_id: string;
  note_id: string | null;
  sender_id: string | null;
  sender_name: string | null;
  title: string;
  body: string;
  created_at: string;
  original_exists: boolean;
}

async function visibleShare(q: Queryable, actor: AuthedActor, id: string): Promise<ShareRow> {
  if (!(await canViewShare(q, actor, id))) throw notFound('Заметка не найдена');
  const { rows } = await q.query<ShareRow>(
    `SELECT s.id, s.company_id, s.note_id, s.sender_id, u.display_name AS sender_name, s.title, s.body, s.created_at, s.note_id IS NOT NULL AS original_exists
       FROM note_shares s LEFT JOIN users u ON u.id = s.sender_id WHERE s.id = $1`,
    [id],
  );
  return rows[0]!;
}

interface RequestRow {
  id: string;
  share_id: string;
  requester_id: string;
  owner_id: string;
  note_id: string | null;
  status: NoteRequestState['status'];
  result_note_id: string | null;
  created_at: string;
  resolved_at: string | null;
  shared_title: string;
  shared_at: string;
  note_title: string | null;
  note_body: string | null;
  note_updated_at: string | null;
  note_files: number | null;
  requester_name: string;
  owner_name: string;
}

async function loadRequest(q: Queryable, actor: AuthedActor, id: string, lock = false): Promise<RequestRow> {
  const { rows } = await q.query<RequestRow>(
    `SELECT r.id, r.share_id, r.requester_id, r.owner_id, r.note_id, r.status, r.result_note_id, r.created_at, r.resolved_at,
            s.title AS shared_title, s.created_at AS shared_at, n.title AS note_title, n.body AS note_body, n.updated_at AS note_updated_at,
            (SELECT COUNT(*)::int FROM attachments a WHERE a.owner_type = 'note' AND a.owner_id = n.id) AS note_files,
            rq.display_name AS requester_name, ow.display_name AS owner_name
       FROM note_share_requests r
       JOIN note_shares s ON s.id = r.share_id
       LEFT JOIN personal_notes n ON n.id = r.note_id
       JOIN users rq ON rq.id = r.requester_id
       JOIN users ow ON ow.id = r.owner_id
      WHERE r.id = $1 AND r.company_id = $2 AND (r.owner_id = $3 OR r.requester_id = $3)${lock ? ' FOR UPDATE OF r' : ''}`,
    [id, actor.company_id, actor.id],
  );
  if (!rows[0]) throw notFound('Запрос не найден');
  return rows[0];
}

const requestState = (r: Pick<RequestRow, 'id' | 'status' | 'result_note_id' | 'created_at' | 'resolved_at'>, forOwner: boolean): NoteRequestState => ({
  id: r.id,
  status: r.status,
  result_note_id: forOwner ? null : r.result_note_id,
  created_at: r.created_at,
  resolved_at: r.resolved_at,
});

/** Автор видит, чем поделится; запросивший — только название. */
function requestView(r: RequestRow, viewerId: string): NoteRequestView {
  const isOwner = r.owner_id === viewerId;
  return {
    ...requestState(r, isOwner),
    is_owner: isOwner,
    requester: { id: r.requester_id, name: r.requester_name },
    owner: { id: r.owner_id, name: r.owner_name },
    shared: { id: r.share_id, title: noteTitle(r.shared_title), created_at: r.shared_at },
    note:
      r.note_title !== null
        ? {
            id: isOwner ? r.note_id : null,
            title: noteTitle(r.note_title),
            preview: isOwner ? (r.note_body ?? '').slice(0, 600) : null,
            files_count: isOwner ? r.note_files : null,
            updated_at: r.note_updated_at!,
            changed_since_share: Date.parse(r.note_updated_at!) > Date.parse(r.shared_at),
          }
        : null,
  };
}

/** Ответили на запрос — его уведомление больше не «новое». */
const markRequestRead = (q: Queryable, userId: string, requestId: string) =>
  q.query(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND kind = 'note_request' AND read_at IS NULL AND data->>'request_id' = $2`, [userId, requestId]);

/**
 * Личные заметки: `/api/v1/my-notes`. Видит и меняет только владелец —
 * даже администратор чужие заметки не открывает. В чат уходит снимок.
 */
export function myNotesRouter({ db, now, rt, media, onMessage }: ChatDeps): Router {
  const r = Router();
  const at = () => now().toISOString();
  const today = () => todayIso(now());

  const full = async (q: Queryable, actor: AuthedActor, n: NoteRow): Promise<MyNote> => {
    const atts = await loadAttachments(q, 'note', [n.id]);
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      note_date: n.note_date,
      is_favorite: n.is_favorite,
      files_count: n.files_count,
      created_at: n.created_at,
      updated_at: n.updated_at,
      attachments: serializeAll(media, atts.get(n.id), actor.id),
    };
  };

  // ------------------------------------------------------------ списки

  /** ?month=ГГГГ-ММ, ?date=ГГГГ-ММ-ДД, ?favorite=1, ?q=слова. Без фильтров — последние изменённые. */
  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const { month, date, favorite, q: query = '' } = req.query as Record<string, string | undefined>;
    const where = ['n.owner_id = $1', 'n.company_id = $2'];
    const args: unknown[] = [actor.id, actor.company_id];
    if (month !== undefined) {
      if (!isIsoMonth(month)) throw invalid('Некорректный фильтр', { month: 'Месяц в формате ГГГГ-ММ' });
      args.push(`${month}-01`);
      where.push(`n.note_date >= $${args.length}::date AND n.note_date < ($${args.length}::date + INTERVAL '1 month')`);
    }
    if (date !== undefined) {
      if (!isIsoDay(date)) throw invalid('Некорректный фильтр', { date: 'День в формате ГГГГ-ММ-ДД' });
      args.push(date);
      where.push(`n.note_date = $${args.length}::date`);
    }
    if (favorite === '1' || favorite === 'true') where.push('n.is_favorite');
    const words = searchWords(String(query));
    for (const w of words) {
      args.push(`%${w}%`);
      where.push(`(lower(n.title) LIKE $${args.length} OR lower(n.body) LIKE $${args.length})`);
    }
    const { rows } = await db.query<NoteRow>(`SELECT ${NOTE_COLS} FROM personal_notes n WHERE ${where.join(' AND ')} ORDER BY n.is_favorite DESC, n.updated_at DESC, n.id LIMIT 300`, args);
    res.json({ data: rows.map((n) => myNoteSummary(n, words[0] ?? '')) });
  });

  /** Дни месяца с заметками — точки в календаре. */
  r.get('/days', async (req, res) => {
    const actor = actorOf(req);
    const month = String(req.query.month ?? '');
    if (!isIsoMonth(month)) throw invalid('Некорректный фильтр', { month: 'Месяц в формате ГГГГ-ММ' });
    const { rows } = await db.query<MyNoteDay>(
      `SELECT to_char(note_date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count FROM personal_notes
        WHERE owner_id = $1 AND company_id = $2 AND note_date >= $3::date AND note_date < ($3::date + INTERVAL '1 month')
        GROUP BY note_date ORDER BY note_date`,
      [actor.id, actor.company_id, `${month}-01`],
    );
    res.json({ data: rows });
  });

  // ------------------------------------------------------------ пересланные заметки и запросы (до /:id)

  r.get('/shared/:id', async (req, res) => {
    const actor = actorOf(req);
    const s = await visibleShare(db, actor, idParam(req.params.id));
    const isOwner = s.sender_id === actor.id;
    const [acc, reqs, atts] = await Promise.all([
      db.query<{ note_id: string }>(`SELECT a.note_id FROM note_share_acceptances a JOIN personal_notes n ON n.id = a.note_id WHERE a.share_id = $1 AND a.user_id = $2`, [s.id, actor.id]),
      db.query<RequestRow>(`SELECT id, status, result_note_id, created_at, resolved_at FROM note_share_requests WHERE share_id = $1 AND requester_id = $2 ORDER BY created_at DESC LIMIT 1`, [s.id, actor.id]),
      loadAttachments(db, 'note_share', [s.id]),
    ]);
    const data: NoteShareView = {
      id: s.id,
      title: noteTitle(s.title),
      body: s.body,
      attachments: serializeAll(media, atts.get(s.id), actor.id),
      sender_id: s.sender_id,
      sender_name: s.sender_name,
      created_at: s.created_at,
      is_owner: isOwner,
      accepted_note_id: acc.rows[0]?.note_id ?? null,
      original_note_id: isOwner ? s.note_id : null,
      original_exists: s.original_exists,
      my_request: reqs.rows[0] ? requestState(reqs.rows[0], false) : null,
    };
    res.json({ data });
  });

  /** Сохранить пересланную заметку к себе: копия на сегодня, повторно — та же копия. */
  r.post('/shared/:id/accept', async (req, res) => {
    const actor = actorOf(req);
    const shareId = idParam(req.params.id);
    const noteId = await db.tx(async (q) => {
      const s = await visibleShare(q, actor, shareId);
      const prev = await q.query<{ note_id: string }>(`SELECT a.note_id FROM note_share_acceptances a JOIN personal_notes n ON n.id = a.note_id WHERE a.share_id = $1 AND a.user_id = $2`, [s.id, actor.id]);
      if (prev.rows[0]) return prev.rows[0].note_id;
      const id = await copyNoteTo(q, actor, { title: s.title, body: s.body }, { type: 'note_share', id: s.id }, at());
      await q.query(
        `INSERT INTO note_share_acceptances (share_id, user_id, note_id, accepted_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (share_id, user_id) DO UPDATE SET note_id = EXCLUDED.note_id, accepted_at = EXCLUDED.accepted_at`,
        [s.id, actor.id, id, at()],
      );
      return id;
    });
    res.status(201).json({ data: await full(db, actor, await ownNote(db, actor, noteId)) });
  });

  /** Попросить у автора свежую версию. Пока он не ответил, повторный запрос не дублируется. */
  r.post('/shared/:id/request', async (req, res) => {
    const actor = actorOf(req);
    const shareId = idParam(req.params.id);
    const out = await db.tx(async (q): Promise<{ state: NoteRequestState; already: boolean; owner?: string }> => {
      const s = await visibleShare(q, actor, shareId);
      if (s.sender_id === actor.id) throw new ApiError('CONFLICT', 'Это ваша заметка — свежая версия у вас в заметках');
      if (!s.note_id || !s.sender_id) throw new ApiError('CONFLICT', 'Автор удалил эту заметку — свежей версии больше нет');
      const owner = (await q.query<{ active: boolean }>(`SELECT u.active FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $2 WHERE u.id = $1`, [s.sender_id, actor.company_id])).rows[0];
      if (!owner?.active) throw new ApiError('CONFLICT', 'Автор заметки больше не работает в компании');
      const existing = await q.query<RequestRow>(`SELECT id, status, result_note_id, created_at, resolved_at FROM note_share_requests WHERE share_id = $1 AND requester_id = $2 AND status = 'pending'`, [s.id, actor.id]);
      if (existing.rows[0]) return { state: requestState(existing.rows[0], false), already: true };
      const { rows } = await q.query<RequestRow>(
        `INSERT INTO note_share_requests (company_id, share_id, requester_id, owner_id, note_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, status, result_note_id, created_at, resolved_at`,
        [actor.company_id, s.id, actor.id, s.sender_id, s.note_id, at()],
      );
      const title = noteTitle((await q.query<{ title: string }>(`SELECT title FROM personal_notes WHERE id = $1`, [s.note_id])).rows[0]?.title ?? s.title);
      await notify(q, { company_id: actor.company_id, user_id: s.sender_id, kind: 'note_request', title: `${actor.display_name} просит свежую версию заметки`, body: title, data: { request_id: rows[0]!.id, share_id: s.id } }, actor.id);
      return { state: requestState(rows[0]!, false), already: false, owner: s.sender_id };
    });
    if (!out.already && out.owner) rt.emit(actor.company_id, [out.owner], 'notification', { kind: 'note_request' });
    res.status(out.already ? 200 : 201).json({ data: { ...out.state, already: out.already } });
  });

  r.get('/requests/:id', async (req, res) => {
    const actor = actorOf(req);
    res.json({ data: requestView(await loadRequest(db, actor, idParam(req.params.id)), actor.id) });
  });

  /** Поделиться свежей версией: у запросившего появляется новая копия «Название (2)». */
  r.post('/requests/:id/approve', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    await db.tx(async (q) => {
      const rq = await loadRequest(q, actor, id, true);
      if (rq.owner_id !== actor.id) throw forbidden('Ответить на запрос может только автор заметки');
      if (rq.status !== 'pending') return;
      if (!rq.note_id || rq.note_title === null) throw new ApiError('CONFLICT', 'Заметка удалена — делиться нечем');
      const requester = (await q.query<{ id: string; company_id: string }>(`SELECT user_id AS id, company_id FROM company_members WHERE user_id = $1 AND company_id = $2`, [rq.requester_id, actor.company_id])).rows[0];
      if (!requester) throw new ApiError('CONFLICT', 'Сотрудник больше не работает в компании');
      const copy = await copyNoteTo(q, requester, { title: rq.note_title, body: rq.note_body ?? '' }, { type: 'note', id: rq.note_id }, at());
      await q.query(`UPDATE note_share_requests SET status = 'approved', result_note_id = $2, resolved_at = $3 WHERE id = $1`, [rq.id, copy, at()]);
      const title = (await q.query<{ title: string }>(`SELECT title FROM personal_notes WHERE id = $1`, [copy])).rows[0]!.title;
      await notify(q, { company_id: actor.company_id, user_id: rq.requester_id, kind: 'note_request_approved', title: `${actor.display_name} поделился свежей версией`, body: noteTitle(title), data: { request_id: rq.id, note_id: copy } }, actor.id);
      await markRequestRead(q, actor.id, rq.id);
    });
    const done = await loadRequest(db, actor, id);
    rt.emit(actor.company_id, [done.requester_id], 'notification', { kind: 'note_request_approved' });
    res.json({ data: requestView(done, actor.id) });
  });

  r.post('/requests/:id/decline', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    await db.tx(async (q) => {
      const rq = await loadRequest(q, actor, id, true);
      if (rq.owner_id !== actor.id) throw forbidden('Ответить на запрос может только автор заметки');
      if (rq.status !== 'pending') return;
      await q.query(`UPDATE note_share_requests SET status = 'declined', resolved_at = $2 WHERE id = $1`, [rq.id, at()]);
      await notify(q, { company_id: actor.company_id, user_id: rq.requester_id, kind: 'note_request_declined', title: `${actor.display_name} не стал делиться новой версией`, body: noteTitle(rq.note_title ?? rq.shared_title), data: { request_id: rq.id, share_id: rq.share_id } }, actor.id);
      await markRequestRead(q, actor.id, rq.id);
    });
    const done = await loadRequest(db, actor, id);
    rt.emit(actor.company_id, [done.requester_id], 'notification', { kind: 'note_request_declined' });
    res.json({ data: requestView(done, actor.id) });
  });

  // ------------------------------------------------------------ одна заметка

  r.get('/:id', async (req, res) => {
    const actor = actorOf(req);
    res.json({ data: await full(db, actor, await ownNote(db, actor, idParam(req.params.id))) });
  });

  r.post('/', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(createSchema, req.body);
    const errors = validateMyNote(body);
    if (Object.keys(errors).length) throw invalid(MSG, errors);
    const files = body.attachment_ids ?? [];
    if (isBlankNote({ ...body, files: files.length })) throw invalid(MSG, { body: 'Напишите что-нибудь или прикрепите файл' });
    const note = await db.tx(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO personal_notes (company_id, owner_id, title, body, note_date, is_favorite, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
        [actor.company_id, actor.id, body.title.trim(), body.body, body.note_date ?? today(), body.is_favorite, at()],
      );
      if (files.length) await claimDrafts(q, actor, files, { type: 'note', id: rows[0]!.id }, { message: MSG });
      return ownNote(q, actor, rows[0]!.id);
    });
    res.status(201).json({ data: await full(db, actor, note) });
  });

  r.patch('/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(patchSchema, req.body);
    const errors = validateMyNote(body);
    if (Object.keys(errors).length) throw invalid(MSG, errors);
    const note = await db.tx(async (q) => {
      const n = await ownNote(q, actor, id, true);
      const next = { title: body.title?.trim() ?? n.title, body: body.body ?? n.body, note_date: body.note_date ?? n.note_date, is_favorite: body.is_favorite ?? n.is_favorite };
      // Только «в избранное» — не правка текста: порядок «последние изменённые» не прыгает.
      const contentChanged = next.title !== n.title || next.body !== n.body || next.note_date !== n.note_date;
      await q.query(`UPDATE personal_notes SET title = $2, body = $3, note_date = $4, is_favorite = $5, updated_at = CASE WHEN $6 THEN $7::timestamptz ELSE updated_at END WHERE id = $1`, [
        id,
        next.title,
        next.body,
        next.note_date,
        next.is_favorite,
        contentChanged,
        at(),
      ]);
      return ownNote(q, actor, id);
    });
    res.json({ data: await full(db, actor, note) });
  });

  r.delete('/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    await db.tx(async (q) => {
      await ownNote(q, actor, id, true);
      // Файлы на диске остаются, пока на них ссылаются копии (пересланные снимки, принятые заметки).
      await deleteAttachments(q, media.store, { type: 'note', ids: [id] });
      await q.query(`DELETE FROM personal_notes WHERE id = $1`, [id]);
    });
    res.status(204).end();
  });

  /** Копия заметки с теми же файлами — на тот же или другой день. */
  r.post('/:id/duplicate', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ note_date: z.string().max(20).optional() }), req.body);
    if (body.note_date !== undefined && !isIsoDay(body.note_date)) throw invalid('Не удалось скопировать заметку', { note_date: 'Выберите день в календаре' });
    const id = idParam(req.params.id);
    const copy = await db.tx(async (q) => {
      const src = await ownNote(q, actor, id);
      const newId = await copyNoteTo(q, actor, { title: src.title.trim() ? `${src.title} (копия)`.slice(0, MY_NOTE_LIMITS.title) : '', body: src.body }, { type: 'note', id: src.id }, at(), { exactTitle: true });
      await q.query(`UPDATE personal_notes SET note_date = $2 WHERE id = $1`, [newId, body.note_date ?? src.note_date]);
      return ownNote(q, actor, newId);
    });
    res.status(201).json({ data: await full(db, actor, copy) });
  });

  /** Прикрепить загруженные черновики (через /files). Не больше 20 файлов на заметку. */
  r.post('/:id/files', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(z.object({ attachment_ids: z.array(uuid).min(1).max(MY_NOTE_LIMITS.files) }), req.body);
    const note = await db.tx(async (q) => {
      const n = await ownNote(q, actor, id, true);
      if (n.files_count + new Set(body.attachment_ids).size > MY_NOTE_LIMITS.files) throw invalid('Не удалось прикрепить файлы', { attachment_ids: `К заметке можно прикрепить не больше ${MY_NOTE_LIMITS.files} файлов` });
      const maxPos = (await q.query<{ p: number | null }>(`SELECT MAX(position) AS p FROM attachments WHERE owner_type = 'note' AND owner_id = $1`, [id])).rows[0]?.p ?? -1;
      await claimDrafts(q, actor, body.attachment_ids, { type: 'note', id }, { message: 'Не удалось прикрепить файлы', startAt: maxPos + 1 });
      await q.query(`UPDATE personal_notes SET updated_at = $2 WHERE id = $1`, [id, at()]);
      return ownNote(q, actor, id);
    });
    res.status(201).json({ data: await full(db, actor, note) });
  });

  r.delete('/:id/files/:fileId', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const fileId = idParam(req.params.fileId);
    await db.tx(async (q) => {
      await ownNote(q, actor, id, true);
      const { rows } = await q.query(`SELECT 1 FROM attachments WHERE id = $1 AND owner_type = 'note' AND owner_id = $2`, [fileId, id]);
      if (!rows.length) throw notFound('Файл не найден');
      await deleteAttachments(q, media.store, { attachmentIds: [fileId] });
      await q.query(`UPDATE personal_notes SET updated_at = $2 WHERE id = $1`, [id, at()]);
    });
    res.status(204).end();
  });

  /** PDF — по токену в заголовке: сайт и приложение скачивают его своим запросом, публичной ссылки нет. */
  r.get('/:id/pdf', async (req, res) => {
    const actor = actorOf(req);
    const n = await ownNote(db, actor, idParam(req.params.id));
    const [files, company] = await Promise.all([
      loadAttachments(db, 'note', [n.id]),
      db.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [actor.company_id]),
    ]);
    const pdf = await renderNotePdf({
      title: n.title,
      body: n.body,
      note_date: n.note_date,
      author: actor.display_name,
      company: company.rows[0]?.name ?? null,
      files: (files.get(n.id) ?? []).map((f) => ({ name: f.name, size: Number(f.size) })),
      today: today(),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition(req.query.download === '1' ? 'attachment' : 'inline', notePdfName(n.title)));
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  });

  /**
   * Отправить заметку в чат: снимок текста и файлов на этот момент. Подпись —
   * в том же сообщении, под карточкой заметки. Повтор с тем же client_id —
   * то же сообщение.
   */
  r.post('/:id/share', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(shareSchema, req.body);
    if (body.text.length > MESSAGE_MAX) throw invalid('Не удалось отправить заметку', { text: `Не длиннее ${MESSAGE_MAX} символов` });
    if (body.client_id) {
      const dup = (await db.query<MessageRow>(`${MSG_SELECT} WHERE m.sender_id = $1 AND m.client_id = $2 AND m.chat_id = $3`, [actor.id, body.client_id, body.chat_id])).rows[0];
      if (dup) {
        const [msg] = await hydrate(db, actor.id, [dup], 0, media);
        res.json({ data: msg });
        return;
      }
    }
    const { chat, row } = await db.tx(async (q) => {
      const n = await ownNote(q, actor, id);
      const a = await openChat(q, actor, body.chat_id);
      const topicId = await resolveTopic(q, a, body.topic_id);
      const { rows } = await q.query<{ id: string }>(`INSERT INTO note_shares (company_id, note_id, sender_id, title, body, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [
        actor.company_id,
        n.id,
        actor.id,
        n.title,
        n.body,
        at(),
      ]);
      await copyAttachments(q, { type: 'note', id: n.id }, { type: 'note_share', id: rows[0]!.id }, actor.id);
      const row = await insertMessage(q, a.chat, actor.id, { kind: 'note', text: body.text.trim() || null, topic_id: topicId, client_id: body.client_id, note_share_id: rows[0]!.id }, at());
      return { chat: a.chat, row };
    });
    await broadcastMessage(db, rt, chat, row, media);
    onMessage?.(chat, row);
    const [msg] = await hydrate(db, actor.id, [row], 0, media);
    res.status(201).json({ data: msg });
  });

  return r;
}
