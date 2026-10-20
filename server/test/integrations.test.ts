import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDemo } from '../src/seed/demo';
import { DEMO_1C_URL, DEMO_MOODLE_URL, fakeSystemsFetch } from '../src/seed/fake-systems';
import { dueIntegrations, syncIntegration, type FetchLike } from '../src/services/integrations';
import { NOW, setup, validGoal, type Agent, type Ctx } from './helpers';

const fake = fakeSystemsFetch(() => NOW);
let impl: FetchLike = fake;
const calls: { url: string; headers: Record<string, string> }[] = [];
const spy: FetchLike = (url, init) => {
  calls.push({ url, headers: init?.headers ?? {} });
  return impl(url, init);
};

let ctx: Ctx;
let director: Agent;
let seeded: string;
let contractsMetric: string;
beforeAll(async () => {
  ctx = await setup({ integrationFetch: spy });
  director = await ctx.as('director');
  const list = (await director.get('/api/v1/integrations')).body.data;
  seeded = list[0].id;
  contractsMetric = list[0].metric.id;
});
beforeEach(() => {
  impl = fake;
  calls.length = 0;
});

const onecBody = (over: object = {}) => ({
  kind: 'onec',
  name: '1С: договоры, копия',
  metric_id: contractsMetric,
  username: 'offix',
  secret: 'another-password-123',
  config: { base_url: DEMO_1C_URL, entity: 'Document_ДоговорКонтрагента', date_field: 'Date', value_field: 'СрокСогласования', aggregate: 'avg' },
  ...over,
});

/** Цель с KPI в процентах — для доли завершивших курс. */
async function percentMetric(): Promise<string> {
  const r = await director.post('/api/v1/goals', {
    ...validGoal(ctx.demo.users.director),
    title: 'Повысить долю завершивших курс «Цифровая грамотность»',
    metrics: [{ name: 'Завершили курс', unit: 'percent', baseline: 40, target: 80, direction: 'increase' }],
  });
  expect(r.status).toBe(201);
  return r.body.data.metrics[0].id;
}

describe('доступ', () => {
  it('без входа — 401, руководителю и сотруднику — 403', async () => {
    expect((await request(ctx.app).get('/api/v1/integrations')).status).toBe(401);
    for (const who of ['olga', 'anna', 'observer'] as const) {
      const a = await ctx.as(who);
      expect((await a.get('/api/v1/integrations')).status).toBe(403);
      expect((await a.post(`/api/v1/integrations/${seeded}/sync`)).status).toBe(403);
    }
  });
  it('чужая или несуществующая интеграция — 404', async () => {
    expect((await director.get('/api/v1/integrations/not-a-uuid/runs')).status).toBe(404);
    expect((await director.post('/api/v1/integrations/00000000-0000-4000-8000-000000000000/sync')).status).toBe(404);
  });
});

describe('список', () => {
  it('демо-подключение к 1С: работает, последний запуск удачный', async () => {
    const r = await director.get('/api/v1/integrations');
    expect(r.status).toBe(200);
    const [i] = r.body.data;
    expect(i).toMatchObject({
      kind: 'onec',
      name: '1С: договоры',
      goal: { id: ctx.demo.goals.contracts, title: 'Сократить срок согласования договоров' },
      metric: { name: 'Срок согласования договора', unit: 'days' },
      username: 'offix',
      secret_mask: '••••••••',
      state: 'ok',
      interval_hours: 24,
      last_run: { status: 'ok', imported: 1, trigger: 'manual' },
    });
  });
  it('пароль не уходит наружу ни в одном ответе', async () => {
    for (const url of ['/api/v1/integrations', `/api/v1/integrations/${seeded}/runs`]) {
      expect(JSON.stringify((await director.get(url)).body)).not.toContain('demo-1c-password');
    }
  });
  it('куда писать: KPI действующих целей', async () => {
    const r = await director.get('/api/v1/integrations/targets');
    expect(r.body.data).toContainEqual({ metric_id: contractsMetric, metric_name: 'Срок согласования договора', unit: 'days', goal_id: ctx.demo.goals.contracts, goal_title: 'Сократить срок согласования договоров' });
  });
});

