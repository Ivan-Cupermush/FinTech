import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { builtinEmbedding, type KnowledgeAskResult, type KnowledgeDoc, type KnowledgeMessage, type KnowledgeStatus } from '@offix/core';
import { AiUnavailableError, aiProviderFromEnv, ollamaProvider, type AiFetch, type AiProvider } from '../src/services/ai';
import { AI_DOWN_NOTICE } from '../src/services/knowledge';
import { makeDocx, makePdf } from './kb-fixtures';
import { setup, type Ctx } from './helpers';

const API = '/api/v1/knowledge';
type Who = Parameters<Ctx['as']>[0];

const REGLAMENT = [
  'Регламент командировок.',
  '',
  'Командировку согласует руководитель подразделения не позднее чем за пять рабочих дней до поездки.',
  'Авансовый отчёт сдаётся в бухгалтерию в течение трёх рабочих дней после возвращения.',
  'Суточные выплачиваются из расчёта 700 рублей в день по России.',
].join('\n');

async function upload(ctx: Ctx, who: Who, file: Buffer | Uint8Array, name: string, fields: Record<string, string> = {}) {
  let r = request(ctx.app).post(`${API}/docs`).set('Authorization', `Bearer ${await ctx.token(who)}`);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', Buffer.from(file), name);
}

const ask = async (ctx: Ctx, who: Who, question: string, session_id?: string) => (await ctx.as(who)).post(`${API}/ask`, { question, session_id });

