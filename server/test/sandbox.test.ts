import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SandboxInfo } from '@offix/core';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Db } from '../src/db/db';
import { migrate } from '../src/db/migrate';
import { openDb, pgliteDir, safeDbUrl } from '../src/db/open';
import { fakeSystemsFetch } from '../src/seed/fake-systems';
import { SANDBOX_COMPANY, SANDBOX_SEATS, seedSandbox } from '../src/seed/sandbox';
import { createKnowledgeService } from '../src/services/knowledge';
import { createMediaStore } from '../src/services/media';
import { NOW, SECRET, setup } from './helpers';

const API = '/api/v1';
const dir = mkdtempSync(join(tmpdir(), 'offix-sandbox-'));
const store = createMediaStore({ dir: join(dir, 'uploads'), maxBytes: 50 * 1024 * 1024, ffmpegDir: null }, SECRET);
let db: Db;

const seed = async (d: Db) => seedSandbox(d, store, createKnowledgeService(d, store, { now: () => NOW, onError: () => undefined }), NOW);
const appFor = (d: Db, sandbox = true) =>
  createApp({ db: d, config: { jwtSecret: SECRET, corsOrigins: [], sandbox }, now: () => NOW, rateLimit: false, media: store, integrationFetch: fakeSystemsFetch(() => NOW) });
const login = async (app: ReturnType<typeof appFor>, login: string, password = login) => request(app).post(`${API}/auth/login`).send({ email: login, password });
const as = async (app: ReturnType<typeof appFor>, who: string) => {
  const t = (await login(app, who)).body.data.token as string;
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
  return {
    get: (u: string) => auth(request(app).get(u)),
    post: (u: string, b: object = {}) => auth(request(app).post(u)).send(b),
    patch: (u: string, b: object = {}) => auth(request(app).patch(u)).send(b),
    put: (u: string, b: object = {}) => auth(request(app).put(u)).send(b),
  };
};

