import { Router } from 'express';
import { z } from 'zod';
import { PUSH_TOPICS, isExpoPushToken } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { invalid } from '../http/errors';
import { parseBody } from '../http/validate';
import { loadPushSettings } from '../services/push';

/**
 * Устройства и настройки push. Токен принадлежит одному человеку: если на
 * телефоне вошёл другой сотрудник, токен переходит к нему, и чужие
 * уведомления на этот телефон больше не приходят.
 */
export function pushRouter(db: Db): Router {
  const r = Router();

  r.post('/devices', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ token: z.string(), platform: z.enum(['ios', 'android']) }), req.body);
    if (!isExpoPushToken(body.token)) throw invalid('Не удалось включить уведомления', { token: 'Некорректный токен устройства' });
    const { rows } = await db.query<{ created: boolean }>(
      `INSERT INTO push_devices (token, user_id, company_id, platform) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, company_id = EXCLUDED.company_id, platform = EXCLUDED.platform,
                                         last_seen_at = NOW(), disabled_at = NULL
       RETURNING (xmax = 0) AS created`,
      [body.token, actor.id, actor.company_id, body.platform],
    );
    res.status(rows[0]?.created ? 201 : 200).json({ data: { registered: true } });
  });

  /** При выходе приложение отвязывает телефон. Чужой токен удалить нельзя — ответ тот же. */
  r.delete('/devices/:token', async (req, res) => {
    const actor = actorOf(req);
    await db.query(`DELETE FROM push_devices WHERE token = $1 AND user_id = $2`, [String(req.params.token), actor.id]);
    res.status(204).end();
  });

  r.get('/settings', async (req, res) => {
    const actor = actorOf(req);
    const settings = await loadPushSettings(db, actor.id, actor.company_id);
    const devices = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM push_devices WHERE user_id = $1 AND company_id = $2 AND disabled_at IS NULL`, [actor.id, actor.company_id]);
    res.json({ data: { ...settings, devices: devices.rows[0]?.n ?? 0 } });
  });

  r.put('/settings', async (req, res) => {
    const actor = actorOf(req);
    const body = parseBody(z.object({ muted: z.array(z.enum(PUSH_TOPICS)).max(PUSH_TOPICS.length), quiet_hours: z.boolean() }), req.body);
    const muted = PUSH_TOPICS.filter((t) => body.muted.includes(t));
    await db.query(
      `INSERT INTO push_settings (user_id, company_id, muted, quiet_hours) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, company_id) DO UPDATE SET muted = EXCLUDED.muted, quiet_hours = EXCLUDED.quiet_hours, updated_at = NOW()`,
      [actor.id, actor.company_id, muted, body.quiet_hours],
    );
    res.json({ data: { muted, quiet_hours: body.quiet_hours } });
  });

  return r;
}
