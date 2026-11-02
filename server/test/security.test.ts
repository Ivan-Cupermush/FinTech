import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ANONYMIZED_EMAIL_DOMAIN, LOCKOUT_ATTEMPTS, PRIVACY_VERSION, type LoginEvent } from '@offix/core';
import { DEMO_PASSWORD } from '../src/seed/demo';
import { pruneLoginEvents } from '../src/services/security';
import { NOW, setup, type Ctx } from './helpers';

/**
 * Защита данных: журнал входов, закрытие входа после подбора пароля,
 * согласие на обработку данных, «Мои данные», журнал для администратора,
 * обезличивание ушедших и срок хранения журнала входов.
 */

const API = '/api/v1';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
let clock = NOW;
let ctx: Ctx;

beforeAll(async () => {
  ctx = await setup({ now: () => clock });
});

const login = (email: string, password: string, ua = CHROME) => request(ctx.app).post(`${API}/auth/login`).set('User-Agent', ua).send({ email, password });
const minutes = (n: number) => new Date(clock.getTime() + n * 60_000);

describe('журнал входов', () => {
  it('удачный и неудачный вход видны в «Безопасности» профиля: устройство по-человечески, чужих входов нет', async () => {
    expect((await login('maria@offix.demo', 'не-тот-пароль')).status).toBe(401);
    const ok = await login('maria@offix.demo', DEMO_PASSWORD);
    expect(ok.status).toBe(200);
    const mine: LoginEvent[] = (await request(ctx.app).get(`${API}/account/logins`).set('Authorization', `Bearer ${ok.body.data.token}`)).body.data;
    expect(mine[0]).toMatchObject({ ok: true, method: 'password', failure: null, device: 'Chrome на Windows' });
    expect(mine[1]).toMatchObject({ ok: false, failure: 'bad_password' });
    const anna: LoginEvent[] = (await (await ctx.as('anna')).get(`${API}/account/logins`)).body.data;
    expect(anna.every((e) => e.user_id === undefined)).toBe(true);
    expect(anna.length).toBeLessThan(mine.length + 5);
  });

  it('неизвестная почта и неверный пароль — одинаковый ответ', async () => {
    const a = await login('nobody@offix.demo', 'x');
    const b = await login('maria@offix.demo', 'x');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });
});

describe('защита от подбора пароля', () => {
  it(`после ${LOCKOUT_ATTEMPTS} неверных паролей вход закрыт даже с верным, через 15 минут — открыт`, async () => {
    clock = new Date('2026-10-20T09:00:00Z');
    for (let i = 0; i < LOCKOUT_ATTEMPTS; i++) {
      expect((await login('sergey@offix.demo', `guess-${i}`)).status).toBe(401);
      clock = minutes(0.5);
    }
    const locked = await login('sergey@offix.demo', DEMO_PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error.message).toMatch(/Слишком много неверных попыток\. Попробуйте через \d+ минут/);
    // Попытки при закрытом входе срок не продлевают.
    clock = minutes(5);
    expect((await login('sergey@offix.demo', 'ещё-раз')).status).toBe(429);
    // В журнале администратора — одно событие «вход закрыт».
    const sec = (await (await ctx.as('director')).get(`${API}/security/audit?group=security`)).body.data.events;
    expect(sec.filter((e: { event_type: string }) => e.event_type === 'login.locked')).toHaveLength(1);
    clock = minutes(15);
    expect((await login('sergey@offix.demo', DEMO_PASSWORD)).status).toBe(200);
  });

  it('удачный вход обнуляет счёт неудачных', async () => {
    clock = new Date('2026-10-21T09:00:00Z');
    for (let i = 0; i < LOCKOUT_ATTEMPTS - 1; i++) await login('elena@offix.demo', `guess-${i}`);
    expect((await login('elena@offix.demo', DEMO_PASSWORD)).status).toBe(200);
    expect((await login('elena@offix.demo', 'опечатка')).status).toBe(401);
    expect((await login('elena@offix.demo', DEMO_PASSWORD)).status).toBe(200);
  });

  it('в песочнице общие входы не закрываются', async () => {
    const sb = await setup({ now: () => clock });
    const app = (await import('../src/app')).createApp({ db: sb.db, config: { jwtSecret: 'x'.repeat(40), corsOrigins: [], sandbox: true }, now: () => clock, rateLimit: false, media: sb.store, knowledge: sb.knowledge });
    for (let i = 0; i < LOCKOUT_ATTEMPTS + 2; i++) await request(app).post(`${API}/auth/login`).send({ email: 'dima@offix.demo', password: 'nope' });
    expect((await request(app).post(`${API}/auth/login`).send({ email: 'dima@offix.demo', password: DEMO_PASSWORD })).status).toBe(200);
  });
});