describe('синхронизация 1С', () => {
  it('забирает новое с прошлого раза: один замер за день, среднее по договорам', async () => {
    const r = await director.post(`/api/v1/integrations/${seeded}/sync`);
    expect(r.status).toBe(200);
    // С 13 по 19 октября пять рабочих дней, замер за 14-е уже был.
    expect(r.body.data.run).toMatchObject({ status: 'ok', trigger: 'manual', imported: 4, skipped: 1, error: null });
    expect(r.body.data.integration).toMatchObject({ state: 'ok', last_error: null, last_sync_at: NOW.toISOString(), next_sync_at: '2026-10-20T12:00:00.000Z' });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('$filter')).toBe("Date ge datetime'2026-10-13T10:00:00'");
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('offix:demo-1c-password').toString('base64')}`);

    const hist = (await director.get(`/api/v1/goals/${ctx.demo.goals.contracts}/metrics/${contractsMetric}/observations`)).body.data;
    const synced = hist.filter((o: { source: string }) => o.source === 'integration');
    expect(synced.map((o: { observed_at: string }) => o.observed_at.slice(0, 10))).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19']);
    expect(synced.at(-1)).toMatchObject({ note: 'Интеграция «1С: договоры»', recorded_by: 'Алексей Петров' });
  });

  it('повторная синхронизация ничего не задваивает', async () => {
    const r = await director.post(`/api/v1/integrations/${seeded}/sync`);
    expect(r.body.data.run).toMatchObject({ status: 'ok', imported: 0 });
    expect(r.body.data.run.skipped).toBeGreaterThan(0);
  });

  it('в журнале цели — событие синхронизации', async () => {
    const { rows } = await ctx.db.query<{ new_values: { count: number; integration_id: string } }>(
      `SELECT new_values FROM audit_events WHERE event_type = 'metric.synced' AND entity_id = $1`,
      [contractsMetric],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.new_values).toMatchObject({ count: 4, integration_id: seeded, kind: 'onec' });
  });

  it('система недоступна — ошибка у подключения и в журнале, сервер работает', async () => {
    impl = async () => {
      throw new TypeError('fetch failed');
    };
    const r = await director.post(`/api/v1/integrations/${seeded}/sync`);
    expect(r.status).toBe(200);
    expect(r.body.data.run).toMatchObject({ status: 'error', error: 'Система недоступна: fetch failed' });
    expect(r.body.data.integration).toMatchObject({ state: 'error', last_error: 'Система недоступна: fetch failed' });
    const runs = (await director.get(`/api/v1/integrations/${seeded}/runs`)).body.data;
    expect(runs[0]).toMatchObject({ status: 'error' });
    expect(runs.length).toBeGreaterThanOrEqual(4);
  });

  it('удачный запуск снимает ошибку', async () => {
    const r = await director.post(`/api/v1/integrations/${seeded}/sync`);
    expect(r.body.data.integration).toMatchObject({ state: 'ok', last_error: null });
  });

  it('ответ без списка записей и не JSON — понятная ошибка', async () => {
    impl = async () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) });
    expect((await director.post(`/api/v1/integrations/${seeded}/sync`)).body.data.run.error).toBe('1С вернула ответ без списка записей');
    impl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    expect((await director.post(`/api/v1/integrations/${seeded}/sync`)).body.data.run.error).toMatch(/не похож на JSON/);
    impl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    expect((await director.post(`/api/v1/integrations/${seeded}/sync`)).body.data.run.error).toBe('Система ответила ошибкой HTTP 500');
  });
});

describe('проверка подключения', () => {
  it('черновик настроек: работает, ничего не записано', async () => {
    const before = (await ctx.db.query(`SELECT COUNT(*)::int AS n FROM goal_metric_observations`)).rows[0];
    const r = await director.post('/api/v1/integrations/test', onecBody());
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ ok: true, invalid: 0 });
    expect(r.body.data.message).toMatch(/^Подключение работает — записей: \d+, дней с замером: \d+$/);
    expect(r.body.data.points).toHaveLength(5);
    expect((await ctx.db.query(`SELECT COUNT(*)::int AS n FROM goal_metric_observations`)).rows[0]).toEqual(before);
  });
  it('неверный пароль и неверный документ — причина словами', async () => {
    expect((await director.post('/api/v1/integrations/test', onecBody({ secret: 'wrong' }))).body.data).toMatchObject({ ok: false, message: 'Система отклонила логин и пароль' });
    const r = await director.post('/api/v1/integrations/test', onecBody({ config: { ...onecBody().config, entity: 'Document_Нет' } }));
    expect(r.body.data.message).toMatch(/^Адрес не найден/);
  });
  it('при правке без нового пароля берём сохранённый', async () => {
    const r = await director.post('/api/v1/integrations/test', { ...onecBody(), secret: undefined, id: seeded });
    expect(r.body.data.ok).toBe(true);
    expect(calls.at(-1)!.headers.Authorization).toBe(`Basic ${Buffer.from('offix:demo-1c-password').toString('base64')}`);
  });
  it('сохранённое подключение', async () => {
    expect((await director.post(`/api/v1/integrations/${seeded}/test`)).body.data.ok).toBe(true);
  });
});

describe('создание и правка', () => {
  it('ошибки у полей: адрес без https, нет пользователя и пароля', async () => {
    const r = await director.post('/api/v1/integrations', onecBody({ username: '', secret: undefined, name: ' ', config: { ...onecBody().config, base_url: 'http://1c.univ.ru' } }));
    expect(r.status).toBe(422);
    expect(r.body.error.fields).toEqual({
      'config.base_url': 'Нужен защищённый адрес https://',
      name: 'Назовите подключение',
      username: 'Укажите пользователя 1С',
      secret: 'Укажите пароль пользователя 1С',
    });
  });
  it('неизвестный вид и неизвестная частота — 400', async () => {
    expect((await director.post('/api/v1/integrations', onecBody({ kind: 'sap' }))).status).toBe(400);
    expect((await director.post('/api/v1/integrations', onecBody({ interval_hours: 2 }))).status).toBe(400);
  });
  it('KPI чужой компании выбрать нельзя', async () => {
    const other = await seedDemo(ctx.db, { now: NOW, companyName: 'Другой вуз' });
    const { rows } = await ctx.db.query<{ id: string }>(`SELECT id FROM goal_metrics WHERE goal_id = $1`, [other.goals.contracts]);
    const r = await director.post('/api/v1/integrations', onecBody({ metric_id: rows[0]!.id }));
    expect(r.status).toBe(422);
    expect(r.body.error.fields).toEqual({ metric_id: 'Выберите KPI' });
    // И наоборот: администратор другой компании не видит наши подключения.
    const theirs = (await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM integrations WHERE company_id = $1`, [other.companyId])).rows[0]!.n;
    expect(theirs).toBe(1);
  });

  it('Moodle: доля завершивших курс приходит в KPI в процентах', async () => {
    const metric = await percentMetric();
    const created = await director.post('/api/v1/integrations', {
      kind: 'moodle',
      name: 'Moodle: цифровая грамотность',
      metric_id: metric,
      secret: 'moodle-token-0123456789',
      config: { base_url: `${DEMO_MOODLE_URL}/`, course_id: '101' },
      interval_hours: 168,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ kind: 'moodle', username: null, secret_mask: '••••••••', state: 'never', config: { base_url: DEMO_MOODLE_URL, course_id: 101, metric: 'completion_share' } });

    const r = await director.post(`/api/v1/integrations/${created.body.data.id}/sync`);
    // 40 слушателей (преподаватели не считаются), завершили 26.
    expect(r.body.data.run).toMatchObject({ status: 'ok', fetched: 40, imported: 1 });
    const goal = (await director.get(`/api/v1/goals/${created.body.data.goal.id}`)).body.data;
    expect(goal.metrics[0].current_value).toBe(65);
    expect(new URL(calls.at(-1)!.url).searchParams.get('wsfunction')).toBe('core_completion_get_course_completion_status');
  });

  it('Moodle: неверный токен и курс — причина словами, токен не попадает в ошибку', async () => {
    const r = await director.post('/api/v1/integrations/test', { kind: 'moodle', config: { base_url: DEMO_MOODLE_URL, course_id: 101 }, secret: 'bad' });
    expect(r.body.data).toMatchObject({ ok: false, message: 'Moodle не принял токен веб-сервиса' });
    expect((await director.post('/api/v1/integrations/test', { kind: 'moodle', config: { base_url: DEMO_MOODLE_URL, course_id: 7 }, secret: 'tok' })).body.data.message).toBe('Курс не найден: проверьте номер курса');
    impl = async (url) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    };
    const leak = await director.post('/api/v1/integrations/test', { kind: 'moodle', config: { base_url: DEMO_MOODLE_URL, course_id: 101 }, secret: 'super-secret-token' });
    expect(leak.body.data.ok).toBe(false);
    expect(leak.body.data.message).not.toContain('super-secret-token');
    expect(leak.body.data.message).toContain('wstoken=••••');
  });

  it('правка: имя и частота меняются, пароль без нового значения сохраняется', async () => {
    const r = await director.patch(`/api/v1/integrations/${seeded}`, { name: '1С: договоры (бухгалтерия)', interval_hours: 6 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: '1С: договоры (бухгалтерия)', interval_hours: 6, secret_mask: '••••••••' });
    const p = await director.patch(`/api/v1/integrations/${seeded}`, { secret: 'new-password-2026' });
    expect(p.body.data.secret_mask).toBe('••••••••');
    expect(JSON.stringify(p.body)).not.toContain('new-password');
    const { rows } = await ctx.db.query<{ secret: string }>(`SELECT secret FROM integrations WHERE id = $1`, [seeded]);
    expect(rows[0]!.secret).toBe('new-password-2026');
  });
  it('правка с ошибкой в настройках — 422, ничего не меняется', async () => {
    const r = await director.patch(`/api/v1/integrations/${seeded}`, { config: { base_url: 'https://1c.univ.ru', entity: 'Документ Договор', date_field: 'Date', value_field: 'V' } });
    expect(r.status).toBe(422);
    expect(r.body.error.fields['config.entity']).toBeDefined();
  });
  it('выключенное подключение не синхронизируется по расписанию', async () => {
    expect((await dueIntegrations(ctx.db, new Date('2026-11-01T00:00:00Z'))).map((d) => d.id)).toContain(seeded);
    await director.patch(`/api/v1/integrations/${seeded}`, { enabled: false });
    const list = (await director.get('/api/v1/integrations')).body.data;
    expect(list.find((i: { id: string }) => i.id === seeded)).toMatchObject({ state: 'paused', next_sync_at: null });
    expect((await dueIntegrations(ctx.db, new Date('2026-11-01T00:00:00Z'))).map((d) => d.id)).not.toContain(seeded);
    await director.patch(`/api/v1/integrations/${seeded}`, { enabled: true });
  });
});

