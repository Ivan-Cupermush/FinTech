import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { KpiFilePreview, SalesEmployee, SalesImportPreview, SalesMonth, SalesPlan, SalesReportImport, SalesTeam } from '@offix/core';
import { hashPassword } from '../src/auth/auth';
import { DEMO_PASSWORD } from '../src/seed/demo';
import { readXlsx, writeXlsx } from '../src/services/xlsx';
import { kpiRows, mayClients, reportSheet, type ClientSales } from '../../packages/core/test/sales-fixtures';
import { setup, type Ctx } from './helpers';

const API = '/api/v1/sales';

/**
 * Сценарии прошлого проекта (kpi.test.ts) на данных offix: отдел продаж с
 * руководителем Виктором и менеджерами Анной и Петром; Ольга — руководитель
 * другого отдела; Сергей — сотрудник без функций, пока директор их не включит.
 */
interface Sales {
  unit: string;
  sales: string;
  mgr1: string;
  mgr2: string;
}

let ctx: Ctx;
let s: Sales;
const tokens = new Map<string, string>();

async function addPerson(name: string, email: string, unit: string, manager: boolean): Promise<string> {
  const hash = await hashPassword(DEMO_PASSWORD);
  const { rows } = await ctx.db.query<{ id: string }>(`INSERT INTO users (email, password_hash, display_name, position) VALUES ($1, $2, $3, $4) RETURNING id`, [
    email,
    hash,
    name,
    manager ? 'Руководитель отдела продаж' : 'Менеджер по продажам',
  ]);
  const id = rows[0]!.id;
  await ctx.db.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)`, [ctx.demo.companyId, id, manager ? 'manager' : 'member']);
  await ctx.db.query(`INSERT INTO org_memberships (company_id, user_id, unit_id, is_manager, is_primary, started_at) VALUES ($1, $2, $3, $4, TRUE, '2026-01-01')`, [
    ctx.demo.companyId,
    id,
    unit,
    manager,
  ]);
  const r = await request(ctx.app).post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
  tokens.set(id, r.body.data.token);
  return id;
}

type Who = keyof Ctx['demo']['users'] | 'sales' | 'mgr1' | 'mgr2';
const tokenOf = async (who: Who) => (who === 'sales' || who === 'mgr1' || who === 'mgr2' ? tokens.get(s[who])! : ctx.token(who));
const call = async (who: Who) => {
  const t = await tokenOf(who);
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
  return {
    get: (url: string) => auth(request(ctx.app).get(url)),
    post: (url: string, body?: object) => auth(request(ctx.app).post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(request(ctx.app).patch(url)).send(body ?? {}),
    delete: (url: string) => auth(request(ctx.app).delete(url)),
  };
};

async function upload(who: Who, path: string, file: Buffer | Uint8Array, name: string, fields: Record<string, string> = {}) {
  let r = request(ctx.app).post(`${API}${path}`).set('Authorization', `Bearer ${await tokenOf(who)}`);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', Buffer.from(file), name);
}

const reportFile = (period: string, clients: ClientSales[], levels = true) => writeXlsx([reportSheet(period, clients, levels)]);
const kpiFile = (opts: Parameters<typeof kpiRows>[0]) => writeXlsx([{ name: 'KPI', rows: kpiRows(opts) }]);

async function month(who: Who, user: string, m = '2026-05'): Promise<SalesMonth & { by: Record<string, SalesPlan> }> {
  const r = await (await call(who)).get(`${API}/month?user=${user}&month=${m}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const data = r.body.data as SalesMonth;
  const by: Record<string, SalesPlan> = {};
  for (const p of data.plans) {
    const n = p.name.toLowerCase();
    const key = /без еп/.test(n) ? 'no_ep' : /есть по/.test(n) ? 'ep' : /акб/.test(n) ? 'akb' : /опх/.test(n) ? 'oph' : /^план балтика/.test(n) ? 'baltika' : /оклад/.test(n) ? 'salary' : p.name;
    by[key] = p;
  }
  return { ...data, by };
}

beforeAll(async () => {
  ctx = await setup();
  const { rows } = await ctx.db.query<{ id: string }>(`INSERT INTO org_units (company_id, name, unit_type, color) VALUES ($1, 'Отдел продаж', 'department', '#F04438') RETURNING id`, [
    ctx.demo.companyId,
  ]);
  const unit = rows[0]!.id;
  s = { unit, sales: '', mgr1: '', mgr2: '' };
  s.sales = await addPerson('Виктор Сидоров', 'sales@offix.demo', unit, true);
  s.mgr1 = await addPerson('Анна Смирнова', 'a.smirnova@offix.demo', unit, false);
  s.mgr2 = await addPerson('Пётр Иванов', 'p.ivanov@offix.demo', unit, false);
});