describe('база знаний с ИИ: документы', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  });

  it('без входа — 401', async () => {
    expect((await request(ctx.app).get(`${API}/status`)).status).toBe(401);
  });

  it('состояние: встроенный помощник, кто может пополнять базу', async () => {
    const st = (await (await ctx.as('director')).get(`${API}/status`)).body.data as KnowledgeStatus;
    expect(st).toMatchObject({ mode: 'builtin', provider: 'builtin', model: null, ready: true, vector: 'memory', can_manage: true });
    expect(st.notes).toBeGreaterThanOrEqual(1);
    expect(((await (await ctx.as('dima')).get(`${API}/status`)).body.data as KnowledgeStatus).can_manage).toBe(false);
    expect(((await (await ctx.as('observer')).get(`${API}/status`)).body.data as KnowledgeStatus).can_manage).toBe(false);
  });

  it('текстовый документ: очередь → готов, фрагменты, файл по ссылке', async () => {
    const r = await upload(ctx, 'director', Buffer.from(REGLAMENT), 'Регламент_командировок.txt');
    expect(r.status).toBe(201);
    const doc = r.body.data as KnowledgeDoc;
    expect(doc).toMatchObject({ title: 'Регламент командировок', type: 'text', goal_id: null, can_edit: true, uploaded_by_name: 'Алексей Петров' });
    expect(['pending', 'processing']).toContain(doc.status);
    await ctx.knowledge.idle();
    const ready = (await (await ctx.as('dima')).get(`${API}/docs/${doc.id}`)).body.data as KnowledgeDoc;
    expect(ready).toMatchObject({ status: 'ready', error: null, can_edit: false });
    expect(ready.chunks).toBeGreaterThanOrEqual(1);
    expect(ready.chars).toBeGreaterThan(100);
    expect(ready.file?.name).toBe('Регламент_командировок.txt');
    const raw = await request(ctx.app).get(ready.file!.url);
    expect(raw.status).toBe(200);
    expect(raw.text).toContain('Суточные');
    const text = (await (await ctx.as('dima')).get(`${API}/docs/${doc.id}/text`)).body.data;
    expect(text.chunks.map((c: { content: string }) => c.content).join(' ')).toContain('Авансовый отчёт');
    expect((await (await ctx.as('dima')).get(`${API}/docs`)).body.data.map((d: KnowledgeDoc) => d.id)).toContain(doc.id);
  });

  it('PDF и DOCX читаются, у PDF — число страниц', async () => {
    const pdf = await upload(ctx, 'director', await makePdf('Политика отпусков', 'Заявление на отпуск подаётся за две недели через HR-партнёра.'), 'otpusk.pdf', {
      title: 'Политика отпусков',
    });
    const docx = await upload(ctx, 'director', makeDocx(['Пропуск в здание', 'Гостевой пропуск заказывает секретарь за один день до визита.']), 'propusk.docx');
    expect(pdf.status).toBe(201);
    expect(docx.status).toBe(201);
    await ctx.knowledge.idle();
    const p = (await (await ctx.as('director')).get(`${API}/docs/${pdf.body.data.id}`)).body.data as KnowledgeDoc;
    const d = (await (await ctx.as('director')).get(`${API}/docs/${docx.body.data.id}`)).body.data as KnowledgeDoc;
    expect(p).toMatchObject({ status: 'ready', type: 'pdf', pages: 1, title: 'Политика отпусков' });
    expect(d).toMatchObject({ status: 'ready', type: 'docx', pages: null, title: 'propusk' });
  });

  it('не тот тип файла — 422; битый PDF — «не обработан» с понятной причиной и повтором', async () => {
    const png = await upload(ctx, 'director', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'схема.png');
    expect(png.status).toBe(422);
    expect(png.body.error.fields.file).toMatch(/PDF, DOCX/);
    const bad = await upload(ctx, 'director', Buffer.from('%PDF-1.4 это не pdf'), 'bad.pdf');
    await ctx.knowledge.idle();
    const failed = (await (await ctx.as('director')).get(`${API}/docs/${bad.body.data.id}`)).body.data as KnowledgeDoc;
    expect(failed).toMatchObject({ status: 'failed', chunks: 0 });
    expect(failed.error).toMatch(/PDF/);
    expect(((await (await ctx.as('director')).get(`${API}/status`)).body.data as KnowledgeStatus).docs.failed).toBe(1);
    const again = await (await ctx.as('director')).post(`${API}/docs/${bad.body.data.id}/reprocess`);
    expect(['pending', 'processing']).toContain(again.body.data.status);
    await ctx.knowledge.idle();
    expect((await (await ctx.as('director')).get(`${API}/docs/${bad.body.data.id}`)).body.data.status).toBe('failed');
  });

  it('загружать для всей компании — кто ведёт базу знаний; наблюдатель — нет', async () => {
    expect((await upload(ctx, 'dima', Buffer.from('текст'), 'a.txt')).status).toBe(403);
    expect((await upload(ctx, 'observer', Buffer.from('текст'), 'a.txt')).status).toBe(403);
    await (await ctx.as('director')).put(`/api/v1/functions/users/${ctx.demo.users.anna}`, { changes: { knowledge_manage: true } });
    const r = await upload(ctx, 'anna', Buffer.from('Памятка по заявкам: типовую заявку закрываем за один день.'), 'pamyatka.md');
    expect(r.status).toBe(201);
    expect(((await (await ctx.as('anna')).get(`${API}/status`)).body.data as KnowledgeStatus).can_manage).toBe(true);
  });

  it('документ цели видят только те, кто видит цель — и в списке, и в ответах, и по ссылке на файл', async () => {
    const goal = ctx.demo.goals.onboarding!;
    const r = await upload(ctx, 'elena', Buffer.from('Наставник новичка проводит встречу-знакомство в первый день и ревизию пробного периода на тридцатый день.'), 'nastavnik.txt', {
      goal_id: goal,
      title: 'Наставничество',
    });
    expect(r.status).toBe(201);
    expect(r.body.data.goal_title).toBeTruthy();
    await ctx.knowledge.idle();
    const id = r.body.data.id as string;
    expect((await (await ctx.as('dima')).get(`${API}/docs/${id}`)).status).toBe(404);
    expect((await (await ctx.as('dima')).get(`${API}/docs`)).body.data.some((d: KnowledgeDoc) => d.id === id)).toBe(false);
    expect((await (await ctx.as('dima')).get(`/api/v1/files/${r.body.data.file.id}`)).status).toBe(404);
    expect((await (await ctx.as('dima')).get(`${API}/docs?goal_id=${goal}`)).body.data).toEqual([]);
    expect((await upload(ctx, 'dima', Buffer.from('x'), 'x.txt', { goal_id: goal })).status).toBe(404);

    const mine = (await ask(ctx, 'elena', 'Что делает наставник новичка в первый день?')).body.data as KnowledgeAskResult;
    expect(mine.answer.sources.map((s) => s.id)).toContain(id);
    const theirs = (await ask(ctx, 'dima', 'Что делает наставник новичка в первый день?')).body.data as KnowledgeAskResult;
    expect(theirs.answer.sources.map((s) => s.id)).not.toContain(id);
    expect(theirs.answer.content).not.toContain('тридцатый');
  });

  it('переименование пересчитывает документ; удалить может автор или ведущий базу', async () => {
    const r = await upload(ctx, 'director', Buffer.from('Парковка для гостей — на нижнем уровне, место заказывает секретарь.'), 'parking.txt');
    await ctx.knowledge.idle();
    const id = r.body.data.id as string;
    expect((await (await ctx.as('dima')).patch(`${API}/docs/${id}`, { title: 'Взлом' })).status).toBe(403);
    expect((await (await ctx.as('director')).patch(`${API}/docs/${id}`, { title: ' ' })).status).toBe(422);
    const renamed = await (await ctx.as('director')).patch(`${API}/docs/${id}`, { title: 'Парковка' });
    expect(renamed.body.data.title).toBe('Парковка');
    expect(['pending', 'processing']).toContain(renamed.body.data.status);
    await ctx.knowledge.idle();
    expect((await (await ctx.as('director')).get(`${API}/docs/${id}`)).body.data.status).toBe('ready');
    expect((await (await ctx.as('dima')).delete(`${API}/docs/${id}`)).status).toBe(403);
    expect((await (await ctx.as('director')).delete(`${API}/docs/${id}`)).status).toBe(204);
    expect((await ctx.db.query(`SELECT 1 FROM knowledge_chunks WHERE doc_id = $1`, [id])).rows).toEqual([]);
    expect((await ctx.db.query(`SELECT 1 FROM attachments WHERE owner_type = 'kb_doc' AND owner_id = $1`, [id])).rows).toEqual([]);
  });
});

