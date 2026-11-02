import { randomBytes } from 'node:crypto';
import {
  ANONYMIZED_EMAIL_DOMAIN,
  LOCKOUT_WINDOW_MIN,
  anonymizedName,
  deviceLabel,
  lockout,
  type LoginEvent,
  type LoginFailure,
  type LoginMethod,
} from '@offix/core';
import { hashPassword, revokeSessions } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { audit } from './audit';
import { deleteAttachments } from './attachments';
import type { MediaStore } from './media';

/**
 * Защита данных на сервере: журнал входов, закрытие входа после подбора
 * пароля, срок хранения журнала, обезличивание ушедших сотрудников.
 */

export interface LoginMeta {
  ip: string | null;
  userAgent: string | null;
}

export async function recordLogin(
  q: Queryable,
  e: { userId: string; companyId: string | null; ok: boolean; method: LoginMethod; failure?: LoginFailure | null; at?: Date } & LoginMeta,
): Promise<void> {
  await q.query(`INSERT INTO login_events (user_id, company_id, ok, method, failure, ip, user_agent, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()))`, [
    e.userId,
    e.companyId,
    e.ok,
    e.method,
    e.ok ? null : (e.failure ?? 'bad_password'),
    e.ip?.slice(0, 64) ?? null,
    e.userAgent?.slice(0, 400) || null,
    e.at?.toISOString() ?? null,
  ]);
}

/**
 * Закрыт ли вход в учётную запись после неудачных попыток. Считаются только
 * неверные пароли: попытки при уже закрытом входе срок не продлевают, иначе
 * подбирающий держал бы вход закрытым для хозяина сколько угодно.
 */
export async function loginLockout(q: Queryable, userId: string, now: Date) {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MIN * 60_000).toISOString();
  const { rows } = await q.query<{ created_at: Date | string; ok: boolean; failure: string | null }>(
    `SELECT created_at, ok, failure FROM login_events WHERE user_id = $1 AND created_at > $2 ORDER BY created_at`,
    [userId, since],
  );
  const failures = rows.filter((r) => r.failure === 'bad_password').map((r) => new Date(r.created_at));
  const successes = rows.filter((r) => r.ok).map((r) => new Date(r.created_at).getTime());
  return lockout(failures, successes.length ? new Date(Math.max(...successes)) : null, now);
}

export interface LoginRow {
  id: string;
  created_at: Date | string;
  ok: boolean;
  method: LoginMethod;
  failure: LoginFailure | null;
  ip: string | null;
  user_agent: string | null;
  user_id?: string;
  display_name?: string | null;
}

export const loginView = (r: LoginRow): LoginEvent => ({
  id: String(r.id),
  at: new Date(r.created_at).toISOString(),
  ok: r.ok,
  method: r.method,
  failure: r.failure,
  ip: r.ip,
  device: deviceLabel(r.user_agent),
  ...(r.user_id !== undefined ? { user_id: r.user_id, display_name: r.display_name ?? null } : {}),
});

/** Журнал входов хранится полгода: дольше он не нужен ни для безопасности, ни человеку. */
export const LOGIN_RETENTION_DAYS = 180;

export async function pruneLoginEvents(db: Db, now: Date, days = LOGIN_RETENTION_DAYS): Promise<number> {
  const before = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { rows } = await db.query<{ id: string }>(`DELETE FROM login_events WHERE created_at < $1 RETURNING id`, [before]);
  return rows.length;
}

