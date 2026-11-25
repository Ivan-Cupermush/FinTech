import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { observationDay, parseTable, planImport } from '@offix/core';
import { NOW, setup, validGoal, type Ctx } from './helpers';

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

  it('параллельный импорт одного дня добавляет ровно один замер', async () => {
    const { olga, url } = await newGoal();
    const requests = await Promise.all([
      olga.post(`${url}/import`, { rows: [ROWS[0]!] }),
      olga.post(`${url}/import`, { rows: [{ ...ROWS[0]!, value: 39 }] }),
    ]);
    expect(requests.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(requests.find((r) => r.status === 200)?.body.data).toMatchObject({ imported: 0, skipped: 1 });
    expect((await olga.get(url)).body.data).toHaveLength(1);
  });

  it('параллельные ручной замер и импорт уведомляют о достижении один раз', async () => {
    const director = await ctx.as('director');
    const owner = ctx.demo.users.olga;
    const goal = (await director.post('/api/v1/goals', {
      ...validGoal(owner),
      metrics: [{ name: 'Время', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease' }],
    })).body.data;
    const url = `/api/v1/goals/${goal.id}/metrics/${goal.metrics[0].id}/observations`;
    const results = await Promise.all([
      director.post(url, { observed_at: '2026-10-02T09:00:00Z', value: 29 }),
      director.post(`${url}/import`, { rows: [{ observed_at: '2026-10-03T09:00:00Z', value: 28 }] }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect((await director.get(url)).body.data).toHaveLength(2);
    const { rows } = await ctx.db.query(`SELECT id FROM notifications WHERE user_id = $1 AND goal_id = $2 AND kind = 'kpi_achieved'`, [owner, goal.id]);
    expect(rows).toHaveLength(1);
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

  it('решение по задержке и контрольный импорт согласованы в карточке, тренде и отчёте', async () => {
    const director = await ctx.as('director');
    const goalId = ctx.demo.goals.main;
    const goalPath = `/api/v1/goals/${goalId}`;
    const roadmap = (await director.get(`${goalPath}/roadmap`)).body.data;
    const proposal = roadmap.risks.find((risk: { kind: string }) => risk.kind === 'dependency_delay').proposals[0];
    expect(proposal).toBeDefined();
    const change = { task_id: proposal.task_id, start_at: proposal.to_start, due_at: proposal.to_due };
    expect((await director.post(`${goalPath}/reschedule`, { changes: [change] })).status).toBe(200);
    const updated = (await director.get(`${goalPath}/roadmap`)).body.data;
    expect(updated.tasks.find((task: { id: string }) => task.id === change.task_id)).toMatchObject({ due_at: change.due_at });

    const metric = updated.goal.metrics[0];
    expect(metric).toMatchObject({ current_value: 36.5, last_observed_source: 'manual' });
    const observations = `${goalPath}/metrics/${metric.id}/observations`;
    const before = (await director.get(observations)).body.data as { observed_at: string }[];
    const control = readFileSync(new URL('../../docs/sprint2/kpi-import-control.csv', import.meta.url), 'utf8');
    const table = parseTable(control);
    const preview = (history: { observed_at: string }[]) => planImport(table, table.dateCol!, table.valueCol!, {
      unit: 'minutes', now: NOW, existingDays: history.map((item) => observationDay(item.observed_at)),
    });
    const first = preview(before);
    expect(first.counts).toEqual({ ok: 1, duplicate: 1, error: 1 });
    expect(first.rows[1]).toMatchObject({ line: 3, status: 'error', reason: expect.stringContaining('Проценты не подходят') });
    expect(first.latest?.value).toBe(34);

    const imported = await director.post(`${observations}/import`, { rows: first.observations });
    expect(imported.status).toBe(201);
    expect(imported.body.data.metric).toMatchObject({ current_value: 34, last_observed_source: 'import', last_observed_at: first.latest?.at });
    const card = (await director.get(goalPath)).body.data;
    expect(card.metrics[0]).toMatchObject({ current_value: 34, last_observed_source: 'import', progress: { raw: 60 } });
    const list = (await director.get('/api/v1/goals?scope=top')).body.data;
    const summary = list.find((goal: { id: string }) => goal.id === goalId);
    expect(summary.primary_metric.trend.at(-1)).toBe(34);
    const report = (await director.get('/api/v1/report?days=30')).body.data;
    expect(report.goals.find((goal: { id: string }) => goal.id === goalId).kpi).toMatchObject({ current: 34, progress: 60 });

    const history = (await director.get(observations)).body.data;
    expect(history).toHaveLength(before.length + 1);
    expect(preview(history).counts).toEqual({ ok: 0, duplicate: 2, error: 1 });
    const repeat = await director.post(`${observations}/import`, { rows: first.observations });
    expect(repeat.body.data).toMatchObject({ imported: 0, skipped: 1, metric: { current_value: 34 } });
    expect((await director.get(observations)).body.data).toHaveLength(history.length);
  });
});
