import { Router } from 'express';
import { AUDIT_GROUP_LABELS, auditDetails, auditGroupTypes, auditLabel, canManageOrg, securityAdvice, toCsv, type AuditGroup, type AuditRow, type SecuritySummary } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { forbidden } from '../http/errors';
import { audit } from '../services/audit';
import { loginView, type LoginRow } from '../services/security';

const GROUPS = Object.keys(AUDIT_GROUP_LABELS) as AuditGroup[];

const msk = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Курсор страницы — id последней строки (BIGSERIAL): новые события не сдвигают страницы. */
const cursorOf = (v: unknown): string | null => (typeof v === 'string' && /^\d{1,18}$/.test(v) ? v : null);

/**
 * Безопасность компании для владельца и администратора: `/api/v1/security`.
 * Сводка с советами, журнал событий (с выгрузкой в Excel) и журнал входов.
 */
export function securityRouter(db: Db, now: () => Date): Router {
  const r = Router();
  r.use((req, _res, next) => {
    if (!canManageOrg(actorOf(req))) throw forbidden('Журнал безопасности видят владелец и администратор');
    next();
  });

  r.get('/summary', async (req, res) => {
    const actor = actorOf(req);
    const at = now();
    const week = new Date(at.getTime() - 7 * 86_400_000).toISOString();
    const month = new Date(at.getTime() - 30 * 86_400_000).toISOString();
    const { rows } = await db.query<Record<keyof SecuritySummary, string>>(
      `SELECT
         (SELECT count(*) FROM login_events WHERE company_id = $1 AND ok AND created_at > $2) AS logins_7d,
         (SELECT count(*) FROM login_events WHERE company_id = $1 AND NOT ok AND created_at > $2) AS failures_7d,
         (SELECT count(*) FROM audit_events WHERE company_id = $1 AND event_type = 'login.locked' AND created_at > $2) AS lockouts_7d,
         (SELECT count(*) FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $1
           WHERE u.active AND COALESCE(u.last_login_at, m.joined_at) < $3) AS dormant,
         (SELECT count(*) FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $1
           WHERE NOT u.active AND u.anonymized_at IS NULL AND m.role <> 'owner') AS to_anonymize,
         (SELECT count(*) FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $1
           WHERE u.active AND u.password_changed_at IS NULL AND u.consent_at IS NULL AND m.role <> 'owner') AS default_passwords`,
      [actor.company_id, week, month],
    );
    const s = Object.fromEntries(Object.entries(rows[0]!).map(([k, v]) => [k, Number(v)])) as unknown as SecuritySummary;
    res.json({ data: { summary: s, advice: securityAdvice(s) } });
  });

  r.get('/audit', async (req, res) => {
    const actor = actorOf(req);
    const group: AuditGroup = GROUPS.includes(req.query.group as AuditGroup) ? (req.query.group as AuditGroup) : 'security';
    const csv = req.query.format === 'csv';
    const before = cursorOf(req.query.before);
    const asked = Number(req.query.limit);
    const limit = csv ? 5000 : Number.isInteger(asked) && asked >= 1 && asked <= 100 ? asked : 50;
    const f = auditGroupTypes(group);
    const { rows } = await db.query<AuditRow>(
      `SELECT e.id::text AS id, e.created_at AS at, e.event_type, e.entity_type, e.entity_id, e.actor_id,
              a.display_name AS actor_name, CASE WHEN e.entity_type = 'member' THEN t.display_name END AS target_name,
              e.old_values, e.new_values
         FROM audit_events e
         LEFT JOIN users a ON a.id = e.actor_id
         LEFT JOIN users t ON t.id = e.entity_id AND e.entity_type = 'member'
        WHERE e.company_id = $1
          AND ($2::bigint IS NULL OR e.id < $2::bigint)
          AND ($3::text[] IS NULL OR e.event_type = ANY($4::text[]) OR EXISTS (SELECT 1 FROM unnest($3::text[]) p WHERE e.event_type LIKE p || '%'))
        ORDER BY e.id DESC LIMIT $5`,
      [actor.company_id, before, f?.prefixes ?? null, f?.exact ?? [], limit + 1],
    );
    const more = rows.length > limit;
    const page = rows.slice(0, limit).map((e) => ({ ...e, at: new Date(e.at).toISOString() }));
    if (csv) {
      await audit(db, { company_id: actor.company_id, entity_type: 'member', entity_id: actor.id, actor_id: actor.id, event_type: 'security.audit_exported', new_values: { group } });
      const table = [
        ['Когда (МСК)', 'Кто', 'Событие', 'О ком', 'Подробности'],
        ...page.map((e) => [msk.format(new Date(e.at)), e.actor_name ?? 'система', auditLabel(e.event_type), e.target_name, auditDetails(e.old_values, e.new_values) || null]),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="offix-zhurnal-${now().toISOString().slice(0, 10)}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(toCsv(table));
      return;
    }
    res.json({ data: { events: page, next: more ? page[page.length - 1]!.id : null } });
  });

  r.get('/logins', async (req, res) => {
    const actor = actorOf(req);
    const failed = req.query.failed === '1';
    const before = cursorOf(req.query.before);
    const { rows } = await db.query<LoginRow>(
      `SELECT l.id, l.created_at, l.ok, l.method, l.failure, l.ip, l.user_agent, l.user_id, u.display_name
         FROM login_events l JOIN users u ON u.id = l.user_id
        WHERE l.company_id = $1 AND ($2::bigint IS NULL OR l.id < $2::bigint) AND (NOT $3 OR NOT l.ok)
        ORDER BY l.id DESC LIMIT 51`,
      [actor.company_id, before, failed],
    );
    const more = rows.length > 50;
    const page = rows.slice(0, 50).map(loginView);
    res.json({ data: { logins: page, next: more ? page[page.length - 1]!.id : null } });
  });

  return r;
}
