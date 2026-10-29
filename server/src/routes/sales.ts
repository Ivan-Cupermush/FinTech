import { promises as fs } from 'node:fs';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  buildKpiSheet,
  buildSalesReportSheet,
  checkEntryMapping,
  csvTable,
  defaultRules,
  ENTRY_FIELDS,
  entriesFromRows,
  guessEntryColumns,
  kpiMetricPercent,
  kpiMetricUnit,
  matchesClient,
  matchPeople,
  monthLastDay,
  parseKpiSheets,
  parsePatterns,
  parseSalesReport,
  PATH_SEP,
  pickReportSheet,
  ruleText,
  SALES_LIMITS,
  salesKey,
  salesKindOf,
  SalesFileError,
  sheetTable,
  validatePlanInput,
  validateSaleEntry,
  cellText,
  type EntryMapping,
  type FactRule,
  type PayoutRule,
  type EntryTable,
  type KpiFilePreview,
  type KpiFileResult,
  type SalesAlias,
  type SalesClientPattern,
  type SalesEmployee,
  type SalesGoalLink,
  type SalesImportPreview,
  type SalesUnit,
  type SalesUnmatched,
  type SheetData,
} from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { conflict, forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import type { MediaCtx } from '../services/attachments';
import { canRecordKpi, getVisibleGoal } from '../services/goals';
import {
  canFor,
  canSeeTeam,
  canView,
  deleteSalesReport,
  ENTRY_COLS,
  entryContribution,
  hasFn,
  importSalesReport,
  isMonth,
  json,
  knownGroups,
  loadLists,
  loadPeople,
  loadPlan,
  monthDate,
  person,
  peopleFor,
  recalcPairs,
  recalcUserMonth,
  recentPairs,
  reportInfos,
  reportMonths,
  salesAccess,
  salesMonth,
  salesTeam,
  saveKpiFile,
  shiftMonth,
  syncGoalLinks,
  todayMsk,
  toEntry,
  toPlan,
  monthCoverage,
  type EntryDbRow,
  type SalesAccess,
  type SalesFn,
  type SalesPersonRow,
} from '../services/sales';
import { readXlsx, writeXlsx } from '../services/xlsx';
import { receive } from './files';

const FILE_BYTES = 20 * 1024 * 1024;

const planSchema = z.object({
  user_id: z.string().max(40),
  month: z.string().max(10),
  name: z.unknown().optional(),
  unit: z.unknown().optional(),
  plan: z.unknown().optional(),
  bonus: z.unknown().optional(),
  fact: z.unknown().optional(),
  fact_rule: z.unknown().optional(),
  payout_rule: z.unknown().optional(),
  description: z.string().max(2000).nullable().optional(),
});
const patchPlanSchema = planSchema.omit({ user_id: true, month: true });

const entrySchema = z.object({
  user_id: z.string().max(40).optional(),
  plan_id: z.string().max(40).nullable().optional(),
  product: z.unknown().optional(),
  client: z.unknown().optional(),
  quantity: z.unknown().optional(),
  amount: z.unknown().optional(),
  sold_on: z.unknown().optional(),
  note: z.unknown().optional(),
});

const mappingSchema = z.object(Object.fromEntries(ENTRY_FIELDS.map((f) => [f, z.number().int().nullable().optional()])) as Record<(typeof ENTRY_FIELDS)[number], z.ZodOptional<z.ZodNullable<z.ZodNumber>>>);

const listSchema = z.object({
  kind: z.enum(['key', 'merge']),
  text: z.string().max(200_000).optional(),
  patterns: z.array(z.string().max(1000)).max(SALES_LIMITS.listPatterns).optional(),
  replace: z.boolean().optional(),
});

const aliasSchema = z.object({ name: z.string().max(255), user_id: z.string().max(40) });
const linkSchema = z.object({ metric_id: z.string().max(40), measure: z.enum(['revenue', 'quantity', 'clients']), unit_id: z.string().max(40).nullable().optional() });

const VALIDATION = 'Не удалось сохранить показатель';

/** Ошибку разбора файла показываем как есть — человек поправит файл. */
function fileError(e: unknown): never {
  if (e instanceof SalesFileError) throw invalid(e.message, { file: e.message });
  throw e;
}

const ext = (name: string) => name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';

/** Текст CSV: UTF-8, а если в нём битые символы — Windows-1251 (выгрузки из 1С и Excel). */
function decodeText(buf: Buffer): string {
  const utf = buf.toString('utf8').replace(/^﻿/, '');
  return utf.includes('�') ? new TextDecoder('windows-1251').decode(buf) : utf;
}

/** Листы Excel; CSV и TXT — одним листом. */
function readSheets(buf: Buffer, name: string): SheetData[] {
  const e = ext(name);
  if (e === '.csv' || e === '.txt') {
    const t = csvTable(decodeText(buf));
    return [{ name: name.replace(/\.[^.]+$/, ''), rows: [t.headers, ...t.rows], levels: [] }];
  }
  if (e && !['.xlsx', '.xlsm', '.xls'].includes(e)) throw new SalesFileError('Загрузите файл Excel (.xlsx) или CSV');
  return readXlsx(buf);
}

/**
 * Продажи и личный KPI с выплатами: `/api/v1/sales`. План сотрудника на
 * месяц с правилами факта и выплаты, отчёты 1С, файлы KPI, продажи из Excel,
 * списки клиентов, сопоставление менеджеров и KPI целей из продаж.
 */
export function salesRouter(db: Db, media: MediaCtx): Router {
  const r = Router();
  const { store, now } = media;
  const upload = receive(store, 'file', { maxBytes: Math.min(store.maxBytes, FILE_BYTES) });

  async function withFile<T>(req: Request, res: Response, fn: (file: Express.Multer.File, buf: Buffer) => Promise<T>): Promise<T> {
    const file = await upload(req, res);
    try {
      return await fn(file, await fs.readFile(file.path));
    } catch (e) {
      fileError(e);
    } finally {
      await fs.rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  const monthOf = (v: unknown) => {
    if (v === undefined || v === '') return todayMsk(now()).slice(0, 7);
    if (!isMonth(v)) throw invalid('Некорректный месяц', { month: 'Месяц в формате ГГГГ-ММ' });
    return v;
  };

  async function personOf(q: Queryable, acc: SalesAccess, id: unknown): Promise<SalesPersonRow> {
    const userId = id === undefined || id === '' ? acc.actor.id : String(id);
    if (!isUuid(userId)) throw notFound('Сотрудник не найден');
    const p = (await loadPeople(q, acc.actor.company_id)).find((x) => x.id === userId);
    if (!p || !canView(acc, p.id)) throw notFound('Сотрудник не найден');
    return p;
  }

  /** Человек, которому что-то ставят: должен быть в компании и в области функции. */
  async function targetOf(q: Queryable, acc: SalesAccess, id: unknown, fn: SalesFn, message: string): Promise<SalesPersonRow> {
    const userId = typeof id === 'string' && id ? id : acc.actor.id;
    if (!isUuid(userId)) throw invalid(message, { user_id: 'Сотрудник не найден' });
    const p = (await loadPeople(q, acc.actor.company_id)).find((x) => x.id === userId);
    if (!p || p.role === 'observer') throw invalid(message, { user_id: 'Сотрудник не найден' });
    if (!canFor(acc, fn, p.id)) throw forbidden(FN_DENIED[fn]);
    return p;
  }

  async function planView(q: Queryable, acc: SalesAccess, id: string) {
    const row = await loadPlan(q, acc.actor.company_id, id);
    if (!row || !canView(acc, row.user_id)) throw notFound('Показатель не найден');
    const cov = await monthCoverage(q, acc.actor.company_id, row.month);
    return toPlan(row, cov, todayMsk(now()));
  }

  // ------------------------------------------------------------ экраны

  r.get('/month', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    const who = await personOf(db, acc, req.query.user);
    res.json({ data: await salesMonth(db, acc, who, monthOf(req.query.month), now()) });
  });

  r.get('/team', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    if (!canSeeTeam(acc)) throw forbidden('Команду видит руководитель или тот, кому включены функции продаж');
    res.json({ data: await salesTeam(db, acc, monthOf(req.query.month), now()) });
  });

  /** Кому человек может применить функцию: поставить план, загрузить файл KPI, сопоставить менеджера. */
  r.get('/people', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    const fn = z.enum(['sales_assign', 'sales_files', 'sales_reports']).safeParse(req.query.for ?? 'sales_assign');
    if (!fn.success) throw invalid('Некорректный запрос', { for: 'Неизвестная функция' });
    res.json({ data: peopleFor(acc, await loadPeople(db, acc.actor.company_id), fn.data) });
  });

  /** Страница сотрудника: месяц, задачи, что продаёт и записанные продажи. */
  r.get('/people/:id', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    const who = await personOf(db, acc, idParam(req.params.id));
    const month = monthOf(req.query.month);
    const companyId = acc.actor.company_id;
    const today = todayMsk(now());
    const [m, tasks, products, entries] = await Promise.all([
      salesMonth(db, acc, who, month, now()),
      db.query<{ open: number; overdue: number; blocked: number; done_30d: number }>(
        `SELECT count(*) FILTER (WHERE status NOT IN ('done', 'cancelled'))::int AS open,
                count(*) FILTER (WHERE status NOT IN ('done', 'cancelled') AND due_at < $3::date)::int AS overdue,
                count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
                count(*) FILTER (WHERE status = 'done' AND done_at >= $4)::int AS done_30d
           FROM tasks WHERE company_id = $1 AND assignee_id = $2`,
        [companyId, who.id, today, new Date(now().getTime() - 30 * 86_400_000).toISOString()],
      ),
      db.query<{ name: string; quantity: number; revenue: number }>(
        `SELECT name, sum(quantity) AS quantity, sum(revenue) AS revenue FROM (
           SELECT l.name, l.quantity, l.revenue FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id
            WHERE r.company_id = $1 AND l.user_id = $2 AND r.month = $3::date AND l.kind = 'item'
           UNION ALL
           SELECT product, quantity, amount FROM sales_entries WHERE company_id = $1 AND user_id = $2 AND sold_on BETWEEN $3::date AND $4::date
         ) s GROUP BY name ORDER BY sum(revenue) DESC, sum(quantity) DESC, name LIMIT 8`,
        [companyId, who.id, monthDate(month), monthLastDay(month)],
      ),
      db.query<EntryDbRow>(
        `SELECT ${ENTRY_COLS} FROM sales_entries e WHERE e.company_id = $1 AND e.user_id = $2 AND e.sold_on BETWEEN $3::date AND $4::date ORDER BY e.sold_on DESC, e.created_at DESC LIMIT 200`,
        [companyId, who.id, monthDate(month), monthLastDay(month)],
      ),
    ]);
    const t = tasks.rows[0]!;
    const data: SalesEmployee = {
      month: m,
      tasks: { open: Number(t.open), overdue: Number(t.overdue), blocked: Number(t.blocked), done_30d: Number(t.done_30d) },
      top_products: products.rows.map((p) => ({ name: p.name, quantity: Number(p.quantity), revenue: Number(p.revenue) })),
      entries: entries.rows.map((e) => toEntry(acc, e)),
    };
    res.json({ data });
  });

  // ------------------------------------------------------------ план

  r.post('/plans', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(planSchema, req.body);
    const month = isMonth(body.month) ? body.month : null;
    const data = await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      const who = await targetOf(q, acc, body.user_id, 'sales_assign', VALIDATION);
      const { input, errors } = validatePlanInput({
        ...body,
        bonus: body.bonus ?? 0,
        fact_rule: body.fact_rule ?? { type: 'manual' },
        payout_rule: body.payout_rule ?? { type: 'none' },
      });
      if (!month) errors.month = 'Выберите месяц';
      if (input.fact_rule && input.fact_rule.type !== 'manual' && body.fact !== undefined) errors.fact = 'Факт этого показателя считается по отчётам 1С';
      if (Object.keys(errors).length) throw invalid(VALIDATION, errors);
      const { rows: cnt } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM sales_plans WHERE company_id = $1 AND user_id = $2 AND month = $3::date`, [
        actor.company_id,
        who.id,
        monthDate(month!),
      ]);
      if (Number(cnt[0]!.n) >= 50) throw invalid(VALIDATION, { name: 'В плане на месяц — не больше 50 показателей' });
      const payout = input.payout_rule!;
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO sales_plans (company_id, user_id, month, name, kind, unit, plan, fact, bonus, fact_rule, payout_rule, source, description, sort_order, fact_updated_at, created_by, created_at, updated_at)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, 'manual', $12,
                 (SELECT coalesce(max(sort_order), -1) + 1 FROM sales_plans WHERE company_id = $1 AND user_id = $2 AND month = $3::date AND sort_order >= 0),
                 $13, $14, $15, $15) RETURNING id`,
        [
          actor.company_id,
          who.id,
          monthDate(month!),
          input.name,
          salesKindOf(input.name!, payout.type === 'fixed'),
          input.unit,
          input.plan,
          input.fact ?? 0,
          input.bonus ?? 0,
          JSON.stringify(input.fact_rule),
          JSON.stringify(payout),
          body.description?.trim() || null,
          input.fact !== undefined ? now().toISOString() : null,
          actor.id,
          now().toISOString(),
        ],
      );
      const id = rows[0]!.id;
      await recalcUserMonth(q, actor.company_id, who.id, month!, await loadLists(q, actor.company_id), now());
      return planView(q, acc, id);
    });
    res.status(201).json({ data });
  });

  /**
   * Правка показателя. Тот, кто ставит план, меняет всё; у показателя из
   * файла KPI — только правило выплаты (оно сохранится при новой загрузке).
   * Сотрудник сам отмечает факт своего показателя «вручную».
   */
  r.patch('/plans/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(patchPlanSchema, req.body);
    const data = await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      const row = await loadPlan(q, actor.company_id, id);
      if (!row || !canView(acc, row.user_id)) throw notFound('Показатель не найден');
      const fields = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
      if (!fields.length) return planView(q, acc, id);
      const factRule = json<{ type: string }>(row.fact_rule);
      const manager = canFor(acc, 'sales_assign', row.user_id);
      if (!manager) {
        const own = row.user_id === actor.id && actor.role !== 'observer' && row.source === 'manual' && factRule.type === 'manual';
        if (!own || fields.some((f) => f !== 'fact')) throw forbidden('План и правила выплат меняет руководитель — вы можете отмечать факт своих показателей «вручную»');
      }
      if (row.source === 'file' && fields.some((f) => f !== 'payout_rule')) {
        throw invalid(VALIDATION, { _: 'Показатель из файла KPI меняется новой загрузкой файла — здесь можно поправить только правило выплаты' });
      }
      const { input, errors } = validatePlanInput(body as Record<string, unknown>, { partial: true });
      const rule: FactRule = input.fact_rule ?? json<FactRule>(row.fact_rule);
      if (input.fact !== undefined && rule.type !== 'manual') errors.fact = 'Факт этого показателя считается по отчётам 1С';
      const plan = input.plan ?? Number(row.plan);
      const payout: PayoutRule = input.payout_rule ?? json<PayoutRule>(row.payout_rule);
      if (!errors.plan && payout.type === 'threshold' && !(plan > 0) && row.source === 'manual') errors.plan = 'Для выплаты по порогам нужен план больше нуля';
      const unit = input.unit ?? row.unit;
      if (!errors.unit && rule.type === 'items' && unit !== 'items') errors.unit = 'Для позиций единица — «Позиции»';
      if (Object.keys(errors).length) throw invalid(VALIDATION, errors);
      const name = input.name ?? row.name;
      await q.query(
        `UPDATE sales_plans SET name = $2, unit = $3, plan = $4, bonus = $5, fact = $6, fact_rule = $7::jsonb, payout_rule = $8::jsonb,
                description = $9, kind = $10, rules_custom = rules_custom OR $11, fact_updated_at = CASE WHEN $12 THEN $13::timestamptz ELSE fact_updated_at END, updated_at = $13
          WHERE id = $1`,
        [
          id,
          name,
          unit,
          plan,
          input.bonus ?? Number(row.bonus),
          rule.type !== 'manual' ? Number(row.fact) : (input.fact ?? Number(row.fact)),
          JSON.stringify(rule),
          JSON.stringify(payout),
          body.description !== undefined ? body.description?.trim() || null : row.description,
          row.source === 'file' ? row.kind : salesKindOf(name, payout.type === 'fixed'),
          input.payout_rule !== undefined || input.fact_rule !== undefined,
          input.fact !== undefined,
          now().toISOString(),
        ],
      );
      // Правило факта сменилось на ручное — подробности отчёта больше не нужны.
      if (rule.type === 'manual' && factRule.type !== 'manual') await q.query(`UPDATE sales_plans SET fact_details = NULL WHERE id = $1`, [id]);
      await recalcUserMonth(q, actor.company_id, row.user_id, row.month, await loadLists(q, actor.company_id), now());
      return planView(q, acc, id);
    });
    res.json({ data });
  });

  r.delete('/plans/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      const row = await loadPlan(q, actor.company_id, id);
      if (!row || !canView(acc, row.user_id)) throw notFound('Показатель не найден');
      if (!canFor(acc, 'sales_assign', row.user_id)) throw forbidden(FN_DENIED.sales_assign);
      await q.query(`DELETE FROM sales_plans WHERE id = $1`, [id]);
    });
    res.status(204).end();
  });

  // ------------------------------------------------------------ записи о продажах

  r.get('/entries', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    const who = await personOf(db, acc, req.query.user);
    const month = monthOf(req.query.month);
    const { rows } = await db.query<EntryDbRow>(
      `SELECT ${ENTRY_COLS} FROM sales_entries e WHERE e.company_id = $1 AND e.user_id = $2 AND e.sold_on BETWEEN $3::date AND $4::date ORDER BY e.sold_on DESC, e.created_at DESC LIMIT 500`,
      [acc.actor.company_id, who.id, monthDate(month), monthLastDay(month)],
    );
    res.json({ data: rows.map((e) => toEntry(acc, e)) });
  });

  /** Показатель, к факту которого прибавляются продажи: «вручную», того же сотрудника и месяца. */
  async function entryPlan(q: Queryable, companyId: string, planId: string | null | undefined, userId: string, days: string[]) {
    if (!planId) return null;
    const row = isUuid(planId) ? await loadPlan(q, companyId, planId) : null;
    const msg = 'Не удалось записать продажу';
    if (!row || row.user_id !== userId) throw invalid(msg, { plan_id: 'Показатель не найден' });
    if (row.source !== 'manual' || json<{ type: string }>(row.fact_rule).type !== 'manual') throw invalid(msg, { plan_id: 'Факт этого показателя считается сам — по отчётам или из файла KPI' });
    if (row.unit === 'percent' || row.unit === 'items') throw invalid(msg, { plan_id: 'К этому показателю продажи не прибавляются' });
    if (days.some((d) => d.slice(0, 7) !== row.month)) throw invalid(msg, { sold_on: 'Дата продажи — в месяце показателя' });
    return row;
  }

  async function addToPlanFact(q: Queryable, planId: string, delta: number) {
    if (!delta) return;
    await q.query(`UPDATE sales_plans SET fact = greatest(0, fact + $2), fact_updated_at = $3, updated_at = $3 WHERE id = $1`, [planId, Math.round(delta * 100) / 100, now().toISOString()]);
  }

  r.post('/entries', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(entrySchema, req.body);
    const data = await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      const who = await entryTarget(q, acc, body.user_id);
      const { entry, errors } = validateSaleEntry(body as Record<string, unknown>, todayMsk(now()));
      if (!entry) throw invalid('Не удалось записать продажу', errors);
      const plan = await entryPlan(q, actor.company_id, body.plan_id, who.id, [entry.sold_on]);
      const { rows } = await q.query<EntryDbRow>(
        `INSERT INTO sales_entries AS e (company_id, user_id, plan_id, product, client, quantity, amount, sold_on, note, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${ENTRY_COLS}`,
        [actor.company_id, who.id, plan?.id ?? null, entry.product, entry.client, entry.quantity, entry.amount, entry.sold_on, entry.note, actor.id, now().toISOString()],
      );
      if (plan) await addToPlanFact(q, plan.id, entryContribution(plan.unit, entry));
      return toEntry(acc, rows[0]!);
    });
    res.status(201).json({ data });
  });

  /** Записывает продажу себе — любой сотрудник; другому — тот, кто ставит ему план. */
  async function entryTarget(q: Queryable, acc: SalesAccess, userId: string | undefined): Promise<SalesPersonRow> {
    if (acc.actor.role === 'observer') throw forbidden('Наблюдатель не записывает продажи');
    if (!userId || userId === acc.actor.id) return (await loadPeople(q, acc.actor.company_id)).find((p) => p.id === acc.actor.id)!;
    return targetOf(q, acc, userId, 'sales_assign', 'Не удалось записать продажу');
  }

  r.delete('/entries/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      const { rows } = await q.query<EntryDbRow>(`SELECT ${ENTRY_COLS} FROM sales_entries e WHERE e.id = $1 AND e.company_id = $2`, [id, actor.company_id]);
      const e = rows[0];
      if (!e || !canView(acc, e.user_id)) throw notFound('Продажа не найдена');
      if (!toEntry(acc, e).can_delete) throw forbidden('Удалить продажу может тот, кто её записал, или руководитель');
      await q.query(`DELETE FROM sales_entries WHERE id = $1`, [id]);
      if (e.plan_id) {
        const plan = await loadPlan(q, actor.company_id, e.plan_id);
        if (plan) await addToPlanFact(q, plan.id, -entryContribution(plan.unit, { amount: Number(e.amount), quantity: Number(e.quantity) }));
      }
    });
    res.status(204).end();
  });

  // ------------------------------------------------------------ продажи из Excel

  interface ImportRow {
    id: string;
    user_id: string;
    file_name: string;
    headers: string[];
    rows: unknown[][];
    lines: number[];
    total_rows: number;
    status: string;
  }

  function preview(imp: ImportRow, mapping: EntryMapping): SalesImportPreview {
    const { entries, errors } = entriesFromRows(json(imp.rows), mapping, todayMsk(now()), json(imp.lines));
    const headers = json<string[]>(imp.headers);
    return {
      id: imp.id,
      file_name: imp.file_name,
      headers,
      mapping,
      sample: json<unknown[][]>(imp.rows)
        .slice(0, 5)
        .map((r) => headers.map((_, i) => cellText(r[i]))),
      total_rows: imp.total_rows,
      valid: entries.length,
      amount: Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100,
      errors: errors.slice(0, 20),
    };
  }

  async function loadImport(q: Queryable, acc: SalesAccess, id: string): Promise<ImportRow> {
    const { rows } = await q.query<ImportRow>(
      `SELECT id, user_id, file_name, headers, rows, lines, total_rows, status FROM sales_imports WHERE id = $1 AND company_id = $2 AND created_by = $3`,
      [id, acc.actor.company_id, acc.actor.id],
    );
    const imp = rows[0];
    if (!imp) throw notFound('Загрузка не найдена');
    if (imp.status !== 'pending') throw conflict(imp.status === 'done' ? 'Эти продажи уже записаны' : 'Загрузка отменена — загрузите файл заново');
    return imp;
  }

  /** Шаг 1: файл → таблица и предложенные колонки. Ничего не записывается, пока человек не подтвердит. */
  r.post('/entries/import', async (req, res) => {
    const actor = actorOf(req);
    const data = await withFile(req, res, async (file, buf) => {
      const acc = await salesAccess(db, actor);
      const who = await entryTarget(db, acc, typeof req.body?.user_id === 'string' && req.body.user_id ? req.body.user_id : undefined);
      let table: EntryTable;
      const e = ext(file.originalname);
      if (e === '.csv' || e === '.txt') table = csvTable(decodeText(buf));
      else {
        const sheets = readSheets(buf, file.originalname);
        table = sheets.map((s) => sheetTable(s.rows)).find((t) => t.headers.length && t.rows.length) ?? { headers: [], rows: [], lines: [] };
      }
      if (!table.headers.length || !table.rows.length) throw new SalesFileError('В файле не нашли таблицу: нужна строка с названиями колонок и строки продаж под ней');
      const rows = table.rows.slice(0, SALES_LIMITS.importRows + 1);
      const { rows: ins } = await db.query<ImportRow>(
        `INSERT INTO sales_imports (company_id, user_id, file_name, headers, rows, lines, total_rows, created_by, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9) RETURNING id, user_id, file_name, headers, rows, lines, total_rows, status`,
        [actor.company_id, who.id, file.originalname.slice(0, 255), JSON.stringify(table.headers), JSON.stringify(rows), JSON.stringify(table.lines.slice(0, rows.length)), table.rows.length, actor.id, now().toISOString()],
      );
      return preview(ins[0]!, guessEntryColumns(table.headers));
    });
    res.status(201).json({ data });
  });

  /** Шаг 2: колонки выбраны — dry_run показывает итог, иначе продажи записываются. */
  r.post('/entries/import/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const body = parseBody(z.object({ mapping: mappingSchema, plan_id: z.string().max(40).nullable().optional(), dry_run: z.boolean().optional() }), req.body);
    const data = await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      const imp = await loadImport(q, acc, id);
      const headers = json<string[]>(imp.headers);
      const { mapping, error } = checkEntryMapping(body.mapping, headers.length);
      if (!mapping) throw invalid('Не удалось записать продажи', { mapping: error! });
      const p = preview(imp, mapping);
      if (body.dry_run) return { preview: p, imported: 0, skipped: 0 };
      const { entries, errors } = entriesFromRows(json(imp.rows), mapping, todayMsk(now()), json(imp.lines));
      if (!entries.length) throw invalid('Не удалось записать продажи', { mapping: errors[0] ? `Строка ${errors[0].row}: ${errors[0].message}` : 'В файле нет строк с продажами' });
      const plan = await entryPlan(q, actor.company_id, body.plan_id, imp.user_id, entries.map((e) => e.sold_on));
      const cols: unknown[][] = Array.from({ length: 7 }, () => []);
      for (const e of entries) [e.product, e.client, e.quantity, e.amount, e.sold_on, e.note, null].forEach((v, i) => cols[i]!.push(v));
      await q.query(
        `INSERT INTO sales_entries (company_id, user_id, plan_id, import_id, product, client, quantity, amount, sold_on, note, created_by, created_at)
         SELECT $1, $2, $3, $4, product, client, quantity, amount, sold_on, note, $5, $6
           FROM unnest($7::text[], $8::text[], $9::numeric[], $10::numeric[], $11::date[], $12::text[]) AS t(product, client, quantity, amount, sold_on, note)`,
        [actor.company_id, imp.user_id, plan?.id ?? null, imp.id, actor.id, now().toISOString(), ...cols.slice(0, 6)],
      );
      if (plan) await addToPlanFact(q, plan.id, entries.reduce((s, e) => s + entryContribution(plan.unit, e), 0));
      await q.query(`UPDATE sales_imports SET status = 'done', imported = $2, skipped = $3, finished_at = $4, rows = NULL WHERE id = $1`, [id, entries.length, errors.length, now().toISOString()]);
      return { preview: p, imported: entries.length, skipped: errors.length };
    });
    res.json({ data });
  });

  r.delete('/entries/import/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const acc = await salesAccess(db, actor);
    await loadImport(db, acc, id);
    await db.query(`UPDATE sales_imports SET status = 'cancelled', rows = NULL, finished_at = $2 WHERE id = $1`, [id, now().toISOString()]);
    res.status(204).end();
  });

  // ------------------------------------------------------------ отчёты 1С

  r.post('/reports', async (req, res) => {
    const actor = actorOf(req);
    const data = await withFile(req, res, async (file, buf) => {
      const acc = await salesAccess(db, actor);
      if (!hasFn(acc, 'sales_reports')) throw forbidden(FN_DENIED.sales_reports);
      const sheet = pickReportSheet(readSheets(buf, file.originalname));
      if (!sheet) throw new SalesFileError('Файл пустой');
      const report = parseSalesReport(sheet);
      return db.tx((q) => importSalesReport(q, acc, { name: file.originalname, report }, now()));
    });
    res.status(201).json({ data });
  });

  r.get('/reports', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    if (!hasFn(acc, 'sales_reports')) throw forbidden(FN_DENIED.sales_reports);
    const month = req.query.month === undefined || req.query.month === '' ? undefined : monthOf(req.query.month);
    res.json({ data: await reportInfos(db, acc, { month }) });
  });

  r.delete('/reports/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const result = await db.tx(async (q) => deleteSalesReport(q, await salesAccess(q, actor), id, now()));
    if (result === 'not_found') throw notFound('Отчёт не найден');
    if (result === 'forbidden') throw forbidden('Этот отчёт загрузил другой руководитель, и в нём есть не ваши сотрудники');
    res.status(204).end();
  });

  // ------------------------------------------------------------ сопоставление менеджеров

  r.get('/unmatched', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    if (!hasFn(acc, 'sales_reports')) throw forbidden(FN_DENIED.sales_reports);
    const all = acc.admin || !!acc.scopes.sales_reports?.all;
    const { rows } = await db.query<SalesUnmatched>(
      `SELECT min(l.manager_name) AS name, coalesce(sum(l.revenue) FILTER (WHERE l.kind = 'total'), 0) AS revenue, to_char(max(r.period_end), 'YYYY-MM-DD') AS last_date
         FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id
        WHERE r.company_id = $1 AND l.user_id IS NULL AND (r.uploaded_by = $2 OR $3::boolean) AND r.month >= $4::date
        GROUP BY l.manager_key ORDER BY 2 DESC, 1`,
      [acc.actor.company_id, acc.actor.id, all, monthDate(shiftMonth(todayMsk(now()).slice(0, 7), -12))],
    );
    res.json({ data: rows.map((x) => ({ ...x, revenue: Number(x.revenue) })) });
  });

  r.get('/aliases', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    if (!hasFn(acc, 'sales_reports')) throw forbidden(FN_DENIED.sales_reports);
    const people = new Map((await loadPeople(db, acc.actor.company_id)).map((p) => [p.id, p]));
    const { rows } = await db.query<{ id: string; name: string; user_id: string; created_at: string }>(
      `SELECT id, name, user_id, created_at FROM sales_name_aliases WHERE company_id = $1 ORDER BY name`,
      [acc.actor.company_id],
    );
    const data: SalesAlias[] = rows
      .filter((a) => people.has(a.user_id) && canFor(acc, 'sales_reports', a.user_id))
      .map((a) => ({ id: a.id, name: a.name, user: person(people.get(a.user_id)!), created_at: a.created_at }));
    res.json({ data });
  });

  /** «Этот менеджер из 1С — вот этот сотрудник»: строки отчётов переходят к нему, факт пересчитывается. */
  r.post('/aliases', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(aliasSchema, req.body);
    const data = await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      if (!hasFn(acc, 'sales_reports')) throw forbidden(FN_DENIED.sales_reports);
      const name = body.name.replace(/\s+/g, ' ').trim();
      const key = salesKey(name);
      if (!key) throw invalid('Не удалось сопоставить', { name: 'Укажите имя из отчёта' });
      const who = await targetOf(q, acc, body.user_id, 'sales_reports', 'Не удалось сопоставить');
      await q.query(
        `INSERT INTO sales_name_aliases (company_id, name_key, name, user_id, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (company_id, name_key) DO UPDATE SET name = EXCLUDED.name, user_id = EXCLUDED.user_id, created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at`,
        [actor.company_id, key, name.slice(0, 255), who.id, actor.id, now().toISOString()],
      );
      // Строки без сотрудника и строки тех, за кого отвечает этот человек; прежний владелец тоже пересчитывается.
      const scope = acc.scopes.sales_reports;
      const all = acc.admin || !!scope?.all;
      const { rows: candidates } = await q.query<{ id: number; user_id: string | null; month: string }>(
        `SELECT l.id, l.user_id, to_char(r.month, 'YYYY-MM') AS month FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id
          WHERE r.company_id = $1 AND l.manager_key = $2 AND l.user_id IS DISTINCT FROM $3`,
        [actor.company_id, key, who.id],
      );
      const moving = candidates.filter((l) => l.user_id == null || all || canFor(acc, 'sales_reports', l.user_id));
      if (moving.length) await q.query(`UPDATE sales_report_lines SET user_id = $1 WHERE id = ANY($2::bigint[])`, [who.id, moving.map((l) => l.id)]);
      const months = [...new Set(moving.map((l) => l.month))];
      const plans = await recalcPairs(
        q,
        actor.company_id,
        [...months.map((month) => ({ user_id: who.id, month })), ...moving.filter((l) => l.user_id).map((l) => ({ user_id: l.user_id!, month: l.month }))],
        now(),
      );
      const goals = await syncGoalLinks(q, actor.company_id, months, now());
      return { months: months.length, lines: moving.length, plans_updated: plans, goals_updated: goals };
    });
    res.json({ data });
  });

  r.delete('/aliases/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      if (!hasFn(acc, 'sales_reports')) throw forbidden(FN_DENIED.sales_reports);
      const { rows } = await q.query<{ name_key: string; user_id: string }>(`SELECT name_key, user_id FROM sales_name_aliases WHERE id = $1 AND company_id = $2`, [id, actor.company_id]);
      const a = rows[0];
      if (!a) throw notFound('Сопоставление не найдено');
      if (!canFor(acc, 'sales_reports', a.user_id)) throw forbidden('Это сопоставление сделано для чужого сотрудника');
      await q.query(`DELETE FROM sales_name_aliases WHERE id = $1`, [id]);
      // Строки, перенесённые по этому сопоставлению, снова ждут сотрудника.
      const { rows: moved } = await q.query<{ month: string }>(
        `UPDATE sales_report_lines l SET user_id = NULL FROM sales_reports r
          WHERE r.id = l.report_id AND r.company_id = $1 AND l.manager_key = $2 AND l.user_id = $3
          RETURNING to_char(r.month, 'YYYY-MM') AS month`,
        [actor.company_id, a.name_key, a.user_id],
      );
      const months = [...new Set(moved.map((m) => m.month))];
      await recalcPairs(q, actor.company_id, months.map((month) => ({ user_id: a.user_id, month })), now());
      await syncGoalLinks(q, actor.company_id, months, now());
    });
    res.status(204).end();
  });

  // ------------------------------------------------------------ клиенты, группы, списки

  /** Чьи строки отчётов показывать в справочниках: вся компания или сотрудники в области функций. */
  async function lineScope(q: Queryable, acc: SalesAccess): Promise<string[] | null> {
    if (acc.admin || (['sales_reports', 'sales_files', 'sales_assign'] as SalesFn[]).some((f) => acc.scopes[f]?.all)) return null;
    const people = await loadPeople(q, acc.actor.company_id);
    return people.filter((p) => (['sales_reports', 'sales_files', 'sales_assign'] as SalesFn[]).some((f) => canFor(acc, f, p.id))).map((p) => p.id);
  }

  const anySalesFn = (acc: SalesAccess) => hasFn(acc, 'sales_reports') || hasFn(acc, 'sales_files') || hasFn(acc, 'sales_assign');

  r.get('/clients', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    if (!anySalesFn(acc)) throw forbidden('Клиентов из отчётов видит тот, кому включены функции продаж');
    const month = monthOf(req.query.month);
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const users = await lineScope(db, acc);
    const { rows } = await db.query<{ name: string; revenue: number | null; managers: string[]; key_hint: boolean }>(
      `SELECT l.client_name AS name, sum(l.revenue) FILTER (WHERE l.kind = 'total') AS revenue, array_agg(DISTINCT l.manager_name) AS managers,
              bool_or(l.kind <> 'total' AND l.name ~* 'есть\\s*по[вд]од') AS key_hint
         FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id
        WHERE r.company_id = $1 AND r.month = $2::date AND ($3 = '' OR l.client_name ILIKE '%' || $3 || '%') ${users ? 'AND l.user_id = ANY($4::uuid[])' : ''}
        GROUP BY l.client_name ORDER BY 2 DESC NULLS LAST, 1 LIMIT 1000`,
      users ? [acc.actor.company_id, monthDate(month), search, users] : [acc.actor.company_id, monthDate(month), search],
    );
    const lists = await loadLists(db, acc.actor.company_id);
    res.json({
      data: rows.map((c) => ({
        name: c.name,
        revenue: Number(c.revenue ?? 0),
        managers: c.managers,
        key: lists.key.find((p) => matchesClient(c.name, p)) ?? null,
        merge: lists.merge.find((p) => matchesClient(c.name, p)) ?? null,
        key_hint: !!c.key_hint,
      })),
    });
  });

  r.get('/groups', async (req, res) => {
    const acc = await salesAccess(db, actorOf(req));
    if (!anySalesFn(acc)) throw forbidden('Группы товаров из отчётов видит тот, кому включены функции продаж');
    const month = monthOf(req.query.month);
    const users = await lineScope(db, acc);
    const { rows } = await db.query<{ group_path: string; name: string; depth: number; revenue: number }>(
      `SELECT l.group_path, l.name, min(l.depth)::int AS depth, sum(l.revenue) AS revenue
         FROM sales_report_lines l JOIN sales_reports r ON r.id = l.report_id
        WHERE r.company_id = $1 AND r.month = $2::date AND l.kind = 'group' ${users ? 'AND l.user_id = ANY($3::uuid[])' : ''}
        GROUP BY l.group_path, l.name
        ORDER BY CASE WHEN l.group_path = '' THEN l.name ELSE l.group_path || '${PATH_SEP}' || l.name END LIMIT 2000`,
      users ? [acc.actor.company_id, monthDate(month), users] : [acc.actor.company_id, monthDate(month)],
    );
    res.json({ data: rows.map((g) => ({ path: g.group_path ? `${g.group_path}${PATH_SEP}${g.name}` : g.name, name: g.name, depth: g.depth, revenue: Number(g.revenue) })) });
  });

  async function listsView(q: Queryable, companyId: string) {
    const { rows } = await q.query<SalesClientPattern>(
      `SELECT l.id, l.kind, l.pattern, u.display_name AS created_by_name, l.created_at FROM sales_client_lists l LEFT JOIN users u ON u.id = l.created_by
        WHERE l.company_id = $1 ORDER BY l.pattern`,
      [companyId],
    );
    return { key: rows.filter((r) => r.kind === 'key'), merge: rows.filter((r) => r.kind === 'merge') };
  }

  /** Списки нужны всем, кто смотрит продажи (что такое «ключевой клиент»), менять — тем, кто загружает отчёты. */
  r.get('/lists', async (req, res) => {
    const actor = actorOf(req);
    res.json({ data: await listsView(db, actor.company_id) });
  });

  async function addPatterns(acc: SalesAccess, kind: 'key' | 'merge', patterns: string[], skippedBefore: number, replace: boolean) {
    return db.tx(async (q) => {
      const companyId = acc.actor.company_id;
      if (replace) await q.query(`DELETE FROM sales_client_lists WHERE company_id = $1 AND kind = $2`, [companyId, kind]);
      const { rows: cnt } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM sales_client_lists WHERE company_id = $1`, [companyId]);
      if (Number(cnt[0]!.n) + patterns.length > SALES_LIMITS.listPatterns) {
        throw invalid('Не удалось пополнить список', { text: `В списках клиентов — не больше ${SALES_LIMITS.listPatterns} строк` });
      }
      const { rows: added } = await q.query<{ id: string }>(
        `INSERT INTO sales_client_lists (company_id, kind, pattern, pattern_key, created_by, created_at)
         SELECT $1, $2, p, k, $3, $4 FROM unnest($5::text[], $6::text[]) AS t(p, k)
         ON CONFLICT (company_id, kind, pattern_key) DO NOTHING RETURNING id`,
        [companyId, kind, acc.actor.id, now().toISOString(), patterns, patterns.map(salesKey)],
      );
      const pairs = await recentPairs(q, companyId, now());
      const plans = await recalcPairs(q, companyId, pairs, now());
      const goals = await syncGoalLinks(q, companyId, await reportMonths(q, companyId, now()), now());
      return { added: added.length, skipped: skippedBefore + patterns.length - added.length, plans_updated: plans, goals_updated: goals, lists: await listsView(q, companyId) };
    });
  }

  r.post('/lists', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(listSchema, req.body);
    const acc = await salesAccess(db, actor);
    if (!hasFn(acc, 'sales_reports')) throw forbidden(FN_DENIED.sales_reports);
    const { patterns, skipped } = parsePatterns([body.text ?? '', ...(body.patterns ?? [])].join('\n'));
    if (!patterns.length && !body.replace) throw invalid('Не удалось пополнить список', { text: 'Добавьте хотя бы одного клиента — по одному на строку' });
    res.json({ data: await addPatterns(acc, body.kind, patterns, skipped, !!body.replace) });
  });

  /** Список клиентов из файла: первая текстовая ячейка каждой строки, без заголовков. */
  r.post('/lists/file', async (req, res) => {
    const actor = actorOf(req);
    const data = await withFile(req, res, async (file, buf) => {
      const acc = await salesAccess(db, actor);
      if (!hasFn(acc, 'sales_reports')) throw forbidden(FN_DENIED.sales_reports);
      const kind = req.body?.kind === 'merge' ? 'merge' : req.body?.kind === 'key' ? 'key' : null;
      if (!kind) throw invalid('Не удалось пополнить список', { kind: 'Выберите список' });
      const names: string[] = [];
      for (const s of readSheets(buf, file.originalname)) {
        for (const row of s.rows) {
          const text = row.map(cellText).find((c) => c && !/^[\d\s.,№%-]+$/.test(c));
          if (text && !/^(клиент|контрагент|наименование|название|точка|тт|адрес|список)/i.test(text)) names.push(text);
        }
      }
      const { patterns, skipped } = parsePatterns(names.join('\n'));
      if (!patterns.length) throw new SalesFileError('В файле не нашли названий клиентов');
      return addPatterns(acc, kind, patterns, skipped, req.body?.replace === 'true' || req.body?.replace === '1');
    });
    res.json({ data });
  });

  r.delete('/lists/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      if (!hasFn(acc, 'sales_reports')) throw forbidden(FN_DENIED.sales_reports);
      const { rows } = await q.query(`DELETE FROM sales_client_lists WHERE id = $1 AND company_id = $2 RETURNING id`, [id, actor.company_id]);
      if (!rows.length) throw notFound('Строка списка не найдена');
      await recalcPairs(q, actor.company_id, await recentPairs(q, actor.company_id, now()), now());
      await syncGoalLinks(q, actor.company_id, await reportMonths(q, actor.company_id, now()), now());
    });
    res.status(204).end();
  });

  // ------------------------------------------------------------ файлы KPI

  /**
   * Файл KPI: dry_run — предпросмотр (кто на листах, месяц, показатели и
   * правила), иначе показатели сохраняются. Один лист — сотрудник из user_id
   * или найденный по имени; несколько листов — каждый по своему имени.
   */
  r.post('/kpi-files', async (req, res) => {
    const actor = actorOf(req);
    const result = await withFile(req, res, async (file, buf) => {
      const acc = await salesAccess(db, actor);
      if (!hasFn(acc, 'sales_files')) throw forbidden(FN_DENIED.sales_files);
      const files = parseKpiSheets(readSheets(buf, file.originalname));
      if (!files.length) throw new SalesFileError('В файле не нашли показателей KPI: нужны строки «план», «факт», «бонус», «к выплате»');
      const people = await loadPeople(db, actor.company_id);
      const allowed = people.filter((p) => p.role !== 'observer' && canFor(acc, 'sales_files', p.id));
      const matches = matchPeople(
        files.map((f) => f.employee),
        allowed.map((p) => ({ id: p.id, name: p.name, email: p.email })),
      );
      const byId = new Map(people.map((p) => [p.id, p]));
      const body = req.body ?? {};
      const forced = typeof body.month === 'string' && body.month ? body.month : null;
      if (forced && !isMonth(forced)) throw invalid('Не удалось загрузить файл KPI', { month: 'Месяц в формате ГГГГ-ММ' });
      const userId = typeof body.user_id === 'string' && body.user_id ? body.user_id : null;
      const groups = await knownGroups(db, actor.company_id);

      if (body.dry_run === '1' || body.dry_run === 'true') {
        const data: KpiFilePreview = {
          sheets: files.map((f) => {
            const m = matches.get(salesKey(f.employee));
            const suggested = m?.user_id ? byId.get(m.user_id) : undefined;
            return {
              sheet: f.sheet,
              employee: f.employee,
              month: f.month,
              suggested_user: suggested ? person(suggested) : null,
              has_results: f.has_results,
              warnings: f.warnings,
              metrics: f.metrics.map((x) => {
                const unit: SalesUnit = kpiMetricUnit(x);
                const payout = defaultRules(x, groups).payout;
                return {
                  name: x.name,
                  kind: x.kind,
                  unit,
                  plan: x.plan,
                  fact: x.fact,
                  bonus: x.bonus,
                  payment: x.payment,
                  percent: kpiMetricPercent(x),
                  rule: ruleText(payout, x.bonus, x.items.length),
                };
              }),
            };
          }),
          people: allowed.map(person),
        };
        return { status: 200, data };
      }

      if (userId && files.length > 1) throw invalid('Не удалось загрузить файл KPI', { user_id: 'В файле несколько листов — сотрудники выбираются по именам на листах' });
      if (userId) {
        const p = byId.get(userId);
        if (!p || p.role === 'observer' || !isUuid(userId)) throw invalid('Не удалось загрузить файл KPI', { user_id: 'Сотрудник не найден' });
        if (!canFor(acc, 'sales_files', userId)) throw forbidden(FN_DENIED.sales_files);
      }
      const results: KpiFileResult[] = [];
      await db.tx(async (q) => {
        for (const f of files) {
          const month = forced ?? f.month ?? todayMsk(now()).slice(0, 7);
          const id = userId ?? matches.get(salesKey(f.employee))?.user_id ?? null;
          const base = { sheet: f.sheet, employee: f.employee, month, created: 0, replaced: 0 };
          if (!id) {
            const amb = matches.get(salesKey(f.employee))?.ambiguous;
            results.push({ ...base, user: null, error: amb ? 'Подходит несколько сотрудников — загрузите лист отдельно, выбрав сотрудника' : 'Сотрудник не найден — загрузите лист отдельно, выбрав сотрудника' });
            continue;
          }
          const p = byId.get(id)!;
          const r = await saveKpiFile(q, acc, { userId: id, month, file: f }, now());
          results.push({ ...base, user: person(p), ...r, error: null });
        }
      });
      if (results.every((x) => x.error)) throw invalid('Не удалось загрузить файл KPI', { user_id: results[0]!.error! });
      return { status: 201, data: { results } };
    });
    res.status(result.status).json({ data: result.data });
  });

  // ------------------------------------------------------------ KPI целей из продаж

  interface LinkDbRow {
    metric_id: string;
    metric_name: string;
    metric_unit: string;
    goal_id: string;
    goal_title: string;
    measure: SalesGoalLink['measure'];
    unit_id: string | null;
    unit_name: string | null;
    last_value: number | null;
    last_month: string | null;
  }

  /** Может ли человек связать KPI с продажами: вносит факт в этот KPI и загружает отчёты там, откуда берутся продажи. */
  async function canLink(q: Queryable, acc: SalesAccess, goalId: string, unitId: string | null): Promise<boolean> {
    if (!hasFn(acc, 'sales_reports')) return false;
    const scope = acc.scopes.sales_reports;
    if (!acc.admin && !scope?.all && (!unitId || !scope?.units.has(unitId))) return false;
    try {
      const { goal, org } = await getVisibleGoal(q, acc.actor, goalId);
      return await canRecordKpi(q, acc.actor, goal, org);
    } catch {
      return false;
    }
  }

  r.get('/goal-links', async (req, res) => {
    const actor = actorOf(req);
    const acc = await salesAccess(db, actor);
    const { rows } = await db.query<LinkDbRow>(
      `SELECT s.metric_id, m.name AS metric_name, m.unit AS metric_unit, g.id AS goal_id, g.title AS goal_title, s.measure, s.unit_id, u.name AS unit_name,
              (SELECT gm.value FROM sales_goal_months gm WHERE gm.metric_id = s.metric_id ORDER BY gm.month DESC LIMIT 1) AS last_value,
              (SELECT to_char(gm.month, 'YYYY-MM') FROM sales_goal_months gm WHERE gm.metric_id = s.metric_id ORDER BY gm.month DESC LIMIT 1) AS last_month
         FROM sales_goal_links s JOIN goal_metrics m ON m.id = s.metric_id JOIN goals g ON g.id = m.goal_id LEFT JOIN org_units u ON u.id = s.unit_id
        WHERE s.company_id = $1 ORDER BY g.title, m.name`,
      [actor.company_id],
    );
    const data: SalesGoalLink[] = [];
    for (const l of rows) {
      try {
        await getVisibleGoal(db, actor, l.goal_id);
      } catch {
        continue;
      }
      data.push({ ...l, last_value: l.last_value == null ? null : Number(l.last_value), can_edit: await canLink(db, acc, l.goal_id, l.unit_id) });
    }
    res.json({ data });
  });

  /** KPI, которые можно заполнять продажами: в рублях или штуках, в целях, где человек вносит факт. */
  r.get('/goal-links/targets', async (req, res) => {
    const actor = actorOf(req);
    const acc = await salesAccess(db, actor);
    if (!hasFn(acc, 'sales_reports')) return res.json({ data: { metrics: [], units: [] } });
    const { rows } = await db.query<{ metric_id: string; metric_name: string; unit: string; goal_id: string; goal_title: string }>(
      `SELECT m.id AS metric_id, m.name AS metric_name, m.unit, g.id AS goal_id, g.title AS goal_title
         FROM goal_metrics m JOIN goals g ON g.id = m.goal_id
        WHERE g.company_id = $1 AND g.status NOT IN ('cancelled', 'completed') AND m.unit IN ('rub', 'count')
        ORDER BY g.title, m.is_primary DESC, m.created_at LIMIT 300`,
      [actor.company_id],
    );
    const metrics = [];
    for (const m of rows) {
      try {
        const { goal, org } = await getVisibleGoal(db, actor, m.goal_id);
        if (await canRecordKpi(db, actor, goal, org)) metrics.push(m);
      } catch {
        /* цель не видна */
      }
    }
    const org = acc.ctx.units.filter((u) => u.status !== 'archived' && (acc.admin || acc.scopes.sales_reports?.all || acc.scopes.sales_reports?.units.has(u.id)));
    res.json({ data: { metrics, units: org.map((u) => ({ id: u.id, name: u.name })), company: acc.admin || !!acc.scopes.sales_reports?.all } });
  });

  r.post('/goal-links', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(linkSchema, req.body);
    const data = await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      const msg = 'Не удалось связать KPI с продажами';
      if (!isUuid(body.metric_id)) throw invalid(msg, { metric_id: 'Выберите KPI' });
      const unitId = body.unit_id || null;
      if (unitId && (!isUuid(unitId) || !acc.ctx.units.some((u) => u.id === unitId))) throw invalid(msg, { unit_id: 'Подразделение не найдено' });
      const { rows } = await q.query<{ goal_id: string; unit: string; status: string }>(
        `SELECT g.id AS goal_id, m.unit, g.status FROM goal_metrics m JOIN goals g ON g.id = m.goal_id WHERE m.id = $1 AND g.company_id = $2`,
        [body.metric_id, actor.company_id],
      );
      const m = rows[0];
      if (!m) throw invalid(msg, { metric_id: 'Выберите KPI' });
      if (m.status === 'cancelled' || m.status === 'completed') throw invalid(msg, { metric_id: 'Цель закрыта — выберите другой KPI' });
      if (body.measure === 'revenue' && m.unit !== 'rub') throw invalid(msg, { metric_id: 'Для выручки выберите KPI в рублях' });
      if (body.measure !== 'revenue' && m.unit !== 'count') throw invalid(msg, { metric_id: 'Для штук и клиентов выберите KPI в штуках' });
      if (!(await canLink(q, acc, m.goal_id, unitId))) throw forbidden('Связать KPI с продажами может тот, кто вносит его факт и загружает отчёты о продажах этого подразделения');
      await q.query(
        `INSERT INTO sales_goal_links (metric_id, company_id, measure, unit_id, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (metric_id) DO UPDATE SET measure = EXCLUDED.measure, unit_id = EXCLUDED.unit_id, created_by = EXCLUDED.created_by`,
        [body.metric_id, actor.company_id, body.measure, unitId, actor.id, now().toISOString()],
      );
      // Сменили, что считать, — прежние замеры пересчитываются заново.
      const { rows: old } = await q.query<{ observation_id: string }>(`DELETE FROM sales_goal_months WHERE metric_id = $1 RETURNING observation_id`, [body.metric_id]);
      if (old.length) await q.query(`DELETE FROM goal_metric_observations WHERE id = ANY($1::uuid[])`, [old.map((o) => o.observation_id)]);
      const goals_updated = await syncGoalLinks(q, actor.company_id, await reportMonths(q, actor.company_id, now()), now(), body.metric_id);
      return { metric_id: body.metric_id, goals_updated };
    });
    res.status(201).json({ data });
  });

  r.delete('/goal-links/:metricId', async (req, res) => {
    const actor = actorOf(req);
    const metricId = idParam(req.params.metricId);
    await db.tx(async (q) => {
      const acc = await salesAccess(q, actor);
      const { rows } = await q.query<{ goal_id: string; unit_id: string | null }>(
        `SELECT m.goal_id, s.unit_id FROM sales_goal_links s JOIN goal_metrics m ON m.id = s.metric_id WHERE s.metric_id = $1 AND s.company_id = $2`,
        [metricId, actor.company_id],
      );
      if (!rows[0]) throw notFound('Связь не найдена');
      if (!(await canLink(q, acc, rows[0].goal_id, rows[0].unit_id))) throw forbidden('Отвязать KPI может тот, кто вносит его факт и загружает отчёты о продажах');
      // Замеры, которые уже записаны, остаются в истории KPI.
      await q.query(`DELETE FROM sales_goal_links WHERE metric_id = $1`, [metricId]);
    });
    res.status(204).end();
  });

  // ------------------------------------------------------------ образцы файлов

  r.get('/templates/:kind', async (req, res) => {
    actorOf(req);
    const month = todayMsk(now()).slice(0, 7);
    const kind = req.params.kind;
    let sheets: { name: string; rows: unknown[][]; levels?: number[]; widths?: number[] }[];
    let name: string;
    if (kind === 'report') {
      const end = todayMsk(now());
      const s = buildSalesReportSheet(`01.${month.slice(5, 7)}.${month.slice(0, 4)} - ${end.slice(8, 10)}.${month.slice(5, 7)}.${month.slice(0, 4)}`, SAMPLE_CLIENTS);
      sheets = [{ ...s, widths: [14, 4, 4, 52, 4, 4, 12, 14] }];
      name = 'Образец отчёта о продажах 1С.xlsx';
    } else if (kind === 'kpi') {
      sheets = [{ name: 'Иванов Иван', rows: buildKpiSheet({ employee: 'Иванов Иван', month, fixed: [{ name: 'Оклад', amount: 40000 }], metrics: SAMPLE_KPI, results: false }), widths: [64, 16, 14, 14] }];
      name = 'Образец файла KPI.xlsx';
    } else if (kind === 'entries') {
      sheets = [
        {
          name: 'Продажи',
          rows: [
            ['Дата', 'Товар', 'Клиент', 'Количество', 'Сумма', 'Комментарий'],
            [`${month}-02`, 'Курс «Python для аналитиков»', 'ООО «Альфа»', 2, 90000, ''],
            [`${month}-03`, 'Семинар «Охрана труда»', 'ИП Смирнов', 1, 12000, 'Оплата картой'],
          ],
          widths: [12, 40, 24, 12, 12, 24],
        },
      ];
      name = 'Образец продаж.xlsx';
    } else throw notFound('Образец не найден');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(Buffer.from(writeXlsx(sheets)));
  });

  return r;
}

const FN_DENIED: Record<SalesFn, string> = {
  sales_reports: 'Загружать отчёты о продажах может руководитель или тот, кому он включил эту функцию',
  sales_files: 'Загружать файлы KPI может руководитель сотрудника или тот, кому он включил эту функцию',
  sales_assign: 'Ставить план может руководитель сотрудника или тот, кому он включил эту функцию',
};

const COURSES = ['КУРСЫ', 'Повышение квалификации'];
const SAMPLE_CLIENTS = [
  {
    client: 'ООО «Альфа»',
    managers: [{ name: 'Иванов Иван', sales: [{ path: COURSES, name: 'Курс «Python для аналитиков»', qty: 2, rev: 90000, article: 'ДПО-0001' }] }],
  },
  {
    client: 'ИП Смирнов',
    managers: [{ name: 'Иванов Иван', sales: [{ path: ['СЕМИНАРЫ'], name: 'Семинар «Охрана труда»', qty: 1, rev: 12000 }] }],
  },
];
const SAMPLE_KPI = [
  { name: 'План продаж, руб (порог 90%, При выполнении 80-90% кэф 0,5)', plan: 600000, fact: null, percent: null, bonus: 30000, payment: null },
  { name: 'Корпоративные клиенты, шт (порог 100%)', plan: 5, fact: null, percent: null, bonus: 10000, payment: null },
];
