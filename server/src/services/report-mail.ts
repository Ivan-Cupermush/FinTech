import nodemailer from 'nodemailer';
import { SCHEDULE_DAYS, isReportDue, reportCsv, reportFileName, reportMailHtml, reportMailSubject, reportText, type ReportSchedule } from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import type { Db } from '../db/db';
import { buildActorReport } from './report';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: string; contentType: string }[];
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** SMTP через nodemailer: `smtps://user:pass@smtp.example.ru:465`. */
export function smtpSender(opts: { url: string; from: string }): MailSender {
  const transport = nodemailer.createTransport(opts.url);
  return {
    async send(m) {
      await transport.sendMail({ from: opts.from, to: m.to, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
    },
  };
}

interface SubscriptionRow {
  user_id: string;
  company_id: string;
  schedule: ReportSchedule;
  since: string;
}

export interface MailDispatchResult {
  sent: number;
  failed: number;
}

/** После ошибки SMTP ждём, прежде чем пробовать снова, чтобы не долбить сервер почты каждую минуту. */
const RETRY_AFTER_MINUTES = 15;

/**
 * Разослать отчёты, которым пора. Каждая подписка — своя транзакция: строка
 * блокируется (SKIP LOCKED — второй процесс её пропустит), срок проверяется
 * заново, отчёт собирается в зоне видимости подписчика, письмо уходит, и
 * только потом записывается last_sent_at. Сбой отправки откатывает
 * транзакцию — письмо уйдёт на следующей попытке, а не потеряется.
 */
export async function dispatchReportMail(db: Db, sender: MailSender, now: Date, opts: { appUrl?: string } = {}): Promise<MailDispatchResult> {
  const at = now.toISOString();
  const result: MailDispatchResult = { sent: 0, failed: 0 };
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT s.user_id, s.company_id, s.schedule, GREATEST(s.last_sent_at, s.since_at) AS since
       FROM report_subscriptions s
       JOIN users u ON u.id = s.user_id AND u.active
       JOIN company_members m ON m.user_id = s.user_id AND m.company_id = s.company_id
      WHERE s.enabled
        AND (s.last_error IS NULL OR s.last_attempt_at < $1::timestamptz - make_interval(mins => $2::int))`,
    [at, RETRY_AFTER_MINUTES],
  );

  for (const sub of rows) {
    if (!isReportDue(sub.schedule, sub.since, at)) continue;
    try {
      const sent = await db.tx(async (q) => {
        const locked = await q.query<SubscriptionRow & { email: string; display_name: string; role: AuthedActor['role'] }>(
          `SELECT s.user_id, s.company_id, s.schedule, GREATEST(s.last_sent_at, s.since_at) AS since,
                  u.email, u.display_name, m.role
             FROM report_subscriptions s
             JOIN users u ON u.id = s.user_id AND u.active
             JOIN company_members m ON m.user_id = s.user_id AND m.company_id = s.company_id
            WHERE s.user_id = $1 AND s.company_id = $2 AND s.enabled
            FOR UPDATE OF s SKIP LOCKED`,
          [sub.user_id, sub.company_id],
        );
        const row = locked.rows[0];
        // Другой процесс уже взял подписку или успел отправить — пропускаем.
        if (!row || !isReportDue(row.schedule, row.since, at)) return false;
        const actor: AuthedActor = { id: row.user_id, company_id: row.company_id, role: row.role, display_name: row.display_name };
        const report = await buildActorReport(q, actor, SCHEDULE_DAYS[row.schedule], now);
        await sender.send({
          to: row.email,
          subject: reportMailSubject(report),
          text: `${reportText(report)}\n\nТаблица для Excel — во вложении. Отключить письма можно на странице «Отчёт».`,
          html: reportMailHtml(report, { appUrl: opts.appUrl }),
          attachments: [{ filename: reportFileName(report, 'csv'), content: reportCsv(report), contentType: 'text/csv; charset=utf-8' }],
        });
        await q.query(
          `UPDATE report_subscriptions SET last_sent_at = $3, last_attempt_at = $3, last_error = NULL WHERE user_id = $1 AND company_id = $2`,
          [row.user_id, row.company_id, at],
        );
        return true;
      });
      if (sent) result.sent++;
    } catch (e) {
      result.failed++;
      await db.query(`UPDATE report_subscriptions SET last_attempt_at = $3, last_error = $4 WHERE user_id = $1 AND company_id = $2`, [
        sub.user_id,
        sub.company_id,
        at,
        (e instanceof Error ? e.message : String(e)).slice(0, 500),
      ]);
    }
  }
  return result;
}

/** Фоновая рассылка отчётов: раз в минуту проверяет, кому пора, без наложения шагов. */
export function startReportMailLoop(
  db: Db,
  sender: MailSender,
  opts: { intervalMs?: number; now?: () => Date; appUrl?: string; onError?: (e: unknown) => void } = {},
): () => void {
  const now = opts.now ?? (() => new Date());
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await dispatchReportMail(db, sender, now(), { appUrl: opts.appUrl });
    } catch (e) {
      opts.onError?.(e);
    } finally {
      running = false;
    }
  }, opts.intervalMs ?? 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
