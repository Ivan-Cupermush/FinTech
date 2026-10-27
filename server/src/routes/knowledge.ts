import { promises as fs } from 'node:fs';
import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  KNOWLEDGE_LIMITS,
  knowledgeDocType,
  sessionTitleFrom,
  titleFromFileName,
  validateKnowledgeTitle,
  validateQuestion,
  type KnowledgeAskResult,
  type KnowledgeDoc,
  type KnowledgeMessage,
  type KnowledgeSession,
  type KnowledgeSource,
  type KnowledgeStatus,
} from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { deleteAttachments, type MediaCtx } from '../services/attachments';
import { canEditKnowledgeDoc, canManageKnowledge, visibleGoalIds, type KnowledgeService } from '../services/knowledge';
import { ATT_COLS, serializeAttachment, type AttachmentRow } from '../services/media';
import { getVisibleGoal } from '../services/goals';
import { receive } from './files';

const askLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `kb:${(req as { actor?: { id: string } }).actor?.id ?? 'anon'}`,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Слишком много вопросов подряд. Подождите минуту' } }),
});

const askSchema = z.object({ question: z.string().max(10_000), session_id: z.string().nullable().optional() });
const patchDocSchema = z.object({ title: z.string().max(1000).optional(), goal_id: z.string().nullable().optional() });
const feedbackSchema = z.object({ feedback: z.enum(['up', 'down']).nullable(), comment: z.string().max(1000).optional() });

interface DocRow {
  id: string;
  title: string;
  doc_type: KnowledgeDoc['type'];
  status: KnowledgeDoc['status'];
  error: string | null;
  chars: number;
  pages: number | null;
  goal_id: string | null;
  goal_title: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  processed_at: string | null;
  chunks: number | string;
}

const DOC_SELECT = `SELECT d.id, d.title, d.doc_type, d.status, d.error, d.chars, d.pages, d.goal_id, g.title AS goal_title,
                           d.uploaded_by, u.display_name AS uploaded_by_name, d.created_at, d.processed_at,
                           (SELECT count(*) FROM knowledge_chunks c WHERE c.doc_id = d.id) AS chunks
                      FROM knowledge_docs d
                      LEFT JOIN users u ON u.id = d.uploaded_by
                      LEFT JOIN goals g ON g.id = d.goal_id`;

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: KnowledgeSource[] | string;
  mode: KnowledgeMessage['mode'];
  notice: string | null;
  feedback: 'up' | 'down' | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_answer: string | null;
  questions: number | string;
}

const SESSION_SELECT = `SELECT s.id, s.title, s.created_at, s.updated_at,
                               (SELECT left(m.content, 200) FROM knowledge_messages m WHERE m.session_id = s.id AND m.role = 'assistant' ORDER BY m.created_at DESC LIMIT 1) AS last_answer,
                               (SELECT count(*) FROM knowledge_messages m WHERE m.session_id = s.id AND m.role = 'user') AS questions
                          FROM knowledge_sessions s`;

const toSession = (r: SessionRow): KnowledgeSession => ({ id: r.id, title: r.title, created_at: r.created_at, updated_at: r.updated_at, last_answer: r.last_answer, questions: Number(r.questions) });

const parseSources = (s: MessageRow['sources']): KnowledgeSource[] => (typeof s === 'string' ? (JSON.parse(s) as KnowledgeSource[]) : (s ?? []));

const toMessage = (r: MessageRow, sources = parseSources(r.sources)): KnowledgeMessage => ({
  id: r.id,
  role: r.role,
  content: r.content,
  sources,
  mode: r.mode,
  notice: r.notice,
  feedback: r.feedback,
  created_at: r.created_at,
});

/**
 * Источники старых ответов — только те, что человек видит сейчас: доступ к
 * цели забрали или документ удалили — ссылка гаснет, отрывок скрывается.
 */
