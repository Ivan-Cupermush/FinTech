import { beforeAll, describe, expect, it } from 'vitest';
import { setup, validGoal, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

/** Новая цель Ольги с KPI «Время» 40 → 30 мин. */
const newGoal = async () => {
  const olga = await ctx.as('olga');
  const g = (await olga.post('/api/v1/goals', { ...validGoal(ctx.demo.users.olga), metrics: [{ name: 'Время', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease' }] })).body.data;
  return { olga, g, url: `/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations` };
};

const ROWS = [
  { observed_at: '2026-10-01T09:00:00.000Z', value: 40 },
  { observed_at: '2026-10-08T09:00:00.000Z', value: 38.5 },
  { observed_at: '2026-10-15T09:00:00.000Z', value: 35 },
];

describe('POST /goals/:id/metrics/:mid/observations/import', () => {
  it('добавляет замеры с source=import и пересчитывает текущее значение', async () => {
    const { olga, url } = await newGoal();
    const r = await olga.post(`${url}/import`, { rows: ROWS, note: 'Выгрузка из 1С' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ imported: 3, skipped: 0 });
    expect(r.body.data.metric).toMatchObject({ current_value: 35, last_observed_at: '2026-10-15T09:00:00.000Z' });
    expect(r.body.data.metric.progress).toEqual({ state: 'progress', raw: 50, bar: 50 });
    const hist = (await olga.get(url)).body.data;
    expect(hist.map((o: { value: number; source: string; note: string; recorded_by: string }) => [o.value, o.source, o.note, o.recorded_by])).toEqual([
      [40, 'import', 'Выгрузка из 1С', 'Ольга Смирнова'],
      [38.5, 'import', 'Выгрузка из 1С', 'Ольга Смирнова'],
      [35, 'import', 'Выгрузка из 1С', 'Ольга Смирнова'],
    ]);
  });

  it('один аудит metric.imported с количеством и диапазоном дат', async () => {
    const { olga, g, url } = await newGoal();
    await olga.post(`${url}/import`, { rows: [...ROWS, ROWS[0]!] });
    const { rows } = await ctx.db.query<{ event_type: string; new_values: unknown }>(
      `SELECT event_type, new_values FROM audit_events WHERE entity_id = $1 AND event_type LIKE 'metric.%' ORDER BY created_at`,
      [g.metrics[0].id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('metric.imported');
    expect(rows[0]!.new_values).toEqual({ count: 3, skipped: 1, from: '2026-10-01', to: '2026-10-15' });
  });

  it('повторный импорт того же файла ничего не добавляет', async () => {
    const { olga, url } = await newGoal();
    await olga.post(`${url}/import`, { rows: ROWS });
    const again = await olga.post(`${url}/import`, { rows: ROWS });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ imported: 0, skipped: 3 });
    expect((await olga.get(url)).body.data).toHaveLength(3);
  });

  it('день, где замер уже есть (в том числе ручной), пропускается; день считается по Москве', async () => {
    const { olga, url } = await newGoal();
    await olga.post(url, { value: 39, observed_at: '2026-10-01T20:30:00Z' }); // 23:30 по Москве 1 октября
    const r = await olga.post(`${url}/import`, {
      rows: [
        { observed_at: '2026-10-01T05:00:00Z', value: 40 }, // 1 октября — уже есть
        { observed_at: '2026-10-01T21:30:00Z', value: 38 }, // 00:30 по Москве 2 октября — новый день
        { observed_at: '2026-10-02T10:00:00Z', value: 37 }, // тот же 2 октября — повтор внутри файла
      ],
    });
    expect(r.body.data).toMatchObject({ imported: 1, skipped: 2 });
    const hist = (await olga.get(url)).body.data;
    expect(hist.map((o: { value: number }) => o.value)).toEqual([39, 38]);
  });

  it('без прав — 403: участник цели и наблюдатель', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.get(`/api/v1/goals/${ctx.demo.goals.main}`)).body.data;
    const url = `/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations/import`;
    expect((await (await ctx.as('anna')).post(url, { rows: ROWS })).status).toBe(403);
    expect((await (await ctx.as('observer')).post(url, { rows: ROWS })).status).toBe(403);
  });

  it('замер из будущего — 422 с номером строки, ничего не добавлено', async () => {
    const { olga, url } = await newGoal();
    const r = await olga.post(`${url}/import`, { rows: [...ROWS, { observed_at: '2026-12-01T09:00:00Z', value: 33 }] });
    expect(r.status).toBe(422);
    expect(r.body.error.fields['rows.3.observed_at']).toBe('Строка 4: измерение не может быть из будущего');
    expect(r.body.error.message).toMatch(/Строка 4/);
    expect((await olga.get(url)).body.data).toHaveLength(0);
  });

  it('значение вне диапазона единицы — 422', async () => {
    const { olga, url } = await newGoal();
    const r = await olga.post(`${url}/import`, { rows: [ROWS[0]!, { observed_at: '2026-10-02T09:00:00Z', value: -5 }] });
    expect(r.status).toBe(422);
    expect(r.body.error.fields['rows.1.value']).toMatch(/^Строка 2: .*отрицательным/);
  });

  it('некорректная дата — 422; пустой список и больше 500 строк — 400, как любое тело не по схеме', async () => {
    const { olga, url } = await newGoal();
    expect((await olga.post(`${url}/import`, { rows: [{ observed_at: 'вчера', value: 1 }] })).status).toBe(422);
    expect((await olga.post(`${url}/import`, { rows: [] })).status).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) => ({ observed_at: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString(), value: 1 }));
    expect((await olga.post(`${url}/import`, { rows: many })).status).toBe(400);
  });

  it('500 строк за раз — можно', async () => {
    const { olga, url } = await newGoal();
    const rows = Array.from({ length: 500 }, (_, i) => ({ observed_at: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString(), value: 35 }));
    const r = await olga.post(`${url}/import`, { rows });
    expect(r.body.data).toMatchObject({ imported: 500, skipped: 0 });
  });

  it('в отменённую цель — 409', async () => {
    const { olga, g, url } = await newGoal();
    expect((await olga.post(`/api/v1/goals/${g.id}/status`, { status: 'cancelled' })).status).toBe(200);
    expect((await olga.post(`${url}/import`, { rows: ROWS })).status).toBe(409);
  });

  it('KPI другой цели по этому адресу не найден', async () => {
    const olga = await ctx.as('olga');
    const other = (await olga.get(`/api/v1/goals/${ctx.demo.goals.contracts}`)).body.data;
    const r = await olga.post(`/api/v1/goals/${ctx.demo.goals.main}/metrics/${other.metrics[0].id}/observations/import`, { rows: ROWS });
    expect(r.status).toBe(404);
  });

  it('тот же Idempotency-Key возвращает тот же ответ, другой запрос с ним — 409', async () => {
    const { olga, url } = await newGoal();
    const first = await olga.post(`${url}/import`, { rows: ROWS }).set('Idempotency-Key', 'import-1');
    const second = await olga.post(`${url}/import`, { rows: ROWS }).set('Idempotency-Key', 'import-1');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect((await olga.post(`${url}/import`, { rows: ROWS.slice(1) }).set('Idempotency-Key', 'import-1')).status).toBe(409);
  });

  it('достижение KPI импортом уведомляет владельца', async () => {
    const director = await ctx.as('director');
    const g = (await director.post('/api/v1/goals', validGoal(ctx.demo.users.maria))).body.data;
    await director.post(`/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations/import`, { rows: [{ observed_at: '2026-10-18T09:00:00Z', value: 7 }] });
    const { rows } = await ctx.db.query<{ kind: string }>(`SELECT kind FROM notifications WHERE user_id = $1 AND goal_id = $2`, [ctx.demo.users.maria, g.id]);
    expect(rows.map((r) => r.kind)).toContain('kpi_achieved');
  });

  it('GET /metrics учитывает импортированные замеры', async () => {
    const director = await ctx.as('director');
    const before = (await director.get('/api/v1/metrics')).body.data;
    expect(before.freshness.stale.map((s: { id: string }) => s.id)).toContain(ctx.demo.goals.onboarding);
    const g = (await director.get(`/api/v1/goals/${ctx.demo.goals.onboarding}`)).body.data;
    const r = await director.post(`/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations/import`, {
      rows: [{ observed_at: '2026-10-18T09:00:00Z', value: g.metrics[0].baseline }],
    });
    expect(r.status).toBe(201);
    const after = (await director.get('/api/v1/metrics')).body.data;
    expect(after.freshness.stale.map((s: { id: string }) => s.id)).not.toContain(ctx.demo.goals.onboarding);
    expect(after.freshness.fresh).toBe(before.freshness.fresh + 1);
  });
});
