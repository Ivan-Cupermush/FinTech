import {
  buildKpiSheet,
  buildSalesReportSheet,
  monthLastDay,
  parseKpiSheet,
  parseSalesReport,
  payoutFor,
  thresholdsFromName,
  workDays,
  type SampleClient,
  type SampleKpiMetric,
} from '@offix/core';
import { hashPassword, type AuthedActor } from '../auth/auth';
import type { Db } from '../db/db';
import { importSalesReport, monthDate, recalcPairs, salesAccess, saveKpiFile, shiftMonth, syncGoalLinks, todayMsk } from '../services/sales';
import { readXlsx, writeXlsx } from '../services/xlsx';
import { DEMO_PASSWORD, type DemoIds } from './demo';

/**
 * Продажи в демо: центр дополнительного образования продаёт курсы. Наталья
 * Белова руководит центром, Павел и Ксения — менеджеры программ. За прошлые
 * месяцы — отчёты 1С и итоговые файлы KPI, за текущий — нарастающий отчёт
 * по вчерашний день и план с правилами выплат. KPI цели «Выручка центра»
 * заполняется продажами за завершённые месяцы.
 */
export interface DemoSales {
  unit: string;
  natalia: string;
  pavel: string;
  ksenia: string;
  goal: string;
}

interface Course {
  path: string[];
  name: string;
  price: number;
  article: string;
}

const COURSES: Course[] = [
  { path: ['КУРСЫ', 'Программирование'], name: 'Курс «Python для аналитиков»', price: 45000, article: 'ДПО-101' },
  { path: ['КУРСЫ', 'Программирование'], name: 'Курс «SQL с нуля»', price: 32000, article: 'ДПО-102' },
  { path: ['КУРСЫ', 'Программирование'], name: 'Курс «Веб-разработка на React»', price: 58000, article: 'ДПО-103' },
  { path: ['КУРСЫ', 'Управление'], name: 'Курс «Проектное управление»', price: 38000, article: 'ДПО-201' },
  { path: ['КУРСЫ', 'Управление'], name: 'Курс «Финансы для руководителей»', price: 42000, article: 'ДПО-202' },
  { path: ['СЕМИНАРЫ'], name: 'Семинар «Охрана труда»', price: 12000, article: 'ДПО-301' },
  { path: ['СЕМИНАРЫ'], name: 'Семинар «Кадровый учёт»', price: 9500, article: 'ДПО-302' },
];

const CLIENTS = [
  'ООО «Альфа-Софт»',
  'АО «Северсталь-Инфо»',
  'ГК «Меридиан» (Москва)',
  'ГК «Меридиан» (Казань)',
  'ИП Орлова Т.В. (офис)',
  'ИП Орлова Т.В. (филиал)',
  'ООО «Вектор»',
  'Колледж связи №7',
  'ООО «Техносервис»',
  'АНО «Цифровые кадры»',
];

/** Детерминированный генератор: демо одинаковое при каждом запуске. */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

interface SaleEvent {
  day: number;
  manager: string;
  client: string;
  course: Course;
  qty: number;
}

/** Продажи менеджера за месяц по рабочим дням: в среднем `rate` продаж в день. */
function monthEvents(month: string, manager: string, seed: number, rate: number, clients: string[]): SaleEvent[] {
  const r = rng(seed);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const days = Number(monthLastDay(month).slice(8, 10));
  const out: SaleEvent[] = [];
  for (let d = 1; d <= days; d++) {
    if (workDays(y, m, d) === workDays(y, m, d - 1)) continue;
    let n = Math.floor(rate + r());
    while (n-- > 0) {
      const course = COURSES[Math.floor(r() * COURSES.length)]!;
      out.push({ day: d, manager, client: clients[Math.floor(r() * clients.length)]!, course, qty: course.price > 30000 ? (r() < 0.8 ? 1 : 2) : 1 + Math.floor(r() * 3) });
    }
  }
  return out;
}

/** События по день `to` включительно → клиенты отчёта 1С с менеджерами и товарами. */
function reportClients(events: readonly SaleEvent[], to: number): SampleClient[] {
  const out = new Map<string, Map<string, Map<string, { course: Course; qty: number }>>>();
  for (const e of events) {
    if (e.day > to) continue;
    const c = out.get(e.client) ?? new Map();
    out.set(e.client, c);
    const m = c.get(e.manager) ?? new Map();
    c.set(e.manager, m);
    const s = m.get(e.course.name) ?? { course: e.course, qty: 0 };
    s.qty += e.qty;
    m.set(e.course.name, s);
  }
  return [...out].map(([client, managers]) => ({
    client,
    managers: [...managers].map(([name, sales]) => ({
      name,
      sales: [...sales.values()].map((s) => ({ path: s.course.path, name: s.course.name, qty: s.qty, rev: s.qty * s.course.price, article: s.course.article })),
    })),
  }));
}

