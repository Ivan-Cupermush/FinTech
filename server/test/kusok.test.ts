import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Attachment, ChatMessage, KnowledgeDoc } from '@offix/core';
import { findKusokModule, isKusokKey, kusokId, loadKusok, parseBlobMode, reconcileRefs } from '../src/services/blobs';
import { sweepDrafts } from '../src/services/attachments';
import { createMediaStore } from '../src/services/media';
import { backupKusok, backupRequested, isStorageNight, migrateLegacyFiles, nightlyStorage } from '../src/services/storage-jobs';
import { reportPdf } from '../src/seed/demo-media';
import { NOW, SECRET, setup, type Ctx } from './helpers';

/**
 * Оригиналы в kusok: дедупликация, отдача кусками, пересылка и удаление по
 * счётчику ссылок, перенос старых файлов и ночная уборка.
 *
 * Нужна собранная привязка (npm run kusok:build). Локально без неё тесты
 * пропускаются; в CI привязка собирается всегда, и там её отсутствие — ошибка.
 */
const BUILT = !!loadKusok().module;
if (!BUILT && process.env.CI) throw new Error(`В CI kusok должен быть собран: ${loadKusok().error}`);

type Who = keyof Ctx['demo']['users'];
const API = '/api/v1';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('выбор хранилища', () => {
  it('UPLOADS_STORE: kusok, fs, остальное — auto', () => {
    expect(parseBlobMode('kusok')).toBe('kusok');
    expect(parseBlobMode(' FS ')).toBe('fs');
    expect(parseBlobMode(undefined)).toBe('auto');
    expect(parseBlobMode('s3')).toBe('auto');
  });

  it('привязку ищем вверх от сервера; без собранного kusok.node — нет', () => {
    const root = mkdtempSync(join(tmpdir(), 'offix-kusok-find-'));
    const deep = join(root, 'server', 'dist');
    mkdirSync(deep, { recursive: true });
    expect(findKusokModule({}, deep)).toBeNull();
    mkdirSync(join(root, 'native', 'kusok', 'bindings', 'node'), { recursive: true });
    writeFileSync(join(root, 'native', 'kusok', 'bindings', 'node', 'index.js'), '');
    expect(findKusokModule({}, deep)).toBeNull();
    mkdirSync(join(root, 'native', 'kusok', 'build'), { recursive: true });
    writeFileSync(join(root, 'native', 'kusok', 'build', 'kusok.node'), '');
    expect(findKusokModule({}, deep)).toBe(join(root, 'native', 'kusok', 'bindings', 'node', 'index.js'));
    expect(findKusokModule({ KUSOK_MODULE: '/opt/kusok/index.js' }, deep)).toBe('/opt/kusok/index.js');
  });

  it('UPLOADS_STORE=fs — kusok не открывается, оригиналы в files/', () => {
    const store = createMediaStore({ dir: mkdtempSync(join(tmpdir(), 'offix-fs-')), maxBytes: 1e6, ffmpegDir: null, store: 'fs' }, SECRET);
    expect(store.blobs).toBe('fs');
    expect(store.kusok).toBeNull();
    expect(store.openBlob(`kusok:${'a'.repeat(64)}`)).toBeNull();
  });

  it.runIf(BUILT)('auto и kusok — открывают хранилище в UPLOADS_DIR/kusok', () => {
    const dir = mkdtempSync(join(tmpdir(), 'offix-auto-'));
    const store = createMediaStore({ dir, maxBytes: 1e6, ffmpegDir: null, store: 'auto' }, SECRET);
    expect(store.blobs).toBe('kusok');
    expect(existsSync(join(dir, 'kusok'))).toBe(true);
    store.close();
  });

  it('ночь для уборки — с 3 до 5 по Москве', () => {
    expect(isStorageNight(new Date('2026-11-02T00:30:00Z'))).toBe(true); // 03:30 МСК
    expect(isStorageNight(new Date('2026-11-02T01:59:00Z'))).toBe(true); // 04:59
    expect(isStorageNight(new Date('2026-11-02T02:00:00Z'))).toBe(false); // 05:00
    expect(isStorageNight(new Date('2026-11-01T23:59:00Z'))).toBe(false); // 02:59
  });
});

