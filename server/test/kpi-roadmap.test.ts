import { beforeAll, describe, expect, it } from 'vitest';
import { setup, validGoal, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

async function metricOf(goalId: string) {
  const olga = await ctx.as('olga');
  return (await olga.get(`/api/v1/goals/${goalId}`)).body.data.metrics[0];
}

describe('измерения KPI', () => {
  it('новое измерение двигает прогресс по формуле ТЗ', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.post('/api/v1/goals', { ...validGoal(ctx.demo.users.olga), metrics: [{ name: 'Время', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease' }] })).body.data;
    const r = await olga.post(`/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations`, { value: 35 });
    expect(r.status).toBe(201);
    expect(r.body.data.metric.progress).toEqual({ state: 'progress', raw: 50, bar: 50 });
    const card = (await olga.get(`/api/v1/goals/${g.id}`)).body.data;
    expect(card.progress).toBe(50);
    expect(card.metrics[0].baseline).toBe(40);
  });

  it('ухудшение сохраняется: 45 минут — −50 %', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.post('/api/v1/goals', { ...validGoal(ctx.demo.users.olga), metrics: [{ name: 'Время', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease' }] })).body.data;
    const r = await olga.post(`/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations`, { value: 45 });
    expect(r.body.data.metric.progress).toEqual({ state: 'regress', raw: -50, bar: 0 });
  });

  it('текущее значение — самое позднее по времени измерения', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga))).body.data;
    const url = `/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations`;
    await olga.post(url, { value: 12, observed_at: '2026-10-18T10:00:00Z' });
    await olga.post(url, { value: 20, observed_at: '2026-10-10T10:00:00Z' });
    expect((await metricOf(g.id)).current_value).toBe(12);
    const hist = (await olga.get(url)).body.data;
    expect(hist.map((o: { value: number }) => o.value)).toEqual([20, 12]);
  });

  it('отрицательное время в измерении — 422', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga))).body.data;
    const r = await olga.post(`/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations`, { value: -3 });
    expect(r.status).toBe(422);
  });

  it('измерение из будущего — 422', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga))).body.data;
    const r = await olga.post(`/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations`, { value: 3, observed_at: '2027-01-01T00:00:00Z' });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.observed_at).toMatch(/будущего/);
  });

  it('измерение вносит владелец цели, а не любой участник', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.get(`/api/v1/goals/${ctx.demo.goals.main}`)).body.data;
    const anna = await ctx.as('anna');
    expect((await anna.post(`/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations`, { value: 35 })).status).toBe(403);
    const obs = await ctx.as('observer');
    expect((await obs.post(`/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations`, { value: 35 })).status).toBe(403);
  });

  it('KPI другой цели по этому адресу не найден', async () => {
    const olga = await ctx.as('olga');
    const other = (await olga.get(`/api/v1/goals/${ctx.demo.goals.contracts}`)).body.data;
    const r = await olga.post(`/api/v1/goals/${ctx.demo.goals.main}/metrics/${other.metrics[0].id}/observations`, { value: 1 });
    expect(r.status).toBe(404);
  });

  it('достижение KPI уведомляет владельца', async () => {
    const director = await ctx.as('director');
    const g = (await director.post('/api/v1/goals', validGoal(ctx.demo.users.maria))).body.data;
    await director.post(`/api/v1/goals/${g.id}/metrics/${g.metrics[0].id}/observations`, { value: 7 });
    const { rows } = await ctx.db.query(`SELECT kind FROM notifications WHERE user_id = $1 AND goal_id = $2 ORDER BY created_at`, [ctx.demo.users.maria, g.id]);
    expect(rows.map((r) => r.kind)).toContain('kpi_achieved');
  });

  it('добавление и изменение KPI с проверкой направления', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga))).body.data;
    const add = await olga.post(`/api/v1/goals/${g.id}/metrics`, { name: 'Доля в срок', unit: 'percent', baseline: 60, target: 90, direction: 'increase' });
    expect(add.status).toBe(201);
    expect(add.body.data.is_primary).toBe(false);
    const bad = await olga.patch(`/api/v1/goals/${g.id}/metrics/${add.body.data.id}`, { target: 50 });
    expect(bad.status).toBe(422);
    const ok = await olga.patch(`/api/v1/goals/${g.id}/metrics/${add.body.data.id}`, { target: 95 });
    expect(ok.body.data.target).toBe(95);
  });

  it('maintain требует диапазон', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga))).body.data;
    const r = await olga.post(`/api/v1/goals/${g.id}/metrics`, { name: 'Загрузка', unit: 'percent', baseline: 70, target: 80, direction: 'maintain' });
    expect(r.status).toBe(422);
    const ok = await olga.post(`/api/v1/goals/${g.id}/metrics`, { name: 'Загрузка', unit: 'percent', baseline: 70, target: 80, direction: 'maintain', range_min: 75, range_max: 85 });
    expect(ok.status).toBe(201);
  });
});