describe('расписание', () => {
  it('запуск по расписанию — без автора, с отметкой schedule', async () => {
    const run = await syncIntegration(ctx.db, ctx.demo.companyId, seeded, { fetch: spy, now: NOW, trigger: 'schedule' });
    expect(run).toMatchObject({ status: 'ok', trigger: 'schedule' });
    const { rows } = await ctx.db.query(`SELECT started_by FROM integration_runs WHERE id = $1`, [run.id]);
    expect(rows[0]).toEqual({ started_by: null });
  });
  it('пора синхронизироваться — по интервалу после прошлой попытки', async () => {
    const soon = new Date(NOW.getTime() + 3_600_000);
    const later = new Date(NOW.getTime() + 6 * 3_600_000);
    expect((await dueIntegrations(ctx.db, soon)).map((d) => d.id)).not.toContain(seeded);
    expect((await dueIntegrations(ctx.db, later)).map((d) => d.id)).toContain(seeded);
  });
  it('отменённая цель: синхронизация не пишет замеры', async () => {
    const metric = await percentMetric();
    const created = (await director.post('/api/v1/integrations', { kind: 'moodle', name: 'Moodle', metric_id: metric, secret: 'tok-tok-tok', config: { base_url: DEMO_MOODLE_URL, course_id: 101 } })).body.data;
    expect((await director.post(`/api/v1/goals/${created.goal.id}/status`, { status: 'cancelled' })).status).toBe(200);
    const r = await director.post(`/api/v1/integrations/${created.id}/sync`);
    expect(r.body.data.run).toMatchObject({ status: 'error', error: 'Цель отменена — замеры в неё не записываются', imported: 0 });
  });
});

describe('удаление', () => {
  it('подключение и его журнал удаляются, замеры остаются', async () => {
    const created = (await director.post('/api/v1/integrations', onecBody())).body.data;
    await director.post(`/api/v1/integrations/${created.id}/sync`);
    const obs = (await ctx.db.query(`SELECT COUNT(*)::int AS n FROM goal_metric_observations`)).rows[0];
    expect((await director.delete(`/api/v1/integrations/${created.id}`)).status).toBe(204);
    expect((await director.get(`/api/v1/integrations/${created.id}/runs`)).status).toBe(404);
    expect((await ctx.db.query(`SELECT COUNT(*)::int AS n FROM integration_runs WHERE integration_id = $1`, [created.id])).rows[0]).toEqual({ n: 0 });
    expect((await ctx.db.query(`SELECT COUNT(*)::int AS n FROM goal_metric_observations`)).rows[0]).toEqual(obs);
  });
});
