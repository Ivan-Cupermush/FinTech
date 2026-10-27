import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import type { Actor, CompanyRole } from '@offix/core';
import type { Db, Queryable } from '../db/db';
import { ApiError } from '../http/errors';

export interface AuthedActor extends Actor {
  company_id: string;
  display_name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    actor?: AuthedActor;
  }
}

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, hash: string) => bcrypt.compare(p, hash);

/** tv — версия токенов человека на момент выдачи (users.token_version). */
export function signToken(secret: string, userId: string, companyId: string, tokenVersion = 0): string {
  return jwt.sign({ cid: companyId, tv: tokenVersion }, secret, { subject: userId, expiresIn: '30d', algorithm: 'HS256' });
}

/** Новый токен с текущей версией: после входа, смены пароля, завершения других сеансов. */
export async function issueToken(q: Queryable, secret: string, userId: string, companyId: string): Promise<string> {
  const { rows } = await q.query<{ token_version: number }>(`SELECT token_version FROM users WHERE id = $1`, [userId]);
  return signToken(secret, userId, companyId, rows[0]?.token_version ?? 0);
}

/** Все выданные раньше токены человека перестают работать. */
export async function revokeSessions(q: Queryable, userId: string): Promise<void> {
  await q.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [userId]);
}

export interface TokenUser {
  id: string;
  role: CompanyRole;
  display_name: string;
  company_id: string;
}

/**
 * Проверка токена: подпись, срок, человек активен и состоит в компании,
 * версия токена совпадает с текущей. Роль и активность читаются из базы
 * каждый раз — отключённый сотрудник теряет доступ сразу.
 */
export async function verifyToken(q: Queryable, secret: string, token: string): Promise<TokenUser | null> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.sub !== 'string' || typeof payload.cid !== 'string') return null;
  const { rows } = await q.query<TokenUser & { token_version: number }>(
    `SELECT u.id, m.role, u.display_name, m.company_id, u.token_version
       FROM users u JOIN company_members m ON m.user_id = u.id
      WHERE u.id = $1 AND m.company_id = $2 AND u.active`,
    [payload.sub, payload.cid],
  );
  const row = rows[0];
  // Токены до появления версий (без tv) считаются версией 0.
  if (!row || (typeof payload.tv === 'number' ? payload.tv : 0) !== row.token_version) return null;
  return { id: row.id, role: row.role, display_name: row.display_name, company_id: row.company_id };
}

export function requireAuth(db: Db, secret: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new ApiError('UNAUTHORIZED', 'Войдите, чтобы продолжить');
      const user = await verifyToken(db, secret, token);
      if (!user) throw new ApiError('UNAUTHORIZED', 'Сессия завершена — войдите снова');
      req.actor = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function actorOf(req: { actor?: AuthedActor }): AuthedActor {
  if (!req.actor) throw new ApiError('UNAUTHORIZED', 'Войдите, чтобы продолжить');
  return req.actor;
}
