import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { setup, validGoal, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

const metricsOf = async (who: Parameters<Ctx['as']>[0]) => {
  const r = await (await ctx.as(who)).get('/api/v1/metrics');
  expect(r.status).toBe(200);
  return r.body.data;
};

describe('продуктовые метрики', () => {
  it('без входа — 401', async () => {
    expect((await request(ctx.app).get('/api/v1/metrics')).status).toBe(401);
  });

  it('Северная звезда по демо: две цели из трёх с KPI сдвинулись к цели', async () => {
    const m = await metricsOf('director');
    expect(m.scope).toBe('company');
    expect(m.window_days).toBe(30);
    expect(m.north_star).toMatchObject({ value: 67, total: 3, without_kpi: 0, counts: { improved: 2, flat: 0, worse: 0, stale: 1 } });
    // Сначала то, что требует внимания.
    expect(m.north_star.items[0]).toMatchObject({ id: ctx.demo.goals.onboarding, movement: 'stale', delta: null });
    const main = m.north_star.items.find((i: { id: string }) => i.id === ctx.demo.goals.main);
    expect(main.movement).toBe('improved');
    expect(main.delta).toBeCloseTo(35);
  });

  it('свежесть замеров: у адаптации замеров нет совсем', async () => {
    const m = await metricsOf('director');
    expect(m.freshness).toMatchObject({ value: 67, fresh: 2, total: 3, max_age_days: 14 });
    expect(m.freshness.stale).toEqual([{ id: ctx.demo.goals.onboarding, title: 'Ускорить адаптацию новых сотрудников', last_observed_at: null }]);
  });

  it('запуск целей считается по журналу: адаптацию запустили через 18 дней, черновик не запущен', async () => {
    const m = await metricsOf('director');
    expect(m.launch).toMatchObject({ value: 71, launched: 5, total: 7, within_days: 7, median_days: 2.6 });
  });

  it('блокеры: медиана снятия 60 часов, один открыт четвёртый день', async () => {
    const m = await metricsOf('director');
    expect(m.blockers).toEqual({ median_hours: 60, resolved: 2, open: 1, oldest_open_hours: 98 });
  });

  it('задачи в срок: две из трёх закрыты вовремя', async () => {
    expect((await metricsOf('director')).on_time).toEqual({ value: 67, on_time: 2, total: 3 });
  });

  it('недельный ряд из 8 точек заканчивается текущим значением', async () => {
    const m = await metricsOf('director');
    expect(m.series.at).toHaveLength(8);
    expect(m.series.at[7]).toBe('2026-10-19T12:00:00.000Z');
    expect(m.series.north_star[7]).toBe(m.north_star.value);
    expect(m.series.on_time[7]).toBe(m.on_time.value);
    // Семь недель назад целей ещё не было.
    expect(m.series.north_star[0]).toBeNull();
  });

  it('руководитель видит только свою зону: HR — одну цель', async () => {
    const m = await metricsOf('elena');
    expect(m.scope).toBe('visible');
    expect(m.north_star).toMatchObject({ value: 0, total: 1, counts: { stale: 1 } });
    expect(m.blockers.median_hours).toBeNull();
    expect(m.on_time.value).toBeNull();
  });

  it('новый замер сразу двигает метрики', async () => {
    const elena = await ctx.as('elena');
    const goal = (await elena.get(`/api/v1/goals/${ctx.demo.goals.onboarding}`)).body.data;
    const r = await elena.post(`/api/v1/goals/${goal.id}/metrics/${goal.metrics[0].id}/observations`, { value: 25 });
    expect(r.status).toBe(201);
    const m = await metricsOf('elena');
    expect(m.north_star).toMatchObject({ value: 100, counts: { improved: 1, stale: 0 } });
    expect(m.freshness.value).toBe(100);
  });

  it('отменённая цель выходит из Северной звезды', async () => {
    const director = await ctx.as('director');
    const before = (await metricsOf('director')).north_star.total;
    const r = await director.post(`/api/v1/goals/${ctx.demo.goals.contracts}/status`, { status: 'cancelled' });
    expect(r.status).toBe(200);
    const m = await metricsOf('director');
    expect(m.north_star.total).toBe(before - 1);
    expect(m.north_star.items.some((i: { id: string }) => i.id === ctx.demo.goals.contracts)).toBe(false);
  });

  it('цель, запущенная сразу после создания, засчитывается в запуск', async () => {
    const olga = await ctx.as('olga');
    const before = (await metricsOf('olga')).launch;
    const g = (await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga))).body.data;
    expect((await olga.post(`/api/v1/goals/${g.id}/activate`)).status).toBe(200);
    const after = (await metricsOf('olga')).launch;
    expect(after.total).toBe(before.total + 1);
    expect(after.launched).toBe(before.launched + 1);
  });

  it('свежий черновик не снижает метрику запуска', async () => {
    const olga = await ctx.as('olga');
    const before = (await metricsOf('olga')).launch;
    await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga));
    expect((await metricsOf('olga')).launch).toEqual(before);
  });
});
