import { promises as fs } from 'node:fs';
import {
  BUILTIN_MODEL,
  NO_ANSWER_TEXT,
  buildRagPrompt,
  builtinEmbedding,
  canEditGoal,
  chunkText,
  cosineSimilarity,
  extractiveAnswer,
  keywordOverlap,
  knowledgeTokens,
  pickChunks,
  plainParagraphs,
  sourcesOf,
  stripBadCitations,
  type KnowledgeAnswerMode,
  type KnowledgeSource,
  type RetrievedChunk,
} from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { visibleGoals } from '../routes/roadmap';
import { AiUnavailableError, builtinProvider, type AiProvider } from './ai';
import { DocTextError, extractDocText } from './doc-text';
import { allowedByFunction } from './functions';
import { effectiveAccess, getVisibleGoal } from './goals';
import type { MediaStore } from './media';

/** Нейросеть не ответила — сколько ждать до следующей попытки. */
const AI_RETRY_MS = 60_000;
/** Сколько фрагментов считать за один запрос к нейросети. */
const EMBED_BATCH = 32;
/** Документ не обработался столько раз — больше не пробуем сами, ждём «Обработать ещё раз». */
const MAX_ATTEMPTS = 3;
/** Сколько фрагментов просматриваем при поиске без pgvector. */
const SCAN_LIMIT = 20_000;

export const AI_DOWN_NOTICE = 'Нейросеть сейчас недоступна — ответ собран из фрагментов базы знаний';
const PROCESS_FAILED = 'Не получилось обработать документ — попробуйте «Обработать ещё раз»';

export interface Answer {
  content: string;
  sources: KnowledgeSource[];
  mode: KnowledgeAnswerMode;
  notice: string | null;
}

export interface KnowledgeService {
  readonly provider: AiProvider;
  /** Поставить документ в очередь обработки (не ждёт). */
  enqueue(docId: string): void;
  /** Дождаться, пока очередь опустеет (тесты, остановка сервера). */
  idle(): Promise<void>;
  processDoc(docId: string): Promise<void>;
  /** Документы в очереди после перезапуска и пересчёт векторов после смены модели. */
  tick(): Promise<void>;
  /** Статьи, изменённые после прошлой индексации, — в индекс. */
  syncNotes(companyId: string, limit?: number): Promise<number>;
  /** Векторы, посчитанные другой моделью, — пересчитать. */
  reembedStale(companyId: string | null, limit?: number): Promise<number>;
  retrieve(actor: AuthedActor, question: string): Promise<{ chunks: RetrievedChunk[]; degraded: boolean }>;
  answer(actor: AuthedActor, question: string, context?: string | null): Promise<Answer>;
  vectorBackend(): Promise<'pgvector' | 'memory'>;
  /** Нейросеть отвечает (для встроенного провайдера — всегда). */
  aiReady(): Promise<boolean>;
}

export interface KnowledgeOptions {
  provider?: AiProvider;
  onError?: (e: unknown) => void;
  now?: () => Date;
}

interface CandidateRow {
  note_id: string | null;
  doc_id: string | null;
  title: string;
  goal_title: string | null;
  content: string;
  embedding: number[] | string | null;
  model: string;
  score?: number;
}

const asVector = (v: CandidateRow['embedding']): number[] => (Array.isArray(v) ? v.map(Number) : typeof v === 'string' ? v.replace(/[{}]/g, '').split(',').map(Number) : []);

/** Текст для вектора: заголовок источника помогает найти фрагмент по теме. */
const embedText = (title: string, content: string) => `${title}. ${content}`;

/** Кто может пополнять базу знаний документами для всей компании. */
export async function canManageKnowledge(q: Queryable, actor: AuthedActor): Promise<boolean> {
  return allowedByFunction(q, actor, 'knowledge_manage', { byRole: false });
}

/**
 * Загрузить и править документ: тот, кто ведёт базу знаний; документ цели —
 * ещё и тот, кто управляет целью; свой документ — автор. Наблюдатель только читает.
 */
export async function canEditKnowledgeDoc(q: Queryable, actor: AuthedActor, doc: { goal_id: string | null; uploaded_by?: string | null }): Promise<boolean> {
  if (actor.role === 'observer') return false;
  if (doc.uploaded_by && doc.uploaded_by === actor.id) return true;
  if (await canManageKnowledge(q, actor)) return true;
  if (!doc.goal_id) return false;
  try {
    const { goal, org } = await getVisibleGoal(q, actor, doc.goal_id);
    return canEditGoal(actor, await effectiveAccess(q, actor.company_id, goal), 'description', org);
  } catch {
    return false;
  }
}

/** Цели, которые человек видит: по ним фильтруются статьи и документы при поиске. */
export async function visibleGoalIds(q: Queryable, actor: AuthedActor): Promise<string[]> {
  const { visible } = await visibleGoals(q, actor);
  return visible.map((g) => g.row.id);
}