describe.runIf(BUILT)('kusok: вложения', () => {
  let ctx: Ctx;
  let chat: string;
  const id = (who: Who) => ctx.demo.users[who];
  const keyOf = async (a: { id: string }) => (await ctx.db.query<{ storage_key: string }>(`SELECT storage_key FROM attachments WHERE id = $1`, [a.id])).rows[0]!.storage_key;
  const refs = (key: string) => ctx.store.kusok!.refs(kusokId(key));

  async function uploaded(who: Who, data: Buffer, filename: string, contentType: string): Promise<Attachment> {
    const r = await request(ctx.app).post(`${API}/files`).set('Authorization', `Bearer ${await ctx.token(who)}`).attach('file', data, { filename, contentType });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data;
  }
  async function sent(who: Who, chatId: string, body: Record<string, unknown>): Promise<ChatMessage> {
    const r = await (await ctx.as(who)).post(`${API}/chats/${chatId}/messages`, body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data;
  }
  const bytes = (url: string, range?: string) => {
    let r = request(ctx.app).get(url);
    if (range) r = r.set('Range', range);
    return r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  };

  beforeAll(async () => {
    ctx = await setup({ blobs: 'kusok', ffmpeg: false });
    const r = await (await ctx.as('anna')).post(`${API}/chats`, { name: 'Хранилище', member_ids: [id('olga'), id('igor')] });
    chat = r.body.data.id;
  });
  afterAll(() => ctx.store.close());

  it('ключ — kusok:<SHA-256 содержимого>; одинаковый файл хранится один раз', async () => {
    const pdf = reportPdf();
    const a = await uploaded('anna', pdf, 'отчёт.pdf', 'application/pdf');
    const b = await uploaded('igor', pdf, 'копия отчёта.pdf', 'application/pdf');
    const ka = await keyOf(a);
    expect(isKusokKey(ka)).toBe(true);
    expect(ka).toBe(`kusok:${sha(pdf)}`);
    expect(await keyOf(b)).toBe(ka);
    // Две строки — две ссылки; имена у каждого свои.
    expect(refs(ka)).toBe(2);
    expect([a.name, b.name]).toEqual(['отчёт.pdf', 'копия отчёта.pdf']);
    expect(existsSync(join(ctx.store.root, 'files'))).toBe(true);
    expect(ctx.store.pathOf(ka)).toBeNull();
  });

  it('отдача: целиком, кусок (206), с конца, вне файла (416), повтор по ETag (304), HEAD', async () => {
    const data = randomBytes(700_000); // больше шага чтения — поток из нескольких кусков
    const a = await uploaded('anna', data, 'данные.bin', 'application/octet-stream');
    const full = await bytes(a.url);
    expect(full.status).toBe(200);
    expect(Buffer.compare(full.body as Buffer, data)).toBe(0);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['content-length'], JSON.stringify(full.headers)).toBe(String(data.length));
    expect(full.headers.etag).toBe(`"${sha(data)}"`);
    expect(full.headers['content-type']).toBe('application/octet-stream');
    expect(full.headers['content-disposition']).toContain('attachment');
    expect(full.headers['content-security-policy']).toContain('sandbox');

    const part = await bytes(a.url, 'bytes=262000-262999');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 262000-262999/${data.length}`);
    expect(Buffer.compare(part.body as Buffer, data.subarray(262000, 263000))).toBe(0);

    const tail = await bytes(a.url, 'bytes=-10');
    expect(tail.status).toBe(206);
    expect(Buffer.compare(tail.body as Buffer, data.subarray(data.length - 10))).toBe(0);

    const open = await bytes(a.url, `bytes=${data.length - 3}-`);
    expect(Buffer.compare(open.body as Buffer, data.subarray(data.length - 3))).toBe(0);

    const out = await bytes(a.url, `bytes=${data.length + 5}-${data.length + 10}`);
    expect(out.status).toBe(416);
    expect(out.headers['content-range']).toBe(`bytes */${data.length}`);

    expect((await request(ctx.app).get(a.url).set('If-None-Match', `"${sha(data)}"`)).status).toBe(304);
    // If-Range с чужим ETag — файл целиком.
    const stale = await bytes(a.url, 'bytes=0-9');
    expect(stale.status).toBe(206);
    const ifRange = await request(ctx.app).get(a.url).set('Range', 'bytes=0-9').set('If-Range', '"other-etag"');
    expect(ifRange.status).toBe(200);

    const head = await request(ctx.app).head(a.url);
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe(String(data.length));
  });

  it('PDF открывается в браузере, а не скачивается; пустой файл — 200 и 0 байт', async () => {
    const pdf = await uploaded('anna', reportPdf(), 'план.pdf', 'application/pdf');
    const r = await request(ctx.app).get(pdf.url);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toContain('inline');
    const empty = await uploaded('anna', Buffer.alloc(0), 'пусто.txt', 'text/plain');
    const e = await request(ctx.app).get(empty.url);
    expect(e.status).toBe(200);
    expect(e.headers['content-length']).toBe('0');
  });

  it('подпись по-прежнему обязательна', async () => {
    const a = await uploaded('anna', randomBytes(100), 'x.bin', 'application/octet-stream');
    expect((await request(ctx.app).get(`${API}/files/${a.id}/raw`)).status).toBe(403);
    expect((await request(ctx.app).get(a.url.replace(/s=[^&]+/, 's=AAAA'))).status).toBe(403);
  });

  it('пересылка добавляет ссылку; удаление исходника её снимает, копия открывается', async () => {
    const data = randomBytes(5000);
    const a = await uploaded('anna', data, 'вложение.bin', 'application/octet-stream');
    const m = await sent('anna', chat, { attachment_ids: [a.id] });
    const key = await keyOf(a);
    expect(refs(key)).toBe(1);
    const other = (await (await ctx.as('anna')).post(`${API}/chats/direct`, { user_id: id('maria') })).body.data.id;
    const f = await (await ctx.as('anna')).post(`${API}/messages/forward`, { message_ids: [m.id], to_chat_id: other });
    expect(f.status).toBe(201);
    const copy: ChatMessage = f.body.data[0];
    expect(refs(key)).toBe(2);
    expect((await (await ctx.as('anna')).delete(`${API}/messages/${m.id}?for=all`)).status).toBe(204);
    expect(refs(key)).toBe(1);
    const view = await (await ctx.as('maria')).get(`${API}/files/${copy.attachments[0]!.id}`);
    expect(Buffer.compare((await bytes(view.body.data.url)).body as Buffer, data)).toBe(0);
    expect((await (await ctx.as('anna')).delete(`${API}/messages/${copy.id}?for=all`)).status).toBe(204);
    expect(refs(key)).toBe(0);
  });

  it('отменённый и забытый черновик отпускают файл', async () => {
    const a = await uploaded('anna', randomBytes(3000), 'черновик.bin', 'application/octet-stream');
    const key = await keyOf(a);
    expect((await (await ctx.as('anna')).delete(`${API}/files/${a.id}`)).status).toBe(204);
    expect(refs(key)).toBe(0);
    const b = await uploaded('anna', randomBytes(3000), 'забыт.bin', 'application/octet-stream');
    const kb = await keyOf(b);
    await sweepDrafts(ctx.db, ctx.store, new Date(NOW.getTime() + 25 * 3_600_000));
    expect(refs(kb)).toBe(0);
  });

  it('фото: оригинал в kusok, превью — обычным файлом; временных файлов не остаётся', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2f4bff' } }).png().toBuffer();
    const a = await uploaded('anna', png, 'фото.png', 'image/png');
    expect(a.kind).toBe('photo');
    expect(isKusokKey(await keyOf(a))).toBe(true);
    expect(a.thumb_url).toMatch(/^\/api\/v1\/files\/thumbs\/[0-9a-f]{32}\.jpg$/);
    expect((await request(ctx.app).get(a.thumb_url!)).status).toBe(200);
    const jpg = await bytes(a.url);
    expect((await sharp(jpg.body as Buffer).metadata()).width).toBe(300);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(ctx.store.tmpDir)).toEqual([]);
  });

  it('документ базы знаний из kusok читается и разбирается', async () => {
    const text = 'Регламент парковки.\n\nМесто на парковке закрепляется за сотрудником приказом ректора на календарный год.';
    const r = await request(ctx.app).post(`${API}/knowledge/docs`).set('Authorization', `Bearer ${await ctx.token('director')}`).attach('file', Buffer.from(text), 'Парковка.txt');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await ctx.knowledge.idle();
    const doc = (await (await ctx.as('director')).get(`${API}/knowledge/docs/${r.body.data.id}`)).body.data as KnowledgeDoc;
    expect(doc.status).toBe('ready');
    expect(doc.chunks).toBeGreaterThanOrEqual(1);
    expect((await request(ctx.app).get(doc.file!.url)).text).toContain('приказом ректора');
  });
});

describe.runIf(BUILT)('kusok: перенос старых файлов и ночная уборка', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup({ blobs: 'kusok', ffmpeg: false });
  });
  afterAll(() => ctx.store.close());

  /** Строка вложения со старым ключом files/ — как до kusok. */
  async function legacy(data: Buffer | null, copies = 1): Promise<{ key: string; ids: string[] }> {
    const hex = randomBytes(16).toString('hex');
    const key = `files/${hex.slice(0, 2)}/${hex}.bin`;
    if (data) {
      mkdirSync(join(ctx.store.root, 'files', hex.slice(0, 2)), { recursive: true });
      writeFileSync(join(ctx.store.root, key), data);
    }
    const ids: string[] = [];
    for (let i = 0; i < copies; i++) {
      const { rows } = await ctx.db.query<{ id: string }>(
        `INSERT INTO attachments (company_id, uploaded_by, kind, name, mime, size, storage_key) VALUES ($1, $2, 'file', 'старый.bin', 'application/octet-stream', $3, $4) RETURNING id`,
        [ctx.demo.companyId, ctx.demo.users.anna, data?.length ?? 1, key],
      );
      ids.push(rows[0]!.id);
    }
    return { key, ids };
  }
  const keyOf = async (attId: string) => (await ctx.db.query<{ storage_key: string }>(`SELECT storage_key FROM attachments WHERE id = $1`, [attId])).rows[0]!.storage_key;

  it('старый файл переезжает в kusok: ключ во всех строках, ссылка на каждую, старый файл удалён', async () => {
    const data = randomBytes(40_000);
    const one = await legacy(data, 3);
    const gone = await legacy(null);
    const r = await migrateLegacyFiles(ctx.db, ctx.store, { limit: 50 });
    expect(r).toMatchObject({ moved: 1, missing: 1, failed: 0, more: false });
    const key = `kusok:${sha(data)}`;
    for (const i of one.ids) expect(await keyOf(i)).toBe(key);
    expect(ctx.store.kusok!.refs(sha(data))).toBe(3);
    expect(existsSync(join(ctx.store.root, one.key))).toBe(false);
    // Пропавший файл не трогаем: строка со старым ключом, отдать её всё равно было нечего.
    expect(await keyOf(gone.ids[0]!)).toBe(gone.key);
    // Файл по-прежнему открывается по ссылке.
    const url = (await (await ctx.as('anna')).get(`${API}/files/${one.ids[0]}`)).body.data.url as string;
    const got = await request(ctx.app).get(url).buffer(true).parse((res, cb) => {
      const c: Buffer[] = [];
      res.on('data', (x: Buffer) => c.push(x));
      res.on('end', () => cb(null, Buffer.concat(c)));
    });
    expect(Buffer.compare(got.body as Buffer, data)).toBe(0);
  });

  it('пачками: limit и признак «есть ещё»', async () => {
    await legacy(randomBytes(1000));
    await legacy(randomBytes(1000));
    await legacy(randomBytes(1000));
    const skip = new Set<string>();
    const first = await migrateLegacyFiles(ctx.db, ctx.store, { limit: 2, skip });
    expect(first.moved + first.missing).toBe(2);
    expect(first.more).toBe(true);
    const rest = await migrateLegacyFiles(ctx.db, ctx.store, { limit: 10, skip });
    expect(rest.more).toBe(false);
    const left = await ctx.db.query(`SELECT 1 FROM attachments WHERE storage_key LIKE 'files/%' AND NOT (storage_key = ANY($1::text[]))`, [[...skip]]);
    expect(left.rows).toEqual([]);
  });

  it('без kusok перенос ничего не делает', async () => {
    const fsStore = createMediaStore({ dir: mkdtempSync(join(tmpdir(), 'offix-nomig-')), maxBytes: 1e6, ffmpegDir: null, store: 'fs' }, SECRET);
    expect(await migrateLegacyFiles(ctx.db, fsStore)).toEqual({ moved: 0, missing: 0, failed: 0, more: false });
    expect(await nightlyStorage(ctx.db, fsStore)).toBeNull();
  });

  it('ночью: счётчик ниже числа строк поднимается до сборки мусора — живой файл не теряется', async () => {
    const data = randomBytes(20_000);
    const r = await request(ctx.app).post(`${API}/files`).set('Authorization', `Bearer ${await ctx.token('anna')}`).attach('file', data, { filename: 'живой.bin', contentType: 'application/octet-stream' });
    const key = await keyOf(r.body.data.id);
    // Как после отката транзакции, где ссылку уже сняли.
    ctx.store.kusok!.unref(kusokId(key));
    expect(ctx.store.kusok!.refs(kusokId(key))).toBe(0);
    const night = await nightlyStorage(ctx.db, ctx.store);
    expect(night!.reconcile.raised).toBeGreaterThanOrEqual(1);
    expect(night!.broken).toBe(false);
    expect(night!.fsck.brokenFiles).toBe(0);
    expect(ctx.store.kusok!.refs(kusokId(key))).toBe(1);
    expect((await request(ctx.app).get(r.body.data.url)).status).toBe(200);
  });

  it('файл без строк в базе отпускается только со второй ночи — загрузка в процессе не страдает', async () => {
    const tmp = join(ctx.store.tmpDir, 'сирота.bin');
    const data = randomBytes(10_000);
    writeFileSync(tmp, data);
    const { id } = await ctx.store.kusok!.putFile(tmp);
    const first = await nightlyStorage(ctx.db, ctx.store);
    expect(first!.reconcile.pending).toBeGreaterThanOrEqual(1);
    expect(ctx.store.kusok!.refs(id)).toBe(1);
    expect(JSON.parse(readFileSync(join(ctx.store.root, 'kusok-orphans.json'), 'utf8'))).toContain(id);
    const second = await nightlyStorage(ctx.db, ctx.store);
    expect(second!.reconcile.released).toBeGreaterThanOrEqual(1);
    expect(ctx.store.kusok!.refs(id)).toBe(0);
  });
});

describe.runIf(BUILT)('сверка ссылок отдельно от базы', () => {
  it('ключ из базы, которого нет в kusok, попадает в отчёт', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'offix-rec-'));
    const store = createMediaStore({ dir, maxBytes: 1e6, ffmpegDir: null, store: 'kusok' }, SECRET);
    const r = reconcileRefs(store.kusok!, new Map([['f'.repeat(64), 2]]), join(dir, 'orphans.json'));
    expect(r.missing).toEqual(['f'.repeat(64)]);
    expect(r.ids).toBe(0);
    store.close();
  });
});

describe.runIf(BUILT)('копия kusok: снимает сам сервер, пока держит хранилище', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup({ blobs: 'kusok' });
  });
  afterAll(() => ctx.store.close());

  const upload = async (data: Buffer, name: string) => {
    const r = await request(ctx.app).post(`${API}/files`).set('Authorization', `Bearer ${await ctx.token('anna')}`).attach('file', data, { filename: name, contentType: 'application/octet-stream' });
    expect(r.status).toBe(201);
    return r.body.data as Attachment;
  };

  it('первая копия — всё, вторая — только новое; итог в last.json, временного пакета нет', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'offix-bk-')), 'kusok');
    const a = randomBytes(120_000);
    await upload(a, 'первый.bin');
    const first = await backupKusok(ctx.store, dir, { now: () => NOW });
    expect(first!.imported).toBeGreaterThanOrEqual(1);
    expect(first!.at).toBe(NOW.toISOString());
    expect(existsSync(join(dir, 'incoming.kb'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'last.json'), 'utf8')).imported).toBe(first!.imported);

    const b = randomBytes(80_000);
    await upload(b, 'второй.bin');
    const second = await backupKusok(ctx.store, dir);
    expect(second!.imported).toBe(1);
    // Куски первого файла уже в копии — во второй пакет не попали.
    expect(second!.skipped).toBeGreaterThan(0);
    expect(second!.bytes).toBeLessThan(a.length);

    // Копия — обычное хранилище kusok: в нём оба файла целиком.
    const { Kusok } = loadKusok().module!;
    const copy = new Kusok(join(dir, 'store'), { readOnly: true });
    expect(await copy.read(sha(a))).toEqual(a);
    expect(await copy.read(sha(b))).toEqual(b);
    expect((await copy.fsck()).brokenFiles).toBe(0);
    copy.close();
  });

  it('восстановление: копия импортируется в пустое хранилище, файлы снова открываются, ночная сверка выравнивает ссылки', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'offix-bk-')), 'kusok');
    const data = randomBytes(50_000);
    const att = await upload(data, 'важный.bin');
    // Тот же файл переслан ещё раз — в базе две строки.
    await upload(data, 'важный-копия.bin');
    await backupKusok(ctx.store, dir);

    const { Kusok } = loadKusok().module!;
    const freshDir = mkdtempSync(join(tmpdir(), 'offix-restore-'));
    const bundle = join(freshDir, 'all.kb');
    const copy = new Kusok(join(dir, 'store'), { readOnly: true });
    await copy.exportTo(bundle);
    copy.close();
    const restored = createMediaStore({ dir: freshDir, maxBytes: 1e6, ffmpegDir: null, store: 'kusok' }, SECRET);
    await restored.kusok!.importFrom(bundle);
    expect(restored.kusok!.refs(sha(data))).toBe(1);
    const night = await nightlyStorage(ctx.db, restored);
    expect(restored.kusok!.refs(sha(data))).toBe(2);
    expect(night!.fsck.brokenFiles).toBe(0);
    expect(await restored.kusok!.read(sha(data))).toEqual(data);
    expect(att.size).toBe(data.length);
    restored.close();
  });

  it('просьба backup.sh: request новее last.json — пора; после копии — нет', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'offix-bk-')), 'kusok');
    mkdirSync(dir, { recursive: true });
    expect(await backupRequested(dir)).toBe(false);
    writeFileSync(join(dir, 'request'), '');
    expect(await backupRequested(dir)).toBe(true);
    await backupKusok(ctx.store, dir);
    // Файловая система может округлять время — ставим request явно в прошлое.
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(dir, 'request'), past, past);
    expect(await backupRequested(dir)).toBe(false);
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, 'request'), future, future);
    expect(await backupRequested(dir)).toBe(true);
  });

  it('без kusok копии нет', async () => {
    const fsStore = createMediaStore({ dir: mkdtempSync(join(tmpdir(), 'offix-nobk-')), maxBytes: 1e6, ffmpegDir: null, store: 'fs' }, SECRET);
    expect(await backupKusok(fsStore, mkdtempSync(join(tmpdir(), 'offix-nobk-dst-')))).toBeNull();
  });
});