describe('согласие на обработку персональных данных', () => {
  it('без согласия компанию не создаём; с согласием — версия и дата в профиле, событие в журнале', async () => {
    const body = { company_name: 'Колледж', display_name: 'Нина', email: 'nina@college.example', password: 'quiet-river-71' };
    const no = await request(ctx.app).post(`${API}/auth/register`).send(body);
    expect(no.status).toBe(422);
    expect(no.body.error.fields.consent).toMatch(/согласие/);
    const yes = await request(ctx.app).post(`${API}/auth/register`).set('User-Agent', CHROME).send({ ...body, consent: true });
    expect(yes.status).toBe(201);
    const auth = { Authorization: `Bearer ${yes.body.data.token}` };
    const profile = (await request(ctx.app).get(`${API}/account`).set(auth)).body.data;
    expect(profile.consent_version).toBe(PRIVACY_VERSION);
    expect(profile.consent_at).toBeTruthy();
    const logins: LoginEvent[] = (await request(ctx.app).get(`${API}/account/logins`).set(auth)).body.data;
    expect(logins[0]).toMatchObject({ ok: true, method: 'register' });
    const journal = (await request(ctx.app).get(`${API}/security/audit?group=security`).set(auth)).body.data.events;
    expect(journal.map((e: { event_type: string }) => e.event_type)).toContain('account.consent_given');
  });
});

describe('«Мои данные»', () => {
  it('файл JSON со своими задачами, сообщениями и заметками — без пароля и чужого', async () => {
    const anna = await ctx.as('anna');
    const olga = await ctx.as('olga');
    const chat = (await anna.post(`${API}/chats/direct`, { user_id: ctx.demo.users.olga })).body.data.id;
    await anna.post(`${API}/chats/${chat}/messages`, { text: 'Моё сообщение для выгрузки' });
    await olga.post(`${API}/chats/${chat}/messages`, { text: 'Чужое сообщение' });
    await anna.post(`${API}/my-notes`, { title: 'Личное', body: 'Только моё' });
    const r = await anna.get(`${API}/account/export`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="offix-moi-dannye-\d{4}-\d{2}-\d{2}\.json"/);
    expect(r.headers['cache-control']).toBe('no-store');
    const data = JSON.parse(r.text);
    expect(data.format).toBe('offix-personal-data');
    expect(data.profile.email).toBe('anna@offix.demo');
    expect(JSON.stringify(data)).not.toMatch(/password_hash|\$2[aby]\$/);
    expect(data.messages.map((m: { text: string }) => m.text)).toContain('Моё сообщение для выгрузки');
    expect(data.messages.map((m: { text: string }) => m.text)).not.toContain('Чужое сообщение');
    expect(data.personal_notes.map((n: { body: string }) => n.body)).toContain('Только моё');
    expect(data.tasks.length).toBeGreaterThan(0);
    expect(data.tasks.every((t: { i_am_assignee: boolean; i_am_author: boolean }) => t.i_am_assignee || t.i_am_author)).toBe(true);
    expect(data.truncated).toEqual([]);
    const journal = (await (await ctx.as('director')).get(`${API}/security/audit?group=security`)).body.data.events;
    expect(journal.some((e: { event_type: string; actor_id: string }) => e.event_type === 'account.data_exported' && e.actor_id === ctx.demo.users.anna)).toBe(true);
  });
});