beforeAll(async () => {
  db = await openDb(`pglite:${join(dir, 'pgdata')}`);
  await migrate(db);
  expect(await seed(db)).toBe(true);
}, 60_000);
afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('песочница для жюри', () => {
  it('флаг OFFIX_SANDBOX=1 и только он включает песочницу', () => {
    expect(loadConfig({ OFFIX_SANDBOX: '1' }).sandbox).toBe(true);
    expect(loadConfig({}).sandbox).toBe(false);
    expect(loadConfig({ OFFIX_SANDBOX: 'true' }).sandbox).toBe(false);
  });

  it('на странице входа — сотрудники с логинами и паролями', async () => {
    const r = await request(appFor(db)).get(`${API}/auth/sandbox`);
    expect(r.status).toBe(200);
    const info = r.body.data as SandboxInfo;
    expect(info.enabled).toBe(true);
    expect(info.company_name).toBe(SANDBOX_COMPANY);
    expect(info.people.map((p) => p.login)).toEqual(['rector', 'prorector', 'office', 'method', 'spec', 'guest']);
    expect(info.people.map((p) => p.role)).toEqual(['owner', 'manager', 'manager', 'member', 'member', 'observer']);
    for (const p of info.people) {
      expect(p.password).toBe(p.login);
      expect(p.display_name.length).toBeGreaterThan(3);
      expect(p.blurb.length).toBeGreaterThan(10);
    }
  });

  it('без песочницы список пуст, и вход по таким логинам — обычный', async () => {
    const r = await request(appFor(db, false)).get(`${API}/auth/sandbox`);
    expect(r.body.data).toEqual({ enabled: false, company_name: null, people: [] });
    const plain = await setup();
    const empty = await request(plain.app).get(`${API}/auth/sandbox`);
    expect(empty.body.data.enabled).toBe(false);
    expect((await login(plain.app, 'rector')).status).toBe(401);
  });

  it('каждый входит своим логином; пароль равен логину', async () => {
    const app = appFor(db);
    for (const s of SANDBOX_SEATS) {
      const r = await login(app, s.login);
      expect(r.status, s.login).toBe(200);
      expect(r.body.data.user.display_name).toBe(s.display_name);
      expect(r.body.data.company.name).toBe(SANDBOX_COMPANY);
    }
    expect((await login(app, 'RECTOR', 'rector')).status).toBe(200);
    expect((await login(app, 'rector', 'wrong')).status).toBe(401);
  });

  it('университет без продаж: раздел выключен, остальное с данными', async () => {
    const rector = await as(appFor(db), 'rector');
    const me = (await rector.get(`${API}/users/me`)).body.data;
    expect(me.modules).toEqual({ sales: false, chats: true, knowledge_ai: true, my_notes: true, integrations: true });
    expect(me.position).toBe('Ректор');
    expect((await rector.get(`${API}/sales/month`)).body.error.code).toBe('MODULE_DISABLED');
    const goals = (await rector.get(`${API}/goals`)).body.data;
    expect(goals.length).toBeGreaterThan(3);
    const chats = (await rector.get(`${API}/chats`)).body.data;
    expect(chats.length).toBeGreaterThan(2);
    const docs = (await rector.get(`${API}/knowledge/docs`)).body.data;
    expect(docs.length).toBeGreaterThan(0);
  });

  it('в сообщениях и уведомлениях — новые имена, старых не осталось', async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages m JOIN companies c ON c.id = m.company_id WHERE c.name = $1 AND (m.text LIKE '%Алексей Петров%' OR m.text LIKE '%Ольга Смирнова%')`,
      [SANDBOX_COMPANY],
    );
    expect(rows[0]!.n).toBe(0);
    const renamed = await db.query(`SELECT 1 FROM messages m JOIN companies c ON c.id = m.company_id WHERE c.name = $1 AND m.text LIKE 'Алексей Звездин создаёт группу%'`, [SANDBOX_COMPANY]);
    expect(renamed.rows.length).toBe(1);
    const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications n JOIN companies c ON c.id = n.company_id WHERE c.name = $1 AND n.title LIKE '%Ольга Смирнова%'`, [SANDBOX_COMPANY]);
    expect(n.rows[0]!.n).toBe(0);
  });

  it('общие входы не сломать: пароль, почта, имя и «выйти везде» закрыты', async () => {
    const app = appFor(db);
    const rector = await as(app, 'rector');
    for (const [method, url, body] of [
      ['post', '/account/password', { current_password: 'rector', new_password: 'hacked-hacked-1' }],
      ['post', '/account/email', { email: 'x@y.z', password: 'rector' }],
      ['post', '/account/logout-all', {}],
      ['patch', '/account', { display_name: 'Кто-то другой' }],
    ] as const) {
      const r = await rector[method](`${API}${url}`, body);
      expect(r.status, url).toBe(403);
      expect(r.body.error.message).toContain('песочнице');
    }
    const spec = (await rector.get(`${API}/users?search=Заявкина`)).body.data[0];
    expect((await rector.post(`${API}/users/${spec.id}/reset-password`, {})).status).toBe(403);
    expect((await rector.patch(`${API}/users/${spec.id}`, { active: false })).status).toBe(403);
    expect((await rector.patch(`${API}/users/${spec.id}`, { role: 'admin' })).status).toBe(403);
    // Должность поменять можно — это не ломает вход.
    expect((await rector.patch(`${API}/users/${spec.id}`, { position: 'Старший специалист' })).status).toBe(200);
    await rector.patch(`${API}/users/${spec.id}`, { position: 'Специалист по работе с заявками' });
    expect((await login(app, 'rector')).status).toBe(200);
  });

  it('ректор может включить продажи обратно — это и есть «Функции компании»', async () => {
    const rector = await as(appFor(db), 'rector');
    const r = await rector.put(`${API}/company/modules`, { modules: { sales: true } });
    expect(r.body.data.modules.sales).toBe(true);
    expect((await rector.get(`${API}/sales/month`)).status).toBe(200);
    // Методист — не администратор: менять функции не может.
    expect((await (await as(appFor(db), 'method')).put(`${API}/company/modules`, { preset: 'company' })).status).toBe(403);
    await rector.put(`${API}/company/modules`, { preset: 'university' });
  });

  it('повторный запуск ничего не трогает, а данные переживают перезапуск', async () => {
    expect(await seed(db)).toBe(false);
    await db.close();
    db = await openDb(`pglite:${join(dir, 'pgdata')}`);
    await migrate(db);
    expect(await seed(db)).toBe(false);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM companies WHERE name = $1`, [SANDBOX_COMPANY]);
    expect(rows[0]!.n).toBe(1);
    expect((await login(appFor(db), 'office')).status).toBe(200);
  }, 60_000);
});

describe('адрес базы', () => {
  it('pglite: — встроенная база в папке, иначе PostgreSQL', () => {
    expect(pgliteDir('pglite:/var/lib/offix/pgdata')).toBe('/var/lib/offix/pgdata');
    expect(pgliteDir('pglite:///var/lib/offix/pgdata')).toBe('/var/lib/offix/pgdata');
    expect(pgliteDir('pglite:./data/pg')).toMatch(/\/data\/pg$/);
    expect(pgliteDir('postgres://offix:secret@localhost/offix')).toBeNull();
    expect(safeDbUrl('postgres://offix:secret@localhost/offix')).toBe('postgres://offix:***@localhost/offix');
  });
});
