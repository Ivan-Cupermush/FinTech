import { Router } from 'express';
import { z } from 'zod';
import { REPORT_SCHEDULES, isReportPeriod, nextReportSlot, reportCsv, reportFileName, type ReportSchedule, type ReportSubscription } from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db } from '../db/db';
import { ApiError } from '../http/errors';
import { parseBody } from '../http/validate';
import { buildActorReport } from '../services/report';

/**
 * Отчёт для руководства за неделю, месяц или квартал. Собирается из тех же
 * данных, что Пульс и «Эффект», в зоне видимости человека: руководитель
 * получает отчёт по своим целям, администратор — по всей компании.
 * `format=csv` отдаёт таблицу для Excel. `/subscription` — тот же отчёт
 * письмом по расписанию.
 */
export function reportRouter(db: Db, now: () => Date, opts: { mailAvailable?: boolean } = {}): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const raw = req.query.days;
    const days = raw === undefined ? 30 : Number(raw);
    if (!isReportPeriod(days)) throw new ApiError('BAD_REQUEST', 'Неверный период отчёта', { days: 'Выберите неделю, месяц или квартал: 7, 30 или 90 дней' });
    const format = req.query.format ?? 'json';
    if (format !== 'json' && format !== 'csv') throw new ApiError('BAD_REQUEST', 'Неизвестный формат отчёта', { format: 'Доступны json и csv' });

    const report = await buildActorReport(db, actor, days, now());

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(report, 'csv')}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(reportCsv(report));
      return;
    }
    res.json({ data: report });
  });

  const subscription = async (actor: AuthedActor): Promise<ReportSubscription> => {
    const { rows } = await db.query<{ enabled: boolean; schedule: ReportSchedule; last_sent_at: string | null; email: string }>(
      `SELECT s.enabled, s.schedule, s.last_sent_at, u.email
         FROM users u LEFT JOIN report_subscriptions s ON s.user_id = u.id AND s.company_id = $2
        WHERE u.id = $1`,
      [actor.id, actor.company_id],
    );
    const row = rows[0];
    const enabled = !!row?.enabled;
    const schedule = row?.schedule ?? 'weekly';
    return {
      enabled,
      schedule,
      email: row?.email ?? '',
      last_sent_at: row?.last_sent_at ?? null,
      next_at: enabled ? nextReportSlot(schedule, now().toISOString()) : null,
      mail_available: !!opts.mailAvailable,
    };
  };

  r.get('/subscription', async (req, res) => {
    res.json({ data: await subscription(actorOf(req)) });
  });

  r.put('/subscription', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ enabled: z.boolean(), schedule: z.enum(REPORT_SCHEDULES) }), req.body);
    // Включили или сменили частоту — расписание считаем с этого момента,
    // чтобы письмо не ушло сразу за уже прошедший понедельник или 1-е число.
    await db.query(
      `INSERT INTO report_subscriptions (user_id, company_id, enabled, schedule, since_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (user_id, company_id) DO UPDATE SET
         since_at = CASE WHEN (EXCLUDED.enabled AND NOT report_subscriptions.enabled) OR EXCLUDED.schedule <> report_subscriptions.schedule
                         THEN EXCLUDED.since_at ELSE report_subscriptions.since_at END,
         enabled = EXCLUDED.enabled, schedule = EXCLUDED.schedule, last_error = NULL, updated_at = EXCLUDED.updated_at`,
      [actor.id, actor.company_id, body.enabled, body.schedule, now().toISOString()],
    );
    res.json({ data: await subscription(actor) });
  });

  return r;
}
