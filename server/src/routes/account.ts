import { Router } from 'express';
import { z } from 'zod';
import { displayNameError, passwordError, type AccountProfile } from '@offix/core';
import { actorOf, checkPassword, hashPassword, issueToken, revokeSessions } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { ApiError, forbidden, invalid } from '../http/errors';
import { parseBody } from '../http/validate';
import type { Realtime } from '../realtime/hub';
import { audit } from '../services/audit';
import { isExpired, phoneView, qrForPhone } from '../services/qr';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function loadProfile(q: Queryable, userId: string, companyId: string): Promise<AccountProfile> {
  const { rows } = await q.query<AccountProfile>(
    `SELECT u.id, u.email, u.display_name, u.position, u.avatar_url, m.role, c.name AS company_name,
            u.last_login_at, u.password_changed_at, m.joined_at
       FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $2 JOIN companies c ON c.id = m.company_id
      WHERE u.id = $1`,
    [userId, companyId],
  );
  return rows[0]!;
}

/**
 * Свой аккаунт: `/api/v1/account`. Имя, почта (с паролем), смена пароля,
 * завершение сеансов и подтверждение входа на сайт по QR-коду.
 * Смена пароля и «выйти везде» закрывают и сокеты: другой браузер узнаёт
 * об этом сразу, а не при следующем запросе.
 */
