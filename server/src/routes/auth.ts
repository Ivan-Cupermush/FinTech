import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { checkPassword, hashPassword, signToken } from '../auth/auth';
import type { Db } from '../db/db';
import { ApiError, invalid } from '../http/errors';
import { parseBody } from '../http/validate';
import { audit } from '../services/audit';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function authRouter(db: Db, secret: string, opts: { rateLimit?: boolean } = {}): Router {
  const r = Router();
  if (opts.rateLimit !== false) {
    r.use(
      rateLimit({
        windowMs: 15 * 60_000,
        limit: 30,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Слишком много попыток. Попробуйте через несколько минут' } }),
      }),
    );
  }

  r.post('/login', async (req, res) => {
    const { email, password } = parseBody(z.object({ email: z.string().max(254), password: z.string().max(200) }), req.body);
    const { rows } = await db.query<{ id: string; password_hash: string; display_name: string; company_id: string; company_name: string; role: string }>(
      `SELECT u.id, u.password_hash, u.display_name, m.company_id, c.name AS company_name, m.role
         FROM users u JOIN company_members m ON m.user_id = u.id JOIN companies c ON c.id = m.company_id
        WHERE lower(u.email) = lower($1) AND u.active ORDER BY m.joined_at LIMIT 1`,
      [email.trim()],
    );
    const user = rows[0];
    // Одинаковый ответ для «нет такого» и «не тот пароль».
    if (!user || !(await checkPassword(password, user.password_hash))) throw new ApiError('UNAUTHORIZED', 'Неверная почта или пароль');
    res.json({
      data: {
        token: signToken(secret, user.id, user.company_id),
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
      }),
      req.body,
    );
    const errors: Record<string, string> = {};
    if (!body.company_name.trim()) errors.company_name = 'Введите название компании';
    else if (body.company_name.trim().length > 150) errors.company_name = 'Название — не длиннее 150 символов';
    if (!body.display_name.trim()) errors.display_name = 'Как вас зовут?';
    else if (body.display_name.trim().length > 120) errors.display_name = 'Имя — не длиннее 120 символов';
    if (!EMAIL.test(body.email.trim())) errors.email = 'Введите корректную почту';
    if (body.password.length < 8) errors.password = 'Пароль — не короче 8 символов';
    if (Object.keys(errors).length) throw invalid('Не удалось создать компанию', errors);
    const hash = await hashPassword(body.password);
    const out = await db.tx(async (q) => {
      const exists = await q.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [body.email.trim()]);
      if (exists.rows.length) throw invalid('Не удалось создать компанию', { email: 'Эта почта уже зарегистрирована — войдите' });
      const c = await q.query<{ id: string }>(`INSERT INTO companies (name, setup_mode) VALUES ($1, $2) RETURNING id`, [body.company_name.trim(), body.setup_mode]);
      const u = await q.query<{ id: string }>(`INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`, [
        body.email.trim(),
        hash,
        body.display_name.trim(),
      ]);
      const companyId = c.rows[0]!.id;
      const userId = u.rows[0]!.id;
      await q.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [companyId, userId]);
      await audit(q, { company_id: companyId, entity_type: 'member', entity_id: userId, actor_id: userId, event_type: 'company.created', new_values: { name: body.company_name.trim(), setup_mode: body.setup_mode } });
      return { companyId, userId };
    });
    res.status(201).json({
      data: {
        token: signToken(secret, out.userId, out.companyId),
        user: { id: out.userId, display_name: body.display_name.trim(), role: 'owner' },
        company: { id: out.companyId, name: body.company_name.trim() },
      },
    });
  });

  return r;
}