describe('xlsx: чтение и запись', () => {
  it('записанный файл читается обратно: строки, числа, уровни группировки', () => {
    const sheet = reportSheet('01.05.2026 - 15.05.2026', mayClients());
    const [back] = readXlsx(writeXlsx([sheet]));
    expect(back!.name).toBe('Лист_1');
    expect(back!.rows[4]).toEqual(['Параметры:', '', 'Период: 01.05.2026 - 15.05.2026']);
    expect(back!.rows[9]).toEqual(['ООО "Ромашка"', '', '', '', '', '', 25, 32000]);
    expect(back!.levels.slice(9, 13)).toEqual([0, 1, 1, 1]);
  });

  it('старый .xls и не Excel — понятная ошибка', async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(() => readXlsx(xls)).toThrow(/старом формате/);
    const r = await upload('director', '/reports', xls, 'отчёт.xls');
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('.xls');
    const bad = await upload('director', '/reports', Buffer.from('просто текст'), 'отчёт.pdf');
    expect(bad.status).toBe(422);
  });
});

describe('продажи: файл KPI и отчёты 1С', () => {
  let stout = '';
  let bochk = '';
  let contracts = '';

  it('без входа — 401; функции продаж у руководителей по должности', async () => {
    expect((await request(ctx.app).get(`${API}/month`)).status).toBe(401);
    const me = (await (await call('sales')).get('/api/v1/functions/me')).body.data;
    const on = Object.fromEntries(me.functions.map((f: { key: string; enabled: boolean }) => [f.key, f.enabled]));
    expect(on).toMatchObject({ sales_reports: true, sales_files: true, sales_assign: true });
  });

  it('файл KPI: предпросмотр подсказывает сотрудника и месяц, загрузка — за месяц из файла', async () => {
    const preview = await upload('sales', '/kpi-files', kpiFile({ name: 'Анна' }), 'kpi.xlsx', { dry_run: '1' });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const p = preview.body.data as KpiFilePreview;
    expect(p.sheets[0]).toMatchObject({ employee: 'Анна', month: '2026-05', suggested_user: { id: s.mgr1, name: 'Анна Смирнова' }, has_results: true });
    expect(p.sheets[0]!.metrics.find((m) => /есть по/i.test(m.name))!.rule).toContain('3,5 % от продаж');
    expect(p.people.map((x) => x.id).sort()).toEqual([s.mgr1, s.mgr2].sort());

    // Показатель, поставленный вручную в том же месяце, при загрузке файла не пропадает.
    const manual = await (await call('sales')).post(`${API}/plans`, { user_id: s.mgr1, month: '2026-05', name: 'Договоры', unit: 'count', plan: 3 });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    contracts = manual.body.data.id;

    const r = await upload('sales', '/kpi-files', kpiFile({ name: 'Анна', yesNo: true }), 'kpi.xlsx', { user_id: s.mgr1 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.results).toEqual([{ sheet: 'KPI', employee: 'Анна', month: '2026-05', user: expect.objectContaining({ id: s.mgr1 }), created: 8, replaced: 0, error: null }]);
    const m = await month('sales', s.mgr1);
    expect(m.plans).toHaveLength(9);
    expect(m.plans.some((x) => /гсм/i.test(x.name))).toBe(false);
    // Показатели из файла — первыми, поставленный вручную — после.
    expect(m.plans.at(-1)!.id).toBe(contracts);
    // Факт, процент и «к выплате» — из файла KPI.
    expect(m.by.baltika).toMatchObject({ source: 'file', plan: 100000, fact: 95000, unit: 'rub' });
    expect(m.by.baltika!.calc).toMatchObject({ source: 'file', percent: 95, now: 12000, condition: 'порог 90%, При выполнении 80-90% кэф 0,5' });
    expect(m.coverage).toBeNull();
    expect(m.stats).toBeNull();
    expect(m.totals).toMatchObject({ fixed: 30000, file: 55950 });
    const distra = m.plans.filter((x) => x.kind === 'distribution');
    expect(distra[0]!.calc).toMatchObject({ percent: 50, now: 2500 });
    expect(distra[0]!.calc.items!.map((i) => i.done)).toEqual([true, false, true, false]);
    // «Да» без галочек — процент выполнения из файла.
    expect(distra[1]).toMatchObject({ name: 'Дистра Хайнекен', unit: 'percent' });
    expect(distra[1]!.calc).toMatchObject({ percent: 80, now: 2400, items: null, hint: 'Позиции: Охота Крепкое, Бочкарев светлое' });
    expect(m.can).toMatchObject({ edit: true, kpi_file: true, team: true, reports: true, fact: false });

    // Без функции — нельзя; руководитель другого отдела — не своему; себе — тоже нельзя.
    expect((await upload('sergey', '/kpi-files', kpiFile({ name: 'Анна' }), 'kpi.xlsx', { user_id: s.mgr1 })).status).toBe(403);
    expect((await upload('olga', '/kpi-files', kpiFile({ name: 'Анна' }), 'kpi.xlsx', { user_id: s.mgr1 })).status).toBe(403);
    expect((await upload('mgr1', '/kpi-files', kpiFile({ name: 'Анна' }), 'kpi.xlsx', { dry_run: '1' })).status).toBe(403);
    expect((await upload('sales', '/kpi-files', kpiFile({ name: 'Анна' }), 'kpi.xlsx', { user_id: s.sales })).status).toBe(403);
  });

  it('сотрудник видит свой месяц, сам план не ставит, а факт «вручную» отмечает', async () => {
    const own = await month('mgr1', s.mgr1);
    expect(own.can).toMatchObject({ edit: false, kpi_file: false, fact: true, add_entry: true, team: false, reports: false });
    expect(own.months).toEqual(['2026-10', '2026-05']);
    expect(own.reports).toEqual([]);

    const body = { month: '2026-05', name: 'Свой план', unit: 'count', plan: 10 };
    expect((await (await call('mgr1')).post(`${API}/plans`, { ...body, user_id: s.mgr1 })).status).toBe(403);
    expect((await (await call('sales')).post(`${API}/plans`, { ...body, user_id: s.sales })).status).toBe(403);
    // Директор себе может.
    expect((await (await call('director')).post(`${API}/plans`, { ...body, user_id: ctx.demo.users.director })).status).toBe(201);

    // Показатель из файла сотрудник не меняет и не удаляет.
    const agent = await call('mgr1');
    expect((await agent.patch(`${API}/plans/${own.by.baltika!.id}`, { fact: 100000 })).status).toBe(403);
    expect((await agent.patch(`${API}/plans/${own.by.baltika!.id}`, { plan: 1 })).status).toBe(403);
    expect((await agent.delete(`${API}/plans/${own.by.baltika!.id}`)).status).toBe(403);
    // Показатель «вручную» отмечает сам; но не план.
    expect((await agent.patch(`${API}/plans/${contracts}`, { plan: 1 })).status).toBe(403);
    const done = await agent.patch(`${API}/plans/${contracts}`, { fact: 1 });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ fact: 1, calc: { source: 'manual', percent: 33.3 } });
    // Чужой месяц коллеге не виден, наблюдателю тоже.
    expect((await (await call('mgr2')).get(`${API}/month?user=${s.mgr1}&month=2026-05`)).status).toBe(404);
    expect((await (await call('observer')).get(`${API}/month?user=${s.mgr1}&month=2026-05`)).status).toBe(404);
    expect((await (await call('observer')).get(`${API}/team`)).status).toBe(403);
  });

  it('отчёт 1С заполняет плитки и показатели по отчётам, KPI из файла не меняет', async () => {
    const agent = await call('sales');
    // Показатели по отчёту: штуки товара и точки, купившие товар.
    const a = await agent.post(`${API}/plans`, {
      user_id: s.mgr1,
      month: '2026-05',
      name: 'Балтика Stout',
      unit: 'count',
      plan: 4,
      bonus: 2000,
      fact_rule: { type: 'products', query: 'Балтика Stout', measure: 'quantity' },
      payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }], over: 'cap' },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    stout = a.body.data.id;
    const b = await agent.post(`${API}/plans`, {
      user_id: s.mgr1,
      month: '2026-05',
      name: 'Точки Бочкарев',
      unit: 'clients',
      plan: 3,
      fact_rule: { type: 'products', query: 'Бочкарев', measure: 'clients' },
    });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    bochk = b.body.data.id;
    // Факт показателя по отчётам вручную не ставится.
    expect((await agent.patch(`${API}/plans/${stout}`, { fact: 3 })).status).toBe(422);

    const r = await upload('sales', '/reports', reportFile('01.05.2026 - 15.05.2026', mayClients()), 'Отчёт 1-15.xlsx');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const imp = r.body.data as SalesReportImport;
    const res = Object.fromEntries(imp.people.map((x) => [x.manager, x]));
    expect(res['Смирнова Анна']).toMatchObject({ status: 'ok', user: { id: s.mgr1 }, total: 72000, key: 0, non_key: 72000, plans_updated: 2 });
    expect(res['Иванов Пётр']).toMatchObject({ status: 'ok', user: { id: s.mgr2 }, total: 4000 });
    expect(res['Неизвестный Менеджер']).toMatchObject({ status: 'unmatched', user: null });
    expect(imp.key_list_empty).toBe(true);
    expect(imp.report).toMatchObject({ period_start: '2026-05-01', period_end: '2026-05-15', month: '2026-05', total: 79000, people: 3, unmatched: 1, can_delete: true });

    const m = await month('sales', s.mgr1);
    // Плитки: выручка, клиенты, в среднем за рабочий день (пн–сб: с 1 по 15 мая — 13 дней), штуки.
    expect(m.stats).toMatchObject({ revenue: 72000, clients: 6, per_day: 5538.46, quantity: 108, as_of: '2026-05-15', elapsed: 15, days: 31, work_elapsed: 13, work_days: 26, reports: 1 });
    expect(m.coverage).toMatchObject({ as_of: '2026-05-15', reports: 1 });
    // KPI из файла отчёт не трогает.
    expect(m.by.no_ep!.fact).toBe(150000);
    expect(m.by.baltika!.fact).toBe(95000);
    expect(m.by.akb!.fact).toBe(5);
    // Показатели по отчёту.
    const st = m.plans.find((x) => x.id === stout)!;
    expect(st).toMatchObject({ fact: 2 });
    expect(st.calc).toMatchObject({ source: 'report', tracked: true, percent: 50, as_of: '2026-05-15', now: 0 });
    expect(m.plans.find((x) => x.id === bochk)!.fact).toBe(2);
    // Показатель без отчёта — как отметил сотрудник.
    expect(m.plans.find((x) => x.id === contracts)!.fact).toBe(1);
    // Выплаты — из файла, ГСМ не считается.
    expect(m.totals).toMatchObject({ fixed: 30000, now: 55950 });
    expect(m.reports.map((x) => x.file_name)).toEqual(['Отчёт 1-15.xlsx']);
  });

  it('команда руководителя: продажи, выплаты и выполнение', async () => {
    const t = (await (await call('sales')).get(`${API}/team?month=2026-05`)).body.data as SalesTeam;
    expect(t.can).toEqual({ upload: true, kpi_files: true, assign: true });
    expect(t.members.map((x) => x.user.name)).toEqual(['Анна Смирнова', 'Пётр Иванов']);
    expect(t.members[0]).toMatchObject({ plans: 11, totals: { fixed: 30000, now: 55950 }, stats: { revenue: 72000 } });
    expect(t.totals.revenue).toBe(76000);
    // Ольга видит свой отдел — продавцов в нём нет.
    expect(((await (await call('olga')).get(`${API}/team?month=2026-05`)).body.data as SalesTeam).members).toEqual([]);
    // Директор видит всех, у кого есть продажи.
    const all = ((await (await call('director')).get(`${API}/team?month=2026-05`)).body.data as SalesTeam).members.map((x) => x.user.name);
    expect(all).toEqual(['Анна Смирнова', 'Пётр Иванов']);
  });

  it('список ключевых клиентов убирает их из клиентов в плитках', async () => {
    expect((await (await call('mgr1')).post(`${API}/lists`, { kind: 'key', text: 'ИП Соколова Д.И.' })).status).toBe(403);
    const add = await (await call('sales')).post(`${API}/lists`, { kind: 'key', text: 'ИП Соколова Д.И.\n ип  соколова д.и. ' });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body.data).toMatchObject({ added: 1, skipped: 1 });
    expect(add.body.data.lists.key.map((x: { pattern: string }) => x.pattern)).toEqual(['ИП Соколова Д.И.']);
    const m = await month('sales', s.mgr1);
    expect(m.stats).toMatchObject({ revenue: 72000, clients: 4 });
    expect(m.lists).toEqual({ key: 1, merge: 0 });
    // KPI из файла — как в файле.
    expect(m.by.ep!.fact).toBe(30000);
    expect(m.by.ep!.calc.now).toBe(1050);

    const clients = (await (await call('sales')).get(`${API}/clients?month=2026-05`)).body.data;
    expect(clients.find((x: { name: string }) => x.name === 'ИП Соколова Д.И. Ленина 1')).toMatchObject({ key: 'ИП Соколова Д.И.', key_hint: true });
    expect(clients.find((x: { name: string }) => x.name === 'ООО "Ромашка"')).toMatchObject({ key: null, key_hint: false, revenue: 32000 });
    const search = (await (await call('sales')).get(`${API}/clients?month=2026-05&q=егоров`)).body.data;
    expect(search.map((x: { name: string }) => x.name).sort()).toEqual(['ИП Егорова А.А. магазин', 'ИП Егорова А.А. склад']);
    const groups = (await (await call('sales')).get(`${API}/groups?month=2026-05`)).body.data;
    expect(groups.map((g: { path: string }) => g.path)).toContain('ПИВО › Пиво разливное › Россия › Драфт Балтика');
    expect((await (await call('mgr1')).get(`${API}/clients?month=2026-05`)).status).toBe(403);
  });

  it('нарастающий отчёт заменяет прежний, частичное пересечение отклоняется', async () => {
    const next = await upload('sales', '/reports', reportFile('01.05.2026 - 16.05.2026', mayClients(1.1)), 'Отчёт 1-16.xlsx');
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    expect(next.body.data.replaced).toBe(1);
    const m = await month('sales', s.mgr1);
    expect(m.stats).toMatchObject({ revenue: 79200, per_day: 5657.14, as_of: '2026-05-16', work_elapsed: 14, reports: 1 });

    const day = await upload('sales', '/reports', reportFile('10.05.2026 - 10.05.2026', mayClients()), 'день.xlsx');
    expect(day.status).toBe(409);
    expect(day.body.error.message).toContain('10.05');
    expect(day.body.error.message).toContain('01.05–16.05');
  });

  it('отчёты за отдельные дни складываются; файл на начало месяца — без итогов', async () => {
    const kpi = await upload('sales', '/kpi-files', kpiFile({ name: 'Анна', month: '01.06.2026', facts: false }), 'kpi-june.xlsx', { user_id: s.mgr1 });
    expect(kpi.status, JSON.stringify(kpi.body)).toBe(201);
    for (const d of ['01', '02']) {
      const r = await upload('sales', '/reports', reportFile(`${d}.06.2026 - ${d}.06.2026`, mayClients(0.5)), `${d}.xlsx`);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data.replaced).toBe(0);
    }
    const m = await month('sales', s.mgr1, '2026-06');
    expect(m.stats).toMatchObject({ revenue: 72000, per_day: 36000, quantity: 216, elapsed: 2, work_elapsed: 2, reports: 2 });
    expect(m.coverage).toMatchObject({ as_of: '2026-06-02', elapsed: 2, reports: 2 });
    expect(m.totals.file).toBeNull();
    expect(m.by.no_ep!.fact).toBe(0);
  });

  it('менеджер из 1С, которого не нашли, сопоставляется вручную', async () => {
    const before = (await (await call('sales')).get(`${API}/unmatched`)).body.data;
    expect(before.map((x: { name: string }) => x.name)).toContain('Неизвестный Менеджер');
    // Только на своего сотрудника.
    expect((await (await call('sales')).post(`${API}/aliases`, { name: 'Неизвестный Менеджер', user_id: ctx.demo.users.anna })).status).toBe(403);
    const r = await (await call('sales')).post(`${API}/aliases`, { name: 'Неизвестный Менеджер', user_id: s.mgr2 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ months: 2 });
    const after = (await (await call('sales')).get(`${API}/unmatched`)).body.data;
    expect(after.map((x: { name: string }) => x.name)).not.toContain('Неизвестный Менеджер');
    const aliases = (await (await call('sales')).get(`${API}/aliases`)).body.data;
    expect(aliases).toEqual([expect.objectContaining({ name: 'Неизвестный Менеджер', user: expect.objectContaining({ id: s.mgr2 }) })]);
    // Следующие отчёты находят его сами.
    const next = await upload('sales', '/reports', reportFile('01.06.2026 - 03.06.2026', mayClients()), '1-3.xlsx');
    expect(next.body.data.people.find((x: { manager: string }) => x.manager === 'Неизвестный Менеджер')).toMatchObject({ status: 'ok', user: { id: s.mgr2 } });
    expect(next.body.data.replaced).toBe(2);
  });

  it('права: руководитель другого отдела загружает отчёт, но чужих сотрудников пропускает', async () => {
    expect((await upload('mgr1', '/reports', reportFile('01.07.2026 - 01.07.2026', mayClients()), 'x.xlsx')).status).toBe(403);
    const r = await upload('olga', '/reports', reportFile('01.07.2026 - 01.07.2026', mayClients()), 'x.xlsx');
    expect(r.status).toBe(201);
    expect(r.body.data.people.find((x: { manager: string }) => x.manager === 'Смирнова Анна')).toMatchObject({ status: 'forbidden', plans_updated: 0 });
    // Менеджер, которого сопоставили, — тоже чужой: сохранять нечего, пустой отчёт в историю не попадает.
    expect(r.body.data.report).toBeNull();
    expect((await (await call('mgr1')).get(`${API}/reports`)).status).toBe(403);
  });

  it('функции включаются: директор — загрузку отчётов Сергею на всю компанию, руководитель — файлы KPI менеджеру', async () => {
    const put = await request(ctx.app)
      .put(`/api/v1/functions/users/${ctx.demo.users.sergey}`)
      .set('Authorization', `Bearer ${await ctx.token('director')}`)
      .send({ changes: { sales_reports: true } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const rep = await upload('sergey', '/reports', reportFile('01.08.2026 - 01.08.2026', mayClients()), 'aug.xlsx');
    expect(rep.status, JSON.stringify(rep.body)).toBe(201);
    expect(rep.body.data.people.find((x: { manager: string }) => x.manager === 'Смирнова Анна')).toMatchObject({ status: 'ok' });

    // Виктор включает Петру файлы KPI — для своего отдела, но не себе.
    const grant = await request(ctx.app)
      .put(`/api/v1/functions/users/${s.mgr2}`)
      .set('Authorization', `Bearer ${tokens.get(s.sales)}`)
      .send({ changes: { sales_files: true } });
    expect(grant.status, JSON.stringify(grant.body)).toBe(200);
    expect((await upload('mgr2', '/kpi-files', kpiFile({ name: 'Анна', month: '01.07.2026' }), 'k.xlsx', { user_id: s.mgr1 })).status).toBe(201);
    expect((await upload('mgr2', '/kpi-files', kpiFile({ name: 'Анна', month: '01.07.2026' }), 'k.xlsx', { user_id: s.mgr2 })).status).toBe(403);
    expect((await upload('mgr2', '/kpi-files', kpiFile({ name: 'Анна', month: '01.07.2026' }), 'k.xlsx', { user_id: ctx.demo.users.anna })).status).toBe(403);
    const people = (await (await call('mgr2')).get(`${API}/people?for=sales_files`)).body.data.map((u: { id: string }) => u.id);
    expect(people).toContain(s.mgr1);
    expect(people).not.toContain(s.mgr2);
    expect((await (await call('anna')).get(`${API}/people?for=sales_files`)).body.data).toEqual([]);
    expect((await (await call('anna')).get(`${API}/people?for=nope`)).status).toBe(422);

    // Отключить руководителю его функцию «по должности».
    await request(ctx.app)
      .put(`/api/v1/functions/users/${s.sales}`)
      .set('Authorization', `Bearer ${await ctx.token('director')}`)
      .send({ changes: { sales_assign: false } });
    expect((await (await call('sales')).post(`${API}/plans`, { user_id: s.mgr1, month: '2026-05', name: 'X', unit: 'count', plan: 1 })).status).toBe(403);
    await request(ctx.app)
      .put(`/api/v1/functions/users/${s.sales}`)
      .set('Authorization', `Bearer ${await ctx.token('director')}`)
      .send({ changes: { sales_assign: null } });
  });

  it('правило выплаты можно поправить; повторная загрузка файла его сохраняет', async () => {
    const m = await month('sales', s.mgr1);
    const id = m.by.no_ep!.id;
    const agent = await call('sales');
    expect((await agent.patch(`${API}/plans/${id}`, { payout_rule: { type: 'threshold', steps: [] } })).status).toBe(422);
    // У показателя из файла меняется только правило выплаты.
    expect((await agent.patch(`${API}/plans/${id}`, { plan: 1 })).status).toBe(422);
    expect((await (await call('mgr1')).patch(`${API}/plans/${id}`, { payout_rule: { type: 'none' } })).status).toBe(403);
    const rule = { type: 'threshold', steps: [{ from: 90, k: 1 }, { from: 70, k: 0.7 }], over: 'cap' };
    const r = await agent.patch(`${API}/plans/${id}`, { payout_rule: rule });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.calc.rule.replace(/ /g, ' ')).toBe('от 90 % — 30 000 ₽, 70–90 % — 21 000 ₽ (× 0,7)');
    expect(r.body.data.rules_custom).toBe(true);

    await upload('sales', '/kpi-files', kpiFile({ name: 'Анна' }), 'kpi.xlsx', { user_id: s.mgr1, month: '2026-05' });
    const again = await month('sales', s.mgr1);
    expect(again.by.no_ep!.payout_rule).toEqual(rule);
    expect(again.by.no_ep!.rules_custom).toBe(true);
    expect(again.by.no_ep!.fact).toBe(150000);
    expect(again.plans.filter((x) => x.name === 'Договоры')).toHaveLength(1);
    // Штуки в нарастающем отчёте те же — выросла только выручка.
    expect(again.plans.find((x) => x.id === stout)!.fact).toBe(2);
  });

  it('удалённый отчёт: плитки и показатели по отчёту обнуляются, KPI из файла остаётся', async () => {
    const list = (await (await call('sales')).get(`${API}/reports?month=2026-05`)).body.data;
    expect(list).toHaveLength(1);
    for (const rep of list) expect((await (await call('sales')).delete(`${API}/reports/${rep.id}`)).status).toBe(204);
    const m = await month('sales', s.mgr1);
    expect(m.coverage).toBeNull();
    expect(m.stats).toBeNull();
    expect(m.plans.find((x) => x.id === stout)!.fact).toBe(0);
    expect(m.by.no_ep!.fact).toBe(150000);
    expect(m.by.baltika!.fact).toBe(95000);
    // Отчёт, где есть чужие сотрудники, руководитель другого отдела не удалит.
    const aug = (await (await call('sergey')).get(`${API}/reports?month=2026-08`)).body.data;
    expect(aug).toHaveLength(1);
    expect((await (await call('olga')).delete(`${API}/reports/${aug[0].id}`)).status).toBe(404);
  });
});

