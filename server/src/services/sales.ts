import {
  averagePercent,
  computeFact,
  coverageOf,
  defaultRules,
  factFromReports,
  functionScope,
  GOAL_LINK_MEASURE_LABELS,
  kpiMetricPercent,
  kpiMetricUnit,
  matchesClient,
  matchPeople,
  moscowDay,
  monthLastDay,
  monthObservationAt,
  PATH_SEP,
  planCalc,
  salesKey,
  salesPeriodText,
  salesStats,
  salesTotals,
  teamScope,
  type ClientLists,
  type CompanyRole,
  type DelegationContext,
  type FactDetails,
  type FactRule,
  type FunctionScope,
  type ItemProgress,
  type KpiFile,
  type ParsedSalesReport,
  type PayoutRule,
  type ReportLine,
  type ReportPersonResult,
  type SaleEntry,
  type SalesCoverage,
  type SalesGoalLink,
  type SalesKind,
  type SalesMonth,
  type SalesPerson,
  type SalesPlan,
  type SalesPlanRow,
  type SalesReportImport,
  type SalesReportInfo,
  type SalesStats,
  type SalesTeam,
  type SalesTeamMember,
  type SalesUnit,
} from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import type { Queryable } from '../db/db';
import { conflict } from '../http/errors';
import { audit } from './audit';
import { loadDelegation } from './functions';
import { loadMetrics } from './goals';
import { addObservations } from './observations';
import { loadOrg } from './org';
import { descendants } from '@offix/core';

/**
 * Продажи и личный KPI с выплатами — модуль из прошлого проекта на данных
 * offix. Права — функции продаж (core/delegation): загружать отчёты 1С,
 * загружать файлы KPI, ставить план. Каждая действует там же, где у
 * руководителя его подразделения; администратор — вся компания.
 */

export type SalesFn = 'sales_reports' | 'sales_files' | 'sales_assign';
export const SALES_FNS: readonly SalesFn[] = ['sales_reports', 'sales_files', 'sales_assign'];

export interface SalesAccess {
  actor: AuthedActor;
  admin: boolean;
  ctx: DelegationContext;
  scopes: Record<SalesFn, FunctionScope | null>;
  /** Сотрудники подразделений, которыми человек руководит (без него самого). */
  managed: Set<string>;
}

export async function salesAccess(q: Queryable, actor: AuthedActor): Promise<SalesAccess> {
  const ctx = await loadDelegation(q, actor.company_id);
  const admin = actor.role === 'owner' || actor.role === 'admin';
  const scopes = Object.fromEntries(SALES_FNS.map((f) => [f, actor.role === 'observer' ? null : functionScope(ctx, actor.id, f)])) as Record<SalesFn, FunctionScope | null>;
  const team = teamScope(ctx, actor.id);
  const managed = new Set(ctx.memberships.filter((m) => team?.has(m.unit_id) && m.user_id !== actor.id).map((m) => m.user_id));
  return { actor, admin, ctx, scopes, managed };
}

/**
 * Действует ли функция на сотрудника: вся компания — на всех (и на себя),
 * подразделения — на их сотрудников, кроме себя: план и отчёты о своих
 * продажах ставит не сам человек.
 */
function covers(acc: SalesAccess, scope: FunctionScope | null, userId: string): boolean {
  if (!scope) return false;
  if (scope.all) return true;
  if (userId === acc.actor.id) return false;
  return acc.ctx.memberships.some((m) => m.user_id === userId && scope.units.has(m.unit_id));
}

export const canFor = (acc: SalesAccess, fn: SalesFn, userId: string) => acc.actor.role !== 'observer' && (acc.admin || covers(acc, acc.scopes[fn], userId));

/** Есть ли функция где-нибудь: показывать ли загрузки и настройки. */
export const hasFn = (acc: SalesAccess, fn: SalesFn) => acc.actor.role !== 'observer' && (acc.admin || acc.scopes[fn] != null);

/** Чьи продажи человек видит: свои, подчинённых по оргдереву и тех, на кого действуют его функции продаж. */
export function canView(acc: SalesAccess, userId: string): boolean {
  if (userId === acc.actor.id || acc.admin || acc.managed.has(userId)) return true;
  return SALES_FNS.some((f) => covers(acc, acc.scopes[f], userId));
}

export const canSeeTeam = (acc: SalesAccess) => acc.admin || acc.managed.size > 0 || SALES_FNS.some((f) => hasFn(acc, f));

// ---------------------------------------------------------------- люди и списки

export interface SalesPersonRow extends SalesPerson {
  email: string;
  role: CompanyRole;
}

export async function loadPeople(q: Queryable, companyId: string): Promise<SalesPersonRow[]> {
  const { rows } = await q.query<SalesPersonRow>(
    `SELECT u.id, u.display_name AS name, u.position, u.email, m.role
       FROM company_members m JOIN users u ON u.id = m.user_id
      WHERE m.company_id = $1 AND u.active ORDER BY u.display_name, u.id`,
    [companyId],
  );
  return rows;
}

export const person = (p: SalesPersonRow): SalesPerson => ({ id: p.id, name: p.name, position: p.position });

/** Кому человек может применить функцию: для выбора сотрудника в формах. */
export function peopleFor(acc: SalesAccess, people: readonly SalesPersonRow[], fn: SalesFn): SalesPerson[] {
  return people.filter((p) => p.role !== 'observer' && canFor(acc, fn, p.id)).map(person);
}

