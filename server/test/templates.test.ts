import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { GOAL_TEMPLATES, findTemplate } from '@offix/core';
import { setup, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

const apply = async (who: Parameters<Ctx['as']>[0], key: string, body: object, idem?: string) => {
  const agent = await ctx.as(who);
  const req = agent.post(`/api/v1/templates/${key}/apply`, body);
  return idem ? req.set('Idempotency-Key', idem) : req;
};

describe('каталог шаблонов', () => {
  it('без входа — 401', async () => {
    expect((await request(ctx.app).get('/api/v1/templates')).status).toBe(401);
  });

  it('отдаёт весь каталог ядра', async () => {
    const r = await (await ctx.as('anna')).get('/api/v1/templates');
    expect(r.status).toBe(200);
    expect(r.body.data.map((t: { key: string }) => t.key)).toEqual(GOAL_TEMPLATES.map((t) => t.key));
    expect(r.body.data[0]).toMatchObject({ kpi: { unit: 'minutes', direction: 'decrease' } });
  });
});

describe('цель из шаблона', () => {
  it('черновик с KPI, подцелями и задачами с зависимостями', async () => {
    const t = findTemplate('application-time')!;
    const r = await apply('olga', t.key, { owner_id: ctx.demo.users.olga, due_at: '2027-01-31', baseline: 45, target: 30, unit_ids: [ctx.demo.units.office!] });
    expect(r.status).toBe(201);
    const goal = r.body.data;
    expect(goal).toMatchObject({ title: t.title, status: 'draft', type: 'operational', due_at: '2027-01-31' });
    expect(goal.metrics[0]).toMatchObject({ name: t.kpi.name, unit: 'minutes', baseline: 45, target: 30, direction: 'decrease' });

    const rm = (await (await ctx.as('olga')).get(`/api/v1/goals/${goal.id}/roadmap`)).body.data;
    expect(rm.subgoals.map((s: { title: string }) => s.title)).toEqual(t.subgoals.map((s) => s.title));
    expect(rm.tasks).toHaveLength(t.tasks.length);
    // Задачи «Обучить» и «Замерить» лежат в самой цели, остальные — в подцелях.
    expect(rm.direct_task_ids).toHaveLength(2);
    const byTitle = new Map(rm.tasks.map((x: { id: string; title: string }) => [x.title, x.id]));
    const train = byTitle.get('Обучить сотрудников учебного офиса новому порядку');
    const before = rm.edges.filter((e: { to: string }) => e.to === train).map((e: { from: string }) => e.from);
    expect(before).toHaveLength(3);
    const first = rm.tasks.find((x: { title: string }) => x.title.startsWith('Описать текущий путь'));
    expect(first).toMatchObject({ start_at: '2026-10-19', due_at: '2026-10-29', status: 'todo' });
  });

  it('пишет журнал: цель создана из шаблона', async () => {
    const r = await apply('olga', 'it-tickets', { owner_id: ctx.demo.users.igor, due_at: '2027-01-31' });
    expect(r.status).toBe(201);
    const { rows } = await ctx.db.query<{ event_type: string; new_values: { template?: string } }>(`SELECT event_type, new_values FROM audit_events WHERE goal_id = $1 ORDER BY created_at`, [r.body.data.id]);
    expect(rows.find((e) => e.event_type === 'goal.created')?.new_values.template).toBe('it-tickets');
    expect(rows.filter((e) => e.event_type === 'task.created')).toHaveLength(2); // задачи без подцели
    const n = await ctx.db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND goal_id = $2 AND kind = 'goal_assigned'`, [ctx.demo.users.igor, r.body.data.id]);
    expect(n.rows).toHaveLength(1);
  });

  it('повтор с тем же ключом — та же цель, без дубля', async () => {
    const body = { owner_id: ctx.demo.users.olga, due_at: '2027-02-28' };
    const a = await apply('olga', 'certificates', body, 'tpl-key-1');
    const b = await apply('olga', 'certificates', body, 'tpl-key-1');
    expect(a.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    const { rows } = await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM goals WHERE title = $1 AND parent_goal_id IS NULL`, [findTemplate('certificates')!.title]);
    expect(rows[0]!.n).toBe(1);
  });

  it('цифры не в ту сторону — ошибка у поля target', async () => {
    const r = await apply('olga', 'application-time', { owner_id: ctx.demo.users.olga, due_at: '2027-01-31', baseline: 30, target: 40 });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.target).toMatch(/меньше исходного/);
  });

  it('срок в прошлом и чужой владелец — ошибки полей, ничего не создано', async () => {
    const before = (await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM goals`)).rows[0]!.n;
    const past = await apply('olga', 'onboarding', { owner_id: ctx.demo.users.olga, due_at: '2026-01-01' });
    expect(past.status).toBe(422);
    expect(past.body.error.fields.due_at).toBeTruthy();
    const stranger = await apply('olga', 'onboarding', { owner_id: '00000000-0000-4000-8000-000000000000', due_at: '2027-01-31' });
    expect(stranger.status).toBe(422);
    expect((await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM goals`)).rows[0]!.n).toBe(before);
  });

  it('права как у создания цели: сотрудник и наблюдатель — 403', async () => {
    expect((await apply('anna', 'onboarding', { owner_id: ctx.demo.users.anna, due_at: '2027-01-31' })).status).toBe(403);
    expect((await apply('observer', 'onboarding', { owner_id: ctx.demo.users.olga, due_at: '2027-01-31' })).status).toBe(403);
    // Стратегическую цель руководитель ставить может, а сотрудник — нет.
    expect((await apply('director', 'student-nps', { owner_id: ctx.demo.users.director, due_at: '2027-06-30' })).status).toBe(201);
  });

  it('неизвестный шаблон — 404', async () => {
    expect((await apply('olga', 'no-such', { owner_id: ctx.demo.users.olga, due_at: '2027-01-31' })).status).toBe(404);
  });
});