describe('подцели', () => {
  it('создаётся с наследованием типа и позицией в конце', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post(`/api/v1/goals/${ctx.demo.goals.main}/children`, { title: 'Обучить сотрудников новому регламенту', owner_id: ctx.demo.users.anna, due_at: '2026-12-01' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ type: 'operational', parent_goal_id: ctx.demo.goals.main, status: 'active' });
  });

  it('срок подцели не позже срока цели', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post(`/api/v1/goals/${ctx.demo.goals.main}/children`, { title: 'Слишком поздно', due_at: '2027-06-01' });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.due_at).toMatch(/позже срока цели/);
  });

  it('сотрудник не добавляет подцели — 403', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.post(`/api/v1/goals/${ctx.demo.goals.main}/children`, { title: 'X' })).status).toBe(403);
  });
});

describe('дорожная карта', () => {
  it('собирает подцели, задачи, зависимости и критический путь', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.get(`/api/v1/goals/${ctx.demo.goals.main}/roadmap`);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.subgoals.slice(0, 3).map((s: { title: string }) => s.title)).toEqual(['Убрать лишние согласования', 'Автоматизировать проверку данных', 'Сохранить качество обработки']);
    expect(d.tasks).toHaveLength(8);
    expect(d.edges).toHaveLength(5);
    expect(d.critical_path.length).toBeGreaterThan(1);
    expect(d.timeline.today).toBe('2026-10-19');
  });

  it('видит риски: блокировку, просрочку и сдвиг зависимых', async () => {
    const olga = await ctx.as('olga');
    const d = (await olga.get(`/api/v1/goals/${ctx.demo.goals.main}/roadmap`)).body.data;
    const kinds = d.risks.map((r: { kind: string }) => r.kind);
    expect(kinds).toContain('blocked');
    expect(kinds).toContain('overdue');
    expect(kinds).toContain('dependency_delay');
    const blocked = d.risks.find((r: { kind: string }) => r.kind === 'blocked');
    expect(blocked.explanation).toContain('Не хватает данных: нет доступа к справочнику подразделений');
    expect(blocked.suggestion).toContain('Дмитрий Орлов');
    const delay = d.risks.find((r: { kind: string }) => r.kind === 'dependency_delay');
    expect(delay.proposals.map((p: { task_id: string }) => p.task_id).sort()).toEqual([ctx.demo.tasks.acceptance, ctx.demo.tasks.pilot].sort());
  });

  it('аналитика: где теряется время', async () => {
    const olga = await ctx.as('olga');
    const a = (await olga.get(`/api/v1/goals/${ctx.demo.goals.main}/roadmap`)).body.data.analytics;
    expect(a.bottlenecks[0].key).toBe('data');
    expect(a.bottlenecks.map((b: { key: string }) => b.key)).toEqual(expect.arrayContaining(['approval', 'colleague', 'review']));
    expect(a.on_time_share).toBe(100);
    expect(a.finished).toBe(3);
  });

  it('перенос сроков применяется только по подтверждению руководителя', async () => {
    const olga = await ctx.as('olga');
    const before = (await olga.get(`/api/v1/tasks/${ctx.demo.tasks.pilot}`)).body.data;
    const d = (await olga.get(`/api/v1/goals/${ctx.demo.goals.main}/roadmap`)).body.data;
    // Просмотр дорожной карты сроки не меняет.
    expect((await olga.get(`/api/v1/tasks/${ctx.demo.tasks.pilot}`)).body.data.due_at).toBe(before.due_at);
    const proposals = d.risks.find((r: { kind: string }) => r.kind === 'dependency_delay').proposals;
    const anna = await ctx.as('anna');
    const denied = await anna.post(`/api/v1/goals/${ctx.demo.goals.main}/reschedule`, { changes: proposals.map((p: { task_id: string; to_start: string; to_due: string }) => ({ task_id: p.task_id, start_at: p.to_start, due_at: p.to_due })) });
    expect(denied.status).toBe(403);
    const ok = await olga.post(`/api/v1/goals/${ctx.demo.goals.main}/reschedule`, { changes: proposals.map((p: { task_id: string; to_start: string; to_due: string }) => ({ task_id: p.task_id, start_at: p.to_start, due_at: p.to_due })) });
    expect(ok.status).toBe(200);
    const after = (await olga.get(`/api/v1/tasks/${ctx.demo.tasks.pilot}`)).body.data;
    expect(after.due_at).not.toBe(before.due_at);
    const { rows } = await ctx.db.query(`SELECT COUNT(*)::int AS n FROM audit_events WHERE event_type = 'task.rescheduled'`);
    expect(rows[0]!.n).toBe(proposals.length);
  });

  it('перенос задачи чужой цели отклоняется', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post(`/api/v1/goals/${ctx.demo.goals.contracts}/reschedule`, { changes: [{ task_id: ctx.demo.tasks.pilot, due_at: '2026-12-01' }] });
    expect(r.status).toBe(422);
  });

  it('чужая дорожная карта — 404', async () => {
    const elena = await ctx.as('elena');
    expect((await elena.get(`/api/v1/goals/${ctx.demo.goals.main}/roadmap`)).status).toBe(404);
  });
});