describe('продажи: записи вручную и из Excel', () => {
  let plan = '';

  it('сотрудник записывает продажу, и она прибавляется к факту показателя «вручную»', async () => {
    const p = await (await call('sales')).post(`${API}/plans`, {
      user_id: s.mgr2,
      month: '2026-10',
      name: 'Продажи курсов',
      unit: 'rub',
      plan: 100000,
      bonus: 10000,
      payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }], over: 'proportional' },
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    plan = p.body.data.id;
    const agent = await call('mgr2');
    const e = await agent.post(`${API}/entries`, { plan_id: plan, product: 'Курс «Python»', client: 'ООО «Альфа»', quantity: 2, amount: 45000, sold_on: '2026-10-15' });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    expect(e.body.data).toMatchObject({ product: 'Курс «Python»', amount: 45000, quantity: 2, sold_on: '2026-10-15', plan_id: plan, can_delete: true });
    // Ошибки ввода — 422 с полями; будущая дата, чужой месяц показателя.
    const bad = await agent.post(`${API}/entries`, { product: '', amount: -1, sold_on: '2026-12-01' });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['amount', 'product', 'sold_on']);
    expect((await agent.post(`${API}/entries`, { plan_id: plan, product: 'X', amount: 1, sold_on: '2026-09-30' })).status).toBe(422);

    const m = await month('mgr2', s.mgr2, '2026-10');
    const pl = m.plans.find((x) => x.id === plan)!;
    expect(pl).toMatchObject({ fact: 45000 });
    // Темп по сегодняшнему дню: к 19 октября — 16 рабочих дней из 27.
    expect(pl.calc).toMatchObject({ percent: 45, forecast_value: 75937.5 });
    expect(m.entries).toEqual({ count: 1, amount: 45000, quantity: 2 });

    // Чужому записать может руководитель, коллега — нет.
    expect((await (await call('mgr1')).post(`${API}/entries`, { user_id: s.mgr2, product: 'X', amount: 1 })).status).toBe(403);
    expect((await (await call('sales')).post(`${API}/entries`, { user_id: s.mgr2, product: 'Семинар', amount: 5000 })).status).toBe(201);
    expect((await (await call('observer')).post(`${API}/entries`, { product: 'X', amount: 1 })).status).toBe(403);

    // Удаление записи возвращает факт обратно.
    expect((await (await call('mgr1')).delete(`${API}/entries/${e.body.data.id}`)).status).toBe(404);
    expect((await agent.delete(`${API}/entries/${e.body.data.id}`)).status).toBe(204);
    expect((await month('mgr2', s.mgr2, '2026-10')).plans.find((x) => x.id === plan)!.fact).toBe(0);
  });

  it('продажи из Excel: предложенные колонки, проверка и запись с номерами строк ошибок', async () => {
    const xlsx = writeXlsx([
      {
        name: 'Продажи',
        rows: [
          ['Выгрузка продаж за октябрь'],
          [],
          ['Дата', 'Наименование', 'Покупатель', 'Кол-во', 'Сумма, руб'],
          ['15.10.2026', 'Курс «Excel»', 'ООО «Бета»', 3, 27000],
          [46313, 'Вебинар', '', 1, '1 500,50'],
          ['завтра', 'Курс', '', 1, 100],
          ['16.10.2026', '', '', 1, 100],
        ],
      },
    ]);
    const r = await upload('mgr2', '/entries/import', xlsx, 'продажи.xlsx');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const p = r.body.data as SalesImportPreview;
    expect(p.headers).toEqual(['Дата', 'Наименование', 'Покупатель', 'Кол-во', 'Сумма, руб']);
    expect(p.mapping).toEqual({ product: 1, quantity: 3, amount: 4, sold_on: 0, client: 2, note: null });
    expect(p).toMatchObject({ total_rows: 4, valid: 2, amount: 28500.5 });
    expect(p.errors).toEqual([
      { row: 6, message: 'Не понятна дата «завтра»' },
      { row: 7, message: 'Укажите товар или услугу' },
    ]);
    expect(p.sample[1]).toEqual(['46313', 'Вебинар', '', '1', '1 500,50']);

    const agent = await call('mgr2');
    // Колонки можно поправить и посмотреть итог, ничего не записывая.
    const dry = await agent.post(`${API}/entries/import/${p.id}`, { mapping: { ...p.mapping, client: null }, dry_run: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.data).toMatchObject({ imported: 0, preview: { valid: 2, mapping: { client: null } } });
    expect((await agent.post(`${API}/entries/import/${p.id}`, { mapping: { ...p.mapping, amount: 1 } })).status).toBe(422);
    // Чужую загрузку не видно.
    expect((await (await call('mgr1')).post(`${API}/entries/import/${p.id}`, { mapping: p.mapping })).status).toBe(404);

    const ok = await agent.post(`${API}/entries/import/${p.id}`, { mapping: p.mapping, plan_id: plan });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ imported: 2, skipped: 2 });
    expect((await agent.post(`${API}/entries/import/${p.id}`, { mapping: p.mapping })).status).toBe(409);
    const list = (await agent.get(`${API}/entries?month=2026-10`)).body.data;
    expect(list.map((x: { product: string; sold_on: string }) => [x.product, x.sold_on])).toEqual([
      ['Семинар', '2026-10-19'],
      ['Вебинар', '2026-10-18'],
      ['Курс «Excel»', '2026-10-15'],
    ]);
    expect((await month('mgr2', s.mgr2, '2026-10')).plans.find((x) => x.id === plan)!.fact).toBe(28500.5);

    // CSV в Windows-1251 (выгрузка из 1С) и отмена загрузки.
    const cp1251 = (t: string) => Buffer.from([...t].map((ch) => (ch >= 'А' && ch <= 'я' ? 0xc0 + ch.charCodeAt(0) - 0x410 : ch.charCodeAt(0))));
    const c = await upload('mgr2', '/entries/import', cp1251('Товар;Сумма\nКурс;100\n'), 'sales.csv');
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.data).toMatchObject({ headers: ['Товар', 'Сумма'], valid: 1, mapping: { product: 0, amount: 1 } });
    expect((await agent.delete(`${API}/entries/import/${c.body.data.id}`)).status).toBe(204);
    expect((await agent.post(`${API}/entries/import/${c.body.data.id}`, { mapping: c.body.data.mapping })).status).toBe(409);
    const empty = await upload('mgr2', '/entries/import', Buffer.from('просто строка'), 'x.csv');
    expect(empty.status).toBe(422);
  });

  it('страница сотрудника: месяц, задачи, что продаёт и записи', async () => {
    const r = await (await call('sales')).get(`${API}/people/${s.mgr2}?month=2026-10`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data as SalesEmployee;
    expect(d.month.user).toMatchObject({ id: s.mgr2, name: 'Пётр Иванов', position: 'Менеджер по продажам' });
    expect(d.tasks).toEqual({ open: 0, overdue: 0, blocked: 0, done_30d: 0 });
    expect(d.top_products[0]).toEqual({ name: 'Курс «Excel»', quantity: 3, revenue: 27000 });
    expect(d.entries).toHaveLength(3);
    expect((await (await call('mgr1')).get(`${API}/people/${s.mgr2}`)).status).toBe(404);
    expect((await (await call('anna')).get(`${API}/people/${ctx.demo.users.anna}`)).status).toBe(200);
  });
});

