import { existsSync, readdirSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import request from 'supertest';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Attachment, ChatGallery, ChatHistory, ChatMessage, ChatStats, ChatSummary } from '@offix/core';
import { sweepDrafts } from '../src/services/attachments';
import { reportPdf, speechLike, wav } from '../src/seed/demo-media';
import { NOW, recordingRealtime, setup, type Ctx } from './helpers';

type Who = keyof Ctx['demo']['users'];
const API = '/api/v1';
const run = promisify(execFile);
/** Тесты с ffmpeg пропускаются, если его нет на машине. */
const FFMPEG = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const rt = recordingRealtime();
let clock = NOW.getTime();
let ctx: Ctx;
let ffmpeg = false;
beforeAll(async () => {
  ctx = await setup({ realtime: rt, now: () => new Date(clock) });
  ffmpeg = await ctx.store.hasFfmpeg();
});
beforeEach(() => rt.clear());
afterEach(() => {
  clock = NOW.getTime();
});

const id = (who: Who) => ctx.demo.users[who];
const png = (w = 64, h = 48, color = '#2f4bff') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

async function upload(who: Who, data: Buffer, filename: string, contentType: string, fields: Record<string, string> = {}, app = ctx.app) {
  let r = request(app).post(`${API}/files`).set('Authorization', `Bearer ${await ctx.token(who)}`);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', data, { filename, contentType });
}

async function uploaded(who: Who, data: Buffer, filename: string, contentType: string, fields: Record<string, string> = {}): Promise<Attachment> {
  const r = await upload(who, data, filename, contentType, fields);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}

async function send(who: Who, chatId: string, body: Record<string, unknown>) {
  return (await ctx.as(who)).post(`${API}/chats/${chatId}/messages`, body);
}

async function sent(who: Who, chatId: string, body: Record<string, unknown>): Promise<ChatMessage> {
  const r = await send(who, chatId, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}

async function direct(a: Who, b: Who): Promise<string> {
  const r = await (await ctx.as(a)).post(`${API}/chats/direct`, { user_id: id(b) });
  expect([200, 201]).toContain(r.status);
  return r.body.data.id;
}

const raw = (url: string) => request(ctx.app).get(url);
const tmpEmpty = () => readdirSync(ctx.store.tmpDir).length === 0;
const diskOf = (a: { id: string }) => ctx.db.query<{ storage_key: string; thumb_key: string | null }>(`SELECT storage_key, thumb_key FROM attachments WHERE id = $1`, [a.id]).then((r) => r.rows[0]!);

describe('загрузка файлов', () => {
  it('фото: размеры, превью и подписанная ссылка', async () => {
    const a = await uploaded('anna', await png(640, 480), 'снимок.png', 'image/png');
    expect(a).toMatchObject({ kind: 'photo', width: 640, height: 480, uploaded_by: id('anna') });
    expect(a.thumb_url).toMatch(/^\/api\/v1\/files\/thumbs\/[0-9a-f]{32}\.jpg$/);
    expect(a.url).toMatch(new RegExp(`^/api/v1/files/${a.id}/raw\\?e=\\d+&u=${id('anna')}&s=`));
    const thumb = await raw(a.thumb_url!);
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    const file = await raw(a.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/^image\/(jpeg|png)/);
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(tmpEmpty()).toBe(true);
  });

  it('фото без геометки: EXIF не сохраняется, поворот применён', async () => {
    const withExif = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#ffb547' } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
      .toBuffer();
    const a = await uploaded('anna', withExif, 'IMG_0001.JPG', 'image/jpeg');
    // Ориентация 6 — снимок повёрнут: ширина и высота меняются местами.
    expect([a.width, a.height]).toEqual([200, 300]);
    const p = ctx.store.pathOf((await diskOf(a)).storage_key)!;
    const meta = await sharp(p).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation ?? 1).toBe(1);
  });

  it('PNG с прозрачностью остаётся PNG', async () => {
    const t = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const a = await uploaded('anna', t, 'logo.png', 'image/png');
    expect(a.mime).toBe('image/png');
    expect(a.name).toBe('logo.png');
  });

  it('документ: русское имя, размер, тип по расширению; PDF открывается, архив — скачивается', async () => {
    const pdf = await uploaded('anna', reportPdf(), 'Отчёт по заявкам.pdf', 'application/pdf');
    expect(pdf).toMatchObject({ kind: 'file', name: 'Отчёт по заявкам.pdf', mime: 'application/pdf', thumb_url: null });
    expect(pdf.size).toBe(reportPdf().length);
    const open = await raw(pdf.url);
    expect(open.headers['content-type']).toBe('application/pdf');
    expect(open.headers['content-disposition']).toMatch(/^inline/);
    const zip = await uploaded('anna', Buffer.from('PK\u0003\u0004fake'), 'смета.zip', 'application/octet-stream');
    expect(zip.mime).toBe('application/zip');
    const dl = await raw(zip.url);
    expect(dl.headers['content-type']).toBe('application/octet-stream');
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect(dl.headers['content-disposition']).toContain(encodeURIComponent('смета.zip'));
    // ?download=1 — скачать даже то, что умеет открыться.
    expect((await raw(`${pdf.url}&download=1`)).headers['content-disposition']).toMatch(/^attachment/);
  });

  it('«отправить как файл» — без сжатия и превью', async () => {
    const buf = await png(200, 100);
    const a = await uploaded('anna', buf, 'схема.png', 'image/png', { as_file: '1' });
    expect(a).toMatchObject({ kind: 'file', thumb_url: null, width: null, size: buf.length });
  });

  it('картинка, которую нельзя прочитать, становится файлом', async () => {
    const a = await uploaded('anna', Buffer.from('not really a jpeg'), 'broken.jpg', 'image/jpeg');
    expect(a.kind).toBe('file');
  });

  it('страницы, скрипты и программы не загружаются', async () => {
    for (const [name, type] of [
      ['page.html', 'text/html'],
      ['logo.svg', 'image/svg+xml'],
      ['run.exe', 'application/octet-stream'],
      ['script.js', 'application/javascript'],
      ['noext', 'text/html'],
    ]) {
      const r = await upload('anna', Buffer.from('<script>alert(1)</script>'), name!, type!);
      expect(r.status, name).toBe(422);
      expect(r.body.error.fields.file).toMatch(/нельзя/);
    }
    expect(tmpEmpty()).toBe(true);
  });

  it('без файла и без входа — понятные ошибки', async () => {
    const empty = await request(ctx.app).post(`${API}/files`).set('Authorization', `Bearer ${await ctx.token('anna')}`).field('kind', 'voice');
    expect(empty.status).toBe(422);
    const anon = await request(ctx.app).post(`${API}/files`).attach('file', Buffer.from('x'), 'a.txt');
    expect(anon.status).toBe(401);
  });

  it('предел размера — 413, временный файл удалён', async () => {
    const small = await setup({ maxUploadBytes: 1024 });
    const r = await request(small.app)
      .post(`${API}/files`)
      .set('Authorization', `Bearer ${await small.token('anna')}`)
      .attach('file', Buffer.alloc(4096, 1), { filename: 'big.bin', contentType: 'application/octet-stream' });
    expect(r.status).toBe(413);
    expect(r.body.error.message).toBe('Файл больше 1 КБ');
    expect(readdirSync(small.store.tmpDir)).toEqual([]);
    expect((await small.db.query(`SELECT COUNT(*)::int AS n FROM attachments`)).rows[0]).toEqual({ n: 0 });
  });
});