const revenueOf = (events: readonly SaleEvent[], manager: string) => events.filter((e) => e.manager === manager).reduce((s, e) => s + e.qty * e.course.price, 0);
const clientsOf = (events: readonly SaleEvent[], manager: string) => new Set(events.filter((e) => e.manager === manager).map((e) => e.client.replace(/\s*\(.*\)$/, ''))).size;

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export async function seedDemoSales(db: Db, demo: DemoIds, now = new Date()): Promise<DemoSales> {
  const today = todayMsk(now);
  const current = today.slice(0, 7);
  const prev = shiftMonth(current, -1);
  const prev2 = shiftMonth(current, -2);
  const hash = await hashPassword(DEMO_PASSWORD);
  const companyId = demo.companyId;

  return db.tx(async (q) => {
    const one = async <T = { id: string }>(sql: string, params: unknown[]) => (await q.query<T>(sql, params)).rows[0]!;
    const { id: unit } = await one(`INSERT INTO org_units (company_id, name, unit_type, color) VALUES ($1, 'Центр ДПО', 'department', '#EE46BC') RETURNING id`, [companyId]);
    const person = async (name: string, email: string, position: string, manager: boolean) => {
      const { id } = await one(`INSERT INTO users (email, password_hash, display_name, position) VALUES ($1, $2, $3, $4) RETURNING id`, [email, hash, name, position]);
      await q.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)`, [companyId, id, manager ? 'manager' : 'member']);
      await q.query(`INSERT INTO org_memberships (company_id, user_id, unit_id, is_manager, is_primary, started_at) VALUES ($1, $2, $3, $4, TRUE, $5)`, [
        companyId,
        id,
        unit,
        manager,
        `${prev2}-01`,
      ]);
      return id;
    };
    const natalia = await person('Наталья Белова', 'natalia@offix.demo', 'Руководитель центра ДПО', true);
    const pavel = await person('Павел Соколов', 'pavel@offix.demo', 'Менеджер программ ДПО', false);
    const ksenia = await person('Ксения Морозова', 'ksenia@offix.demo', 'Менеджер программ ДПО', false);

    const actor: AuthedActor = { id: natalia, company_id: companyId, role: 'manager', display_name: 'Наталья Белова' };
    const acc = await salesAccess(q, actor);
    const at = (iso: string) => new Date(`${iso}T15:00:00Z`);

    // Ключевой клиент — сеть «Меридиан» (своя скидка и свой бонус), «ИП Орлова» с филиалом — одна точка.
    await q.query(
      `INSERT INTO sales_client_lists (company_id, kind, pattern, pattern_key, created_by) VALUES ($1, 'key', 'ГК «Меридиан»', 'гк меридиан', $2), ($1, 'merge', 'ИП Орлова Т.В.', 'ип орлова т в', $2)`,
      [companyId, natalia],
    );

    // Менеджеры в 1С записаны «Фамилия Имя»; Олег Гусев уволился — его продажи ждут сопоставления.
    const events = (month: string, k: number) => [
      ...monthEvents(month, 'Соколов Павел', 11 + k, 0.6, CLIENTS),
      // Ксения ведёт сеть «Меридиан»: её точки у неё чаще.
      ...monthEvents(month, 'Морозова Ксения', 23 + k, 0.5, [...CLIENTS, 'ГК «Меридиан» (Москва)', 'ГК «Меридиан» (Казань)', 'ГК «Меридиан» (Москва)']),
      ...monthEvents(month, 'Гусев Олег', 37 + k, 0.1, CLIENTS.slice(6)),
    ];
    const upload = async (month: string, list: SaleEvent[], to: number, name: string) => {
      if (to < 1) return;
      const sheet = buildSalesReportSheet(`01.${month.slice(5, 7)}.${month.slice(0, 4)} - ${dmy(`${month}-${String(to).padStart(2, '0')}`)}`, reportClients(list, to));
      const [back] = readXlsx(writeXlsx([sheet]));
      await importSalesReport(q, acc, { name, report: parseSalesReport(back!) }, at(`${month}-${String(to).padStart(2, '0')}`));
    };

    const e2 = events(prev2, 0);
    const e1 = events(prev, 100);
    const e0 = events(current, 200);
    await upload(prev2, e2, Number(monthLastDay(prev2).slice(8, 10)), `Валовая прибыль ${prev2}.xlsx`);
    await upload(prev, e1, Number(monthLastDay(prev).slice(8, 10)), `Валовая прибыль ${prev}.xlsx`);
    // Нарастающий отчёт за текущий месяц: сначала по 10-е, потом по вчерашний день — второй заменяет первый.
    const yesterday = Number(today.slice(8, 10)) - 1;
    if (yesterday > 10) await upload(current, e0, 10, `Валовая прибыль ${current} по 10-е.xlsx`);
    await upload(current, e0, yesterday, `Валовая прибыль ${current}.xlsx`);

    // Итоговые файлы KPI за прошлый месяц: план, факт, бонусы и «к выплате».
    const kpi = async (userId: string, employee: string, manager: string, plan: number, salary: number) => {
      const fact = revenueOf(e1, manager);
      const clients = clientsOf(e1, manager);
      const metric = (name: string, p: number, f: number, bonus: number): SampleKpiMetric => {
        const steps = thresholdsFromName(name);
        const payment = payoutFor({ type: 'threshold', steps: steps.length ? steps : [{ from: 100, k: 1 }], over: 'cap' }, { plan: p, fact: f, bonus });
        return { name, plan: p, fact: f, percent: Math.round((f / p) * 1000) / 1000, bonus, payment };
      };
      const rows = buildKpiSheet({
        employee,
        month: prev,
        fixed: [{ name: 'Оклад', amount: salary }],
        metrics: [metric('План продаж курсов, руб (порог 90%, При выполнении 80-90% кэф 0,5)', plan, fact, 30000), metric('Корпоративные клиенты, ТТ (порог 100%)', 6, clients, 10000)],
        results: true,
      });
      const [sheet] = readXlsx(writeXlsx([{ name: employee, rows }]));
      await saveKpiFile(q, acc, { userId, month: prev, file: parseKpiSheet(sheet!.rows) }, at(`${current}-01`));
    };
    await kpi(pavel, 'Павел Соколов', 'Соколов Павел', 600000, 45000);
    await kpi(ksenia, 'Ксения Морозова', 'Морозова Ксения', 500000, 42000);

    // План на текущий месяц, который поставила Наталья: факт — по отчётам 1С или записями вручную.
    let order = 0;
    const plan = async (userId: string, p: { name: string; unit: string; plan: number; bonus: number; fact?: number; fact_rule: object; payout_rule: object; kind?: string }) => {
      const { id } = await one(
        `INSERT INTO sales_plans (company_id, user_id, month, name, kind, unit, plan, fact, bonus, fact_rule, payout_rule, source, sort_order, fact_updated_at, created_by)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, 'manual', $12, $13, $14) RETURNING id`,
        [companyId, userId, monthDate(current), p.name, p.kind ?? null, p.unit, p.plan, p.fact ?? 0, p.bonus, JSON.stringify(p.fact_rule), JSON.stringify(p.payout_rule), order++, p.fact ? now.toISOString() : null, natalia],
      );
      return id;
    };
    const fixed = { fact_rule: { type: 'manual' }, payout_rule: { type: 'fixed' }, kind: 'fixed' };
    const steps = { type: 'threshold', steps: [{ from: 100, k: 1 }, { from: 90, k: 0.5 }], over: 'proportional' };
    await plan(pavel, { name: 'Оклад', unit: 'rub', plan: 45000, bonus: 45000, ...fixed });
    await plan(pavel, { name: 'Выручка по курсам', unit: 'rub', plan: 650000, bonus: 30000, fact_rule: { type: 'revenue', groups: [], clients: 'all', measure: 'revenue' }, payout_rule: steps });
    await plan(pavel, { name: 'Корпоративные клиенты', unit: 'clients', plan: 6, bonus: 10000, fact_rule: { type: 'clients', groups: [], exclude_key: false, merge: [] }, payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }], over: 'cap' } });
    await plan(pavel, {
      name: 'Курсы программирования, шт',
      unit: 'count',
      plan: 12,
      bonus: 6000,
      fact_rule: { type: 'revenue', groups: ['Программирование'], clients: 'all', measure: 'quantity' },
      payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }], over: 'cap' },
    });
    order = 0;
    await plan(ksenia, { name: 'Оклад', unit: 'rub', plan: 42000, bonus: 42000, ...fixed });
    await plan(ksenia, { name: 'Выручка без ключевых клиентов', unit: 'rub', plan: 420000, bonus: 25000, fact_rule: { type: 'revenue', groups: [], clients: 'non_key', measure: 'revenue' }, payout_rule: steps });
    await plan(ksenia, { name: 'Продажи сети «Меридиан»', unit: 'rub', plan: 150000, bonus: 0, fact_rule: { type: 'revenue', groups: [], clients: 'key', measure: 'revenue' }, payout_rule: { type: 'rate', rate: 0.03, min: 50000 } });
    const webinars = await plan(ksenia, { name: 'Вебинары (записи вручную)', unit: 'rub', plan: 40000, bonus: 4000, fact_rule: { type: 'manual' }, payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }], over: 'cap' } });
    await plan(ksenia, { name: 'Отзывы слушателей', unit: 'count', plan: 15, bonus: 0, fact: 9, fact_rule: { type: 'manual' }, payout_rule: { type: 'none' } });

    // Ксения сама записывает вебинары — их нет в 1С.
    const day = (d: number) => `${current}-${String(Math.min(d, Number(today.slice(8, 10)))).padStart(2, '0')}`;
    const entries: [string, string, number, number, string][] = [
      ['Вебинар «Excel для бухгалтера»', 'ООО «Вектор»', 4, 3500, day(3)],
      ['Вебинар «Охрана труда онлайн»', 'Колледж связи №7', 6, 2500, day(8)],
      ['Вебинар «Excel для бухгалтера»', 'ИП Орлова Т.В.', 2, 3500, day(14)],
    ];
    let webinarFact = 0;
    for (const [product, client, quantity, price, soldOn] of entries) {
      await q.query(`INSERT INTO sales_entries (company_id, user_id, plan_id, product, client, quantity, amount, sold_on, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $2)`, [
        companyId,
        ksenia,
        webinars,
        product,
        client,
        quantity,
        quantity * price,
        soldOn,
      ]);
      webinarFact += quantity * price;
    }
    await q.query(`UPDATE sales_plans SET fact = $2, fact_updated_at = $3 WHERE id = $1`, [webinars, webinarFact, now.toISOString()]);
    // Факт показателей по отчётам: план поставлен после загрузки отчётов.
    await recalcPairs(q, companyId, [pavel, ksenia].map((user_id) => ({ user_id, month: current })), now);

    // Цель центра: выручка за месяц, KPI заполняется продажами подразделения.
    const { id: goal } = await one(
      `INSERT INTO goals (company_id, title, description, goal_type, owner_id, created_by, status, due_at, created_at)
       VALUES ($1, 'Выручка центра ДПО — 1 млн ₽ в месяц', 'Вывести продажи программ дополнительного образования на 1 млн ₽ в месяц к концу года. Факт — из отчётов 1С о продажах центра.', 'operational', $2, $3, 'active', $4, $5) RETURNING id`,
      [companyId, natalia, demo.users.director, `${current.slice(0, 4)}-12-31`, at(`${prev2}-01`).toISOString()],
    );
    await q.query(`INSERT INTO goal_org_units (goal_id, unit_id, role) VALUES ($1, $2, 'owner')`, [goal, unit]);
    const { id: metric } = await one(
      `INSERT INTO goal_metrics (goal_id, name, unit, baseline, target_value, direction, is_primary) VALUES ($1, 'Выручка за месяц', 'rub', 600000, 1000000, 'increase', TRUE) RETURNING id`,
      [goal],
    );
    await q.query(`INSERT INTO sales_goal_links (metric_id, company_id, measure, unit_id, created_by) VALUES ($1, $2, 'revenue', $3, $4)`, [metric, companyId, unit, natalia]);
    await syncGoalLinks(q, companyId, [prev2, prev, current], now);
    await q.query(
      `INSERT INTO audit_events (company_id, entity_type, entity_id, goal_id, actor_id, event_type, new_values, created_at) VALUES ($1, 'goal', $2, $2, $3, 'goal.created', $4, $5)`,
      [companyId, goal, demo.users.director, JSON.stringify({ title: 'Выручка центра ДПО — 1 млн ₽ в месяц', status: 'active' }), at(`${prev2}-01`).toISOString()],
    );
    return { unit, natalia, pavel, ksenia, goal };
  });
}
