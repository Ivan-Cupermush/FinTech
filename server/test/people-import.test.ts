import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { guessPeopleColumns, parseTable, type PeopleMapping } from '@offix/core';
import { writeXlsx } from '../src/services/xlsx';
import { setup, type Ctx } from './helpers';

/**
 * Импорт сотрудников и структуры: файл → таблица, план с проверкой каждой
 * строки и выполнение одной транзакцией с временными паролями.
 */

const API = '/api/v1';
let ctx: Ctx;

beforeAll(async () => {
  ctx = await setup();
});

const FILE = [
  'ФИО;Почта;Должность;Подразделение;Руководитель;Роль',
  'Кольцова Мария;koltsova@uni.ru;Директор центра;Центр цифровых сервисов;да;',
  'Петров Иван;Petrov@uni.ru;Аналитик;Центр цифровых сервисов / Аналитика;;',
  'Сидорова Ольга;sidorova@uni.ru;Разработчик;IT-департамент / Автоматизация;;',
  'Ольга уже есть;olga@offix.demo;;;;',
  'Без почты;;;;;',
  'Наблюдатель;guest@uni.ru;;;;наблюдатель',
].join('\n');

const tableOf = (text: string) => {
  const t = parseTable(text);
  return { rows: t.rows, lines: t.lines, mapping: guessPeopleColumns(t.columns, t.rows, t.hasHeader) as PeopleMapping };
};

const login = (email: string, password: string) => request(ctx.app).post(`${API}/auth/login`).send({ email, password });