describe('безопасность компании для администратора', () => {
  it('сотрудник и руководитель журнал не видят', async () => {
    expect((await (await ctx.as('anna')).get(`${API}/security/summary`)).status).toBe(403);
    expect((await (await ctx.as('olga')).get(`${API}/security/audit`)).status).toBe(403);
    expect((await request(ctx.app).get(`${API}/security/summary`)).status).toBe(401);
  });

  it('сводка и советы', async () => {
    const r = (await (await ctx.as('director')).get(`${API}/security/summary`)).body.data;
    expect(r.summary.lockouts_7d).toBeGreaterThanOrEqual(0);
    expect(Object.keys(r.summary).sort()).toEqual(['default_passwords', 'dormant', 'failures_7d', 'lockouts_7d', 'logins_7d', 'to_anonymize']);
    expect(r.advice.length).toBeGreaterThan(0);
  });

  it('журнал: группы, страницы без повторов, «О ком» и подробности', async () => {
    const d = await ctx.as('director');
    await d.patch(`${API}/users/${ctx.demo.users.dima}`, { position: 'Ведущий разработчик' });
    const sec = (await d.get(`${API}/security/audit?group=security`)).body.data;
    const upd = sec.events.find((e: { event_type: string }) => e.event_type === 'member.updated');
    expect(upd).toMatchObject({ target_name: 'Дмитрий Орлов', actor_name: 'Алексей Петров' });
    const people = (await d.get(`${API}/security/audit?group=people&limit=100`)).body.data;
    expect(people.events.every((e: { event_type: string }) => /^(member\.invited|user\.|company\.|org_unit\.)/.test(e.event_type))).toBe(true);
    const all1 = (await d.get(`${API}/security/audit?group=all&limit=5`)).body.data;
    expect(all1.events).toHaveLength(5);
    expect(all1.next).toBeTruthy();
    const all2 = (await d.get(`${API}/security/audit?group=all&limit=5&before=${all1.next}`)).body.data;
    expect(all2.events).toHaveLength(5);
    expect(Number(all2.events[0].id)).toBeLessThan(Number(all1.next));
    const ids = new Set(all1.events.map((e: { id: string }) => e.id));
    expect(all2.events.some((e: { id: string }) => ids.has(e.id))).toBe(false);
    // Мусор в курсоре — с начала, а не ошибка базы.
    expect((await d.get(`${API}/security/audit?before=1;DROP`)).status).toBe(200);
  });

  it('выгрузка журнала в Excel: BOM, «;», русские подписи, и сама выгрузка попадает в журнал', async () => {
    const d = await ctx.as('director');
    const r = await d.get(`${API}/security/audit?group=security&format=csv`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text.startsWith('﻿Когда (МСК);Кто;Событие;О ком;Подробности')).toBe(true);
    expect(r.text).toContain('Изменил роль или доступ');
    const sec = (await d.get(`${API}/security/audit?group=security`)).body.data.events;
    expect(sec[0].event_type).toBe('security.audit_exported');
  });

  it('журнал входов компании: только неудачные — фильтр', async () => {
    const d = await ctx.as('director');
    const failed = (await d.get(`${API}/security/logins?failed=1`)).body.data.logins as LoginEvent[];
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((e) => !e.ok)).toBe(true);
    expect(failed[0]!.display_name).toBeTruthy();
    const all = (await d.get(`${API}/security/logins`)).body.data.logins as LoginEvent[];
    expect(all.some((e) => e.ok)).toBe(true);
  });
});