describe('подписанные ссылки', () => {
  let a: Attachment;
  beforeAll(async () => {
    a = await uploaded('anna', reportPdf(), 'plan.pdf', 'application/pdf');
  });

  it('живёт от 10 до 20 минут', async () => {
    clock = NOW.getTime() + 9 * 60_000;
    expect((await raw(a.url)).status).toBe(200);
    clock = NOW.getTime() + 21 * 60_000;
    const r = await raw(a.url);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/устарела/);
  });

  it('подделка подписи, чужой id или другой человек — 403', async () => {
    const u = new URL(a.url, 'http://x');
    const s = u.searchParams.get('s')!;
    const forged = a.url.replace(`s=${s}`, `s=${s.slice(0, -2)}AA`);
    expect((await raw(forged)).status).toBe(403);
    expect((await raw(a.url.replace(`u=${id('anna')}`, `u=${id('olga')}`))).status).toBe(403);
    const other = await uploaded('anna', reportPdf(), 'other.pdf', 'application/pdf');
    expect((await raw(a.url.replace(a.id, other.id))).status).toBe(403);
    expect((await raw(`${API}/files/${a.id}/raw`)).status).toBe(403);
    expect((await raw(`${API}/files/${a.id}/raw?e=abc&u=x&s=y`)).status).toBe(403);
  });

  it('уволенный сотрудник ссылкой больше не пользуется', async () => {
    const mine = await uploaded('sergey', reportPdf(), 'mine.pdf', 'application/pdf');
    await ctx.db.query(`UPDATE users SET active = FALSE WHERE id = $1`, [id('sergey')]);
    try {
      expect((await raw(mine.url)).status).toBe(404);
    } finally {
      await ctx.db.query(`UPDATE users SET active = TRUE WHERE id = $1`, [id('sergey')]);
    }
  });

  it('превью и аватары — только по имени из 32 hex, без выхода из папки', async () => {
    expect((await raw(`${API}/files/thumbs/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await raw(`${API}/files/thumbs/${'a'.repeat(32)}.jpg`)).status).toBe(404);
    expect((await raw(`${API}/files/avatars/x.jpg`)).status).toBe(404);
  });
});

describe('черновики', () => {
  it('черновик видит только автор; отмена удаляет файл с диска', async () => {
    const a = await uploaded('anna', await png(), 'draft.png', 'image/png');
    expect((await (await ctx.as('olga')).get(`${API}/files/${a.id}`)).status).toBe(404);
    const fresh = await (await ctx.as('anna')).get(`${API}/files/${a.id}`);
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.url).toContain(`u=${id('anna')}`);
    const { storage_key, thumb_key } = await diskOf(a);
    expect((await (await ctx.as('olga')).delete(`${API}/files/${a.id}`)).status).toBe(404);
    expect((await (await ctx.as('anna')).delete(`${API}/files/${a.id}`)).status).toBe(204);
    expect(existsSync(ctx.store.pathOf(storage_key)!)).toBe(false);
    expect(existsSync(ctx.store.pathOf(thumb_key!)!)).toBe(false);
  });

  it('несохранённые черновики старше суток убираются', async () => {
    const a = await uploaded('anna', reportPdf(), 'old.pdf', 'application/pdf');
    const { storage_key } = await diskOf(a);
    expect(await sweepDrafts(ctx.db, ctx.store, new Date(NOW.getTime() + 2 * 3_600_000))).toBe(0);
    expect(await sweepDrafts(ctx.db, ctx.store, new Date(NOW.getTime() + 25 * 3_600_000))).toBeGreaterThanOrEqual(1);
    expect(existsSync(ctx.store.pathOf(storage_key)!)).toBe(false);
  });
});

describe('медиа в чате', () => {
  let chat: string;
  beforeAll(async () => {
    const r = await (await ctx.as('anna')).post(`${API}/chats`, { name: 'Выезд на площадку', member_ids: [id('olga'), id('igor')] });
    chat = r.body.data.id;
  });

  it('альбом из трёх фото с подписью: порядок, превью в списке, ссылки — каждому свои', async () => {
    const files = [await uploaded('anna', await png(800, 600), '1.png', 'image/png'), await uploaded('anna', await png(600, 800, '#ff5d73'), '2.png', 'image/png'), await uploaded('anna', await png(), '3.png', 'image/png')];
    const m = await sent('anna', chat, { text: 'С выезда', attachment_ids: files.map((f) => f.id), client_id: 'album-1' });
    expect(m.kind).toBe('media');
    expect(m.text).toBe('С выезда');
    expect(m.attachments.map((x) => x.id)).toEqual(files.map((f) => f.id));
    const ev = rt.of('new_message')[0]!;
    const forOlga = ev.payloadFor(id('olga')) as { message: ChatMessage };
    expect(forOlga.message.attachments[0]!.url).toContain(`u=${id('olga')}`);
    expect((ev.payloadFor(id('igor')) as { message: ChatMessage }).message.attachments[0]!.url).toContain(`u=${id('igor')}`);
    const list: ChatSummary[] = (await (await ctx.as('olga')).get(`${API}/chats`)).body.data;
    const row = list.find((c) => c.id === chat)!;
    expect(row.last_message?.media).toEqual({ kind: 'photo', count: 3, name: '1.jpg' });
    // Участник видит файл, история отдаёт вложения.
    const h: ChatHistory = (await (await ctx.as('igor')).get(`${API}/chats/${chat}/messages`)).body.data;
    const got = h.messages.find((x) => x.id === m.id)!;
    expect(got.attachments).toHaveLength(3);
    expect((await raw(got.attachments[1]!.url)).status).toBe(200);
  });

  it('медиа без подписи и файлы пачкой', async () => {
    const a = await uploaded('olga', reportPdf(), 'a.pdf', 'application/pdf');
    const b = await uploaded('olga', Buffer.from('a;b\n1;2'), 'b.csv', 'text/csv');
    const m = await sent('olga', chat, { attachment_ids: [a.id, b.id] });
    expect(m.text).toBeNull();
    expect(m.attachments.map((x) => x.kind)).toEqual(['file', 'file']);
  });

  it('чужой, уже отправленный или несуществующий черновик — 422', async () => {
    const annas = await uploaded('anna', await png(), 'x.png', 'image/png');
    const r1 = await send('olga', chat, { attachment_ids: [annas.id] });
    expect(r1.status).toBe(422);
    expect(r1.body.error.fields.attachment_ids).toMatch(/не найден/);
    await sent('anna', chat, { attachment_ids: [annas.id] });
    expect((await send('anna', chat, { attachment_ids: [annas.id] })).status).toBe(422);
    expect((await send('anna', chat, { attachment_ids: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(422);
    expect((await send('anna', chat, { attachment_ids: Array(11).fill(annas.id) })).status).toBe(400);
  });

  it('без текста и файлов отправить нельзя', async () => {
    expect((await send('anna', chat, { text: '   ' })).status).toBe(422);
    expect((await send('anna', chat, {})).status).toBe(422);
  });

  it('файл чата не видит тот, кто не в чате; удалённое для всех исчезает с диска', async () => {
    const a = await uploaded('anna', reportPdf(), 'secret.pdf', 'application/pdf');
    const m = await sent('anna', chat, { attachment_ids: [a.id] });
    expect((await (await ctx.as('maria')).get(`${API}/files/${a.id}`)).status).toBe(404);
    expect((await (await ctx.as('igor')).get(`${API}/files/${a.id}`)).status).toBe(200);
    // Удалил «у себя» — сам больше не видит, остальные видят.
    await (await ctx.as('igor')).delete(`${API}/messages/${m.id}`);
    expect((await (await ctx.as('igor')).get(`${API}/files/${a.id}`)).status).toBe(404);
    expect((await (await ctx.as('olga')).get(`${API}/files/${a.id}`)).status).toBe(200);
    const { storage_key } = await diskOf(a);
    expect((await (await ctx.as('anna')).delete(`${API}/messages/${m.id}?for=all`)).status).toBe(204);
    expect((await (await ctx.as('olga')).get(`${API}/files/${a.id}`)).status).toBe(404);
    expect(existsSync(ctx.store.pathOf(storage_key)!)).toBe(false);
    expect((await raw(m.attachments[0]!.url)).status).toBe(404);
  });

  it('чужая компания не видит и не прикрепляет файлы', async () => {
    const reg = await request(ctx.app).post(`${API}/auth/register`).send({ company_name: 'Другая компания', display_name: 'Пётр', email: 'petr@other.example', password: 'very-secret' });
    const t = reg.body.data.token;
    const theirs = await request(ctx.app).post(`${API}/files`).set('Authorization', `Bearer ${t}`).attach('file', reportPdf(), { filename: 'their.pdf', contentType: 'application/pdf' });
    expect(theirs.status).toBe(201);
    expect((await (await ctx.as('anna')).get(`${API}/files/${theirs.body.data.id}`)).status).toBe(404);
    expect((await send('anna', chat, { attachment_ids: [theirs.body.data.id] })).status).toBe(422);
    const ours = await uploaded('anna', reportPdf(), 'ours.pdf', 'application/pdf');
    await sent('anna', chat, { attachment_ids: [ours.id] });
    expect((await request(ctx.app).get(`${API}/files/${ours.id}`).set('Authorization', `Bearer ${t}`)).status).toBe(404);
    // Подписанная ссылка на человека из другой компании не сработает.
    const theirId = (await request(ctx.app).get(`${API}/users/me`).set('Authorization', `Bearer ${t}`)).body.data.id as string;
    const forged = ctx.store.sign(ours.id, theirId, clock);
    expect((await raw(forged)).status).toBe(404);
  });

  it('подпись к медиа можно поправить и стереть', async () => {
    const a = await uploaded('anna', await png(), 'p.png', 'image/png');
    const m = await sent('anna', chat, { text: 'Было', attachment_ids: [a.id] });
    const r = await (await ctx.as('anna')).patch(`${API}/messages/${m.id}`, { text: 'Стало' });
    expect(r.body.data.text).toBe('Стало');
    const empty = await (await ctx.as('anna')).patch(`${API}/messages/${m.id}`, { text: '' });
    expect(empty.status).toBe(200);
    expect(empty.body.data.text).toBeNull();
    expect(empty.body.data.attachments).toHaveLength(1);
  });

  it('пересылка медиа: копия живёт после удаления исходника', async () => {
    const a = await uploaded('anna', await png(), 'fwd.png', 'image/png');
    const m = await sent('anna', chat, { text: 'Перешлю', attachment_ids: [a.id] });
    const other = await direct('anna', 'maria');
    const f = await (await ctx.as('anna')).post(`${API}/messages/forward`, { message_ids: [m.id], to_chat_id: other });
    expect(f.status).toBe(201);
    const copy: ChatMessage = f.body.data[0];
    expect(copy.kind).toBe('media');
    expect(copy.forwarded_from).toBeTruthy();
    expect(copy.attachments[0]!.id).not.toBe(a.id);
    const { storage_key } = await diskOf(a);
    await (await ctx.as('anna')).delete(`${API}/messages/${m.id}?for=all`);
    expect(existsSync(ctx.store.pathOf(storage_key)!)).toBe(true);
    const mariaView = await (await ctx.as('maria')).get(`${API}/files/${copy.attachments[0]!.id}`);
    expect(mariaView.status).toBe(200);
    expect((await raw(mariaView.body.data.url)).status).toBe(200);
  });

  it('цитата медиа-сообщения подписана «📷 Фото»', async () => {
    const a = await uploaded('anna', await png(), 'q.png', 'image/png');
    const m = await sent('anna', chat, { attachment_ids: [a.id] });
    const reply = await sent('olga', chat, { text: 'Красиво', reply_to_id: m.id });
    expect(reply.reply_to).toMatchObject({ id: m.id, kind: 'media', media: { kind: 'photo', count: 1 } });
  });

  it('удалённый чат уносит файлы', async () => {
    const r = await (await ctx.as('anna')).post(`${API}/chats`, { name: 'Временный', member_ids: [id('olga')] });
    const a = await uploaded('anna', await png(), 'tmp.png', 'image/png');
    await sent('anna', r.body.data.id, { attachment_ids: [a.id] });
    const { storage_key } = await diskOf(a);
    expect((await (await ctx.as('anna')).delete(`${API}/chats/${r.body.data.id}`)).status).toBe(204);
    expect(existsSync(ctx.store.pathOf(storage_key)!)).toBe(false);
    expect((await ctx.db.query(`SELECT 1 FROM attachments WHERE id = $1`, [a.id])).rows).toHaveLength(0);
  });
});

describe('голосовые, кружочки и контакты', () => {
  let chat: string;
  beforeAll(async () => {
    chat = await direct('olga', 'anna');
  });

  const voiceWav = () => {
    const { pcm } = speechLike(2.5, 3);
    return wav(pcm);
  };

  it('голосовое: волна, длительность, «прослушано» в реальном времени', async () => {
    const a = await uploaded('olga', voiceWav(), 'voice.webm', 'audio/webm', { kind: 'voice', waveform: '1,5,9,31,12,4', duration: '2.5' });
    expect(a.kind).toBe('voice');
    expect(a.duration).toBeCloseTo(2.5, 0);
    expect(a.waveform).toBe('1,5,9,31,12,4');
    if (ffmpeg) {
      expect(a.mime).toBe('audio/mp4');
      expect(a.name).toBe('voice.m4a');
    }
    const m = await sent('olga', chat, { attachment_ids: [a.id] });
    expect(m.kind).toBe('voice');
    expect(m.listened).toBe(false);
    // Своё прослушивание не считается.
    expect((await (await ctx.as('olga')).post(`${API}/messages/${m.id}/listen`)).status).toBe(204);
    expect(rt.of('message_listened')).toHaveLength(0);
    expect((await (await ctx.as('anna')).post(`${API}/messages/${m.id}/listen`)).status).toBe(204);
    const ev = rt.of('message_listened');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.users.sort()).toEqual([id('olga'), id('anna')].sort());
    expect(ev[0]!.payloadFor(id('olga'))).toMatchObject({ chat_id: chat, message_id: m.id, user_id: id('anna') });
    // Повтор — без нового события.
    await (await ctx.as('anna')).post(`${API}/messages/${m.id}/listen`);
    expect(rt.of('message_listened')).toHaveLength(1);
    const forOlga: ChatHistory = (await (await ctx.as('olga')).get(`${API}/chats/${chat}/messages`)).body.data;
    const forAnna: ChatHistory = (await (await ctx.as('anna')).get(`${API}/chats/${chat}/messages`)).body.data;
    expect(forOlga.messages.find((x) => x.id === m.id)!.listened).toBe(true);
    expect(forAnna.messages.find((x) => x.id === m.id)!.listened).toBe(true);
    const list: ChatSummary[] = (await (await ctx.as('anna')).get(`${API}/chats`)).body.data;
    expect(list.find((c) => c.id === chat)!.last_message?.media?.kind).toBe('voice');
  });

  it.skipIf(!FFMPEG)('волну снимает сервер, если клиент её не прислал', async () => {
    const a = await uploaded('olga', voiceWav(), 'voice.wav', 'audio/wav', { kind: 'voice' });
    expect(a.waveform).toMatch(/^\d+(,\d+)+$/);
    expect(Math.max(...a.waveform!.split(',').map(Number))).toBe(31);
  });

  it('голосовое — отдельно от фото и без подписи; «прослушать» текст нельзя', async () => {
    const v = await uploaded('olga', voiceWav(), 'v.wav', 'audio/wav', { kind: 'voice' });
    const p = await uploaded('olga', await png(), 'p.png', 'image/png');
    const mixed = await send('olga', chat, { attachment_ids: [v.id, p.id] });
    expect(mixed.status).toBe(422);
    expect(mixed.body.error.fields.attachment_ids).toMatch(/отдельно/);
    const caption = await send('olga', chat, { text: 'Послушай', attachment_ids: [v.id] });
    expect(caption.status).toBe(422);
    const t = await sent('olga', chat, { text: 'Просто текст' });
    expect((await (await ctx.as('anna')).post(`${API}/messages/${t.id}/listen`)).status).toBe(422);
  });

  it('без ffmpeg голосовое сохраняется как есть, длительность и волна — от клиента', async () => {
    const plain = await setup({ ffmpeg: false });
    expect(await plain.store.hasFfmpeg()).toBe(false);
    expect((await request(plain.app).get('/api/health')).body.media.ffmpeg).toBe(false);
    const r = await request(plain.app)
      .post(`${API}/files`)
      .set('Authorization', `Bearer ${await plain.token('olga')}`)
      .field('kind', 'voice')
      .field('waveform', '3,8,31,2')
      .field('duration', '2.5')
      .field('as_file', '0')
      .attach('file', voiceWav(), { filename: 'voice.webm', contentType: 'audio/webm' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ kind: 'voice', mime: 'audio/webm', duration: 2.5, waveform: '3,8,31,2' });
    // Мусорная волна и длительность отбрасываются.
    const bad = await request(plain.app)
      .post(`${API}/files`)
      .set('Authorization', `Bearer ${await plain.token('olga')}`)
      .field('kind', 'voice')
      .field('waveform', '99,abc')
      .field('duration', '-5')
      .attach('file', voiceWav(), { filename: 'voice.webm', contentType: 'audio/webm' });
    expect(bad.body.data).toMatchObject({ waveform: null, duration: null });
    // Видео без ffmpeg — без обложки, но открывается.
    const v = await request(plain.app)
      .post(`${API}/files`)
      .set('Authorization', `Bearer ${await plain.token('olga')}`)
      .attach('file', Buffer.from('fake mp4'), { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(v.body.data).toMatchObject({ kind: 'video', thumb_url: null, duration: null });
  });

  it.skipIf(!FFMPEG)('видео и кружочек: обложка, длительность, квадрат 480', async () => {
    const dir = ctx.store.tmpDir;
    const src = join(dir, 'gen-clip.mp4');
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
    const buf = await import('node:fs').then((fs) => fs.promises.readFile(src));
    await import('node:fs').then((fs) => fs.promises.rm(src));
    const video = await uploaded('olga', buf, 'clip.mp4', 'video/mp4');
    expect(video).toMatchObject({ kind: 'video', width: 640, height: 360 });
    expect(video.duration).toBeCloseTo(2, 0);
    expect((await raw(video.thumb_url!)).status).toBe(200);
    const note = await uploaded('olga', buf, 'note.webm', 'video/webm', { kind: 'video_note' });
    expect(note).toMatchObject({ kind: 'video_note', width: 480, height: 480, mime: 'video/mp4' });
    expect(note.thumb_url).toBeTruthy();
    const m = await sent('olga', chat, { attachment_ids: [note.id] });
    expect(m.kind).toBe('video_note');
    // Видео отдаётся кусками — перемотка работает.
    const part = await raw(video.url).set('Range', 'bytes=0-99');
    expect(part.status).toBe(206);
  });

  it('контакт: карточка сотрудника, без текста и только своей компании', async () => {
    const m = await sent('olga', chat, { contact_user_id: id('igor') });
    expect(m.kind).toBe('contact');
    expect(m.contact).toMatchObject({ id: id('igor'), display_name: 'Игорь Лебедев', position: 'Руководитель IT-департамента' });
    const list: ChatSummary[] = (await (await ctx.as('anna')).get(`${API}/chats`)).body.data;
    expect(list.find((c) => c.id === chat)!.last_message?.media).toEqual({ kind: 'contact', count: 1, name: 'Игорь Лебедев' });
    expect((await send('olga', chat, { contact_user_id: id('igor'), text: 'вот' })).status).toBe(422);
    expect((await send('olga', chat, { contact_user_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    const f = await (await ctx.as('olga')).post(`${API}/messages/forward`, { message_ids: [m.id], to_chat_id: chat });
    expect(f.body.data[0].contact.id).toBe(id('igor'));
  });
});

describe('медиа, файлы и ссылки чата', () => {
  let chat: string;
  beforeAll(async () => {
    const r = await (await ctx.as('igor')).post(`${API}/chats`, { name: 'Галерея', member_ids: [id('dima'), id('sergey')] });
    chat = r.body.data.id;
    for (let i = 0; i < 3; i++) {
      const a = await uploaded('igor', await png(100 + i, 100), `p${i}.png`, 'image/png');
      await sent('igor', chat, { attachment_ids: [a.id] });
    }
    const album = [await uploaded('dima', await png(), 'a1.png', 'image/png'), await uploaded('dima', await png(), 'a2.png', 'image/png')];
    await sent('dima', chat, { attachment_ids: album.map((a) => a.id) });
    const doc = await uploaded('sergey', reportPdf(), 'отчёт.pdf', 'application/pdf');
    await sent('sergey', chat, { text: 'Отчёт', attachment_ids: [doc.id] });
    const v = await uploaded('dima', wav(speechLike(1, 2).pcm), 'v.wav', 'audio/wav', { kind: 'voice' });
    await sent('dima', chat, { attachment_ids: [v.id] });
    await sent('sergey', chat, { text: 'Дашборд: https://offix.example/dash и вики https://wiki.example/kpi.' });
    await sent('igor', chat, { text: 'Без ссылок' });
  });

  const gallery = async (q: string, who: Who = 'sergey'): Promise<ChatGallery> => {
    const r = await (await ctx.as(who)).get(`${API}/chats/${chat}/media${q}`);
    expect(r.status).toBe(200);
    return r.body.data;
  };

  it('медиа: новые первыми, альбом целиком', async () => {
    const g = await gallery('?tab=media');
    expect(g.items.map((i) => i.attachment!.name)).toEqual(['a1.jpg', 'a2.jpg', 'p2.jpg', 'p1.jpg', 'p0.jpg']);
    expect(g.next_before).toBeNull();
    expect(g.items[0]!.attachment!.url).toContain(`u=${id('sergey')}`);
  });

  it('страницы по сообщениям: альбом не разрывается', async () => {
    const first = await gallery('?tab=media&limit=1');
    expect(first.items).toHaveLength(2);
    expect(first.next_before).toBe(first.items[0]!.seq);
    const second = await gallery(`?tab=media&limit=2&before=${first.next_before}`);
    expect(second.items.map((i) => i.attachment!.name)).toEqual(['p2.jpg', 'p1.jpg']);
  });

  it('файлы, голосовые и ссылки', async () => {
    expect((await gallery('?tab=files')).items.map((i) => i.attachment!.name)).toEqual(['отчёт.pdf']);
    expect((await gallery('?tab=voice')).items.map((i) => i.attachment!.kind)).toEqual(['voice']);
    const links = await gallery('?tab=links');
    expect(links.items.map((i) => i.link!.url)).toEqual(['https://offix.example/dash', 'https://wiki.example/kpi']);
    expect(links.items[0]!.link!.host).toBe('offix.example');
    expect((await gallery('?tab=nonsense')).items[0]!.attachment!.kind).toBe('photo');
  });

  it('не участник — 404', async () => {
    expect((await (await ctx.as('maria')).get(`${API}/chats/${chat}/media`)).status).toBe(404);
    expect((await (await ctx.as('maria')).get(`${API}/chats/${chat}/stats`)).status).toBe(404);
  });

  it('статистика чата', async () => {
    const s: ChatStats = (await (await ctx.as('dima')).get(`${API}/chats/${chat}/stats`)).body.data;
    expect(s).toMatchObject({ photos: 5, videos: 0, files: 1, voice: 1, video_notes: 0, links: 1 });
    expect(s.messages).toBe(8);
    expect(s.bytes).toBeGreaterThan(0);
    expect(s.top_senders[0]).toMatchObject({ id: id('igor'), messages: 4 });
    expect(s.first_message_at).toBeTruthy();
  });
});

describe('файлы задач и комментариев', () => {
  it('исполнитель прикрепляет файлы к задаче, видят те, кто видит задачу', async () => {
    const task = ctx.demo.tasks[Object.keys(ctx.demo.tasks)[0]!]!;
    const detail = (await (await ctx.as('director')).get(`${API}/tasks/${task}`)).body.data;
    const a = await uploaded('director', reportPdf(), 'ТЗ.pdf', 'application/pdf');
    const r = await (await ctx.as('director')).post(`${API}/tasks/${task}/files`, { attachment_ids: [a.id] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.map((f: Attachment) => f.name)).toEqual(['ТЗ.pdf']);
    const again = (await (await ctx.as('director')).get(`${API}/tasks/${task}`)).body.data;
    expect(again.files).toHaveLength(1);
    expect(detail.files).toEqual([]);
    expect((await (await ctx.as('director')).get(`${API}/files/${a.id}`)).status).toBe(200);
    // Наблюдатель не прикрепляет.
    const o = await uploaded('observer', reportPdf(), 'o.pdf', 'application/pdf');
    expect((await (await ctx.as('observer')).post(`${API}/tasks/${task}/files`, { attachment_ids: [o.id] })).status).toBe(403);
    // Аудит.
    const ev = await ctx.db.query(`SELECT event_type FROM audit_events WHERE entity_id = $1 AND event_type LIKE 'task.file%'`, [task]);
    expect(ev.rows).toEqual([{ event_type: 'task.files_added' }]);
    // Удалить.
    expect((await (await ctx.as('director')).delete(`${API}/tasks/${task}/files/${a.id}`)).status).toBe(204);
    expect((await (await ctx.as('director')).get(`${API}/tasks/${task}`)).body.data.files).toEqual([]);
    expect((await (await ctx.as('director')).delete(`${API}/tasks/${task}/files/${a.id}`)).status).toBe(404);
  });

  it('файл задачи, которую не видно, — 404', async () => {
    const r = await (await ctx.as('anna')).post(`${API}/tasks`, { title: 'Личная задача Анны' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const task = r.body.data.id;
    const a = await uploaded('anna', reportPdf(), 'личное.pdf', 'application/pdf');
    expect((await (await ctx.as('anna')).post(`${API}/tasks/${task}/files`, { attachment_ids: [a.id] })).status).toBe(201);
    const canSergey = (await (await ctx.as('sergey')).get(`${API}/tasks/${task}`)).status;
    expect((await (await ctx.as('sergey')).get(`${API}/files/${a.id}`)).status).toBe(canSergey === 200 ? 200 : 404);
  });

  it('комментарий из одного файла', async () => {
    const goal = ctx.demo.goals[Object.keys(ctx.demo.goals)[0]!]!;
    const a = await uploaded('director', await png(), 'скрин.png', 'image/png');
    const r = await (await ctx.as('director')).post(`${API}/discussions/goal/${goal}`, { body: '', attachment_ids: [a.id] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.attachments[0]).toMatchObject({ kind: 'photo', name: 'скрин.jpg' });
    const d = (await (await ctx.as('director')).get(`${API}/discussions/goal/${goal}`)).body.data;
    expect(d.comments.find((c: { id: string }) => c.id === r.body.data.id).attachments).toHaveLength(1);
    expect((await (await ctx.as('director')).post(`${API}/discussions/goal/${goal}`, { body: '' })).status).toBe(422);
    expect((await (await ctx.as('director')).get(`${API}/files/${a.id}`)).status).toBe(200);
  });
});

describe('фото профиля', () => {
  it('загрузка, замена, удаление и список фото коллег', async () => {
    const up = (buf: Buffer, name = 'me.png', type = 'image/png') =>
      ctx.token('maria').then((t) => request(ctx.app).post(`${API}/files/avatar`).set('Authorization', `Bearer ${t}`).attach('file', buf, { filename: name, contentType: type }));
    const r = await up(await png(800, 600));
    expect(r.status).toBe(200);
    const url: string = r.body.data.avatar_url;
    expect(url).toMatch(/^\/api\/v1\/files\/avatars\/[0-9a-f]{32}\.jpg$/);
    const img = await raw(url);
    expect(img.status).toBe(200);
    expect((await sharp(img.body as Buffer).metadata()).width).toBe(512);
    expect(rt.of('avatar_changed')[0]!.payloadFor('*')).toEqual({ user_id: id('maria'), avatar_url: url });
    expect((await (await ctx.as('maria')).get(`${API}/users/me`)).body.data.avatar_url).toBe(url);
    const dir = (await (await ctx.as('anna')).get(`${API}/files/avatars`)).body.data;
    expect(dir).toContainEqual({ id: id('maria'), display_name: 'Мария Васильева', avatar_url: url });
    // Замена удаляет прежний файл.
    const r2 = await up(await png(300, 300, '#3fd6a0'));
    expect((await raw(url)).status).toBe(404);
    // Не картинка.
    expect((await up(Buffer.from('nope'), 'x.png')).status).toBe(422);
    expect((await up(reportPdf(), 'x.pdf', 'application/pdf')).status).toBe(422);
    expect((await (await ctx.as('maria')).delete(`${API}/files/avatar`)).status).toBe(204);
    expect((await raw(r2.body.data.avatar_url)).status).toBe(404);
    expect((await (await ctx.as('maria')).get(`${API}/users/me`)).body.data.avatar_url).toBeNull();
  });
});

describe('push о медиа', () => {
  it('текст push — «📷 Фото», а не пустая строка', async () => {
    const { sendChatPush } = await import('../src/services/chat-jobs');
    const chat = await direct('elena', 'sergey');
    const a = await uploaded('elena', await png(), 'p.png', 'image/png');
    const m = await sent('elena', chat, { attachment_ids: [a.id] });
    await (await ctx.as('sergey')).post(`${API}/push/devices`, { token: 'ExponentPushToken[media-test]', platform: 'ios' });
    const pushed: { body?: string }[] = [];
    const row = (await ctx.db.query(`SELECT m.*, u.display_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1`, [m.id])).rows[0] as never;
    const c = (await ctx.db.query(`SELECT * FROM chats WHERE id = $1`, [chat])).rows[0] as never;
    await sendChatPush(ctx.db, { send: async (msgs) => (pushed.push(...(msgs as { body?: string }[])), []) }, recordingRealtime(), c, row, NOW.toISOString());
    expect(pushed[0]?.body).toBe('📷 Фото');
  });
});

describe('демо', () => {
  it('в демо-чатах есть альбом, PDF, голосовое и контакт', async () => {
    const { seedDemoMedia } = await import('../src/seed/demo-media');
    await seedDemoMedia(ctx.db, ctx.store, ctx.demo, NOW);
    const team: ChatHistory = (await (await ctx.as('director')).get(`${API}/chats/${ctx.demo.chats.team}/messages`)).body.data;
    const kinds = team.messages.slice(-3).map((m) => m.kind);
    expect(kinds).toEqual(['media', 'media', 'voice']);
    const [album, pdf, voice] = team.messages.slice(-3);
    expect(album!.attachments).toHaveLength(3);
    expect(album!.attachments.every((a) => a.kind === 'photo' && a.thumb_url)).toBe(true);
    expect(pdf!.attachments[0]).toMatchObject({ kind: 'file', mime: 'application/pdf' });
    expect(voice!.attachments[0]!.kind).toBe('voice');
    expect(voice!.attachments[0]!.waveform).toBeTruthy();
    expect(voice!.listened).toBe(false);
    for (const a of [...album!.attachments, ...pdf!.attachments, ...voice!.attachments]) expect((await raw(a.url)).status).toBe(200);
    const olga: ChatHistory = (await (await ctx.as('director')).get(`${API}/chats/${ctx.demo.chats.olga}/messages`)).body.data;
    expect(olga.messages.at(-1)).toMatchObject({ kind: 'contact', contact: { id: id('anna') } });
    const list: ChatSummary[] = (await (await ctx.as('director')).get(`${API}/chats`)).body.data;
    expect(list.find((c) => c.id === ctx.demo.chats.team)!.last_message?.media?.kind).toBe('voice');
  });
});
