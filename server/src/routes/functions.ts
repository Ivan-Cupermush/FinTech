import { Router } from 'express';
import { z } from 'zod';
import { canChangeFunctions, DELEGABLE_KEYS, functionDetails, functionInfo, managersOf, planFunctionChange, type DelegableFunction } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { forbidden, invalid, notFound } from '../http/errors';
import { idParam, parseBody } from '../http/validate';
import type { Realtime } from '../realtime/hub';
import { audit } from '../services/audit';
import { loadDelegation } from '../services/functions';
import { inbox } from '../services/notify';

const changesSchema = z.object({
  changes: z.partialRecord(z.enum(DELEGABLE_KEYS as [DelegableFunction, ...DelegableFunction[]]), z.boolean().nullable()),
});

/**
 * Функции сотрудника: что ему включил или отключил руководитель. Видят сам
 * сотрудник, его руководители и администраторы. Меняет — администратор
 * любому, руководитель — своим подчинённым.
 */
export function functionsRouter(db: Db, rt: Realtime): Router {
  const r = Router();

  r.get('/me', async (req, res) => {
    const actor = actorOf(req);
    const ctx = await loadDelegation(db, actor.company_id);
    res.json({ data: { functions: functionDetails(ctx, actor.id), can_change: false, reason: canChangeFunctions(ctx, actor.id, actor.id) } });
  });

  r.get('/users/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const ctx = await loadDelegation(db, actor.company_id);
    if (!ctx.roles.has(id)) throw notFound('Сотрудник не найден');
    const admin = actor.role === 'owner' || actor.role === 'admin';
    if (id !== actor.id && !admin && !managersOf(ctx.units, ctx.memberships, id).has(actor.id)) throw notFound('Сотрудник не найден');
    const reason = canChangeFunctions(ctx, actor.id, id);
    res.json({ data: { functions: functionDetails(ctx, id), can_change: reason === null, reason } });
  });

  /** { changes: { kpi_record: true, knowledge_manage: null } } — включить, отключить или вернуть «по должности». */
  r.put('/users/:id', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const { changes } = parseBody(changesSchema, req.body);
    if (!Object.keys(changes).length) throw invalid('Нечего менять', { changes: 'Выберите функцию' });
    const box = inbox();
    const data = await db.tx(async (q) => {
      const ctx = await loadDelegation(q, actor.company_id);
      const reason = canChangeFunctions(ctx, actor.id, id);
      if (reason) throw reason === 'Сотрудник не найден' ? notFound(reason) : forbidden(reason);
      const before = functionDetails(ctx, id);
      for (const [fn, raw] of Object.entries(changes) as [DelegableFunction, boolean | null][]) {
        const plan = planFunctionChange(ctx, actor.id, id, fn, raw);
        if ('error' in plan) throw forbidden(plan.error);
        if (plan.value === null) {
          await q.query(`DELETE FROM user_functions WHERE company_id = $1 AND user_id = $2 AND fn = $3`, [actor.company_id, id, fn]);
        } else {
          await q.query(
            `INSERT INTO user_functions (company_id, user_id, fn, allowed, granted_by) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (company_id, user_id, fn) DO UPDATE SET allowed = EXCLUDED.allowed, granted_by = EXCLUDED.granted_by, updated_at = NOW()`,
            [actor.company_id, id, fn, plan.value, actor.id],
          );
        }
      }
      const after = functionDetails(await loadDelegation(q, actor.company_id), id);
      const changed = after.filter((a) => before.find((b) => b.key === a.key)!.enabled !== a.enabled);
      await audit(q, {
        company_id: actor.company_id,
        entity_type: 'member',
        entity_id: id,
        actor_id: actor.id,
        event_type: 'user.functions_changed',
        old_values: Object.fromEntries(before.map((b) => [b.key, b.enabled])),
        new_values: Object.fromEntries(after.map((a) => [a.key, a.enabled])),
      });
      const on = changed.filter((c) => c.enabled);
      const off = changed.filter((c) => !c.enabled);
      if (on.length || off.length) {
        await box.notify(
          q,
          {
            company_id: actor.company_id,
            user_id: id,
            kind: 'function_granted',
            title: on.length ? `Вам включили: ${on.map((c) => `«${functionInfo(c.key).label}»`).join(', ')}` : `Вам отключили: ${off.map((c) => `«${functionInfo(c.key).label}»`).join(', ')}`,
            body: on.length && off.length ? `Отключили: ${off.map((c) => `«${functionInfo(c.key).label}»`).join(', ')}` : null,
          },
          actor.id,
        );
      }
      return { functions: after, can_change: true, reason: null };
    });
    box.flush(rt, actor.company_id);
    res.json({ data });
  });

  return r;
}
