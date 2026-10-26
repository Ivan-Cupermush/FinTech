import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { QR_LOGIN_TTL_SECONDS, describeDevice, isQrLoginToken, type QrLoginInfo, type QrLoginStatus } from '@offix/core';
import type { Queryable } from '../db/db';
import { ApiError, notFound } from '../http/errors';

/**
 * Вход на сайт по QR-коду с телефона (как в Telegram Web).
 *
 * 1. Сайт: POST /auth/qr → { token, secret }. token рисуется в QR-коде,
 *    secret остаётся в браузере.
 * 2. Телефон, где человек уже вошёл: GET /account/qr/:token — какое
 *    устройство просит вход; код закрепляется за этим человеком.
 * 3. Телефон: POST /account/qr/:token/approve (или /decline) — только тот,
 *    кто отсканировал.
 * 4. Сайт: POST /auth/qr/poll { token, secret } → после подтверждения ровно
 *    один раз получает вход, как при вводе пароля.
 *
 * Сфотографировать код с чужого экрана бесполезно: без secret вход не
 * забрать, а без подтверждения на телефоне его просто нет.
 */

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface QrRow {
  id: string;
  status: 'pending' | 'scanned' | 'approved' | 'declined' | 'used';
  user_id: string | null;
  company_id: string | null;
  secret_hash: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  expires_at: string;
}

const QR_COLS = `id, status, user_id, company_id, secret_hash, user_agent, ip, created_at, expires_at`;

export async function createQrLogin(q: Queryable, at: Date, meta: { userAgent: string; ip: string | null }) {
  const token = randomBytes(24).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  const expires = new Date(at.getTime() + QR_LOGIN_TTL_SECONDS * 1000).toISOString();
  // Старые коды больше не нужны — заодно убираем.
  await q.query(`DELETE FROM qr_logins WHERE expires_at < $1`, [new Date(at.getTime() - 86_400_000).toISOString()]);
  await q.query(`INSERT INTO qr_logins (token_hash, secret_hash, user_agent, ip, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    sha256(token),
    sha256(secret),
    meta.userAgent.slice(0, 500),
    meta.ip?.slice(0, 64) ?? null,
    at.toISOString(),
    expires,
  ]);
  return { token, secret, expires_at: expires, ttl: QR_LOGIN_TTL_SECONDS };
}

export async function findQr(q: Queryable, token: string, lock = false): Promise<QrRow | null> {
  if (!isQrLoginToken(token)) return null;
  const { rows } = await q.query<QrRow>(`SELECT ${QR_COLS} FROM qr_logins WHERE token_hash = $1${lock ? ' FOR UPDATE' : ''}`, [sha256(token)]);
  return rows[0] ?? null;
}

export const isExpired = (row: Pick<QrRow, 'expires_at'>, at: Date) => Date.parse(row.expires_at) <= at.getTime();

/** Код с телефона: несуществующий и битый — одно сообщение, без подсказок. */
export async function qrForPhone(q: Queryable, token: string, lock = false): Promise<QrRow> {
  if (!isQrLoginToken(token)) throw new ApiError('BAD_REQUEST', 'Это не код входа offix');
  const row = await findQr(q, token, lock);
  if (!row) throw notFound('Код входа не найден. Обновите страницу на компьютере и отсканируйте новый код');
  return row;
}

export function phoneView(row: QrRow, at: Date): QrLoginInfo {
  const live = row.status === 'pending' || row.status === 'scanned';
  const status: QrLoginStatus = live && isExpired(row, at) ? 'expired' : row.status === 'used' ? 'approved' : (row.status as QrLoginStatus);
  return { status, device: describeDevice(row.user_agent), ip: row.ip, created_at: row.created_at, expires_at: row.expires_at };
}