export async function loadLists(q: Queryable, companyId: string): Promise<ClientLists> {
  const { rows } = await q.query<{ kind: 'key' | 'merge'; pattern: string }>(`SELECT kind, pattern FROM sales_client_lists WHERE company_id = $1 ORDER BY pattern`, [companyId]);
  return { key: rows.filter((r) => r.kind === 'key').map((r) => r.pattern), merge: rows.filter((r) => r.kind === 'merge').map((r) => r.pattern) };
}

/** Месяц «2026-10» по Москве и сегодняшний день. */
export const todayMsk = (now: Date) => moscowDay(now.toISOString());
export const monthDate = (month: string) => `${month}-01`;
export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** Месяц на n раньше: shiftMonth('2026-01', -1) = '2025-12'. */
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

// ---------------------------------------------------------------- строки отчётов и пересчёт

const LINE_COLS = `l.client_name, l.kind, l.group_path, l.name, l.quantity, l.revenue`;

async function userMonthLines(q: Queryable, companyId: string, userId: string, month: string, kind?: 'total'): Promise<ReportLine[]> {
  const { rows } = await q.query<ReportLine>(
    `SELECT ${LINE_COLS} FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id
      WHERE r.company_id = $1 AND l.user_id = $2 AND r.month = $3::date ${kind ? `AND l.kind = 'total'` : ''}`,
    [companyId, userId, monthDate(month)],
  );
  return rows;
}

/**
 * Факт показателей сотрудника за месяц, которые считаются по отчётам 1С.
 * Отчётов нет (их удалили) — факт обнуляется. Показатели из файла KPI и
 * «вручную» не трогаются. Возвращает, сколько показателей пересчитано.
 */
export async function recalcUserMonth(q: Queryable, companyId: string, userId: string, month: string, lists: ClientLists, now: Date): Promise<number> {
  const { rows } = await q.query<{ id: string; fact_rule: FactRule }>(
    `SELECT id, fact_rule FROM sales_plans WHERE company_id = $1 AND user_id = $2 AND month = $3::date AND source = 'manual'`,
    [companyId, userId, monthDate(month)],
  );
  const plans = rows.filter((p) => factFromReports(json<FactRule>(p.fact_rule)));
  if (!plans.length) return 0;
  const lines = await userMonthLines(q, companyId, userId, month);
  for (const p of plans) {
    const r = lines.length ? computeFact(json<FactRule>(p.fact_rule), lines, lists) : null;
    await q.query(`UPDATE sales_plans SET fact = $2, fact_details = $3::jsonb, fact_updated_at = $4, updated_at = $4 WHERE id = $1`, [
      p.id,
      r?.value ?? 0,
      r ? JSON.stringify({ ...r.details, from: 'report' }) : null,
      now.toISOString(),
    ]);
  }
  return plans.length;
}

export async function recalcPairs(q: Queryable, companyId: string, pairs: readonly { user_id: string; month: string }[], now: Date): Promise<number> {
  const seen = new Set<string>();
  const lists = await loadLists(q, companyId);
  let n = 0;
  for (const p of pairs) {
    const k = `${p.user_id}:${p.month}`;
    if (seen.has(k)) continue;
    seen.add(k);
    n += await recalcUserMonth(q, companyId, p.user_id, p.month, lists, now);
  }
  return n;
}

/** Сотрудники и месяцы с продажами по отчётам за последний год — для пересчёта после смены списков клиентов. */
export async function recentPairs(q: Queryable, companyId: string, now: Date): Promise<{ user_id: string; month: string }[]> {
  const { rows } = await q.query<{ user_id: string; month: string }>(
    `SELECT DISTINCT l.user_id, to_char(r.month, 'YYYY-MM') AS month FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id
      WHERE r.company_id = $1 AND l.user_id IS NOT NULL AND r.month >= $2::date`,
    [companyId, monthDate(shiftMonth(todayMsk(now).slice(0, 7), -12))],
  );
  return rows;
}

/** Покрытие месяца отчётами компании: последний день и сколько отчётов; null — отчётов нет. */
export async function monthCoverage(q: Queryable, companyId: string, month: string): Promise<SalesCoverage | null> {
  const { rows } = await q.query<{ n: number; as_of: string | null }>(
    `SELECT count(*)::int AS n, to_char(max(period_end), 'YYYY-MM-DD') AS as_of FROM sales_reports WHERE company_id = $1 AND month = $2::date`,
    [companyId, monthDate(month)],
  );
  const r = rows[0];
  return r && r.as_of ? coverageOf(month, r.as_of, Number(r.n)) : null;
}

/** Плитки продаж сотрудника за месяц: выручка, клиенты, в среднем за рабочий день, штуки. */
async function userStats(q: Queryable, companyId: string, userId: string, month: string, cov: SalesCoverage | null, lists: ClientLists): Promise<SalesStats | null> {
  if (!cov) return null;
  const lines = await userMonthLines(q, companyId, userId, month, 'total');
  return lines.length ? salesStats(lines, lists, cov) : null;
}

// ---------------------------------------------------------------- показатели