/** Раз в сутки — чистка журнала входов. */
export function startRetentionLoop(db: Db, opts: { now?: () => Date; onError?: (e: unknown) => void } = {}): () => void {
  const now = opts.now ?? (() => new Date());
  const tick = () => void pruneLoginEvents(db, now()).catch((e) => opts.onError?.(e));
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, 24 * 3_600_000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

// ------------------------------------------------------------ обезличивание

export type AnonymizeRefusal = 'not_found' | 'self' | 'owner' | 'active' | 'other_company' | 'done';

/**
 * Обезличить ушедшего сотрудника (152-ФЗ, ст. 21: данные, которые больше не
 * нужны, уничтожаются или обезличиваются). Работа остаётся: задачи, цели и
 * сообщения сохраняются, но вместо имени — «Бывший сотрудник N», почты и
 * фото нет, войти нельзя, личные заметки и журнал входов удалены.
 */
export async function anonymizeMember(
  q: Queryable,
  store: MediaStore,
  actor: { id: string; company_id: string },
  userId: string,
): Promise<{ ok: true; name: string; avatar: string | null } | { ok: false; reason: AnonymizeRefusal }> {
  if (userId === actor.id) return { ok: false, reason: 'self' };
  const { rows } = await q.query<{ role: string; active: boolean; anonymized_at: string | null; avatar_url: string | null }>(
    `SELECT m.role, u.active, u.anonymized_at, u.avatar_url FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1 AND m.user_id = $2 FOR UPDATE OF u`,
    [actor.company_id, userId],
  );
  const cur = rows[0];
  if (!cur) return { ok: false, reason: 'not_found' };
  if (cur.anonymized_at) return { ok: false, reason: 'done' };
  if (cur.role === 'owner') return { ok: false, reason: 'owner' };
  if (cur.active) return { ok: false, reason: 'active' };
  // Учётная запись общая для всех компаний человека — чужую компанию не трогаем.
  const elsewhere = await q.query(`SELECT 1 FROM company_members WHERE user_id = $1 AND company_id <> $2 LIMIT 1`, [userId, actor.company_id]);
  if (elsewhere.rows.length) return { ok: false, reason: 'other_company' };

  const n = Number((await q.query<{ n: string }>(`SELECT count(*) AS n FROM users u JOIN company_members m ON m.user_id = u.id WHERE m.company_id = $1 AND u.anonymized_at IS NOT NULL`, [actor.company_id])).rows[0]!.n) + 1;
  const name = anonymizedName(n);
  const email = `${randomBytes(12).toString('hex')}@${ANONYMIZED_EMAIL_DOMAIN}`;
  // Пароль, который никто не знает: вход невозможен, даже если учётную запись снова включат.
  const hash = await hashPassword(randomBytes(32).toString('hex'));
  await q.query(
    `UPDATE users SET display_name = $2, email = $3, password_hash = $4, position = NULL, avatar_url = NULL, anonymized_at = NOW(), active = FALSE, consent_version = NULL, consent_at = NULL WHERE id = $1`,
    [userId, name, email, hash],
  );
  await revokeSessions(q, userId);
  await q.query(`DELETE FROM login_events WHERE user_id = $1`, [userId]);
  await q.query(`DELETE FROM push_devices WHERE user_id = $1`, [userId]);
  await q.query(`DELETE FROM contact_names WHERE owner_id = $1 OR user_id = $1`, [userId]);
  // Личные заметки — только его: удаляем вместе с файлами (копии, пересланные коллегам, остаются у них).
  const notes = (await q.query<{ id: string }>(`SELECT id FROM personal_notes WHERE owner_id = $1`, [userId])).rows.map((r) => r.id);
  if (notes.length) await deleteAttachments(q, store, { type: 'note', ids: notes });
  await q.query(`DELETE FROM personal_notes WHERE owner_id = $1`, [userId]);
  // В журнале событий нет ни имени, ни почты — только факт.
  await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: userId, actor_id: actor.id, event_type: 'member.anonymized', new_values: { display_name: name } });
  return { ok: true, name, avatar: cur.avatar_url };
}

export const ANONYMIZE_MESSAGES: Record<AnonymizeRefusal, string> = {
  not_found: 'Сотрудник не найден',
  self: 'Себя обезличить нельзя',
  owner: 'Владельца компании обезличить нельзя',
  active: 'Сначала отключите сотрудника: обезличивают только тех, кто ушёл',
  other_company: 'Сотрудник состоит и в другой компании — его учётную запись обезличить нельзя',
  done: 'Данные сотрудника уже обезличены',
};