describe('импорт сотрудников', () => {
  it('сотрудник и руководитель загружать не могут', async () => {
    for (const who of ['anna', 'olga'] as const) {
      const a = await ctx.as(who);
      expect((await a.post(`${API}/users/import`, { ...tableOf(FILE), dry_run: true })).status).toBe(403);
    }
  });

  it('план ничего не меняет и показывает, что будет', async () => {
    const d = await ctx.as('director');
    const before = (await ctx.db.query(`SELECT count(*)::int AS n FROM users`)).rows[0]!.n;
    const r = await d.post(`${API}/users/import`, { ...tableOf(FILE), dry_run: true });
    expect(r.status).toBe(200);
    const plan = r.body.data.plan;
    expect(plan.counts).toMatchObject({ new: 4, exists: 1, error: 1, units: 2, managers: 1 });
    expect(plan.units.map((u: { path: string[] }) => u.path.join(' / '))).toEqual(['Центр цифровых сервисов', 'Центр цифровых сервисов / Аналитика']);
    expect((await ctx.db.query(`SELECT count(*)::int AS n FROM users`)).rows[0]!.n).toBe(before);
  });

  it('без колонки почты — понятная ошибка', async () => {
    const d = await ctx.as('director');
    const t = tableOf(FILE);
    const r = await d.post(`${API}/users/import`, { ...t, mapping: { ...t.mapping, email: -1 } });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.mapping).toMatch(/почтой/);
  });

  it('импорт: подразделения, руководитель, роли, пароли один раз, журнал', async () => {
    const d = await ctx.as('director');
    const r = await d.post(`${API}/users/import`, { ...tableOf(FILE), dry_run: false });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ created: 4, units_created: 2 });
    const creds: { name: string; email: string; password: string }[] = r.body.data.credentials;
    expect(creds.map((c) => c.email).sort()).toEqual(['guest@uni.ru', 'koltsova@uni.ru', 'petrov@uni.ru', 'sidorova@uni.ru']);
    expect(creds[0]!.password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    // Пароль хранится только хешем, и по нему можно войти.
    const petrov = creds.find((c) => c.email === 'petrov@uni.ru')!;
    const hash = (await ctx.db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE email = 'petrov@uni.ru'`)).rows[0]!.password_hash;
    expect(hash).not.toContain(petrov.password);
    expect((await login('petrov@uni.ru', petrov.password)).status).toBe(200);

    const members = (await ctx.db.query<{ email: string; role: string; unit: string | null; is_manager: boolean | null; parent: string | null; unit_type: string | null }>(
      `SELECT u.email, m.role, o.name AS unit, mm.is_manager, p.name AS parent, o.unit_type
         FROM users u JOIN company_members m ON m.user_id = u.id
         LEFT JOIN org_memberships mm ON mm.user_id = u.id AND mm.ended_at IS NULL
         LEFT JOIN org_units o ON o.id = mm.unit_id
         LEFT JOIN org_units p ON p.id = o.parent_unit_id
        WHERE u.email = ANY($1::text[]) ORDER BY u.email`,
      [creds.map((c) => c.email)],
    )).rows;
    expect(members).toEqual([
      { email: 'guest@uni.ru', role: 'observer', unit: null, is_manager: null, parent: null, unit_type: null },
      { email: 'koltsova@uni.ru', role: 'manager', unit: 'Центр цифровых сервисов', is_manager: true, parent: null, unit_type: 'division' },
      { email: 'petrov@uni.ru', role: 'member', unit: 'Аналитика', is_manager: false, parent: 'Центр цифровых сервисов', unit_type: 'department' },
      // Существующая команда нашлась по пути — новой не появилось.
      { email: 'sidorova@uni.ru', role: 'member', unit: 'Автоматизация', is_manager: false, parent: 'IT-департамент', unit_type: 'team' },
    ]);

    const people = (await d.get(`${API}/security/audit?group=people&limit=100`)).body.data.events;
    expect(people.find((e: { event_type: string }) => e.event_type === 'member.imported')).toBeTruthy();
    expect(people.filter((e: { event_type: string }) => e.event_type === 'member.invited').length).toBeGreaterThanOrEqual(4);

    // Повтор того же файла: все уже в компании, создавать нечего.
    const again = await d.post(`${API}/users/import`, { ...tableOf(FILE), dry_run: false });
    expect(again.status).toBe(422);
    expect(again.body.error.fields.rows).toMatch(/нет новых/);
  });

  it('почта из другой организации — ошибка строки, а не чужой аккаунт', async () => {
    const reg = await request(ctx.app).post(`${API}/auth/register`).send({ company_name: 'Другая', display_name: 'Чужой', email: 'stranger@other.ru', password: 'длинный пароль', consent: true });
    expect(reg.status).toBe(201);
    const d = await ctx.as('director');
    const r = await d.post(`${API}/users/import`, { ...tableOf('ФИО;Почта\nЧужой;stranger@other.ru\nСвой;mine@uni.ru'), dry_run: true });
    expect(r.body.data.plan.rows[0]).toMatchObject({ status: 'error', note: expect.stringMatching(/другой организации/) });
    expect(r.body.data.plan.rows[1]).toMatchObject({ status: 'new' });
  });

  it('файл Excel и CSV в Windows-1251 превращаются в текст таблицы', async () => {
    const token = await ctx.token('director');
    const xlsx = writeXlsx([
      { name: 'Пусто', rows: [] },
      { name: 'Сотрудники', rows: [['ФИО', 'Почта'], ['Иванов\tИван', 'ivanov@uni.ru']] },
    ]);
    const x = await request(ctx.app).post(`${API}/users/import/table`).set('Authorization', `Bearer ${token}`).attach('file', Buffer.from(xlsx), 'staff.xlsx');
    expect(x.status).toBe(200);
    expect(x.body.data.text).toBe('ФИО\tПочта\nИванов Иван\tivanov@uni.ru');

    const cp1251 = Buffer.from([0xd4, 0xc8, 0xce, 0x3b, 0x50, 0x0a, 0xc0, 0x3b, 0x61, 0x40, 0x62, 0x2e, 0x63]); // «ФИО;P\nА;a@b.c»
    const c = await request(ctx.app).post(`${API}/users/import/table`).set('Authorization', `Bearer ${token}`).attach('file', cp1251, 'staff.csv');
    expect(c.body.data.text).toBe('ФИО;P\nА;a@b.c');

    const bad = await request(ctx.app).post(`${API}/users/import/table`).set('Authorization', `Bearer ${token}`).attach('file', Buffer.from('x'), 'staff.pdf');
    expect(bad.status).toBe(422);
    const anna = await ctx.token('anna');
    expect((await request(ctx.app).post(`${API}/users/import/table`).set('Authorization', `Bearer ${anna}`).attach('file', Buffer.from(xlsx), 'staff.xlsx')).status).toBe(403);
  });
});