export const PLAN_COLS = `p.id, p.user_id, to_char(p.month, 'YYYY-MM') AS month, p.name, p.kind, p.unit, p.plan, p.fact, p.bonus, p.payment, p.file_percent,
  p.fact_rule, p.payout_rule, p.rules_custom, p.fact_details, p.file_items, p.source, p.description, p.fact_updated_at, p.sort_order`;

/** JSONB приходит объектом, но старый драйвер может отдать строку. */
export function json<T>(v: unknown): T {
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}

export interface PlanDbRow {
  id: string;
  user_id: string;
  month: string;
  name: string;
  kind: SalesKind | null;
  unit: SalesUnit;
  plan: number;
  fact: number;
  bonus: number;
  payment: number | null;
  file_percent: number | null;
  fact_rule: FactRule;
  payout_rule: PayoutRule;
  rules_custom: boolean;
  fact_details: (FactDetails & { from?: 'report' }) | null;
  file_items: ItemProgress[] | null;
  source: 'manual' | 'file';
  description: string | null;
  fact_updated_at: string | null;
  sort_order: number;
}

export function toPlan(r: PlanDbRow, cov: SalesCoverage | null, today: string): SalesPlan {
  const row: SalesPlanRow & { rules_custom: boolean } = {
    id: r.id,
    user_id: r.user_id,
    month: r.month,
    name: r.name,
    kind: r.kind,
    unit: r.unit,
    plan: Number(r.plan),
    fact: Number(r.fact),
    bonus: Number(r.bonus),
    payment: r.payment == null ? null : Number(r.payment),
    file_percent: r.file_percent == null ? null : Number(r.file_percent),
    fact_rule: json(r.fact_rule),
    payout_rule: json(r.payout_rule),
    rules_custom: r.rules_custom,
    fact_details: r.fact_details == null ? null : json(r.fact_details),
    file_items: r.file_items == null ? null : json(r.file_items),
    source: r.source,
    description: r.description,
    fact_updated_at: r.fact_updated_at,
    sort_order: r.sort_order,
  };
  return { ...row, calc: planCalc(row, cov, today) };
}

export async function loadPlans(q: Queryable, companyId: string, userId: string, month: string): Promise<PlanDbRow[]> {
  const { rows } = await q.query<PlanDbRow>(
    `SELECT ${PLAN_COLS} FROM sales_plans p WHERE p.company_id = $1 AND p.user_id = $2 AND p.month = $3::date ORDER BY p.sort_order, p.created_at, p.id`,
    [companyId, userId, monthDate(month)],
  );
  return rows;
}

