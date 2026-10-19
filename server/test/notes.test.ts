import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { setup, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

const create = async (who: Parameters<Ctx['as']>[0], body: object) => (await ctx.as(who)).post('/api/v1/notes', body);
const list = async (who: Parameters<Ctx['as']>[0], query = '') => (await (await ctx.as(who)).get(`/api/v1/notes${query}`)).body.data as { id: string; title: string; excerpt: string; goal_id: string | null }[];

describe('заметки', () => {
  it('без входа — 401', async () => {
    expect((await request(ctx.app).get('/api/v1/notes')).status).toBe(401);
  });

  it('общая заметка: создать, прочитать, увидеть в списке', async () => {
    const r = await create('olga', { title: 'Как мы считаем KPI', body: '# Правило\n\nЗамер — **раз в неделю**, источник — СЭД.' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ title: 'Как мы считаем KPI', goal_id: null, author_name: 'Ольга Смирнова', can_edit: true });
    const one = (await (await ctx.as('dima')).get(`/api/v1/notes/${r.body.data.id}`)).body.data;
    expect(one).toMatchObject({ title: 'Как мы считаем KPI', can_edit: false });
    const items = await list('dima');
    expect(items.find((n) => n.id === r.body.data.id)?.excerpt).toBe('Правило Замер — раз в неделю, источник — СЭД.');
  });

  it('заметка цели видна только тем, кто видит цель', async () => {
    const goal = ctx.demo.goals.onboarding!;
    const r = await create('elena', { title: 'План адаптации', body: 'Чек-лист первой недели', goal_id: goal });
    expect(r.status).toBe(201);
    expect(r.body.data.goal_title).toBeTruthy();
    expect((await (await ctx.as('dima')).get(`/api/v1/notes/${r.body.data.id}`)).status).toBe(404);
    expect((await list('dima')).some((n) => n.id === r.body.data.id)).toBe(false);
    expect((await list('elena', `?goal_id=${goal}`)).map((n) => n.title)).toContain('План адаптации');
    expect((await (await ctx.as('dima')).get(`/api/v1/notes?goal_id=${goal}`)).status).toBe(404);
    expect((await create('dima', { title: 'Чужая', goal_id: goal })).status).toBe(404);
  });

  it('поиск: каждое слово в заголовке или тексте, отрывок вокруг найденного', async () => {
    await create('olga', { title: 'Регламент договоров', body: `${'Общие положения. '.repeat(20)}Срок согласования договора — пять рабочих дней.` });
    const found = await list('olga', `?q=${encodeURIComponent('срок договора')}`);
    expect(found.map((n) => n.title)).toEqual(['Регламент договоров']);
    expect(found[0]!.excerpt).toContain('Срок согласования договора');
    expect(await list('olga', `?q=${encodeURIComponent('несуществующее слово')}`)).toEqual([]);
    // Спецсимволы LIKE не ломают поиск.
    expect((await (await ctx.as('olga')).get(`/api/v1/notes?q=${encodeURIComponent('100%_')}`)).status).toBe(200);
  });

  it('только общие: scope=company', async () => {
    const items = await list('director', '?scope=company');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((n) => n.goal_id === null)).toBe(true);
  });

  it('править и удалять может автор и администратор, остальные — 403', async () => {
    const r = await create('olga', { title: 'Черновик', body: 'v1' });
    const id = r.body.data.id;
    expect((await (await ctx.as('dima')).patch(`/api/v1/notes/${id}`, { body: 'взлом' })).status).toBe(403);
    const upd = await (await ctx.as('olga')).patch(`/api/v1/notes/${id}`, { title: 'Итог встречи', body: 'v2' });
    expect(upd.body.data).toMatchObject({ title: 'Итог встречи', body: 'v2', updated_by_name: 'Ольга Смирнова' });
    const byAdmin = await (await ctx.as('director')).patch(`/api/v1/notes/${id}`, { body: 'v3' });
    expect(byAdmin.body.data.updated_by_name).toBe('Алексей Петров');
    expect((await (await ctx.as('dima')).delete(`/api/v1/notes/${id}`)).status).toBe(403);
    expect((await (await ctx.as('olga')).delete(`/api/v1/notes/${id}`)).status).toBe(204);
    expect((await (await ctx.as('olga')).get(`/api/v1/notes/${id}`)).status).toBe(404);
  });

  it('заголовок обязателен, наблюдатель не пишет', async () => {
    const r = await create('olga', { title: '  ', body: 'x' });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.title).toBe('Введите заголовок');
    expect((await create('observer', { title: 'Можно?' })).status).toBe(403);
    expect((await (await ctx.as('olga')).patch('/api/v1/notes/00000000-0000-4000-8000-000000000000', { title: 'x' })).status).toBe(404);
  });
});