async function redactSources(q: Queryable, actor: AuthedActor, rows: MessageRow[]): Promise<Map<string, KnowledgeSource[]>> {
  const all = rows.map((r) => [r.id, parseSources(r.sources)] as const);
  const noteIds = [...new Set(all.flatMap(([, s]) => s.filter((x) => x.kind === 'note').map((x) => x.id)))].filter(isUuid);
  const docIds = [...new Set(all.flatMap(([, s]) => s.filter((x) => x.kind === 'doc').map((x) => x.id)))].filter(isUuid);
  const goalIds = noteIds.length || docIds.length ? await visibleGoalIds(q, actor) : [];
  const visible = new Set<string>();
  if (noteIds.length) {
    const { rows: r } = await q.query<{ id: string }>(`SELECT id FROM notes WHERE id = ANY($1::uuid[]) AND company_id = $2 AND (goal_id IS NULL OR goal_id = ANY($3::uuid[]))`, [
      noteIds,
      actor.company_id,
      goalIds,
    ]);
    for (const x of r) visible.add(`note:${x.id}`);
  }
  if (docIds.length) {
    const { rows: r } = await q.query<{ id: string }>(
      `SELECT id FROM knowledge_docs WHERE id = ANY($1::uuid[]) AND company_id = $2 AND (goal_id IS NULL OR goal_id = ANY($3::uuid[]))`,
      [docIds, actor.company_id, goalIds],
    );
    for (const x of r) visible.add(`doc:${x.id}`);
  }
  return new Map(
    all.map(([id, sources]) => [
      id,
      sources.map((s) => (visible.has(`${s.kind}:${s.id}`) ? s : { ...s, id: '', title: 'Источник недоступен', excerpt: '', goal_title: null })),
    ]),
  );
}

/**
 * База знаний с ИИ: `/api/v1/knowledge`. Документы (PDF, DOCX, TXT, MD)
 * читаются в фоне и режутся на фрагменты; вопрос ищет ближайшие фрагменты
 * среди статей и документов, которые человек видит, и отвечает со ссылками.
 */