export async function loadPlan(q: Queryable, companyId: string, id: string): Promise<PlanDbRow | null> {
  const { rows } = await q.query<PlanDbRow>(`SELECT ${PLAN_COLS} FROM sales_plans p WHERE p.id = $1 AND p.company_id = $2`, [id, companyId]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- отчёты

interface ReportDbRow {
  id: string;
  file_name: string;
  period_start: string;
  period_end: string;
  month: string;
  total: number;
  warnings: string[] | string;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  people: number;
  unmatched: number;
  users: string[];
}

/** Отчёты, которые видит человек с функцией загрузки: свои и те, где есть его сотрудники. */
export async function reportInfos(q: Queryable, acc: SalesAccess, filter: { month?: string; id?: string }): Promise<SalesReportInfo[]> {
  if (!hasFn(acc, 'sales_reports')) return [];
  const args: unknown[] = [acc.actor.company_id];
  let where = '';
  if (filter.month) {
    args.push(monthDate(filter.month));
    where += ` AND r.month = $${args.length}::date`;
  }
  if (filter.id) {
    args.push(filter.id);
    where += ` AND r.id = $${args.length}`;
  }
  const { rows } = await q.query<ReportDbRow>(
    `SELECT r.id, r.file_name, to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
            to_char(r.month, 'YYYY-MM') AS month, r.total, r.warnings, r.uploaded_by, u.display_name AS uploaded_by_name, r.created_at,
            (SELECT count(DISTINCT l.manager_key)::int FROM sales_report_lines l WHERE l.report_id = r.id) AS people,
            (SELECT count(DISTINCT l.manager_key)::int FROM sales_report_lines l WHERE l.report_id = r.id AND l.user_id IS NULL) AS unmatched,
            ARRAY(SELECT DISTINCT l.user_id FROM sales_report_lines l WHERE l.report_id = r.id AND l.user_id IS NOT NULL) AS users
       FROM sales_reports r LEFT JOIN users u ON u.id = r.uploaded_by
      WHERE r.company_id = $1 ${where}
      ORDER BY r.period_end DESC, r.created_at DESC LIMIT 200`,
    args,
  );
  const scope = acc.scopes.sales_reports;
  const all = acc.admin || !!scope?.all;
  return rows
    .filter((r) => all || r.uploaded_by === acc.actor.id || (r.users ?? []).some((u) => covers(acc, scope, u)))
    .map((r) => ({
      id: r.id,
      file_name: r.file_name,
      period_start: r.period_start,
      period_end: r.period_end,
      month: r.month,
      total: Number(r.total),
      warnings: json<string[]>(r.warnings) ?? [],
      uploaded_by_name: r.uploaded_by_name,
      created_at: r.created_at,
      people: Number(r.people),
      unmatched: Number(r.unmatched),
      can_delete: all || (r.users ?? []).every((u) => covers(acc, scope, u)),
    }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Загрузка отчёта 1С. Подходят и нарастающие отчёты (1–15, затем 1–16 —
 * новый заменяет прежний), и отчёты за отдельные дни (складываются).
 * Отчёт, который частично пересекается с загруженным, отклоняется — иначе
 * продажи посчитались бы дважды. Сотрудники вне области функции
 * пропускаются; менеджеры, которых не нашли, ждут ручного сопоставления.
 */
export async function importSalesReport(q: Queryable, acc: SalesAccess, file: { name: string; report: ParsedSalesReport }, now: Date): Promise<SalesReportImport> {
  const companyId = acc.actor.company_id;
  const rep = file.report;
  const [people, lists, aliasRows] = await Promise.all([
    loadPeople(q, companyId),
    loadLists(q, companyId),
    q.query<{ name_key: string; user_id: string }>(`SELECT name_key, user_id FROM sales_name_aliases WHERE company_id = $1`, [companyId]),
  ]);
  const candidates = people.filter((p) => p.role !== 'observer');
  const matches = matchPeople(
    rep.blocks.map((b) => b.manager),
    candidates.map((p) => ({ id: p.id, name: p.name, email: p.email })),
    new Map(aliasRows.rows.map((a) => [a.name_key, a.user_id])),
  );
  const byId = new Map(people.map((p) => [p.id, p]));
  const isKey = (client: string) => lists.key.some((p) => matchesClient(client, p));

  const byManager = new Map<string, { name: string; blocks: typeof rep.blocks }>();
  for (const b of rep.blocks) {
    const key = salesKey(b.manager);
    if (!byManager.has(key)) byManager.set(key, { name: b.manager, blocks: [] });
    byManager.get(key)!.blocks.push(b);
  }

  const results: ReportPersonResult[] = [];
  const store: { key: string; name: string; userId: string | null; blocks: typeof rep.blocks }[] = [];
  for (const [key, m] of byManager) {
    const total = round2(m.blocks.reduce((s, b) => s + b.revenue, 0));
    const keyRevenue = round2(m.blocks.filter((b) => isKey(b.client)).reduce((s, b) => s + b.revenue, 0));
    const clients = new Set(m.blocks.filter((b) => b.revenue > 0).map((b) => salesKey(b.client))).size;
    const base = { manager: m.name || 'Без менеджера', total, key: keyRevenue, non_key: round2(total - keyRevenue), clients, plans_updated: 0 };
    if (!key) {
      results.push({ ...base, user: null, status: 'no_manager', error: 'Продажи без менеджера — не учитываются' });
      continue;
    }
    const match = matches.get(key);
    if (!match?.user_id) {
      results.push({
        ...base,
        user: null,
        status: match?.ambiguous ? 'ambiguous' : 'unmatched',
        error: match?.ambiguous ? 'Подходит несколько сотрудников — выберите вручную' : 'Сотрудник не найден — выберите вручную',
      });
      store.push({ key, name: m.name, userId: null, blocks: m.blocks });
      continue;
    }
    const p = byId.get(match.user_id)!;
    if (!canFor(acc, 'sales_reports', p.id)) {
      results.push({ ...base, user: person(p), status: 'forbidden', error: 'Нет прав: продажи этого сотрудника загружает его руководитель' });
      continue;
    }
    results.push({ ...base, user: person(p), status: 'ok', error: null });
    store.push({ key, name: m.name, userId: p.id, blocks: m.blocks });
  }

  const userIds = [...new Set(store.map((s) => s.userId).filter((id): id is string => id != null))];
  const unmatchedKeys = store.filter((s) => s.userId == null).map((s) => s.key);
  const sameOwner = `(l.user_id = ANY($5::uuid[]) OR (l.user_id IS NULL AND l.manager_key = ANY($6::text[])))`;
  const params = [companyId, monthDate(rep.month), rep.period_start, rep.period_end, userIds, unmatchedKeys];

  // Пересечение, которое нельзя разрешить заменой: прежний отчёт шире нового или выходит за его границы.
  const clash = await q.query<{ s: string; e: string }>(
    `SELECT DISTINCT to_char(r.period_start, 'YYYY-MM-DD') AS s, to_char(r.period_end, 'YYYY-MM-DD') AS e
       FROM sales_reports r JOIN sales_report_lines l ON l.report_id = r.id
      WHERE r.company_id = $1 AND r.month = $2::date AND r.period_start <= $4::date AND r.period_end >= $3::date
        AND NOT (r.period_start >= $3::date AND r.period_end <= $4::date) AND ${sameOwner}
      ORDER BY 1`,
    params,
  );
  if (clash.rows.length) {
    const old = clash.rows.map((r) => salesPeriodText(r.s, r.e)).join(', ');
    throw conflict(
      `Продажи за ${salesPeriodText(rep.period_start, rep.period_end)} уже входят в загруженный отчёт за ${old}. ` +
        'Загрузите отчёт, который полностью покрывает прежний (например, с 1-го числа по сегодня), или удалите прежний отчёт в истории загрузок',
    );
  }

  const warnings = rep.warnings.slice(0, 20);
  if (!store.length) return { report: null, replaced: 0, people: results, key_list_empty: lists.key.length === 0, warnings, goals_updated: 0 };

  const { rows: ins } = await q.query<{ id: string }>(
    `INSERT INTO sales_reports (company_id, file_name, period_start, period_end, month, total, file_total, warnings, uploaded_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10) RETURNING id`,
    [companyId, file.name.slice(0, 255), rep.period_start, rep.period_end, monthDate(rep.month), rep.total, rep.file_total, JSON.stringify(warnings), acc.actor.id, now.toISOString()],
  );
  const reportId = ins[0]!.id;

  // Строки пачками через unnest: в отчёте за месяц их тысячи.
  const cols: unknown[][] = Array.from({ length: 10 }, () => []);
  const add = (...v: unknown[]) => v.forEach((x, i) => cols[i]!.push(x));
  for (const s of store) {
    for (const b of s.blocks) {
      const client = b.client.slice(0, 500);
      add(s.userId, s.name.slice(0, 255), s.key.slice(0, 255), client, 'total', 0, '', client, b.quantity, b.revenue);
      for (const n of b.nodes) add(s.userId, s.name.slice(0, 255), s.key.slice(0, 255), client, n.kind, n.depth, n.path.join(PATH_SEP), n.name.slice(0, 500), n.quantity, n.revenue);
    }
  }
  const CHUNK = 2000;
  for (let i = 0; i < cols[0]!.length; i += CHUNK) {
    const part = cols.map((c) => c.slice(i, i + CHUNK));
    await q.query(
      `INSERT INTO sales_report_lines (report_id, user_id, manager_name, manager_key, client_name, kind, depth, group_path, name, quantity, revenue)
       SELECT $1, * FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::text[], $10::numeric[], $11::numeric[])`,
      [reportId, ...part],
    );
  }

  // Прежние отчёты внутри нового периода заменяются — для тех же сотрудников.
  const removed = await q.query<{ id: string; user_id: string | null }>(
    `DELETE FROM sales_report_lines l USING sales_reports r
      WHERE l.report_id = r.id AND r.id <> $7 AND r.company_id = $1 AND r.month = $2::date
        AND r.period_start >= $3::date AND r.period_end <= $4::date AND ${sameOwner}
      RETURNING r.id, l.user_id`,
    [...params, reportId],
  );
  await q.query(`DELETE FROM sales_reports r WHERE r.company_id = $1 AND r.id <> $2 AND r.month = $3::date AND NOT EXISTS (SELECT 1 FROM sales_report_lines l WHERE l.report_id = r.id)`, [
    companyId,
    reportId,
    monthDate(rep.month),
  ]);

  for (const r of results) {
    if (r.status !== 'ok' || !r.user) continue;
    r.plans_updated = await recalcUserMonth(q, companyId, r.user.id, rep.month, lists, now);
  }
  // У кого строки ушли вместе с прежним отчётом, но не пришли в новом — тоже пересчитать.
  const gone = [...new Set(removed.rows.map((r) => r.user_id).filter((u): u is string => !!u && !userIds.includes(u)))];
  await recalcPairs(q, companyId, gone.map((user_id) => ({ user_id, month: rep.month })), now);

  await audit(q, {
    company_id: companyId,
    entity_type: 'sales_report',
    entity_id: reportId,
    actor_id: acc.actor.id,
    event_type: 'sales_report.uploaded',
    new_values: { file_name: file.name, period: salesPeriodText(rep.period_start, rep.period_end), total: rep.total, people: results.length },
  });
  const goals_updated = await syncGoalLinks(q, companyId, [rep.month], now);
  const [info] = await reportInfos(q, acc, { id: reportId });
  return {
    report: info ?? null,
    replaced: new Set(removed.rows.map((r) => r.id)).size,
    people: results,
    key_list_empty: lists.key.length === 0,
    warnings,
    goals_updated,
  };
}

/** Удалить отчёт (ошибочный файл): факт по отчётам пересчитывается без него. */
export async function deleteSalesReport(q: Queryable, acc: SalesAccess, id: string, now: Date): Promise<'deleted' | 'not_found' | 'forbidden'> {
  const [info] = await reportInfos(q, acc, { id });
  if (!info) return 'not_found';
  if (!info.can_delete) return 'forbidden';
  const { rows } = await q.query<{ user_id: string }>(`SELECT DISTINCT user_id FROM sales_report_lines WHERE report_id = $1 AND user_id IS NOT NULL`, [id]);
  await q.query(`DELETE FROM sales_reports WHERE id = $1`, [id]);
  await recalcPairs(q, acc.actor.company_id, rows.map((r) => ({ user_id: r.user_id, month: info.month })), now);
  await audit(q, {
    company_id: acc.actor.company_id,
    entity_type: 'sales_report',
    entity_id: id,
    actor_id: acc.actor.id,
    event_type: 'sales_report.deleted',
    old_values: { file_name: info.file_name, period: salesPeriodText(info.period_start, info.period_end), total: info.total },
  });
  await syncGoalLinks(q, acc.actor.company_id, [info.month], now);
  return 'deleted';
}

/** Названия групп товаров из недавних отчётов — чтобы подобрать правило показателю из файла KPI. */
export async function knownGroups(q: Queryable, companyId: string): Promise<string[]> {
  const { rows } = await q.query<{ name: string }>(
    `SELECT DISTINCT l.name FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id
      WHERE r.company_id = $1 AND l.kind = 'group'
        AND r.month >= (SELECT max(month) FROM sales_reports WHERE company_id = $1) - INTERVAL '3 months'
      LIMIT 3000`,
    [companyId],
  );
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------- файл KPI

const ruleKey = (kind: string | null, name: string) => (kind && kind !== 'other' ? kind : `name:${salesKey(name)}`);

/**
 * Показатели файла KPI сотруднику за месяц: прежние показатели из файла за
 * этот месяц заменяются, поставленные вручную остаются. Факт, процент и «к
 * выплате» — из файла; отчёты 1С их не меняют. Правило выплаты, которое
 * поправил руководитель, переносится на новый показатель.
 */
export async function saveKpiFile(q: Queryable, acc: SalesAccess, o: { userId: string; month: string; file: KpiFile }, now: Date): Promise<{ created: number; replaced: number }> {
  const companyId = acc.actor.company_id;
  const { rows: custom } = await q.query<{ kind: string | null; name: string; payout_rule: PayoutRule }>(
    `SELECT kind, name, payout_rule FROM sales_plans WHERE company_id = $1 AND user_id = $2 AND month = $3::date AND source = 'file' AND rules_custom`,
    [companyId, o.userId, monthDate(o.month)],
  );
  const kept = new Map(custom.map((r) => [ruleKey(r.kind, r.name), json<PayoutRule>(r.payout_rule)]));
  const { rows: removed } = await q.query<{ id: string }>(`DELETE FROM sales_plans WHERE company_id = $1 AND user_id = $2 AND month = $3::date AND source = 'file' RETURNING id`, [
    companyId,
    o.userId,
    monthDate(o.month),
  ]);
  const groups = await knownGroups(q, companyId);
  // Показатели из файла — первыми, поставленные вручную — после них.
  const base = -1000;
  for (const [i, m] of o.file.metrics.entries()) {
    const keep = kept.get(ruleKey(m.kind, m.name));
    const marked = m.items.some((it) => it.file_done != null);
    const items: ItemProgress[] | null = marked
      ? m.items.map((it) => ({ name: it.name, need: it.need, count: it.file_count ?? (it.file_done ? it.need : 0), done: !!it.file_done }))
      : null;
    await q.query(
      `INSERT INTO sales_plans (company_id, user_id, month, name, kind, unit, plan, fact, bonus, payment, file_percent, fact_rule, payout_rule, rules_custom,
                                file_items, source, description, sort_order, fact_updated_at, created_by, created_at, updated_at)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15::jsonb, 'file', $16, $17, $18, $19, $18, $18)`,
      [
        companyId,
        o.userId,
        monthDate(o.month),
        m.name.slice(0, 300),
        m.kind,
        kpiMetricUnit(m),
        round2(m.plan),
        round2(m.fact ?? 0),
        round2(m.bonus),
        o.file.has_results ? round2(m.payment ?? 0) : null,
        kpiMetricPercent(m),
        JSON.stringify({ type: 'manual' }),
        JSON.stringify(keep ?? defaultRules(m, groups).payout),
        !!keep,
        items ? JSON.stringify(items) : null,
        m.items.map((it) => it.name).join('; ') || null,
        base + i,
        now.toISOString(),
        acc.actor.id,
      ],
    );
  }
  await audit(q, {
    company_id: companyId,
    entity_type: 'sales_plan',
    entity_id: o.userId,
    actor_id: acc.actor.id,
    event_type: 'sales_plan.file_uploaded',
    new_values: { month: o.month, employee: o.file.employee, metrics: o.file.metrics.length, replaced: removed.length },
  });
  return { created: o.file.metrics.length, replaced: removed.length };
}

// ---------------------------------------------------------------- экран месяца и команда

async function entriesSummary(q: Queryable, companyId: string, userId: string, month: string) {
  const { rows } = await q.query<{ count: number; amount: number | null; quantity: number | null }>(
    `SELECT count(*)::int AS count, sum(amount) AS amount, sum(quantity) AS quantity FROM sales_entries
      WHERE company_id = $1 AND user_id = $2 AND sold_on >= $3::date AND sold_on <= $4::date`,
    [companyId, userId, monthDate(month), monthLastDay(month)],
  );
  const r = rows[0]!;
  return { count: Number(r.count), amount: round2(Number(r.amount ?? 0)), quantity: Math.round(Number(r.quantity ?? 0) * 1000) / 1000 };
}

async function personMonths(q: Queryable, companyId: string, userId: string, current: string): Promise<string[]> {
  const { rows } = await q.query<{ m: string }>(
    `SELECT to_char(month, 'YYYY-MM') AS m FROM sales_plans WHERE company_id = $1 AND user_id = $2
     UNION SELECT to_char(r.month, 'YYYY-MM') FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id WHERE r.company_id = $1 AND l.user_id = $2
     UNION SELECT to_char(sold_on, 'YYYY-MM') FROM sales_entries WHERE company_id = $1 AND user_id = $2`,
    [companyId, userId],
  );
  return [...new Set([current, ...rows.map((r) => r.m)])].sort().reverse().slice(0, 36);
}

/** План, выплаты и продажи сотрудника за месяц. Права на просмотр проверяет вызывающий. */
export async function salesMonth(q: Queryable, acc: SalesAccess, who: SalesPersonRow, month: string, now: Date): Promise<SalesMonth> {
  const companyId = acc.actor.company_id;
  const today = todayMsk(now);
  const [cov, lists, rows] = await Promise.all([monthCoverage(q, companyId, month), loadLists(q, companyId), loadPlans(q, companyId, who.id, month)]);
  const plans = rows.map((r) => toPlan(r, cov, today));
  const self = who.id === acc.actor.id && acc.actor.role !== 'observer';
  const edit = canFor(acc, 'sales_assign', who.id);
  return {
    month,
    user: person(who),
    plans,
    totals: salesTotals(plans),
    coverage: cov,
    stats: await userStats(q, companyId, who.id, month, cov, lists),
    reports: await reportInfos(q, acc, { month }),
    entries: await entriesSummary(q, companyId, who.id, month),
    months: await personMonths(q, companyId, who.id, today.slice(0, 7)),
    can: {
      edit,
      fact: self,
      kpi_file: canFor(acc, 'sales_files', who.id),
      add_entry: self || edit,
      team: canSeeTeam(acc),
      reports: hasFn(acc, 'sales_reports'),
    },
    lists: { key: lists.key.length, merge: lists.merge.length },
  };
}

/** Команда за месяц: те, чьи продажи человек видит и у кого есть план, отчёты или записи за последние три месяца. */
export async function salesTeam(q: Queryable, acc: SalesAccess, month: string, now: Date): Promise<SalesTeam> {
  const companyId = acc.actor.company_id;
  const today = todayMsk(now);
  const people = (await loadPeople(q, companyId)).filter((p) => p.id !== acc.actor.id && p.role !== 'observer' && canView(acc, p.id));
  const from = monthDate(shiftMonth(month, -2));
  const to = monthLastDay(month);
  const { rows: active } = await q.query<{ user_id: string }>(
    `SELECT user_id FROM sales_plans WHERE company_id = $1 AND month BETWEEN $2::date AND $3::date
     UNION SELECT l.user_id FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id WHERE r.company_id = $1 AND r.month BETWEEN $2::date AND $3::date AND l.user_id IS NOT NULL
     UNION SELECT user_id FROM sales_entries WHERE company_id = $1 AND sold_on BETWEEN $2::date AND $3::date`,
    [companyId, from, to],
  );
  const activeIds = new Set(active.map((r) => r.user_id));
  const [cov, lists] = await Promise.all([monthCoverage(q, companyId, month), loadLists(q, companyId)]);
  const members: SalesTeamMember[] = [];
  for (const p of people.filter((x) => activeIds.has(x.id))) {
    const plans = (await loadPlans(q, companyId, p.id, month)).map((r) => toPlan(r, cov, today));
    const e = await entriesSummary(q, companyId, p.id, month);
    members.push({
      user: person(p),
      plans: plans.length,
      percent: averagePercent(plans),
      totals: salesTotals(plans),
      stats: await userStats(q, companyId, p.id, month, cov, lists),
      entries: { count: e.count, amount: e.amount },
    });
  }
  members.sort((a, b) => (b.stats?.revenue ?? 0) + b.entries.amount - ((a.stats?.revenue ?? 0) + a.entries.amount) || a.user.name.localeCompare(b.user.name, 'ru'));
  const sum = (f: (m: SalesTeamMember) => number) => round2(members.reduce((s, m) => s + f(m), 0));
  return {
    month,
    members,
    totals: { revenue: sum((m) => m.stats?.revenue ?? 0), now: sum((m) => m.totals.now), forecast: sum((m) => m.totals.forecast), max: sum((m) => m.totals.max) },
    can: { upload: hasFn(acc, 'sales_reports'), kpi_files: hasFn(acc, 'sales_files'), assign: hasFn(acc, 'sales_assign') },
  };
}

// ---------------------------------------------------------------- записи о продажах

export interface EntryDbRow {
  id: string;
  user_id: string;
  plan_id: string | null;
  product: string;
  client: string | null;
  quantity: number;
  amount: number;
  sold_on: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export const ENTRY_COLS = `e.id, e.user_id, e.plan_id, e.product, e.client, e.quantity, e.amount, to_char(e.sold_on, 'YYYY-MM-DD') AS sold_on, e.note, e.created_by, e.created_at`;

export const toEntry = (acc: SalesAccess, e: EntryDbRow): SaleEntry => ({
  id: e.id,
  user_id: e.user_id,
  plan_id: e.plan_id,
  product: e.product,
  client: e.client,
  quantity: Number(e.quantity),
  amount: Number(e.amount),
  sold_on: e.sold_on,
  note: e.note,
  created_at: e.created_at,
  can_delete: acc.actor.role !== 'observer' && (e.user_id === acc.actor.id || e.created_by === acc.actor.id || canFor(acc, 'sales_assign', e.user_id)),
});

/** Сколько добавляет продажа к факту показателя «вручную»: рубли — сумму, точки — одну, остальное — штуки. */
export function entryContribution(unit: SalesUnit, e: { amount: number; quantity: number }): number {
  if (unit === 'rub') return e.amount;
  if (unit === 'clients') return 1;
  return e.quantity;
}

// ---------------------------------------------------------------- KPI целей из продаж

interface LinkRow {
  metric_id: string;
  measure: SalesGoalLink['measure'];
  unit_id: string | null;
}

/** Значение для KPI цели за месяц: выручка, штуки или клиенты компании или подразделения с вложенными. */
async function linkValue(q: Queryable, companyId: string, link: LinkRow, month: string, lists: ClientLists): Promise<number | null> {
  let users: string[] | null = null;
  if (link.unit_id) {
    const org = await loadOrg(q, companyId);
    const units = new Set([link.unit_id, ...descendants(org.units, link.unit_id)]);
    users = [...new Set(org.memberships.filter((m) => units.has(m.unit_id)).map((m) => m.user_id))];
  }
  const { rows } = await q.query<ReportLine>(
    `SELECT ${LINE_COLS} FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id
      WHERE r.company_id = $1 AND r.month = $2::date AND l.kind = 'total' ${users ? 'AND l.user_id = ANY($3::uuid[])' : ''}`,
    users ? [companyId, monthDate(month), users] : [companyId, monthDate(month)],
  );
  if (link.measure === 'revenue') return round2(rows.reduce((s, l) => s + Number(l.revenue), 0));
  if (link.measure === 'quantity') return round2(rows.reduce((s, l) => s + Number(l.quantity), 0));
  return computeFact({ type: 'clients', groups: [], exclude_key: false, merge: lists.merge }, rows, lists)?.value ?? 0;
}

/**
 * KPI целей, связанные с продажами: за каждый завершённый месяц (прошедший
 * или полностью покрытый отчётами) — один замер последним днём месяца.
 * Новый отчёт обновляет замер, а не добавляет второй; отчётов за месяц не
 * осталось — замер удаляется. Возвращает, сколько KPI изменилось.
 */
export async function syncGoalLinks(q: Queryable, companyId: string, months: readonly string[], now: Date, onlyMetric?: string): Promise<number> {
  const { rows: links } = await q.query<LinkRow & { goal_id: string; owner_id: string | null; status: string }>(
    `SELECT s.metric_id, s.measure, s.unit_id, g.id AS goal_id, g.owner_id, g.status
       FROM sales_goal_links s JOIN goal_metrics m ON m.id = s.metric_id JOIN goals g ON g.id = m.goal_id
      WHERE s.company_id = $1 ${onlyMetric ? 'AND s.metric_id = $2' : ''}`,
    onlyMetric ? [companyId, onlyMetric] : [companyId],
  );
  if (!links.length) return 0;
  const lists = await loadLists(q, companyId);
  const current = todayMsk(now).slice(0, 7);
  let changed = 0;
  for (const link of links) {
    if (link.status === 'cancelled') continue;
    for (const month of new Set(months)) {
      const cov = await monthCoverage(q, companyId, month);
      const done = month < current || (cov != null && cov.as_of === monthLastDay(month));
      const { rows: prev } = await q.query<{ observation_id: string; value: number }>(`SELECT observation_id, value FROM sales_goal_months WHERE metric_id = $1 AND month = $2::date`, [
        link.metric_id,
        monthDate(month),
      ]);
      const old = prev[0];
      if (!cov || !done) {
        if (old) {
          await q.query(`DELETE FROM goal_metric_observations WHERE id = $1`, [old.observation_id]);
          changed++;
        }
        continue;
      }
      const value = await linkValue(q, companyId, link, month, lists);
      if (value == null) continue;
      const note = `Продажи: ${GOAL_LINK_MEASURE_LABELS[link.measure].toLowerCase()} по отчётам 1С`;
      if (old) {
        if (Number(old.value) === value) continue;
        await q.query(`UPDATE goal_metric_observations SET value = $2, note = $3 WHERE id = $1`, [old.observation_id, value, note]);
        await q.query(`UPDATE sales_goal_months SET value = $3 WHERE metric_id = $1 AND month = $2::date`, [link.metric_id, monthDate(month), value]);
        await audit(q, {
          company_id: companyId,
          entity_type: 'metric',
          entity_id: link.metric_id,
          goal_id: link.goal_id,
          actor_id: null,
          event_type: 'metric.synced',
          new_values: { month, value, source: 'sales' },
        });
        changed++;
        continue;
      }
      const [metric] = (await loadMetrics(q, [link.goal_id])).filter((m) => m.id === link.metric_id);
      if (!metric) continue;
      const at = monthObservationAt(month);
      const r = await addObservations(q, {
        companyId,
        goalId: link.goal_id,
        goalOwnerId: link.owner_id,
        metric,
        rows: [{ at, value }],
        source: 'integration',
        actorId: null,
        note,
        auditExtra: { source: 'sales', month },
      });
      if (!r.imported) continue;
      const { rows: obs } = await q.query<{ id: string }>(
        `SELECT id FROM goal_metric_observations WHERE metric_id = $1 AND observed_at = $2 AND source = 'integration' ORDER BY id LIMIT 1`,
        [link.metric_id, at],
      );
      if (!obs[0]) continue;
      await q.query(`INSERT INTO sales_goal_months (metric_id, month, observation_id, value) VALUES ($1, $2::date, $3, $4)`, [link.metric_id, monthDate(month), obs[0].id, value]);
      changed++;
    }
  }
  return changed;
}

/** Месяцы с отчётами за последний год — их нужно пересчитать в KPI целей при новой связи. */
export async function reportMonths(q: Queryable, companyId: string, now: Date): Promise<string[]> {
  const { rows } = await q.query<{ m: string }>(`SELECT DISTINCT to_char(month, 'YYYY-MM') AS m FROM sales_reports WHERE company_id = $1 AND month >= $2::date ORDER BY 1`, [
    companyId,
    monthDate(shiftMonth(todayMsk(now).slice(0, 7), -12)),
  ]);
  return rows.map((r) => r.m);
}
