import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { PRIVACY_VERSION, lockoutWait, passwordError } from '@offix/core';
import { checkPassword, hashPassword, issueToken } from '../auth/auth';
import type { Db } from '../db/db';
import { ApiError, invalid } from '../http/errors';
import { parseBody } from '../http/validate';
import { audit } from '../services/audit';
import { loginLockout, recordLogin } from '../services/security';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function authRouter(db: Db, secret: string, opts: { rateLimit?: boolean; loginLimit?: number; lockout?: boolean; now?: () => Date } = {}): Router {
  const r = Router();
  const now = opts.now ?? (() => new Date());
  if (opts.rateLimit !== false) {
    r.use(
      rateLimit({
        windowMs: 15 * 60_000,
        limit: opts.loginLimit ?? 30,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Слишком много попыток. Попробуйте через несколько минут' } }),
      }),
    );
  }

  r.post('/login', async (req, res) => {
    const { email, password } = parseBody(z.object({ email: z.string().max(254), password: z.string().max(200) }), req.body);
    const { rows } = await db.query<{ id: string; password_hash: string; display_name: string; company_id: string; company_name: string; role: string; active: boolean }>(
      `SELECT u.id, u.password_hash, u.display_name, u.active, m.company_id, c.name AS company_name, m.role
         FROM users u JOIN company_members m ON m.user_id = u.id JOIN companies c ON c.id = m.company_id
        WHERE lower(u.email) = lower($1) AND u.anonymized_at IS NULL ORDER BY m.joined_at LIMIT 1`,
      [email.trim()],
    );
    const user = rows[0];
    const BAD = 'Неверная почта или пароль';
    // Одинаковый ответ для «нет такого» и «не тот пароль».
    if (!user) throw new ApiError('UNAUTHORIZED', BAD);
    const meta = { ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '') };
    const at = now();
    const base = { userId: user.id, companyId: user.company_id, method: 'password' as const, at, ...meta };
    // Подбор пароля: после 10 неверных попыток за 15 минут вход в эту учётную запись закрыт —
    // даже с верным паролем, чтобы подбирающий не узнал, что угадал.
    if (opts.lockout !== false) {
      const lk = await loginLockout(db, user.id, at);
      if (lk.locked) {
        await recordLogin(db, { ...base, ok: false, failure: 'locked' });
        throw new ApiError('RATE_LIMITED', `Слишком много неверных попыток. Попробуйте ${lockoutWait(lk.until!, at)} или попросите администратора сбросить пароль`);
      }
    }
    if (!(await checkPassword(password, user.password_hash))) {
      await db.tx(async (q) => {
        await recordLogin(q, { ...base, ok: false, failure: 'bad_password' });
        // Эта попытка закрыла вход — администратор увидит это в журнале безопасности.
        if (opts.lockout !== false && (await loginLockout(q, user.id, at)).locked) {
          await audit(q, { company_id: user.company_id, entity_type: 'member', entity_id: user.id, actor_id: null, event_type: 'login.locked', new_values: { ip: meta.ip, user_agent: meta.userAgent } });
        }
      });
      throw new ApiError('UNAUTHORIZED', BAD);
    }
    if (!user.active) {
      await recordLogin(db, { ...base, ok: false, failure: 'inactive' });
      throw new ApiError('UNAUTHORIZED', BAD);
    }
    await db.tx(async (q) => {
      await q.query(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [user.id, at.toISOString()]);
      await recordLogin(q, { ...base, ok: true });
    });
    res.json({
      data: {
        token: await issueToken(db, secret, user.id, user.company_id),
        user: { id: user.id, display_name: user.display_name, role: user.role },
        company: { id: user.company_id, name: user.company_name },
      },
    });
  });

  /** Быстрый старт: компания и её владелец за один шаг. Структуру можно добавить позже. */
  r.post('/register', async (req, res) => {
    const body = parseBody(
      z.object({
        company_name: z.string().max(1000),
        setup_mode: z.enum(['quick', 'structured']).default('quick'),
        display_name: z.string().max(1000),
        email: z.string().max(254),
        password: z.string().max(200),
        /** Согласие на обработку персональных данных (152-ФЗ, ст. 9): без него компанию не создаём. */
        consent: z.boolean().optional(),
      }),
      req.body,
    );
    const errors: Record<string, string> = {};
    if (!body.company_name.trim()) errors.company_name = 'Введите название компании';
    else if (body.company_name.trim().length > 150) errors.company_name = 'Название — не длиннее 150 символов';
    if (!body.display_name.trim()) errors.display_name = 'Как вас зовут?';
    else if (body.display_name.trim().length > 120) errors.display_name = 'Имя — не длиннее 120 символов';
    if (!EMAIL.test(body.email.trim())) errors.email = 'Введите корректную почту';
    {
      const pe = passwordError(body.password, { email: body.email.trim() });
      if (pe) errors.password = pe;
    }
    if (body.consent !== true) errors.consent = 'Подтвердите согласие на обработку персональных данных';
    if (Object.keys(errors).length) throw invalid('Не удалось создать компанию', errors);
    const hash = await hashPassword(body.password);
    const out = await db.tx(async (q) => {
      const exists = await q.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [body.email.trim()]);
      if (exists.rows.length) throw invalid('Не удалось создать компанию', { email: 'Эта почта уже зарегистрирована — войдите' });
      const c = await q.query<{ id: string }>(`INSERT INTO companies (name, setup_mode) VALUES ($1, $2) RETURNING id`, [body.company_name.trim(), body.setup_mode]);
      const u = await q.query<{ id: string }>(`INSERT INTO users (email, password_hash, display_name, consent_version, consent_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id`, [
        body.email.trim(),
        hash,
        body.display_name.trim(),
        PRIVACY_VERSION,
      ]);
      const companyId = c.rows[0]!.id;
      const userId = u.rows[0]!.id;
      await q.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [companyId, userId]);
      await audit(q, { company_id: companyId, entity_type: 'member', entity_id: userId, actor_id: userId, event_type: 'company.created', new_values: { name: body.company_name.trim(), setup_mode: body.setup_mode } });
      await audit(q, { company_id: companyId, entity_type: 'member', entity_id: userId, actor_id: userId, event_type: 'account.consent_given', new_values: { version: PRIVACY_VERSION } });
      await recordLogin(q, { userId, companyId, ok: true, method: 'register', ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? ''), at: now() });
      return { companyId, userId };
    });
    res.status(201).json({
      data: {
        token: await issueToken(db, secret, out.userId, out.companyId),
        user: { id: out.userId, display_name: body.display_name.trim(), role: 'owner' },
        company: { id: out.companyId, name: body.company_name.trim() },
      },
    });
  });

  return r;
}