describe('обезличивание ушедших', () => {
  it('только отключённого; не владельца и не себя', async () => {
    const d = await ctx.as('director');
    expect((await d.post(`${API}/users/${ctx.demo.users.igor}/anonymize`)).status).toBe(409);
    expect((await d.post(`${API}/users/${ctx.demo.users.director}/anonymize`)).status).toBe(409);
    expect((await (await ctx.as('olga')).post(`${API}/users/${ctx.demo.users.igor}/anonymize`)).status).toBe(403);
  });

  it('имя, почта, заметки и входы исчезают, работа остаётся; войти нельзя; второй раз — нельзя', async () => {
    const igor = ctx.demo.users.igor;
    const i = await ctx.as('igor');
    await i.post(`${API}/my-notes`, { title: 'Личное Игоря', body: 'секрет' });
    const tasksBefore = (await ctx.db.query(`SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1`, [igor])).rows[0]!.n;
    const d = await ctx.as('director');
    expect((await d.patch(`${API}/users/${igor}`, { active: false })).status).toBe(200);
    const before = (await d.get(`${API}/security/summary`)).body.data.summary.to_anonymize;
    const r = await d.post(`${API}/users/${igor}/anonymize`);
    expect(r.status).toBe(200);
    expect(r.body.data.display_name).toMatch(/^Бывший сотрудник \d+$/);
    const u = (await ctx.db.query<{ email: string; position: string | null; avatar_url: string | null; anonymized_at: string | null }>(`SELECT email, position, avatar_url, anonymized_at FROM users WHERE id = $1`, [igor])).rows[0]!;
    expect(u.email.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`)).toBe(true);
    expect(u.position).toBeNull();
    expect(u.anonymized_at).toBeTruthy();
    expect((await ctx.db.query(`SELECT 1 FROM personal_notes WHERE owner_id = $1`, [igor])).rows).toEqual([]);
    expect((await ctx.db.query(`SELECT 1 FROM login_events WHERE user_id = $1`, [igor])).rows).toEqual([]);
    expect((await ctx.db.query(`SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1`, [igor])).rows[0]!.n).toBe(tasksBefore);
    // Старая почта больше никуда не ведёт, включить снова и войти — тоже нельзя.
    expect((await login('igor@offix.demo', DEMO_PASSWORD)).status).toBe(401);
    expect((await d.patch(`${API}/users/${igor}`, { active: true })).status).toBe(409);
    expect((await d.patch(`${API}/users/${igor}`, { role: 'admin' })).status).toBe(409);
    expect((await login(u.email, DEMO_PASSWORD)).status).toBe(401);
    expect((await d.post(`${API}/users/${igor}/anonymize`)).status).toBe(409);
    // В списке сотрудников — с пометкой, в журнале — без имени и почты.
    const list = (await d.get(`${API}/users?include_inactive=1`)).body.data;
    expect(list.find((x: { id: string }) => x.id === igor)).toMatchObject({ anonymized: true, display_name: r.body.data.display_name });
    const ev = (await d.get(`${API}/security/audit?group=security`)).body.data.events.find((e: { event_type: string }) => e.event_type === 'member.anonymized');
    expect(JSON.stringify(ev)).not.toContain('igor@offix.demo');
    expect((await d.get(`${API}/security/summary`)).body.data.summary.to_anonymize).toBe(before - 1);
  });
});

describe('срок хранения журнала входов', () => {
  it('записи старше полугода удаляются, свежие остаются', async () => {
    await ctx.db.query(`INSERT INTO login_events (user_id, company_id, ok, method, created_at) VALUES ($1, $2, true, 'password', '2025-01-01T00:00:00Z')`, [ctx.demo.users.anna, ctx.demo.companyId]);
    const fresh = Number((await ctx.db.query<{ n: string }>(`SELECT count(*) AS n FROM login_events WHERE created_at > '2026-01-01'`)).rows[0]!.n);
    expect(await pruneLoginEvents(ctx.db, new Date('2026-10-25T00:00:00Z'))).toBeGreaterThanOrEqual(1);
    expect((await ctx.db.query(`SELECT 1 FROM login_events WHERE created_at < '2026-01-01'`)).rows).toEqual([]);
    expect(Number((await ctx.db.query<{ n: string }>(`SELECT count(*) AS n FROM login_events WHERE created_at > '2026-01-01'`)).rows[0]!.n)).toBe(fresh);
  });
});
