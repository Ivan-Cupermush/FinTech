import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Attachment, ChatHistory, ChatMessage, MyNote, MyNoteDay, MyNoteSummary, NoteRequestView, NoteShareView } from '@offix/core';
import { reportPdf } from '../src/seed/demo-media';
import { NOW, TODAY, recordingRealtime, setup, type Ctx } from './helpers';

type Who = keyof Ctx['demo']['users'];
const API = '/api/v1';
const rt = recordingRealtime();
let clock = NOW.getTime();
let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup({ realtime: rt, now: () => new Date(clock) });
});
beforeEach(() => {
  rt.clear();
  clock = NOW.getTime();
});

const id = (who: Who) => ctx.demo.users[who];

async function uploaded(who: Who, name = 'план.pdf'): Promise<Attachment> {
  const r = await request(ctx.app).post(`${API}/files`).set('Authorization', `Bearer ${await ctx.token(who)}`).attach('file', reportPdf(), { filename: name, contentType: 'application/pdf' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}

async function create(who: Who, body: Record<string, unknown>): Promise<MyNote> {
  const r = await (await ctx.as(who)).post(`${API}/my-notes`, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}

async function direct(a: Who, b: Who): Promise<string> {
  const r = await (await ctx.as(a)).post(`${API}/chats/direct`, { user_id: id(b) });
  expect([200, 201]).toContain(r.status);
  return r.body.data.id;
}

async function share(who: Who, noteId: string, chatId: string, extra: Record<string, unknown> = {}): Promise<ChatMessage> {
  const r = await (await ctx.as(who)).post(`${API}/my-notes/${noteId}/share`, { chat_id: chatId, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}

const notificationsOf = (who: Who, kind: string) =>
  ctx.db.query<{ id: string; title: string; body: string; data: Record<string, string>; actor_id: string; read_at: string | null }>(
    `SELECT id, title, body, data, actor_id, read_at FROM notifications WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC`,
    [id(who), kind],
  ).then((r) => r.rows);

describe('личные заметки: создание и список', () => {
  it('создаёт заметку на сегодня, пустой заголовок — «Без названия» в выдаче', async () => {
    const n = await create('anna', { body: 'Позвонить в приёмную комиссию' });
    expect(n).toMatchObject({ title: '', note_date: TODAY, is_favorite: false, files_count: 0, attachments: [] });
    const list: MyNoteSummary[] = (await (await ctx.as('anna')).get(`${API}/my-notes`)).body.data;
    expect(list.find((x) => x.id === n.id)?.excerpt).toContain('Позвонить');
  });

  it('пустую заметку не сохраняет, плохая дата и длинный заголовок — ошибки полей', async () => {
    const a = await ctx.as('anna');
    expect((await a.post(`${API}/my-notes`, { title: '  ', body: '\n' })).body.error.fields.body).toBeTruthy();
    expect((await a.post(`${API}/my-notes`, { body: 'x', note_date: '2026-02-30' })).body.error.fields.note_date).toBeTruthy();
    expect((await a.post(`${API}/my-notes`, { title: 'x'.repeat(201), body: 'x' })).body.error.fields.title).toBeTruthy();
  });

  it('заметки видит только владелец — даже владелец компании чужие не открывает', async () => {
    const n = await create('dima', { title: 'Личное', body: 'Только моё' });
    const dir = await ctx.as('director');
    expect((await dir.get(`${API}/my-notes/${n.id}`)).status).toBe(404);
    expect((await dir.patch(`${API}/my-notes/${n.id}`, { title: 'Взлом' })).status).toBe(404);
    expect((await dir.delete(`${API}/my-notes/${n.id}`)).status).toBe(404);
    expect((await dir.get(`${API}/my-notes/${n.id}/pdf`)).status).toBe(404);
    expect(((await dir.get(`${API}/my-notes`)).body.data as MyNoteSummary[]).some((x) => x.id === n.id)).toBe(false);
    // И в общую «Базу знаний» личное не попадает.
    const kb = await dir.get(`${API}/notes?q=${encodeURIComponent('Только моё')}`);
    expect(JSON.stringify(kb.body)).not.toContain('Только моё');
  });

  it('календарь: заметки по дню и месяцу, точки дней', async () => {
    await create('sergey', { title: 'Планёрка', body: 'Повестка', note_date: '2026-11-03' });
    await create('sergey', { title: 'Отчёт', body: 'Цифры', note_date: '2026-11-03' });
    await create('sergey', { title: 'Отпуск', body: 'Заявление', note_date: '2026-11-20' });
    await create('sergey', { title: 'Декабрь', body: 'Итоги', note_date: '2026-12-01' });
    const s = await ctx.as('sergey');
    const days: MyNoteDay[] = (await s.get(`${API}/my-notes/days?month=2026-11`)).body.data;
    expect(days).toEqual([
      { date: '2026-11-03', count: 2 },
      { date: '2026-11-20', count: 1 },
    ]);
    expect(((await s.get(`${API}/my-notes?date=2026-11-03`)).body.data as MyNoteSummary[]).map((n) => n.title).sort()).toEqual(['Отчёт', 'Планёрка']);
    expect((await s.get(`${API}/my-notes?month=2026-11`)).body.data).toHaveLength(3);
    expect((await s.get(`${API}/my-notes/days?month=2026-13`)).status).toBe(422);
    expect((await s.get(`${API}/my-notes?date=вчера`)).status).toBe(422);
  });

  it('поиск по словам в заголовке и тексте', async () => {
    await create('maria', { title: 'Аудит качества', body: 'Проверить анкеты студентов' });
    await create('maria', { title: 'Покупки', body: 'Бумага, картриджи' });
    const m = await ctx.as('maria');
    const hit: MyNoteSummary[] = (await m.get(`${API}/my-notes?q=${encodeURIComponent('анкеты')}`)).body.data;
    expect(hit.map((n) => n.title)).toEqual(['Аудит качества']);
    expect((await m.get(`${API}/my-notes?q=${encodeURIComponent('картриджи бумага')}`)).body.data).toHaveLength(1);
  });

  it('избранное: наверху списка и фильтром; отметка не двигает «изменено»', async () => {
    const a = await create('elena', { title: 'Старая', body: 'a' });
    clock += 60_000;
    await create('elena', { title: 'Новая', body: 'b' });
    clock += 60_000;
    const e = await ctx.as('elena');
    const fav = await e.patch(`${API}/my-notes/${a.id}`, { is_favorite: true });
    expect(fav.body.data.updated_at).toBe(a.updated_at);
    const list: MyNoteSummary[] = (await e.get(`${API}/my-notes`)).body.data;
    expect(list[0]!.id).toBe(a.id);
    expect(((await e.get(`${API}/my-notes?favorite=1`)).body.data as MyNoteSummary[]).map((n) => n.id)).toEqual([a.id]);
    const edited = await e.patch(`${API}/my-notes/${a.id}`, { body: 'изменено' });
    expect(edited.body.data.updated_at).not.toBe(a.updated_at);
  });

  it('правка, перенос на другой день, копия и удаление', async () => {
    const n = await create('igor', { title: 'Релиз', body: 'Чек-лист\n- [ ] тесты' });
    const i = await ctx.as('igor');
    expect((await i.patch(`${API}/my-notes/${n.id}`, { note_date: '2026-10-25' })).body.data.note_date).toBe('2026-10-25');
    const copy = await i.post(`${API}/my-notes/${n.id}/duplicate`, { note_date: '2026-10-30' });
    expect(copy.status).toBe(201);
    expect(copy.body.data).toMatchObject({ title: 'Релиз (копия)', body: n.body, note_date: '2026-10-30' });
    expect((await i.delete(`${API}/my-notes/${n.id}`)).status).toBe(204);
    expect((await i.get(`${API}/my-notes/${n.id}`)).status).toBe(404);
    expect((await i.get(`${API}/my-notes/${copy.body.data.id}`)).status).toBe(200);
  });
});

describe('файлы заметки', () => {
  it('прикрепляет при создании и потом, удаляет по одному', async () => {
    const f1 = await uploaded('anna', 'один.pdf');
    const n = await create('anna', { title: 'С файлами', attachment_ids: [f1.id] });
    expect(n.files_count).toBe(1);
    expect(n.attachments[0]).toMatchObject({ id: f1.id, name: 'один.pdf' });
    const f2 = await uploaded('anna', 'два.pdf');
    const a = await ctx.as('anna');
    const more = await a.post(`${API}/my-notes/${n.id}/files`, { attachment_ids: [f2.id] });
    expect(more.status).toBe(201);
    expect((more.body.data as MyNote).attachments.map((x) => x.name)).toEqual(['один.pdf', 'два.pdf']);
    expect((await a.delete(`${API}/my-notes/${n.id}/files/${f1.id}`)).status).toBe(204);
    expect(((await a.get(`${API}/my-notes/${n.id}`)).body.data as MyNote).attachments.map((x) => x.name)).toEqual(['два.pdf']);
    expect((await a.delete(`${API}/my-notes/${n.id}/files/${f1.id}`)).status).toBe(404);
  });

  it('файл заметки открывает только владелец', async () => {
    const f = await uploaded('anna', 'личное.pdf');
    const n = await create('anna', { title: 'Скан', attachment_ids: [f.id] });
    const url = n.attachments[0]!.url;
    expect((await request(ctx.app).get(url)).status).toBe(200);
    // Подпись ссылки — на Анну; Игорь со своим токеном файл через API не откроет.
    expect((await (await ctx.as('igor')).get(`${API}/files/${f.id}`)).status).toBe(404);
  });

  it('чужой черновик не прикрепить, больше 20 файлов — нельзя', async () => {
    const theirs = await uploaded('igor');
    const n = await create('anna', { title: 'Лимит', body: 'x' });
    const a = await ctx.as('anna');
    expect((await a.post(`${API}/my-notes/${n.id}/files`, { attachment_ids: [theirs.id] })).status).toBe(422);
    const src = await uploaded('anna');
    await ctx.db.query(
      `INSERT INTO attachments (company_id, uploaded_by, owner_type, owner_id, position, kind, name, mime, size, storage_key)
       SELECT a.company_id, a.uploaded_by, 'note', $1::uuid, g, a.kind, 'f' || g || '.pdf', a.mime, a.size, a.storage_key FROM attachments a, generate_series(1, 20) g WHERE a.id = $2`,
      [n.id, src.id],
    );
    const extra = await uploaded('anna');
    const r = await a.post(`${API}/my-notes/${n.id}/files`, { attachment_ids: [extra.id] });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.attachment_ids).toContain('20');
  });

  it('удалённая заметка забирает свои файлы, а копия держит общий файл на диске', async () => {
    const f = await uploaded('anna', 'общий.pdf');
    const n = await create('anna', { title: 'Оригинал', attachment_ids: [f.id] });
    const a = await ctx.as('anna');
    const copy: MyNote = (await a.post(`${API}/my-notes/${n.id}/duplicate`, {})).body.data;
    await a.delete(`${API}/my-notes/${n.id}`);
    const still = copy.attachments[0]!;
    expect((await request(ctx.app).get(still.url)).status).toBe(200);
  });
});

describe('PDF', () => {
  it('выгружает PDF с кириллицей по токену, без публичной ссылки', async () => {
    const f = await uploaded('anna', 'приложение.pdf');
    const n = await create('anna', {
      title: 'Итоги недели',
      body: '# Главное\nСделали **много**.\n\n- пункт один\n- пункт два\n\n- [x] готово\n- [ ] в работе\n\n> цитата\n\n```\nкод\n```\n\n---\nСсылка: [offix](https://offix.example)',
      attachment_ids: [f.id],
    });
    const r = await (await ctx.as('anna')).get(`${API}/my-notes/${n.id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-disposition']).toMatch(/^inline; filename=/);
    expect(decodeURIComponent(r.headers['content-disposition']!)).toContain('Итоги недели');
    const pdf = r.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    expect(pdf.toString('latin1')).toContain('Onest');
    expect((await request(ctx.app).get(`${API}/my-notes/${n.id}/pdf`)).status).toBe(401);
    const dl = await (await ctx.as('anna')).get(`${API}/my-notes/${n.id}/pdf?download=1`);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('длинная заметка — несколько страниц с номерами', async () => {
    const n = await create('anna', { title: 'Длинная', body: Array.from({ length: 160 }, (_, i) => `Абзац ${i + 1}: текст заметки для проверки переноса.`).join('\n\n') });
    const r = await (await ctx.as('anna')).get(`${API}/my-notes/${n.id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const pages = ((r.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(2);
  });
});

describe('заметка в чате', () => {
  it('отправляет снимок: карточка в сообщении, подпись, файлы копией', async () => {
    const f = await uploaded('olga', 'регламент.pdf');
    const n = await create('olga', { title: 'Регламент приёма', body: 'Шаги: 1, 2, 3', attachment_ids: [f.id] });
    const chat = ctx.demo.chats.team;
    const msg = await share('olga', n.id, chat, { text: 'Посмотрите, пожалуйста', client_id: 'share-1' });
    expect(msg).toMatchObject({ kind: 'note', text: 'Посмотрите, пожалуйста' });
    expect(msg.note).toMatchObject({ title: 'Регламент приёма', files_count: 1, sender_id: id('olga') });
    expect(msg.note!.excerpt).toContain('Шаги');
    expect(rt.of('message').length + rt.of('new_message').length).toBeGreaterThan(0);
    // Повтор с тем же client_id — то же сообщение.
    const again = await (await ctx.as('olga')).post(`${API}/my-notes/${n.id}/share`, { chat_id: chat, client_id: 'share-1' });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(msg.id);
    // В ленте у участника — та же карточка.
    const hist: ChatHistory = (await (await ctx.as('anna')).get(`${API}/chats/${chat}/messages`)).body.data;
    expect(hist.messages.find((m) => m.id === msg.id)?.note?.title).toBe('Регламент приёма');
  });

  it('снимок не меняется, когда автор правит заметку', async () => {
    const n = await create('olga', { title: 'Версия 1', body: 'старый текст' });
    const msg = await share('olga', n.id, await direct('olga', 'anna'));
    await (await ctx.as('olga')).patch(`${API}/my-notes/${n.id}`, { title: 'Версия 2', body: 'новый текст' });
    const view: NoteShareView = (await (await ctx.as('anna')).get(`${API}/my-notes/shared/${msg.note!.id}`)).body.data;
    expect(view).toMatchObject({ title: 'Версия 1', body: 'старый текст', is_owner: false, original_note_id: null, original_exists: true, accepted_note_id: null, my_request: null });
    const own: NoteShareView = (await (await ctx.as('olga')).get(`${API}/my-notes/shared/${msg.note!.id}`)).body.data;
    expect(own).toMatchObject({ is_owner: true, original_note_id: n.id });
  });

  it('снимок открывают только участники чата; не участник — 404', async () => {
    const n = await create('olga', { title: 'Для Анны', body: 'секрет' });
    const msg = await share('olga', n.id, await direct('olga', 'anna'));
    expect((await (await ctx.as('igor')).get(`${API}/my-notes/shared/${msg.note!.id}`)).status).toBe(404);
    expect((await (await ctx.as('igor')).post(`${API}/my-notes/shared/${msg.note!.id}/accept`)).status).toBe(404);
  });

  it('в чужой чат не отправить, чужую заметку — тоже', async () => {
    const n = await create('olga', { title: 'Моя', body: 'x' });
    const notMine = await direct('anna', 'igor');
    expect((await (await ctx.as('olga')).post(`${API}/my-notes/${n.id}/share`, { chat_id: notMine })).status).toBe(404);
    expect((await (await ctx.as('anna')).post(`${API}/my-notes/${n.id}/share`, { chat_id: await direct('anna', 'olga') })).status).toBe(404);
  });

  it('сохранить к себе: копия с файлами, повторно — та же копия', async () => {
    const f = await uploaded('olga', 'смета.pdf');
    const n = await create('olga', { title: 'Смета', body: 'Итог: 100', attachment_ids: [f.id] });
    const msg = await share('olga', n.id, await direct('olga', 'dima'));
    const d = await ctx.as('dima');
    const acc = await d.post(`${API}/my-notes/shared/${msg.note!.id}/accept`);
    expect(acc.status).toBe(201);
    const mine: MyNote = acc.body.data;
    expect(mine).toMatchObject({ title: 'Смета', body: 'Итог: 100', note_date: TODAY, files_count: 1 });
    expect((await request(ctx.app).get(mine.attachments[0]!.url)).status).toBe(200);
    const again = await d.post(`${API}/my-notes/shared/${msg.note!.id}/accept`);
    expect(again.body.data.id).toBe(mine.id);
    expect(((await d.get(`${API}/my-notes/shared/${msg.note!.id}`)).body.data as NoteShareView).accepted_note_id).toBe(mine.id);
    // Автор удалил оригинал — у Димы копия осталась.
    await (await ctx.as('olga')).delete(`${API}/my-notes/${n.id}`);
    expect((await d.get(`${API}/my-notes/${mine.id}`)).status).toBe(200);
    expect((await request(ctx.app).get(mine.attachments[0]!.url)).status).toBe(200);
  });

  it('пересылка заметки ведёт к тому же снимку', async () => {
    const n = await create('olga', { title: 'Пересылаемая', body: 'текст' });
    const msg = await share('olga', n.id, await direct('olga', 'anna'));
    const toIgor = await direct('anna', 'igor');
    const fw = await (await ctx.as('anna')).post(`${API}/messages/forward`, { message_ids: [msg.id], to_chat_id: toIgor });
    expect(fw.status, JSON.stringify(fw.body)).toBe(201);
    expect((fw.body.data as ChatMessage[])[0]).toMatchObject({ kind: 'note', note: { id: msg.note!.id, title: 'Пересылаемая' } });
    expect((await (await ctx.as('igor')).get(`${API}/my-notes/shared/${msg.note!.id}`)).status).toBe(200);
  });

  it('подпись к заметке можно изменить и стереть', async () => {
    const n = await create('olga', { title: 'С подписью', body: 'x' });
    const msg = await share('olga', n.id, await direct('olga', 'anna'), { text: 'Черновик' });
    const o = await ctx.as('olga');
    expect((await o.patch(`${API}/messages/${msg.id}`, { text: 'Финал' })).body.data.text).toBe('Финал');
    expect((await o.patch(`${API}/messages/${msg.id}`, { text: '' })).body.data.text).toBeNull();
  });

  it('удалил сообщение для всех — снимок больше не открыть получателю', async () => {
    const n = await create('olga', { title: 'Отозвать', body: 'x' });
    const msg = await share('olga', n.id, await direct('olga', 'maria'));
    await (await ctx.as('olga')).delete(`${API}/messages/${msg.id}?for=all`);
    expect((await (await ctx.as('maria')).get(`${API}/my-notes/shared/${msg.note!.id}`)).status).toBe(404);
  });
});

describe('запрос свежей версии', () => {
  async function shared(owner: Who, to: Who, title = 'Планы') {
    const n = await create(owner, { title, body: 'версия 1' });
    const msg = await share(owner, n.id, await direct(owner, to));
    return { note: n, shareId: msg.note!.id };
  }

  it('запрос → уведомление автору → «поделиться» → у запросившего «Название (2)»', async () => {
    const { note, shareId } = await shared('maria', 'sergey', 'Чек-лист аудита');
    const s = await ctx.as('sergey');
    await s.post(`${API}/my-notes/shared/${shareId}/accept`);
    clock += 3_600_000;
    await (await ctx.as('maria')).patch(`${API}/my-notes/${note.id}`, { body: 'версия 2' });
    const r = await s.post(`${API}/my-notes/shared/${shareId}/request`);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'pending', already: false });
    // Повторный запрос не дублируется.
    const dup = await s.post(`${API}/my-notes/shared/${shareId}/request`);
    expect(dup.status).toBe(200);
    expect(dup.body.data).toMatchObject({ id: r.body.data.id, already: true });

    const [n] = await notificationsOf('maria', 'note_request');
    expect(n).toMatchObject({ title: 'Сергей Ким просит свежую версию заметки', body: 'Чек-лист аудита', actor_id: id('sergey'), read_at: null });
    expect(n!.data).toEqual({ request_id: r.body.data.id, share_id: shareId });
    expect(await notificationsOf('maria', 'note_request')).toHaveLength(1);

    const m = await ctx.as('maria');
    const view: NoteRequestView = (await m.get(`${API}/my-notes/requests/${r.body.data.id}`)).body.data;
    expect(view).toMatchObject({ is_owner: true, status: 'pending', requester: { id: id('sergey') }, note: { id: note.id, preview: 'версия 2', changed_since_share: true } });
    const theirs: NoteRequestView = (await s.get(`${API}/my-notes/requests/${r.body.data.id}`)).body.data;
    expect(theirs.note).toMatchObject({ id: null, preview: null, files_count: null });

    const ok = await m.post(`${API}/my-notes/requests/${r.body.data.id}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('approved');
    expect((await notificationsOf('maria', 'note_request'))[0]!.read_at).not.toBeNull();
    const [done] = await notificationsOf('sergey', 'note_request_approved');
    expect(done!.body).toBe('Чек-лист аудита (2)');
    const copy: MyNote = (await s.get(`${API}/my-notes/${done!.data.note_id}`)).body.data;
    expect(copy).toMatchObject({ title: 'Чек-лист аудита (2)', body: 'версия 2' });
    const after: NoteRequestView = (await s.get(`${API}/my-notes/requests/${r.body.data.id}`)).body.data;
    expect(after.result_note_id).toBe(copy.id);
    // Ответить второй раз — ничего не меняется.
    await m.post(`${API}/my-notes/requests/${r.body.data.id}/approve`);
    expect(await notificationsOf('sergey', 'note_request_approved')).toHaveLength(1);
  });

  it('автор отказал — запросивший узнаёт, может попросить снова', async () => {
    const { shareId } = await shared('maria', 'elena');
    const e = await ctx.as('elena');
    const r = await e.post(`${API}/my-notes/shared/${shareId}/request`);
    const no = await (await ctx.as('maria')).post(`${API}/my-notes/requests/${r.body.data.id}/decline`);
    expect(no.body.data.status).toBe('declined');
    expect(await notificationsOf('elena', 'note_request_declined')).toHaveLength(1);
    expect(((await e.get(`${API}/my-notes/shared/${shareId}`)).body.data as NoteShareView).my_request?.status).toBe('declined');
    expect((await e.post(`${API}/my-notes/shared/${shareId}/request`)).status).toBe(201);
  });

  it('ответить может только автор; посторонний запрос не видит', async () => {
    const { shareId } = await shared('maria', 'dima');
    const r = await (await ctx.as('dima')).post(`${API}/my-notes/shared/${shareId}/request`);
    expect((await (await ctx.as('dima')).post(`${API}/my-notes/requests/${r.body.data.id}/approve`)).status).toBe(403);
    expect((await (await ctx.as('igor')).get(`${API}/my-notes/requests/${r.body.data.id}`)).status).toBe(404);
    expect((await (await ctx.as('igor')).post(`${API}/my-notes/requests/${r.body.data.id}/decline`)).status).toBe(404);
  });

  it('свою заметку и удалённый оригинал запросить нельзя', async () => {
    const { note, shareId } = await shared('maria', 'anna');
    expect((await (await ctx.as('maria')).post(`${API}/my-notes/shared/${shareId}/request`)).status).toBe(409);
    await (await ctx.as('maria')).delete(`${API}/my-notes/${note.id}`);
    const r = await (await ctx.as('anna')).post(`${API}/my-notes/shared/${shareId}/request`);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('удалил');
  });

  it('автор удалил заметку после запроса — поделиться нечем', async () => {
    const { note, shareId } = await shared('maria', 'igor');
    const r = await (await ctx.as('igor')).post(`${API}/my-notes/shared/${shareId}/request`);
    await (await ctx.as('maria')).delete(`${API}/my-notes/${note.id}`);
    expect((await (await ctx.as('maria')).post(`${API}/my-notes/requests/${r.body.data.id}/approve`)).status).toBe(409);
  });
});

describe('лента уведомлений', () => {
  it('автор и статус запроса в ленте, счётчик непрочитанных, отметка и очистка', async () => {
    const n = await create('igor', { title: 'Архитектура', body: 'схема' });
    const msg = await share('igor', n.id, await direct('igor', 'dima'));
    const r = await (await ctx.as('dima')).post(`${API}/my-notes/shared/${msg.note!.id}/request`);
    expect(rt.of('notification')[0]?.users).toEqual([id('igor')]);
    const i = await ctx.as('igor');
    const before = (await i.get(`${API}/notifications/unread-count`)).body.data.count as number;
    const [item] = (await i.get(`${API}/notifications?unread=1`)).body.data;
    expect(item).toMatchObject({ kind: 'note_request', actor_id: id('dima'), actor_name: 'Дмитрий Орлов', request_status: 'pending', data: { request_id: r.body.data.id } });
    await i.post(`${API}/my-notes/requests/${r.body.data.id}/decline`);
    const after = (await i.get(`${API}/notifications`)).body.data.find((x: { id: string }) => x.id === item.id);
    expect(after).toMatchObject({ request_status: 'declined' });
    expect(after.read_at).not.toBeNull();
    expect((await i.get(`${API}/notifications/unread-count`)).body.data.count).toBe(before - 1);
    expect(rt.of('notification').map((e) => e.users[0])).toContain(id('dima'));
    // Страницы по времени.
    const page = (await i.get(`${API}/notifications?limit=1`)).body.data;
    expect(page).toHaveLength(1);
    const next = (await i.get(`${API}/notifications?limit=50&before=${encodeURIComponent(page[0].created_at)}`)).body.data as { created_at: string }[];
    expect(next.every((x) => x.created_at < page[0].created_at)).toBe(true);
    expect((await i.get(`${API}/notifications?before=вчера`)).status).toBe(422);
    // Удалить одно и очистить прочитанные.
    expect((await i.delete(`${API}/notifications/${item.id}`)).status).toBe(204);
    expect(((await i.get(`${API}/notifications`)).body.data as { id: string }[]).some((x) => x.id === item.id)).toBe(false);
    await i.post(`${API}/notifications/read`, {});
    expect((await i.delete(`${API}/notifications?read=1`)).status).toBe(204);
    expect((await i.get(`${API}/notifications`)).body.data).toEqual([]);
  });

  it('чужое уведомление не удалить', async () => {
    const n = await create('igor', { title: 'Чужое', body: 'x' });
    const msg = await share('igor', n.id, await direct('igor', 'sergey'));
    await (await ctx.as('sergey')).post(`${API}/my-notes/shared/${msg.note!.id}/request`);
    const [item] = (await (await ctx.as('igor')).get(`${API}/notifications?unread=1`)).body.data;
    await (await ctx.as('sergey')).delete(`${API}/notifications/${item.id}`);
    expect(((await (await ctx.as('igor')).get(`${API}/notifications`)).body.data as { id: string }[]).some((x) => x.id === item.id)).toBe(true);
  });
});