describe('Пульс', () => {
  it('руководитель видит цели, риски и кому нужна помощь', async () => {
    const olga = await ctx.as('olga');
    const d = (await olga.get('/api/v1/dashboard')).body.data;
    expect(d.goals.map((g: { title: string }) => g.title)).toContain('Сократить время обработки заявки студента');
    const main = d.goals.find((g: { id: string }) => g.id === ctx.demo.goals.main);
    expect(main.risk_level).toBe('critical');
    expect(d.risks[0].severity).toBe('critical');
    expect(d.help_needed.map((t: { title: string }) => t.title)).toContain('Автозаполнение формы заявки');
    expect(d.unread_notifications).toBeGreaterThan(0);
    expect(d.drafts.length).toBeGreaterThan(0);
  });

  it('сотрудник видит свои задачи', async () => {
    const dima = await ctx.as('dima');
    const d = (await dima.get('/api/v1/dashboard')).body.data;
    expect(d.my_tasks.map((t: { title: string }) => t.title).sort()).toEqual(['Автозаполнение формы заявки', 'Подключить проверку данных к реестру студентов']);
    expect(d.help_needed).toEqual([]);
  });

  it('директор видит черновики', async () => {
    const director = await ctx.as('director');
    const d = (await director.get('/api/v1/dashboard')).body.data;
    expect(d.drafts.map((g: { title: string }) => g.title)).toContain('Повысить удовлетворённость студентов сервисом');
  });
});

describe('комментарии', () => {
  it('участник комментирует, владелец получает уведомление', async () => {
    const anna = await ctx.as('anna');
    const r = await anna.post(`/api/v1/goals/${ctx.demo.goals.main}/comments`, { body: 'Регламент готов к обсуждению' });
    expect(r.status).toBe(201);
    const list = (await anna.get(`/api/v1/goals/${ctx.demo.goals.main}/comments`)).body.data;
    expect(list.at(-1).body).toBe('Регламент готов к обсуждению');
    const { rows } = await ctx.db.query(`SELECT title FROM notifications WHERE user_id = $1 AND kind = 'comment'`, [ctx.demo.users.olga]);
    expect(rows.length).toBe(1);
  });
  it('пустой комментарий — 422', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.post(`/api/v1/goals/${ctx.demo.goals.main}/comments`, { body: '  ' })).status).toBe(422);
  });
});