export function knowledgeRouter(db: Db, media: MediaCtx, kb: KnowledgeService, opts: { rateLimit?: boolean } = {}): Router {
  const r = Router();
  const { store, now } = media;
  const upload = receive(store, 'file', { maxBytes: Math.min(store.maxBytes, KNOWLEDGE_LIMITS.docBytes) });

  async function loadDocs(q: Queryable, actor: AuthedActor, where: string, args: unknown[]): Promise<KnowledgeDoc[]> {
    const goalIds = await visibleGoalIds(q, actor);
    const { rows } = await q.query<DocRow>(
      `${DOC_SELECT} WHERE d.company_id = $1 AND (d.goal_id IS NULL OR d.goal_id = ANY($2::uuid[])) ${where} ORDER BY d.created_at DESC, d.id LIMIT 500`,
      [actor.company_id, goalIds, ...args],
    );
    if (!rows.length) return [];
    const files = await q.query<AttachmentRow>(`SELECT ${ATT_COLS} FROM attachments a WHERE a.owner_type = 'kb_doc' AND a.owner_id = ANY($1::uuid[])`, [rows.map((d) => d.id)]);
    const fileOf = new Map(files.rows.map((a) => [a.owner_id!, a]));
    const manage = await canManageKnowledge(q, actor);
    const out: KnowledgeDoc[] = [];
    for (const d of rows) {
      const f = fileOf.get(d.id);
      out.push({
        id: d.id,
        title: d.title,
        file_name: f?.name ?? d.title,
        type: d.doc_type,
        size: Number(f?.size ?? 0),
        status: d.status,
        error: d.error,
        chunks: Number(d.chunks),
        chars: d.chars,
        pages: d.pages,
        goal_id: d.goal_id,
        goal_title: d.goal_title,
        uploaded_by_name: d.uploaded_by_name,
        created_at: d.created_at,
        processed_at: d.processed_at,
        can_edit: actor.role !== 'observer' && (manage || (await canEditKnowledgeDoc(q, actor, d))),
        file: f ? serializeAttachment(store, f, actor.id, now().getTime()) : null,
      });
    }
    return out;
  }

  async function visibleDoc(q: Queryable, actor: AuthedActor, id: string): Promise<KnowledgeDoc> {
    const [d] = await loadDocs(q, actor, 'AND d.id = $3', [id]);
    if (!d) throw notFound('Документ не найден');
    return d;
  }

  // ------------------------------------------------------------ состояние

  r.get('/status', async (req, res) => {
    const actor = actorOf(req);
    const goalIds = await visibleGoalIds(db, actor);
    const [docs, notes, chunks] = await Promise.all([
      db.query<{ status: string; n: number | string }>(
        `SELECT status, count(*) AS n FROM knowledge_docs WHERE company_id = $1 AND (goal_id IS NULL OR goal_id = ANY($2::uuid[])) GROUP BY status`,
        [actor.company_id, goalIds],
      ),
      db.query<{ n: number | string }>(`SELECT count(*) AS n FROM notes WHERE company_id = $1 AND (goal_id IS NULL OR goal_id = ANY($2::uuid[]))`, [actor.company_id, goalIds]),
      db.query<{ n: number | string }>(`SELECT count(*) AS n FROM knowledge_chunks WHERE company_id = $1`, [actor.company_id]),
    ]);
    const count = (s: string[]) => docs.rows.filter((x) => s.includes(x.status)).reduce((a, x) => a + Number(x.n), 0);
    const p = kb.provider;
    const data: KnowledgeStatus = {
      mode: p.generate ? 'ai' : 'builtin',
      provider: p.name,
      model: p.chatModel,
      ready: await kb.aiReady(),
      vector: await kb.vectorBackend(),
      docs: { ready: count(['ready']), processing: count(['pending', 'processing']), failed: count(['failed']) },
      notes: Number(notes.rows[0]?.n ?? 0),
      chunks: Number(chunks.rows[0]?.n ?? 0),
      can_manage: await canManageKnowledge(db, actor),
    };
    res.json({ data });
  });

  // ------------------------------------------------------------ документы

  r.get('/docs', async (req, res) => {
    const actor = actorOf(req);
    const goalId = typeof req.query.goal_id === 'string' ? req.query.goal_id : null;
    if (goalId && !isUuid(goalId)) throw notFound('Цель не найдена');
    res.json({ data: await loadDocs(db, actor, goalId ? 'AND d.goal_id = $3' : '', goalId ? [goalId] : []) });
  });

  r.get('/docs/:id', async (req, res) => {
    const actor = actorOf(req);
    res.json({ data: await visibleDoc(db, actor, idParam(req.params.id)) });
  });

  /** Извлечённый текст документа по фрагментам — для просмотра и проверки. */
  r.get('/docs/:id/text', async (req, res) => {
    const actor = actorOf(req);
    const d = await visibleDoc(db, actor, idParam(req.params.id));
    const { rows } = await db.query<{ idx: number; content: string }>(`SELECT idx, content FROM knowledge_chunks WHERE doc_id = $1 ORDER BY idx LIMIT 400`, [d.id]);
    res.json({ data: { doc: d, chunks: rows } });
  });

  r.post('/docs', async (req, res) => {
    const actor = actorOf(req);
    if (actor.role === 'observer') throw forbidden('Наблюдатель не может загружать документы');
    const file = await upload(req, res);
    try {
      const type = knowledgeDocType(file.originalname, file.mimetype);
      if (!type) throw invalid('Не удалось загрузить документ', { file: 'Загрузите PDF, DOCX, TXT или MD' });
      const goalId = typeof req.body?.goal_id === 'string' && req.body.goal_id ? String(req.body.goal_id) : null;
      if (goalId && !isUuid(goalId)) throw invalid('Не удалось загрузить документ', { goal_id: 'Цель не найдена' });
      const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : titleFromFileName(file.originalname);
      const titleError = validateKnowledgeTitle(title);
      if (titleError) throw invalid('Не удалось загрузить документ', { title: titleError });
      if (goalId) await getVisibleGoal(db, actor, goalId);
      if (!(await canEditKnowledgeDoc(db, actor, { goal_id: goalId }))) {
        throw forbidden(goalId ? 'Загружать документы к цели может тот, кто ею управляет' : 'Загружать документы для всей компании может тот, кто ведёт базу знаний');
      }
      const p = await store.process({ path: file.path, originalName: file.originalname, mime: file.mimetype, size: file.size, asFile: true });
      const id = await db.tx(async (q) => {
        const { rows } = await q.query<{ id: string }>(
          `INSERT INTO knowledge_docs (company_id, goal_id, title, doc_type, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [actor.company_id, goalId, title, type, actor.id, now().toISOString()],
        );
        const docId = rows[0]!.id;
        await q.query(
          `INSERT INTO attachments (company_id, uploaded_by, owner_type, owner_id, position, kind, name, mime, size, storage_key, thumb_key, width, height, duration, waveform, created_at)
           VALUES ($1, $2, 'kb_doc', $3, 0, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [actor.company_id, actor.id, docId, p.kind, p.name, p.mime, p.size, p.storage_key, p.thumb_key, p.width, p.height, p.duration, p.waveform, now().toISOString()],
        );
        return docId;
      });
      kb.enqueue(id);
      res.status(201).json({ data: await visibleDoc(db, actor, id) });
    } finally {
      await fs.rm(file.path, { force: true }).catch(() => undefined);
    }
  });

  r.patch('/docs/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(patchDocSchema, req.body);
    const d = await visibleDoc(db, actor, id);
    if (!d.can_edit) throw forbidden('Недостаточно прав, чтобы изменить документ');
    const title = body.title !== undefined ? body.title.trim() : d.title;
    const titleError = validateKnowledgeTitle(title);
    if (titleError) throw invalid('Не удалось сохранить документ', { title: titleError });
    let goalId = d.goal_id;
    if (body.goal_id !== undefined) {
      goalId = body.goal_id || null;
      if (goalId && !isUuid(goalId)) throw invalid('Не удалось сохранить документ', { goal_id: 'Цель не найдена' });
      if (goalId) await getVisibleGoal(db, actor, goalId);
      if (!(await canEditKnowledgeDoc(db, actor, { goal_id: goalId }))) throw forbidden('Недостаточно прав, чтобы перенести документ');
    }
    await db.query(`UPDATE knowledge_docs SET title = $2, goal_id = $3 WHERE id = $1`, [id, title, goalId]);
    // Заголовок входит в векторы фрагментов — пересчитываем.
    if (title !== d.title && d.status === 'ready') {
      await db.query(`UPDATE knowledge_docs SET status = 'pending', attempts = 0 WHERE id = $1`, [id]);
      kb.enqueue(id);
    }
    res.json({ data: await visibleDoc(db, actor, id) });
  });

  r.post('/docs/:id/reprocess', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const d = await visibleDoc(db, actor, id);
    if (!d.can_edit) throw forbidden('Недостаточно прав, чтобы обработать документ');
    await db.query(`UPDATE knowledge_docs SET status = 'pending', attempts = 0, error = NULL WHERE id = $1`, [id]);
    kb.enqueue(id);
    res.json({ data: await visibleDoc(db, actor, id) });
  });

  r.delete('/docs/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const d = await visibleDoc(db, actor, id);
    if (!d.can_edit) throw forbidden('Недостаточно прав, чтобы удалить документ');
    await db.tx(async (q) => {
      await deleteAttachments(q, store, { type: 'kb_doc', ids: [id] });
      await q.query(`DELETE FROM knowledge_docs WHERE id = $1`, [id]);
    });
    res.status(204).end();
  });

  // ------------------------------------------------------------ вопросы

  r.post('/ask', ...(opts.rateLimit !== false ? [askLimiter] : []), async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(askSchema, req.body);
    const qError = validateQuestion(body.question);
    if (qError) throw invalid('Не удалось задать вопрос', { question: qError });
    const question = body.question.trim();
    let context: string | null = null;
    if (body.session_id) {
      if (!isUuid(body.session_id)) throw notFound('Диалог не найден');
      const s = (await db.query(`SELECT 1 FROM knowledge_sessions WHERE id = $1 AND user_id = $2`, [body.session_id, actor.id])).rows[0];
      if (!s) throw notFound('Диалог не найден');
      context =
        (await db.query<{ content: string }>(`SELECT content FROM knowledge_messages WHERE session_id = $1 AND role = 'user' ORDER BY created_at DESC LIMIT 1`, [body.session_id])).rows[0]
          ?.content ?? null;
    }
    const a = await kb.answer(actor, question, context);
    const data = await db.tx(async (q): Promise<KnowledgeAskResult> => {
      let sessionId = body.session_id ?? null;
      if (sessionId) await q.query(`UPDATE knowledge_sessions SET updated_at = clock_timestamp() WHERE id = $1`, [sessionId]);
      else {
        const { rows } = await q.query<{ id: string }>(
          `INSERT INTO knowledge_sessions (company_id, user_id, title, created_at, updated_at) VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp()) RETURNING id`,
          [actor.company_id, actor.id, sessionTitleFrom(question)],
        );
        sessionId = rows[0]!.id;
      }
      const insert = async (role: 'user' | 'assistant', content: string, extra: { sources?: KnowledgeSource[]; mode?: string; notice?: string | null } = {}) =>
        (
          await q.query<MessageRow>(
            `INSERT INTO knowledge_messages (session_id, role, content, sources, mode, notice, created_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6, clock_timestamp())
             RETURNING id, session_id, role, content, sources, mode, notice, feedback, created_at`,
            [sessionId, role, content, JSON.stringify(extra.sources ?? []), extra.mode ?? null, extra.notice ?? null],
          )
        ).rows[0]!;
      const qm = await insert('user', question);
      const am = await insert('assistant', a.content, { sources: a.sources, mode: a.mode, notice: a.notice });
      const s = (await q.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1`, [sessionId])).rows[0]!;
      return { session: toSession(s), question: toMessage(qm), answer: toMessage(am) };
    });
    res.json({ data });
  });

  r.get('/sessions', async (req, res) => {
    const actor = actorOf(req);
    const { rows } = await db.query<SessionRow>(`${SESSION_SELECT} WHERE s.user_id = $1 AND s.company_id = $2 ORDER BY s.updated_at DESC LIMIT 100`, [actor.id, actor.company_id]);
    res.json({ data: rows.map(toSession) });
  });

  r.get('/sessions/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const s = (await db.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1 AND s.user_id = $2`, [id, actor.id])).rows[0];
    if (!s) throw notFound('Диалог не найден');
    const { rows } = await db.query<MessageRow>(
      `SELECT id, session_id, role, content, sources, mode, notice, feedback, created_at FROM knowledge_messages WHERE session_id = $1 ORDER BY created_at, role DESC`,
      [id],
    );
    const sources = await redactSources(db, actor, rows);
    res.json({ data: { session: toSession(s), messages: rows.map((m) => toMessage(m, sources.get(m.id))) } });
  });

  r.delete('/sessions/:id', async (req, res) => {
    const actor = actorOf(req);
    const { rows } = await db.query(`DELETE FROM knowledge_sessions WHERE id = $1 AND user_id = $2 RETURNING id`, [idParam(req.params.id), actor.id]);
    if (!rows.length) throw notFound('Диалог не найден');
    res.status(204).end();
  });

  /** «Полезно» или «мимо» — чтобы руководитель видел, где база знаний не помогает. */
  r.put('/messages/:id/feedback', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(feedbackSchema, req.body);
    const { rows } = await db.query<MessageRow>(
      `UPDATE knowledge_messages m SET feedback = $3, feedback_comment = $4
         FROM knowledge_sessions s
        WHERE m.id = $1 AND m.session_id = s.id AND s.user_id = $2 AND m.role = 'assistant'
        RETURNING m.id, m.session_id, m.role, m.content, m.sources, m.mode, m.notice, m.feedback, m.created_at`,
      [idParam(req.params.id), actor.id, body.feedback, body.feedback ? body.comment?.trim() || null : null],
    );
    const m = rows[0];
    if (!m) throw notFound('Ответ не найден');
    const sources = await redactSources(db, actor, [m]);
    res.json({ data: toMessage(m, sources.get(m.id)) });
  });

  return r;
}