export function accountRouter(db: Db, secret: string, now: () => Date, rt: Realtime): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    res.json({ data: await loadProfile(db, actor.id, actor.company_id) });
  });

  r.patch('/', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ display_name: z.string().max(1000) }), req.body);
    const err = displayNameError(body.display_name);
    if (err) throw invalid('Не удалось сохранить профиль', { display_name: err });
    await db.tx(async (q) => {
      await q.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [actor.id, body.display_name.trim()]);
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: actor.id, actor_id: actor.id, event_type: 'account.renamed', old_values: { display_name: actor.display_name }, new_values: { display_name: body.display_name.trim() } });
    });
    rt.emitCompany(actor.company_id, 'profile_changed', { user_id: actor.id });
    res.json({ data: await loadProfile(db, actor.id, actor.company_id) });
  });

  /** Почта — это логин: сменить её можно, только подтвердив паролем. */
  r.post('/email', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ email: z.string().max(254), password: z.string().max(200) }), req.body);
    const MSG = 'Не удалось сменить почту';
    const email = body.email.trim();
    if (!EMAIL.test(email)) throw invalid(MSG, { email: 'Введите корректную почту' });
    const cur = (await db.query<{ password_hash: string; email: string }>(`SELECT password_hash, email FROM users WHERE id = $1`, [actor.id])).rows[0]!;
    if (!(await checkPassword(body.password, cur.password_hash))) throw invalid(MSG, { password: 'Неверный пароль' });
    await db.tx(async (q) => {
      const dup = await q.query(`SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2`, [email, actor.id]);
      if (dup.rows.length) throw invalid(MSG, { email: 'Эта почта уже занята' });
      await q.query(`UPDATE users SET email = $2 WHERE id = $1`, [actor.id, email]);
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: actor.id, actor_id: actor.id, event_type: 'account.email_changed', old_values: { email: cur.email }, new_values: { email } });
    });
    res.json({ data: await loadProfile(db, actor.id, actor.company_id) });
  });

  /**
   * Смена пароля: остальные устройства выходят, это получает новый токен.
   * Пароль мог утечь — значит, и сеансы, открытые с ним, больше не нужны.
   */
  r.post('/password', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ current_password: z.string().max(200), new_password: z.string().max(1000) }), req.body);
    const MSG = 'Не удалось сменить пароль';
    const cur = (await db.query<{ password_hash: string; email: string }>(`SELECT password_hash, email FROM users WHERE id = $1`, [actor.id])).rows[0]!;
    if (!(await checkPassword(body.current_password, cur.password_hash))) throw invalid(MSG, { current_password: 'Текущий пароль неверный' });
    const err = body.current_password === body.new_password ? 'Новый пароль совпадает с текущим' : passwordError(body.new_password, { email: cur.email, name: actor.display_name });
    if (err) throw invalid(MSG, { new_password: err });
    const hash = await hashPassword(body.new_password);
    const token = await db.tx(async (q) => {
      await q.query(`UPDATE users SET password_hash = $2, password_changed_at = $3 WHERE id = $1`, [actor.id, hash, now().toISOString()]);
      await revokeSessions(q, actor.id);
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: actor.id, actor_id: actor.id, event_type: 'account.password_changed' });
      return issueToken(q, secret, actor.id, actor.company_id);
    });
    rt.disconnectUser(actor.company_id, actor.id);
    res.json({ data: { token } });
  });

  /**
   * Выйти на всех устройствах. keep_current — остаться на этом: в ответе
   * новый токен. Иначе выходит и это устройство.
   */
  r.post('/logout-all', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ keep_current: z.boolean().default(true) }), req.body);
    const token = await db.tx(async (q) => {
      await revokeSessions(q, actor.id);
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: actor.id, actor_id: actor.id, event_type: 'account.logout_all' });
      return body.keep_current ? issueToken(q, secret, actor.id, actor.company_id) : null;
    });
    rt.disconnectUser(actor.company_id, actor.id);
    res.json({ data: { token } });
  });

  // ------------------------------------------------------------ вход на сайт по QR

  /** Отсканировал код — он закрепляется за мной: подтвердить его может только тот, кто сканировал. */
  r.get('/qr/:token', async (req, res) => {
    const actor = actorOf(req);
    const at = now();
    const row = await db.tx(async (q) => {
      const row = await qrForPhone(q, String(req.params.token), true);
      if (row.status === 'pending' && !isExpired(row, at)) {
        await q.query(`UPDATE qr_logins SET status = 'scanned', user_id = $2, company_id = $3 WHERE id = $1`, [row.id, actor.id, actor.company_id]);
        return { ...row, status: 'scanned' as const, user_id: actor.id, company_id: actor.company_id };
      }
      return row;
    });
    if (row.user_id && row.user_id !== actor.id) throw forbidden('Этот код уже отсканировал другой человек');
    res.json({ data: phoneView(row, at) });
  });

  r.post('/qr/:token/approve', async (req, res) => {
    const actor = actorOf(req);
    const at = now();
    const row = await db.tx(async (q) => {
      const row = await qrForPhone(q, String(req.params.token), true);
      if (row.user_id && row.user_id !== actor.id) throw forbidden('Этот код уже отсканировал другой человек');
      if (isExpired(row, at) || (row.status !== 'pending' && row.status !== 'scanned')) throw new ApiError('CONFLICT', 'Код уже недействителен. Обновите страницу на компьютере и отсканируйте новый код');
      await q.query(`UPDATE qr_logins SET status = 'approved', user_id = $2, company_id = $3 WHERE id = $1`, [row.id, actor.id, actor.company_id]);
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: actor.id, actor_id: actor.id, event_type: 'login.qr_approved', new_values: { ip: row.ip, user_agent: row.user_agent } });
      return { ...row, status: 'approved' as const };
    });
    res.json({ data: phoneView(row, at) });
  });

  r.post('/qr/:token/decline', async (req, res) => {
    const actor = actorOf(req);
    const at = now();
    const row = await db.tx(async (q) => {
      const row = await qrForPhone(q, String(req.params.token), true);
      if (row.user_id && row.user_id !== actor.id) throw forbidden('Этот код уже отсканировал другой человек');
      if (row.status === 'pending' || row.status === 'scanned') {
        await q.query(`UPDATE qr_logins SET status = 'declined', user_id = $2, company_id = $3 WHERE id = $1`, [row.id, actor.id, actor.company_id]);
        return { ...row, status: 'declined' as const };
      }
      return row;
    });
    res.json({ data: phoneView(row, at) });
  });

  return r;
}
