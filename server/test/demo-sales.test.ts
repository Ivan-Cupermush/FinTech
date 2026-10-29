import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SalesMonth, SalesTeam } from '@offix/core';
import { DEMO_PASSWORD } from '../src/seed/demo';
import { seedDemoSales, type DemoSales } from '../src/seed/demo-sales';
import { NOW, setup, type Ctx } from './helpers';

const API = '/api/v1/sales';
let ctx: Ctx;
let d: DemoSales;
let token = '';

const get = (url: string, t = token) => request(ctx.app).get(url).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await setup();
  d = await seedDemoSales(ctx.db, ctx.demo, NOW);
  token = (await request(ctx.app).post('/api/v1/auth/login').send({ email: 'natalia@offix.demo', password: DEMO_PASSWORD })).body.data.token;
});

describe('демо продаж: центр ДПО', () => {
  it('команда Натальи за текущий месяц: выручка по отчёту по вчерашний день, план и прогноз выплат', async () => {
    const t = (await get(`${API}/team?month=2026-10`)).body.data as SalesTeam;
    expect(t.members.map((m) => m.user.name).sort()).toEqual(['Ксения Морозова', 'Павел Соколов']);
    for (const m of t.members) {
      expect(m.stats).toMatchObject({ as_of: '2026-10-18', reports: 1 });
      expect(m.stats!.revenue).toBeGreaterThan(0);
      expect(m.totals.now).toBeGreaterThan(40000);
      expect(m.plans).toBeGreaterThanOrEqual(4);
    }
    expect(t.can).toEqual({ upload: true, kpi_files: true, assign: true });
  });

  it('месяц Павла: показатели по отчётам с фактом и прогнозом, прошлый месяц — из файла KPI', async () => {
    const m = (await get(`${API}/month?user=${d.pavel}&month=2026-10`)).body.data as SalesMonth;
    expect(m.plans.map((p) => p.name)).toEqual(['Оклад', 'Выручка по курсам', 'Корпоративные клиенты', 'Курсы программирования, шт']);
    const revenue = m.plans[1]!;
    expect(revenue.fact).toBe(m.stats!.revenue);
    expect(revenue.calc).toMatchObject({ source: 'report', tracked: true, as_of: '2026-10-18' });
    expect(revenue.calc.forecast_value).toBeGreaterThan(revenue.fact);
    expect(m.plans[2]!.fact).toBeGreaterThan(0);
    expect(m.months.slice(0, 3)).toEqual(['2026-10', '2026-09', '2026-08']);

    const sep = (await get(`${API}/month?user=${d.pavel}&month=2026-09`)).body.data as SalesMonth;
    expect(sep.plans.every((p) => p.source === 'file')).toBe(true);
    expect(sep.totals.file).toBeGreaterThanOrEqual(45000);
    expect(sep.stats!.revenue).toBe(sep.plans.find((p) => /план продаж/i.test(p.name))!.fact);
  });

  it('Ксения: записанные вебинары в факте, ключевые клиенты отдельно, отзывы — вручную', async () => {
    const m = (await get(`${API}/month?user=${d.ksenia}&month=2026-10`)).body.data as SalesMonth;
    const by = Object.fromEntries(m.plans.map((p) => [p.name, p]));
    expect(by['Вебинары (записи вручную)']!.fact).toBe(4 * 3500 + 6 * 2500 + 2 * 3500);
    expect(m.entries).toMatchObject({ count: 3, amount: 36000 });
    expect(by['Отзывы слушателей']).toMatchObject({ fact: 9, calc: { percent: 60, now: null } });
    const key = by['Продажи сети «Меридиан»']!.fact;
    const nonKey = by['Выручка без ключевых клиентов']!.fact;
    expect(key + nonKey).toBe(m.stats!.revenue);
  });

  it('уволившийся менеджер ждёт сопоставления; KPI цели центра — по завершённым месяцам', async () => {
    const un = (await get(`${API}/unmatched`)).body.data;
    expect(un.map((x: { name: string }) => x.name)).toEqual(['Гусев Олег']);
    const links = (await get(`${API}/goal-links`)).body.data;
    expect(links).toEqual([expect.objectContaining({ goal_title: 'Выручка центра ДПО — 1 млн ₽ в месяц', measure: 'revenue', unit_name: 'Центр ДПО', last_month: '2026-09', can_edit: true })]);
    const { rows } = await ctx.db.query<{ observed_at: string }>(
      `SELECT o.observed_at FROM goal_metric_observations o JOIN goal_metrics m ON m.id = o.metric_id WHERE m.goal_id = $1 ORDER BY o.observed_at`,
      [d.goal],
    );
    expect(rows.map((r) => r.observed_at.slice(0, 10))).toEqual(['2026-08-31', '2026-09-30']);
    const reports = (await get(`${API}/reports?month=2026-10`)).body.data;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ period_start: '2026-10-01', period_end: '2026-10-18' });
  });
});
