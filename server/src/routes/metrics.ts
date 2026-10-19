import { Router } from 'express';
import { productMetrics } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { loadMetricsInput } from '../services/metrics';

/**
 * Продуктовые метрики по целям, которые видит человек. Руководитель видит
 * эффект своих подразделений, администратор — всей компании. Всё считается из
 * замеров, истории задач и журнала: ручного ввода цифр здесь нет.
 */
export function metricsRouter(db: Db, now: () => Date): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const at = now().toISOString();
    const input = await loadMetricsInput(db, actor, at);
    const data = productMetrics(input, at);
    res.json({ data: { ...data, scope: actor.role === 'owner' || actor.role === 'admin' ? 'company' : 'visible' } });
  });

  return r;
}