describe('продажи: KPI целей и образцы файлов', () => {
  it('KPI цели «выручка отдела» заполняется по отчётам за завершённый месяц и обновляется, а не задваивается', async () => {
    const dir = await call('director');
    const g = await dir.post('/api/v1/goals', {
      title: 'Выручка отдела продаж',
      description: 'Ежемесячная выручка по отчётам 1С',
      type: 'operational',
      owner_id: s.sales,
      due_at: '2026-12-31',
      status: 'draft',
      units: [{ unit_id: s.unit, role: 'owner' }],
      metrics: [
        { name: 'Выручка за месяц', unit: 'rub', baseline: 0, target: 100000, direction: 'increase' },
        { name: 'Клиенты', unit: 'count', baseline: 0, target: 10, direction: 'increase' },
      ],
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const [revenue, clients] = g.body.data.metrics as { id: string }[];
    // Выручка — только в рублях; штуки и клиенты — в штуках.
    expect((await dir.post(`${API}/goal-links`, { metric_id: clients!.id, measure: 'revenue', unit_id: s.unit })).status).toBe(422);
    // Сотрудник без права вносить факт KPI не связывает.
    expect((await (await call('mgr1')).post(`${API}/goal-links`, { metric_id: revenue!.id, measure: 'revenue', unit_id: s.unit })).status).toBe(403);
    const targets = (await (await call('sales')).get(`${API}/goal-links/targets`)).body.data;
    expect(targets.metrics.map((m: { metric_id: string }) => m.metric_id)).toEqual(expect.arrayContaining([revenue!.id, clients!.id]));

    // Отчёт за май: Анна и Пётр (Пётр — ещё и за «Неизвестного Менеджера»).
    expect((await upload('sales', '/reports', reportFile('01.05.2026 - 31.05.2026', mayClients()), 'май.xlsx')).status).toBe(201);
    const link = await (await call('sales')).post(`${API}/goal-links`, { metric_id: revenue!.id, measure: 'revenue', unit_id: s.unit });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.body.data.goals_updated).toBeGreaterThanOrEqual(1);
    const obsOf = async (metric: string) =>
      (
        await ctx.db.query<{ value: number; observed_at: string; source: string }>(
          `SELECT value, observed_at, source FROM goal_metric_observations WHERE metric_id = $1 ORDER BY observed_at`,
          [metric],
        )
      ).rows;
    const may = (await obsOf(revenue!.id)).find((o) => o.observed_at.startsWith('2026-05-31'));
    expect(may).toMatchObject({ value: 79000, source: 'integration' });

    const cl = await (await call('sales')).post(`${API}/goal-links`, { metric_id: clients!.id, measure: 'clients', unit_id: null });
    expect(cl.status).toBe(403);
    const cd = await dir.post(`${API}/goal-links`, { metric_id: clients!.id, measure: 'clients', unit_id: null });
    expect(cd.status, JSON.stringify(cd.body)).toBe(201);
    expect((await obsOf(clients!.id)).find((o) => o.observed_at.startsWith('2026-05-31'))).toMatchObject({ value: 6 });

    // Новый отчёт за тот же месяц обновляет замер на месте.
    expect((await upload('sales', '/reports', reportFile('01.05.2026 - 31.05.2026', mayClients(2)), 'май-2.xlsx')).status).toBe(201);
    const mayObs = (await obsOf(revenue!.id)).filter((o) => o.observed_at.startsWith('2026-05-31'));
    expect(mayObs).toEqual([expect.objectContaining({ value: 158000 })]);
    const links = (await (await call('sales')).get(`${API}/goal-links`)).body.data;
    expect(links.find((l: { metric_id: string }) => l.metric_id === revenue!.id)).toMatchObject({ measure: 'revenue', unit_name: 'Отдел продаж', last_month: '2026-08', can_edit: true });

    // Отчёт удалён — замер тоже.
    const rep = (await (await call('sales')).get(`${API}/reports?month=2026-05`)).body.data[0];
    expect((await (await call('sales')).delete(`${API}/reports/${rep.id}`)).status).toBe(204);
    expect((await obsOf(revenue!.id)).filter((o) => o.observed_at.startsWith('2026-05-31'))).toEqual([]);
    expect((await (await call('sales')).delete(`${API}/goal-links/${revenue!.id}`)).status).toBe(204);
    expect((await (await call('sales')).get(`${API}/goal-links`)).body.data.map((l: { metric_id: string }) => l.metric_id)).not.toContain(revenue!.id);
  });

  it('образцы файлов скачиваются и читаются теми же разборщиками', async () => {
    const get = async (kind: string) => request(ctx.app).get(`${API}/templates/${kind}`).set('Authorization', `Bearer ${await ctx.token('anna')}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const rep = await get('report');
    expect(rep.status).toBe(200);
    expect(rep.headers['content-type']).toContain('spreadsheetml');
    const [sheet] = readXlsx(rep.body as Buffer);
    expect(sheet!.rows[4]![2]).toBe('Период: 01.10.2026 - 19.10.2026');
    const kpi = await get('kpi');
    expect(readXlsx(kpi.body as Buffer)[0]!.rows[0]![0]).toBe('Иванов Иван');
    expect((await get('entries')).status).toBe(200);
    expect((await get('nope')).status).toBe(404);
  });
});
