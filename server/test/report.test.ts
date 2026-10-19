import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { REPORT_CSV_COLUMNS } from '@offix/core';
import { SECRET, setup, validGoal, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

const reportOf = async (who: Parameters<Ctx['as']>[0], query = '') => {
  const r = await (await ctx.as(who)).get(`/api/v1/report${query}`);
  expect(r.status).toBe(200);
  return r.body.data;
};

describe('отчёт для руководства', () => {
  it('без входа — 401', async () => {
    expect((await request(ctx.app).get('/api/v1/report')).status).toBe(401);
  });

  it('по умолчанию — месяц по всей компании, с автором и названием компании', async () => {
    const r = await reportOf('director');
    expect(r).toMatchObject({ days: 30, at: '2026-10-19T12:00:00.000Z', from: '2026-09-19T12:00:00.000Z', scope: 'company', author: 'Алексей Петров' });
    expect(r.company).toBeTruthy();
  });

  it('шапка совпадает с экраном «Эффект»', async () => {
    const r = await reportOf('director');
    const m = (await (await ctx.as('director')).get('/api/v1/metrics')).body.data;
    expect(r.headline).toMatchObject({
      goals: 3,
      north_star: m.north_star.value,
      improved: m.north_star.counts.improved,
      with_kpi: m.north_star.total,
      on_time: m.on_time.value,
      blocker_median_hours: m.blockers.median_hours,
      open_blockers: m.blockers.open,
      tasks_done: 3,
    });
  });

  it('цель с блокером на критическом пути — первой и «под угрозой»', async () => {
    const r = await reportOf('director');
    const first = r.goals[0];
    expect(first).toMatchObject({ id: ctx.demo.goals.main, health: 'critical', tasks: { done: 3, total: 8, done_in_period: 3, blocked: 1, overdue: 1 } });
    expect(first.top_risk.title).toBe('«Автозаполнение формы заявки» заблокирована');
    expect(first.kpi).toMatchObject({ start: 40, current: 36.5, progress: 35, movement: 'improved', unit: 'minutes' });
    expect(first.owner).toBeTruthy();
  });

  it('адаптация без замеров — «нет замеров», а не «по плану»', async () => {
    const r = await reportOf('director');
    const onboarding = r.goals.find((g: { id: string }) => g.id === ctx.demo.goals.onboarding);
    expect(onboarding).toMatchObject({ health: 'blind', kpi: { current: null, state: 'no_data' } });
  });

  it('решения: сначала критический блокер, справочных нет', async () => {
    const r = await reportOf('director');
    expect(r.decisions.length).toBeGreaterThan(0);
    expect(r.decisions.length).toBeLessThanOrEqual(5);
    expect(r.decisions[0]).toMatchObject({ severity: 'critical', goal_id: ctx.demo.goals.main });
    expect(r.decisions.every((d: { severity: string }) => d.severity !== 'info')).toBe(true);
  });

  it('главное за период — готовые фразы', async () => {
    const r = await reportOf('director');
    expect(r.summary[0]).toBe('2 из 3 целей с KPI сдвинули показатель к цели.');
    expect(r.summary).toContain('Закрыто 3 задачи, 67 % в срок.');
  });

  it('неделя: из закрытых задач остаются только последние', async () => {
    const week = await reportOf('director', '?days=7');
    expect(week.days).toBe(7);
    expect(week.from).toBe('2026-10-12T12:00:00.000Z');
    expect(week.headline.tasks_done).toBeLessThan(3);
  });

  it('неверный период или формат — 400 с понятным полем', async () => {
    const director = await ctx.as('director');
    for (const q of ['?days=14', '?days=abc', '?days=30&days=7']) {
      const r = await director.get(`/api/v1/report${q}`);
      expect(r.status).toBe(400);
      expect(r.body.error.fields.days).toMatch(/7, 30 или 90/);
    }
    const f = await director.get('/api/v1/report?format=xlsx');
    expect(f.status).toBe(400);
    expect(f.body.error.fields.format).toBeTruthy();
  });

  it('руководитель получает отчёт только по своей зоне', async () => {
    const r = await reportOf('elena');
    expect(r.scope).toBe('visible');
    expect(r.goals.map((g: { id: string }) => g.id)).toEqual([ctx.demo.goals.onboarding]);
    expect(r.decisions).toEqual([]);
    expect(r.author).toBe('Елена Фёдорова');
  });

  it('наблюдатель видит отчёт, но без прав на изменения', async () => {
    const r = await reportOf('observer');
    expect(r.goals.length).toBe(3);
  });

  it('CSV для Excel: файл с датой, BOM, «;» и строка на цель', async () => {
    const r = await (await ctx.as('director')).get('/api/v1/report?format=csv');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(r.headers['content-disposition']).toBe('attachment; filename="offix-otchet-2026-10-19.csv"');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    const lines = r.text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(REPORT_CSV_COLUMNS.join(';'));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(';Под угрозой;');
  });

  it('CSV без входа не отдаётся', async () => {
    expect((await request(ctx.app).get('/api/v1/report?format=csv')).status).toBe(401);
    expect((await request(ctx.app).get('/api/v1/report?format=csv').set('Authorization', `Bearer ${SECRET}`)).status).toBe(401);
  });

  it('черновик в отчёт не попадает, запущенная цель — попадает', async () => {
    const olga = await ctx.as('olga');
    const before = (await reportOf('olga')).goals.length;
    const g = (await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga))).body.data;
    expect((await reportOf('olga')).goals.length).toBe(before);
    expect((await olga.post(`/api/v1/goals/${g.id}/activate`)).status).toBe(200);
    const after = await reportOf('olga');
    expect(after.goals.length).toBe(before + 1);
    expect(after.goals.find((x: { id: string }) => x.id === g.id)).toMatchObject({ health: 'blind', owner: 'Ольга Смирнова' });
  });

  it('завершённая за период цель — в отчёте как завершённая', async () => {
    const director = await ctx.as('director');
    expect((await director.post(`/api/v1/goals/${ctx.demo.goals.contracts}/status`, { status: 'completed' })).status).toBe(200);
    const r = await reportOf('director');
    const done = r.goals.find((g: { id: string }) => g.id === ctx.demo.goals.contracts);
    expect(done).toMatchObject({ health: 'done', top_risk: null });
    expect(done.completed_at).toBeTruthy();
    expect(r.goals.at(-1).id).toBe(ctx.demo.goals.contracts);
    expect(r.summary.at(-1)).toMatch(/^Завершена цель «/);
  });
});
