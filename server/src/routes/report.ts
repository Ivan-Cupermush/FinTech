import { Router } from 'express';
import { buildReport, isReportPeriod, productMetrics, reportCsv, reportFileName, todayIso, type ReportGoalInput } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { ApiError } from '../http/errors';
import { loadMetricsInput } from '../services/metrics';
import { goalRisks } from './roadmap';

const REPORTED = new Set(['active', 'on_hold', 'completed']);

/**
 * Отчёт для руководства за неделю, месяц или квартал. Собирается из тех же
 * данных, что Пульс и «Эффект», в зоне видимости человека: руководитель
 * получает отчёт по своим целям, администратор — по всей компании.
 * `format=csv` отдаёт таблицу для Excel.
 */
export function reportRouter(db: Db, now: () => Date): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const raw = req.query.days;
    const days = raw === undefined ? 30 : Number(raw);
    if (!isReportPeriod(days)) throw new ApiError('BAD_REQUEST', 'Неверный период отчёта', { days: 'Выберите неделю, месяц или квартал: 7, 30 или 90 дней' });
    const format = req.query.format ?? 'json';
    if (format !== 'json' && format !== 'csv') throw new ApiError('BAD_REQUEST', 'Неизвестный формат отчёта', { format: 'Доступны json и csv' });

    const at = now().toISOString();
    const today = todayIso(now());
    const input = await loadMetricsInput(db, actor, at);
    const visibleIds = new Set(input.visible.map((g) => g.row.id));
    // Верхний уровень для человека — цели, родителя которых он не видит.
    const top = input.visible.filter((g) => REPORTED.has(g.row.status) && !(g.row.parent_goal_id && visibleIds.has(g.row.parent_goal_id)));

    const people = await db.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])`, [
      [actor.id, ...top.map((g) => g.row.owner_id).filter((id): id is string => !!id)],
    ]);
    const nameOf = new Map(people.rows.map((u) => [u.id, u.display_name]));
    const company = await db.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [actor.company_id]);

    const goals: ReportGoalInput[] = [];
    for (const g of top) {
      const { risks, tasks } = await goalRisks(db, actor.company_id, g, today);
      const history = input.goals.find((h) => h.id === g.row.id);
      const meta = input.kpis.find((k) => k.goal_id === g.row.id);
      goals.push({
        id: g.row.id,
        title: g.row.title,
        status: g.row.status,
        owner_name: g.row.owner_id ? (nameOf.get(g.row.owner_id) ?? null) : null,
        due_at: g.row.due_at,
        completed_at: g.row.status === 'completed' ? (history?.closed_at ?? null) : null,
        kpi: history?.kpi && meta ? { ...history.kpi, name: meta.name, unit: meta.unit } : null,
        risks,
        tasks: tasks.map((t) => ({ id: t.id, status: t.status, due_at: t.due_at, done_at: t.done_at })),
      });
    }

    const report = buildReport({
      company: company.rows[0]?.name ?? '',
      scope: actor.role === 'owner' || actor.role === 'admin' ? 'company' : 'visible',
      author: nameOf.get(actor.id) ?? '',
      at,
      days,
      goals,
      metrics: productMetrics(input, at, { windowDays: days, weeks: 1 }),
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(report, 'csv')}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(reportCsv(report));
      return;
    }
    res.json({ data: report });
  });

  return r;
}