export function createKnowledgeService(db: Db, store: MediaStore, opts: KnowledgeOptions = {}): KnowledgeService {
  const provider = opts.provider ?? builtinProvider();
  const builtin = builtinProvider();
  const now = opts.now ?? (() => new Date());
  const onError = opts.onError ?? ((e: unknown) => console.error('knowledge:', e));
  let downUntil = 0;
  let pgvector: boolean | null = null;

  const aiDown = () => provider !== builtin && provider.name !== 'builtin' && Date.now() < downUntil;
  const markDown = () => {
    downUntil = Date.now() + AI_RETRY_MS;
  };

  /**
   * Векторы для индекса: нейросетью, а если она не отвечает — встроенными
   * (документ сразу ищется, а после возвращения нейросети пересчитается).
   */
  async function embedMany(texts: string[]): Promise<{ vectors: number[][]; model: string }> {
    if (!aiDown()) {
      try {
        const vectors: number[][] = [];
        for (let i = 0; i < texts.length; i += EMBED_BATCH) vectors.push(...(await provider.embed(texts.slice(i, i + EMBED_BATCH))));
        return { vectors, model: provider.embedModel };
      } catch (e) {
        if (!(e instanceof AiUnavailableError)) throw e;
        markDown();
      }
    }
    return { vectors: await builtin.embed(texts), model: builtin.embedModel };
  }

  async function insertChunks(q: Queryable, companyId: string, owner: { note_id?: string; doc_id?: string }, contents: string[], vectors: number[][], model: string) {
    for (let i = 0; i < contents.length; i += 50) {
      const args: unknown[] = [companyId, owner.note_id ?? null, owner.doc_id ?? null, model];
      const values: string[] = [];
      for (let j = i; j < Math.min(i + 50, contents.length); j++) {
        args.push(j, contents[j], vectors[j]);
        const b = args.length;
        values.push(
          `($1, $2::uuid, $3::uuid, $${b - 2}::int, $${b - 1}, $${b}::real[], $4, ${owner.note_id ? '(SELECT updated_at FROM notes WHERE id = $2::uuid)' : 'NULL'})`,
        );
      }
      await q.query(`INSERT INTO knowledge_chunks (company_id, note_id, doc_id, idx, content, embedding, model, source_updated_at) VALUES ${values.join(', ')}`, args);
    }
  }

  async function processDoc(docId: string): Promise<void> {
    const claimed = (
      await db.query<{ id: string; company_id: string; title: string; doc_type: 'pdf' | 'docx' | 'text'; storage_key: string | null }>(
        `UPDATE knowledge_docs d SET status = 'processing', attempts = attempts + 1, error = NULL
          WHERE d.id = $1 AND d.status IN ('pending', 'processing')
          RETURNING d.id, d.company_id, d.title, d.doc_type,
                    (SELECT a.storage_key FROM attachments a WHERE a.owner_type = 'kb_doc' AND a.owner_id = d.id ORDER BY a.position LIMIT 1) AS storage_key`,
        [docId],
      )
    ).rows[0];
    if (!claimed) return;
    try {
      const path = claimed.storage_key ? store.pathOf(claimed.storage_key) : null;
      if (!path) throw new DocTextError('Файл документа не найден — загрузите его ещё раз');
      const buf = await fs.readFile(path).catch(() => {
        throw new DocTextError('Файл документа не найден — загрузите его ещё раз');
      });
      const { text, pages } = await extractDocText(buf, claimed.doc_type);
      const chunks = chunkText(text);
      if (!chunks.length) throw new DocTextError('В документе нет текста');
      const contents = chunks.map((c) => c.content);
      const { vectors, model } = await embedMany(contents.map((c) => embedText(claimed.title, c)));
      await db.tx(async (q) => {
        // Документ могли удалить, пока его читали.
        const alive = (await q.query(`SELECT 1 FROM knowledge_docs WHERE id = $1 FOR UPDATE`, [docId])).rows.length > 0;
        if (!alive) return;
        await q.query(`DELETE FROM knowledge_chunks WHERE doc_id = $1`, [docId]);
        await insertChunks(q, claimed.company_id, { doc_id: docId }, contents, vectors, model);
        await q.query(`UPDATE knowledge_docs SET status = 'ready', error = NULL, chars = $2, pages = $3, processed_at = $4 WHERE id = $1`, [
          docId,
          text.length,
          pages,
          now().toISOString(),
        ]);
      });
    } catch (e) {
      const message = e instanceof DocTextError ? e.message : PROCESS_FAILED;
      if (!(e instanceof DocTextError)) onError(e);
      await db.query(`UPDATE knowledge_docs SET status = 'failed', error = $2, processed_at = $3 WHERE id = $1`, [docId, message, now().toISOString()]);
    }
  }

  // Очередь обработки — по одному документу: чтение PDF и нейросеть не любят толпу.
  let chain: Promise<void> = Promise.resolve();
  const queued = new Set<string>();
  const enqueue = (docId: string) => {
    if (queued.has(docId)) return;
    queued.add(docId);
    chain = chain
      .then(() => processDoc(docId))
      .catch(onError)
      .finally(() => queued.delete(docId));
  };

  async function syncNotes(companyId: string, limit = 50): Promise<number> {
    const model = aiDown() ? builtin.embedModel : provider.embedModel;
    const { rows } = await db.query<{ id: string; title: string; body: string }>(
      `SELECT n.id, n.title, n.body FROM notes n
        WHERE n.company_id = $1
          AND NOT EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.note_id = n.id AND c.model = $2 AND c.source_updated_at = n.updated_at)
        ORDER BY n.updated_at DESC LIMIT $3`,
      [companyId, model, limit],
    );
    for (const n of rows) {
      const parts = chunkText(plainParagraphs(n.body)).map((c) => c.content);
      const contents = parts.length ? parts : [n.title];
      const { vectors, model: used } = await embedMany(contents.map((c) => embedText(n.title, c)));
      await db.tx(async (q) => {
        await q.query(`DELETE FROM knowledge_chunks WHERE note_id = $1`, [n.id]);
        if ((await q.query(`SELECT 1 FROM notes WHERE id = $1`, [n.id])).rows.length) await insertChunks(q, companyId, { note_id: n.id }, contents, vectors, used);
      });
    }
    return rows.length;
  }

  async function reembedStale(companyId: string | null, limit = 200): Promise<number> {
    if (aiDown() || provider.embedModel === BUILTIN_MODEL) return 0;
    const { rows } = await db.query<{ id: string; content: string; title: string }>(
      `SELECT c.id, c.content, COALESCE(n.title, d.title) AS title
         FROM knowledge_chunks c
         LEFT JOIN notes n ON n.id = c.note_id
         LEFT JOIN knowledge_docs d ON d.id = c.doc_id
        WHERE c.model <> $1 AND ($2::uuid IS NULL OR c.company_id = $2::uuid)
        ORDER BY c.created_at LIMIT $3`,
      [provider.embedModel, companyId, limit],
    );
    if (!rows.length) return 0;
    const { vectors, model } = await embedMany(rows.map((r) => embedText(r.title, r.content)));
    if (model !== provider.embedModel) return 0;
    await db.tx(async (q) => {
      for (const [i, r] of rows.entries()) await q.query(`UPDATE knowledge_chunks SET embedding = $2::real[], model = $3 WHERE id = $1`, [r.id, vectors[i], model]);
    });
    return rows.length;
  }

  async function tick(): Promise<void> {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM knowledge_docs WHERE status IN ('pending', 'processing') AND attempts < $1 ORDER BY created_at LIMIT 20`,
      [MAX_ATTEMPTS],
    );
    for (const r of rows) enqueue(r.id);
    await chain;
    // Застрявшие после многих попыток — честно показываем ошибку.
    await db.query(`UPDATE knowledge_docs SET status = 'failed', error = $2 WHERE status IN ('pending', 'processing') AND attempts >= $1`, [MAX_ATTEMPTS, PROCESS_FAILED]);
    await reembedStale(null);
  }

  async function vectorBackend(): Promise<'pgvector' | 'memory'> {
    if (pgvector === null) {
      try {
        pgvector = (await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`)).rows.length > 0;
      } catch {
        pgvector = false;
      }
    }
    return pgvector ? 'pgvector' : 'memory';
  }

  /** Вектор вопроса: нейросетью, а если она молчит — встроенный (и ищем по встроенным). */
  async function embedQuestion(question: string): Promise<{ vector: number[]; model: string; degraded: boolean }> {
    if (provider.embedModel !== BUILTIN_MODEL && !aiDown()) {
      try {
        const [v] = await provider.embed([question]);
        if (v) return { vector: v, model: provider.embedModel, degraded: false };
      } catch (e) {
        if (!(e instanceof AiUnavailableError)) throw e;
        markDown();
      }
    }
    return { vector: builtinEmbedding(question), model: BUILTIN_MODEL, degraded: provider.embedModel !== BUILTIN_MODEL };
  }

  /**
   * Поиск по смыслу среди того, что человек вправе видеть: статьи и
   * документы компании и целей, которые ему видны. Личные заметки в базу
   * знаний не попадают вовсе.
   */
  async function retrieve(actor: AuthedActor, question: string): Promise<{ chunks: RetrievedChunk[]; degraded: boolean }> {
    const goalIds = await visibleGoalIds(db, actor);
    const { vector, model, degraded } = await embedQuestion(question);
    const access = `c.company_id = $1
        AND (c.note_id IS NOT NULL OR d.status = 'ready')
        AND (COALESCE(n.goal_id, d.goal_id) IS NULL OR COALESCE(n.goal_id, d.goal_id) = ANY($2::uuid[]))`;
    const from = `FROM knowledge_chunks c
        LEFT JOIN notes n ON n.id = c.note_id
        LEFT JOIN knowledge_docs d ON d.id = c.doc_id
        LEFT JOIN goals g ON g.id = COALESCE(n.goal_id, d.goal_id)`;
    const cols = `c.note_id, c.doc_id, COALESCE(n.title, d.title) AS title, g.title AS goal_title, c.content`;
    let scored: { row: CandidateRow; score: number }[];
    if ((await vectorBackend()) === 'pgvector') {
      // Близость считает база (pgvector), берём сорок ближайших.
      const { rows } = await db.query<CandidateRow & { score: number }>(
        `SELECT ${cols}, NULL AS embedding, c.model, 1 - (c.embedding::vector <=> $3::real[]::vector) AS score
           ${from} WHERE ${access} AND c.model = $4
          ORDER BY c.embedding::vector <=> $3::real[]::vector LIMIT 40`,
        [actor.company_id, goalIds, vector, model],
      );
      scored = rows.map((row) => ({ row, score: Number(row.score) }));
    } else {
      const { rows } = await db.query<CandidateRow>(`SELECT ${cols}, c.embedding, c.model ${from} WHERE ${access} ORDER BY c.created_at DESC LIMIT ${SCAN_LIMIT}`, [
        actor.company_id,
        goalIds,
      ]);
      scored = [];
      for (const row of rows) {
        // Фрагмент посчитан другой моделью: встроенный вектор пересчитываем на лету, чужой — пропускаем.
        const v = row.model === model ? asVector(row.embedding) : model === BUILTIN_MODEL ? builtinEmbedding(embedText(row.title, row.content)) : null;
        if (v) scored.push({ row, score: cosineSimilarity(vector, v) });
      }
    }
    const chunks: RetrievedChunk[] = [];
    for (const { row, score } of scored) {
      // Похожи только буквы, а слов вопроса нет — не источник.
      if (score < 0.35 && keywordOverlap(question, `${row.title} ${row.content}`) === 0) continue;
      chunks.push({ kind: row.note_id ? 'note' : 'doc', id: (row.note_id ?? row.doc_id)!, title: row.title, goal_title: row.goal_title, content: row.content, score });
    }
    return { chunks, degraded };
  }

  async function answer(actor: AuthedActor, question: string, context?: string | null): Promise<Answer> {
    await syncNotes(actor.company_id).catch(onError);
    await reembedStale(actor.company_id).catch(onError);
    // Короткий уточняющий вопрос («а для отдела продаж?») ищем вместе с прошлым.
    const query = context && knowledgeTokens(question).length < 3 ? `${context} ${question}` : question;
    const { chunks, degraded } = await retrieve(actor, query);
    const picked = pickChunks(chunks);
    if (!picked.length) return { content: NO_ANSWER_TEXT, sources: [], mode: 'empty', notice: degraded ? AI_DOWN_NOTICE : null };
    const { sources, numberOf } = sourcesOf(picked, query);
    let notice: string | null = degraded ? AI_DOWN_NOTICE : null;
    if (provider.generate && !aiDown()) {
      try {
        const company = (await db.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [actor.company_id])).rows[0]?.name;
        const text = stripBadCitations(await provider.generate(buildRagPrompt(question, picked, numberOf, company ? `компании «${company}»` : undefined)), sources.length);
        if (text) return { content: text, sources, mode: 'ai', notice: null };
      } catch (e) {
        if (!(e instanceof AiUnavailableError)) throw e;
        markDown();
        notice = AI_DOWN_NOTICE;
      }
    }
    return { content: extractiveAnswer(query, picked, numberOf), sources, mode: 'extract', notice };
  }

  async function aiReady(): Promise<boolean> {
    if (provider.embedModel === BUILTIN_MODEL && !provider.generate) return true;
    const ok = await provider.health();
    if (ok) downUntil = 0;
    return ok;
  }

  return { provider, enqueue, idle: () => chain, processDoc, tick, syncNotes, reembedStale, retrieve, answer, vectorBackend, aiReady };
}

/** Фоновая обработка: документы из очереди после перезапуска и пересчёт векторов — раз в минуту. */
export function startKnowledgeLoop(svc: KnowledgeService, opts: { intervalMs?: number; onError?: (e: unknown) => void } = {}): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await svc.tick();
    } catch (e) {
      (opts.onError ?? console.error)(e);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, opts.intervalMs ?? 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