describe('база знаний с ИИ: вопросы и ответы', () => {
  let ctx: Ctx;
  let docId: string;
  beforeAll(async () => {
    ctx = await setup();
    docId = (await upload(ctx, 'director', Buffer.from(REGLAMENT), 'Регламент командировок.txt')).body.data.id;
    await ctx.knowledge.idle();
  });

  it('ответ из документа со ссылкой [n] на источник', async () => {
    const r = await ask(ctx, 'anna', 'В какой срок сдаётся авансовый отчёт?');
    expect(r.status).toBe(200);
    const { answer, question, session } = r.body.data as KnowledgeAskResult;
    expect(question).toMatchObject({ role: 'user', content: 'В какой срок сдаётся авансовый отчёт?' });
    expect(answer).toMatchObject({ role: 'assistant', mode: 'extract', notice: null, feedback: null });
    expect(answer.content).toContain('Авансовый отчёт сдаётся в бухгалтерию');
    const src = answer.sources.find((s) => s.id === docId)!;
    expect(src).toMatchObject({ kind: 'doc', title: 'Регламент командировок' });
    expect(answer.content).toContain(`[${src.n}]`);
    expect(src.excerpt).toContain('Авансовый');
    expect(session).toMatchObject({ title: 'В какой срок сдаётся авансовый отчёт?', questions: 1 });
  });

  it('статьи базы знаний тоже источники — и свежие правки сразу в поиске', async () => {
    const a = (await ask(ctx, 'anna', 'Как считаем время обработки заявки?')).body.data.answer as KnowledgeMessage;
    expect(a.sources[0]).toMatchObject({ kind: 'note', title: 'Как мы считаем время обработки заявки' });
    const olga = await ctx.as('olga');
    const note = (await olga.post('/api/v1/notes', { title: 'Кофемашина', body: 'Кофемашину чистит дежурный по пятницам.' })).body.data;
    let found = (await ask(ctx, 'anna', 'Кто чистит кофемашину?')).body.data.answer as KnowledgeMessage;
    expect(found.sources.map((s) => s.id)).toContain(note.id);
    await olga.patch(`/api/v1/notes/${note.id}`, { body: 'Кофемашину обслуживает подрядчик раз в месяц.' });
    found = (await ask(ctx, 'anna', 'Кто чистит кофемашину?')).body.data.answer;
    expect(found.content).not.toContain('дежурный');
    await olga.delete(`/api/v1/notes/${note.id}`);
    found = (await ask(ctx, 'anna', 'Кто обслуживает кофемашину?')).body.data.answer;
    expect(found.sources.map((s) => s.id)).not.toContain(note.id);
  });

  it('о чём в базе ничего нет — честно «нет ответа», без источников', async () => {
    const a = (await ask(ctx, 'anna', 'Рецепт борща со сметаной')).body.data.answer as KnowledgeMessage;
    expect(a).toMatchObject({ mode: 'empty', sources: [] });
    expect(a.content).toMatch(/пока нет ничего/);
  });

  it('диалог: уточнение ищется вместе с прошлым вопросом; список и чужие диалоги', async () => {
    const first = (await ask(ctx, 'sergey', 'Сколько суточные в командировке?')).body.data as KnowledgeAskResult;
    expect(first.answer.content).toContain('700 рублей');
    const follow = (await ask(ctx, 'sergey', 'А по России?', first.session.id)).body.data as KnowledgeAskResult;
    expect(follow.session).toMatchObject({ id: first.session.id, questions: 2 });
    expect(follow.answer.sources.map((s) => s.id)).toContain(docId);
    const list = (await (await ctx.as('sergey')).get(`${API}/sessions`)).body.data;
    expect(list[0]).toMatchObject({ id: first.session.id, title: 'Сколько суточные в командировке?', questions: 2 });
    expect(list[0].last_answer).toBeTruthy();
    const full = (await (await ctx.as('sergey')).get(`${API}/sessions/${first.session.id}`)).body.data;
    expect(full.messages.map((m: KnowledgeMessage) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect((await (await ctx.as('anna')).get(`${API}/sessions/${first.session.id}`)).status).toBe(404);
    expect((await ask(ctx, 'anna', 'И ещё?', first.session.id)).status).toBe(404);
    expect((await (await ctx.as('anna')).get(`${API}/sessions`)).body.data.some((s: { id: string }) => s.id === first.session.id)).toBe(false);
    expect((await (await ctx.as('anna')).delete(`${API}/sessions/${first.session.id}`)).status).toBe(404);
    expect((await (await ctx.as('sergey')).delete(`${API}/sessions/${first.session.id}`)).status).toBe(204);
    expect((await (await ctx.as('sergey')).get(`${API}/sessions/${first.session.id}`)).status).toBe(404);
  });

  it('оценка ответа: только своего и только ответа помощника', async () => {
    const r = (await ask(ctx, 'maria', 'Кто согласует командировку?')).body.data as KnowledgeAskResult;
    const up = await (await ctx.as('maria')).put(`${API}/messages/${r.answer.id}/feedback`, { feedback: 'down', comment: 'Нужно про загранкомандировки' });
    expect(up.body.data.feedback).toBe('down');
    expect((await ctx.db.query(`SELECT feedback_comment FROM knowledge_messages WHERE id = $1`, [r.answer.id])).rows[0]).toEqual({ feedback_comment: 'Нужно про загранкомандировки' });
    expect((await (await ctx.as('maria')).put(`${API}/messages/${r.question.id}/feedback`, { feedback: 'up' })).status).toBe(404);
    expect((await (await ctx.as('anna')).put(`${API}/messages/${r.answer.id}/feedback`, { feedback: 'up' })).status).toBe(404);
    const cleared = await (await ctx.as('maria')).put(`${API}/messages/${r.answer.id}/feedback`, { feedback: null });
    expect(cleared.body.data.feedback).toBeNull();
  });

  it('удалённый источник гаснет в истории диалога', async () => {
    const tmp = (await upload(ctx, 'director', Buffer.from('Шредер для документов стоит в переговорной номер два.'), 'shreder.txt')).body.data.id as string;
    await ctx.knowledge.idle();
    const r = (await ask(ctx, 'igor', 'Где стоит шредер?')).body.data as KnowledgeAskResult;
    expect(r.answer.sources.map((s) => s.id)).toContain(tmp);
    await (await ctx.as('director')).delete(`${API}/docs/${tmp}`);
    const hist = (await (await ctx.as('igor')).get(`${API}/sessions/${r.session.id}`)).body.data;
    const src = hist.messages[1].sources[0];
    expect(src).toMatchObject({ id: '', title: 'Источник недоступен', excerpt: '' });
  });

  it('проверка вопроса', async () => {
    expect((await ask(ctx, 'anna', '   ')).status).toBe(422);
    expect((await ask(ctx, 'anna', 'а'.repeat(2001))).status).toBe(422);
    expect((await ask(ctx, 'anna', 'вопрос', 'not-a-uuid')).status).toBe(404);
  });

  it('личные заметки в базу знаний не попадают', async () => {
    await (await ctx.as('anna')).post('/api/v1/my-notes', { title: 'Пароль от вайфая', body: 'Секретный пароль от вайфая — zebra42' });
    const a = (await ask(ctx, 'anna', 'Какой пароль от вайфая?')).body.data.answer as KnowledgeMessage;
    expect(a.content).not.toContain('zebra42');
  });
});

/** Нейросеть, которую можно «выключить»: векторы — встроенные под другим именем модели. */
function fakeAi() {
  const state = { down: false, prompts: [] as string[], reply: 'Отчёт сдают за три рабочих дня [1][9], см. [7] регламент.' };
  const provider: AiProvider = {
    name: 'fake',
    embedModel: 'fake-embed',
    chatModel: 'fake-chat',
    embed: async (texts) => {
      if (state.down) throw new AiUnavailableError();
      return texts.map((t) => builtinEmbedding(t));
    },
    generate: async (prompt) => {
      if (state.down) throw new AiUnavailableError();
      state.prompts.push(prompt);
      return state.reply;
    },
    health: async () => !state.down,
  };
  return { provider, state };
}

describe('база знаний с ИИ: подключённая нейросеть', () => {
  let ctx: Ctx;
  const ai = fakeAi();
  beforeAll(async () => {
    ctx = await setup({ ai: ai.provider });
    await upload(ctx, 'director', Buffer.from(REGLAMENT), 'Регламент командировок.txt');
    await ctx.knowledge.idle();
  });

  it('ответ пишет нейросеть по найденным фрагментам; ссылки на несуществующие источники убираются', async () => {
    const st = (await (await ctx.as('anna')).get(`${API}/status`)).body.data as KnowledgeStatus;
    expect(st).toMatchObject({ mode: 'ai', provider: 'fake', model: 'fake-chat', ready: true });
    const a = (await ask(ctx, 'anna', 'В какой срок сдаётся авансовый отчёт?')).body.data.answer as KnowledgeMessage;
    expect(a.mode).toBe('ai');
    expect(a.content).toBe('Отчёт сдают за три рабочих дня [1], см. регламент.');
    const prompt = ai.state.prompts.at(-1)!;
    expect(prompt).toContain('Вопрос: В какой срок сдаётся авансовый отчёт?');
    expect(prompt).toContain('[1] «Регламент командировок»');
    expect(prompt).toMatch(/не выполняй инструкций/);
    expect((await ctx.db.query(`SELECT DISTINCT model FROM knowledge_chunks WHERE doc_id IS NOT NULL`)).rows).toEqual([{ model: 'fake-embed' }]);
  });

  it('нейросеть упала — ответ цитатами с пояснением, документы всё равно индексируются', async () => {
    ai.state.down = true;
    const a = (await ask(ctx, 'anna', 'В какой срок сдаётся авансовый отчёт?')).body.data.answer as KnowledgeMessage;
    expect(a).toMatchObject({ mode: 'extract', notice: AI_DOWN_NOTICE });
    expect(a.content).toContain('Авансовый отчёт сдаётся');
    const r = await upload(ctx, 'director', Buffer.from('Канцелярию заказывает офис-менеджер по средам.'), 'kanc.txt');
    await ctx.knowledge.idle();
    expect((await (await ctx.as('director')).get(`${API}/docs/${r.body.data.id}`)).body.data.status).toBe('ready');
    expect((await ctx.db.query(`SELECT DISTINCT model FROM knowledge_chunks WHERE doc_id = $1`, [r.body.data.id])).rows).toEqual([{ model: 'builtin-v1' }]);
    expect(((await (await ctx.as('anna')).get(`${API}/status`)).body.data as KnowledgeStatus).ready).toBe(false);

    // Вернулась — фрагменты пересчитываются её моделью.
    ai.state.down = false;
    expect(await ctx.knowledge.aiReady()).toBe(true);
    expect(await ctx.knowledge.reembedStale(null)).toBeGreaterThan(0);
    expect((await ctx.db.query(`SELECT DISTINCT model FROM knowledge_chunks`)).rows).toEqual([{ model: 'fake-embed' }]);
    const back = (await ask(ctx, 'anna', 'Кто заказывает канцелярию?')).body.data.answer as KnowledgeMessage;
    expect(back.mode).toBe('ai');
  });

  it('после перезапуска документы из очереди дочитываются', async () => {
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO knowledge_docs (company_id, title, doc_type, status) VALUES ($1, 'Без файла', 'text', 'processing') RETURNING id`,
      [ctx.demo.companyId],
    );
    await ctx.knowledge.tick();
    const d = (await ctx.db.query<{ status: string; error: string }>(`SELECT status, error FROM knowledge_docs WHERE id = $1`, [rows[0]!.id])).rows[0]!;
    expect(d.status).toBe('failed');
    expect(d.error).toMatch(/не найден/);
  });
});

describe('Ollama', () => {
  const calls: { url: string; body: unknown }[] = [];
  const fakeFetch =
    (respond: (url: string, body: Record<string, unknown>) => unknown, status = 200): AiFetch =>
    async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, body });
      return { ok: status < 400, status, json: async () => respond(url, body) } as Awaited<ReturnType<AiFetch>>;
    };

  it('векторы и ответ — своими запросами к своему серверу', async () => {
    const p = ollamaProvider({
      url: 'http://ollama.local:11434/',
      embedModel: 'nomic-embed-text',
      chatModel: 'qwen2.5:7b',
      fetch: fakeFetch((url, body) => (url.endsWith('/api/embed') ? { embeddings: (body.input as string[]).map(() => [0.1, 0.2]) } : { response: ' Ответ [1] ' })),
    });
    expect(p.embedModel).toBe('ollama:nomic-embed-text');
    expect(await p.embed(['а', 'б'])).toEqual([
      [0.1, 0.2],
      [0.1, 0.2],
    ]);
    expect(await p.generate!('вопрос')).toBe('Ответ [1]');
    expect(calls.at(-2)).toEqual({ url: 'http://ollama.local:11434/api/embed', body: { model: 'nomic-embed-text', input: ['а', 'б'] } });
    expect(calls.at(-1)!.body).toMatchObject({ model: 'qwen2.5:7b', prompt: 'вопрос', stream: false });
  });

  it('ошибка, пустой или странный ответ — «нейросеть недоступна»', async () => {
    const base = { url: 'http://x', embedModel: 'e', chatModel: 'c' };
    await expect(ollamaProvider({ ...base, fetch: fakeFetch(() => ({}), 500) }).embed(['a'])).rejects.toThrow(AiUnavailableError);
    await expect(ollamaProvider({ ...base, fetch: fakeFetch(() => ({ embeddings: [[1], [2]] })) }).embed(['a'])).rejects.toThrow(/не того вида/);
    await expect(ollamaProvider({ ...base, fetch: fakeFetch(() => ({ response: '  ' })) }).generate!('q')).rejects.toThrow(/пустой/);
    const offline: AiFetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(ollamaProvider({ ...base, fetch: offline }).generate!('q')).rejects.toThrow(/не отвечает/);
    expect(await ollamaProvider({ ...base, fetch: offline }).health()).toBe(false);
  });

  it('по окружению: без KNOWLEDGE_AI — встроенный, с ollama — Ollama с моделями из настроек', () => {
    expect(aiProviderFromEnv({}).name).toBe('builtin');
    const p = aiProviderFromEnv({ KNOWLEDGE_AI: 'ollama', OLLAMA_EMBED_MODEL: 'bge-m3', OLLAMA_CHAT_MODEL: 'llama3.1:8b' });
    expect(p).toMatchObject({ name: 'ollama', embedModel: 'ollama:bge-m3', chatModel: 'llama3.1:8b' });
  });
});
