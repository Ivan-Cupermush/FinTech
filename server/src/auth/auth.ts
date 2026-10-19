import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import type { Actor, CompanyRole } from '@offix/core';
import type { Db } from '../db/db';
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

export function signToken(secret: string, userId: string, companyId: string): string {
  return jwt.sign({ cid: companyId }, secret, { subject: userId, expiresIn: '30d', algorithm: 'HS256' });
}

/** Проверяет токен и каждый раз заново читает роль и активность из базы. */
export function requireAuth(db: Db, secret: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new ApiError('UNAUTHORIZED', 'Войдите, чтобы продолжить');
      let payload: jwt.JwtPayload;
      try {
        payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      } catch {
        throw new ApiError('UNAUTHORIZED', 'Сессия истекла, войдите снова');
      }
      const { rows } = await db.query<{ id: string; role: CompanyRole; display_name: string; company_id: string }>(
        `SELECT u.id, m.role, u.display_name, m.company_id
           FROM users u JOIN company_members m ON m.user_id = u.id
          WHERE u.id = $1 AND m.company_id = $2 AND u.active`,
        [payload.sub, payload.cid],
      );
      const row = rows[0];
      if (!row) throw new ApiError('UNAUTHORIZED', 'Сессия недействительна, войдите снова');
      req.actor = row;
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
