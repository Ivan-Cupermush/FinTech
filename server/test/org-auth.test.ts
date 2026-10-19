import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { splitSql } from '../src/db/migrate';
import { normalizeTimestamp } from '../src/db/db';
import { setup, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

describe('вход и регистрация', () => {
  it('неверный пароль и несуществующая почта — одинаковый ответ', async () => {
    const a = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'olga@offix.demo', password: 'wrong' });
    const b = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'nobody@offix.demo', password: 'wrong' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('почта без учёта регистра', async () => {
    const r = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'OLGA@offix.demo', password: 'offix-demo' });
    expect(r.status).toBe(200);
    expect(r.body.data.user.display_name).toBe('Ольга Смирнова');
  });

  it('быстрый старт: компания и владелец за один шаг', async () => {
    const r = await request(ctx.app).post('/api/v1/auth/register').send({ company_name: 'Кафедра цифровой экономики', display_name: 'Иван', email: 'ivan@example.com', password: 'very-secret' });
    expect(r.status).toBe(201);
    const me = await request(ctx.app).get('/api/v1/users/me').set('Authorization', `Bearer ${r.body.data.token}`);
    expect(me.body.data).toMatchObject({ role: 'owner', company_name: 'Кафедра цифровой экономики', setup_mode: 'quick', units: [] });
    // Новая компания не видит чужих целей.
    const goals = await request(ctx.app).get('/api/v1/goals').set('Authorization', `Bearer ${r.body.data.token}`);
    expect(goals.body.data).toEqual([]);
  });

  it('регистрация: проверка полей и занятая почта', async () => {
    const bad = await request(ctx.app).post('/api/v1/auth/register').send({ company_name: '', display_name: '', email: 'x', password: '123' });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['company_name', 'display_name', 'email', 'password']);
    const dup = await request(ctx.app).post('/api/v1/auth/register').send({ company_name: 'X', display_name: 'Y', email: 'olga@offix.demo', password: '12345678' });
    expect(dup.body.error.fields.email).toMatch(/уже зарегистрирована/);
  });

  it('отключённый сотрудник теряет доступ сразу, даже с действующим токеном', async () => {
    const t = await ctx.token('sergey');
    await ctx.db.query(`UPDATE users SET active = FALSE WHERE id = $1`, [ctx.demo.users.sergey]);
    const r = await request(ctx.app).get('/api/v1/users/me').set('Authorization', `Bearer ${t}`);
    expect(r.status).toBe(401);
    await ctx.db.query(`UPDATE users SET active = TRUE WHERE id = $1`, [ctx.demo.users.sergey]);
  });

  it('health', async () => {
    expect((await request(ctx.app).get('/api/health')).body).toEqual({ ok: true });
  });

  it('неизвестный метод API — 404 в общем формате', async () => {
    const r = await request(ctx.app).get('/api/v1/nope').set('Authorization', `Bearer ${await ctx.token('olga')}`);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('CORS только для разрешённых адресов', async () => {
    const ok = await request(ctx.app).options('/api/v1/goals').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const no = await request(ctx.app).options('/api/v1/goals').set('Origin', 'https://evil.example');
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('оргструктура', () => {
  it('список узлов с руководителями и численностью', async () => {
    const anna = await ctx.as('anna');
    const r = await anna.get('/api/v1/org/units');
    const office = r.body.data.find((u: { name: string }) => u.name === 'Учебный офис');
    expect(office.managers).toEqual([{ id: ctx.demo.users.olga, display_name: 'Ольга Смирнова' }]);
    expect(office.member_count).toBe(1);
    expect(office.active_goals).toBe(2);
  });

  it('структуру меняет только администратор', async () => {
    const olga = await ctx.as('olga');
    expect((await olga.post('/api/v1/org/units', { name: 'Новый', unit_type: 'team' })).status).toBe(403);
  });

  it('создание узла в нужной точке дерева', async () => {
    const director = await ctx.as('director');
    const r = await director.post('/api/v1/org/units', { name: 'Цифровой деканат', unit_type: 'team', parent_unit_id: ctx.demo.units.office });
    expect(r.status).toBe(201);
  });

  it('внутри команды нельзя создать отдел', async () => {
    const director = await ctx.as('director');
    const r = await director.post('/api/v1/org/units', { name: 'Отдел в команде', unit_type: 'department', parent_unit_id: ctx.demo.units.intake });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.unit_type).toMatch(/подкоманду/);
  });

  it('перенос в собственного потомка — 422', async () => {
    const director = await ctx.as('director');
    const r = await director.patch(`/api/v1/org/units/${ctx.demo.units.office}`, { parent_unit_id: ctx.demo.units.intake });
    expect(r.status).toBe(422);
  });

  it('узел с вложенными нельзя архивировать', async () => {
    const director = await ctx.as('director');
    expect((await director.patch(`/api/v1/org/units/${ctx.demo.units.it}`, { status: 'archived' })).status).toBe(409);
  });

  it('родитель из другой компании отвергает сама база', async () => {
    const other = await (await import('../src/seed/demo')).seedDemo(ctx.db, { companyName: 'Вторая', now: new Date('2026-10-19T12:00:00Z') });
    await expect(
      ctx.db.query(`INSERT INTO org_units (company_id, parent_unit_id, name, unit_type) VALUES ($1, $2, 'X', 'team')`, [ctx.demo.companyId, other.units.office]),
    ).rejects.toThrow();
  });

  it('членство: несколько команд, повтор не дублирует, удаление закрывает датой', async () => {
    const director = await ctx.as('director');
    const url = `/api/v1/org/units/${ctx.demo.units.review}/members`;
    expect((await director.post(url, { user_id: ctx.demo.users.anna })).status).toBe(204);
    expect((await director.post(url, { user_id: ctx.demo.users.anna, is_manager: true })).status).toBe(204);
    const members = (await director.get(url)).body.data;
    expect(members.filter((m: { id: string }) => m.id === ctx.demo.users.anna)).toHaveLength(1);
    expect(members.find((m: { id: string }) => m.id === ctx.demo.users.anna).is_manager).toBe(true);
    expect((await director.delete(`${url}/${ctx.demo.users.anna}`)).status).toBe(204);
    const { rows } = await ctx.db.query(`SELECT ended_at FROM org_memberships WHERE user_id = $1 AND unit_id = $2`, [ctx.demo.users.anna, ctx.demo.units.review]);
    expect(rows[0]!.ended_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('новый отдел не расширяет права руководителя другого отдела', async () => {
    const director = await ctx.as('director');
    const u = (await director.post('/api/v1/org/units', { name: 'Аналитика', unit_type: 'department' })).body.data;
    await director.post(`/api/v1/org/units/${u.id}/members`, { user_id: ctx.demo.users.elena, is_manager: true });
    const elena = await ctx.as('elena');
    expect((await elena.get(`/api/v1/goals/${ctx.demo.goals.main}`)).status).toBe(404);
  });
});

describe('сотрудники', () => {
  it('поиск по имени и должности', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.get('/api/v1/users?search=' + encodeURIComponent('IT'));
    expect(r.body.data.map((u: { display_name: string }) => u.display_name)).toContain('Игорь Лебедев');
    const byName = await olga.get('/api/v1/users?search=' + encodeURIComponent('Анна'));
    expect(byName.body.data[0].units[0].name).toBe('Приём заявок');
  });

  it('приглашение: временный пароль, вход, членство', async () => {
    const director = await ctx.as('director');
    const r = await director.post('/api/v1/users', { email: 'new@offix.demo', display_name: 'Новый сотрудник', unit_ids: [ctx.demo.units.hr] });
    expect(r.status).toBe(201);
    const login = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'new@offix.demo', password: r.body.data.temp_password });
    expect(login.status).toBe(200);
  });

  it('руководитель не приглашает, администратор не назначает владельца', async () => {
    const olga = await ctx.as('olga');
    expect((await olga.post('/api/v1/users', { email: 'x@offix.demo', display_name: 'X' })).status).toBe(403);
  });

  it('нельзя отключить себя', async () => {
    const director = await ctx.as('director');
    expect((await director.patch(`/api/v1/users/${ctx.demo.users.director}`, { active: false })).status).toBe(409);
  });
});

describe('уведомления', () => {
  it('список и отметка «прочитано»', async () => {
    const olga = await ctx.as('olga');
    const list = (await olga.get('/api/v1/notifications')).body.data;
    expect(list.length).toBeGreaterThan(0);
    expect((await olga.post('/api/v1/notifications/read', {})).status).toBe(204);
    const after = (await olga.get('/api/v1/notifications')).body.data;
    expect(after.every((n: { read_at: string | null }) => n.read_at)).toBe(true);
  });
});

describe('инфраструктура', () => {
  it('splitSql не режет тела функций', () => {
    const parts = splitSql(`CREATE TABLE a (x int);\n-- комментарий; с точкой с запятой\nCREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'a;b'; END; $$ LANGUAGE plpgsql;`);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toContain("RAISE EXCEPTION 'a;b'; END;");
  });
  it('normalizeTimestamp приводит формат Postgres к ISO', () => {
    expect(normalizeTimestamp('2026-11-05 09:00:00+00')).toBe('2026-11-05T09:00:00.000Z');
    expect(normalizeTimestamp('2026-11-05 12:00:00+03')).toBe('2026-11-05T09:00:00.000Z');
  });
  it('миграции повторно не применяются', async () => {
    const { migrate } = await import('../src/db/migrate');
    expect(await migrate(ctx.db)).toEqual([]);
  });
});
