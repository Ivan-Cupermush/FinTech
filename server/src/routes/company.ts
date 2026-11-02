import { Router } from 'express';
import { z } from 'zod';
import { canManageOrg, companyModules, disabledModules, MODULE_KEYS, MODULE_PRESETS, modulesDiff, type CompanyModules, type ModuleKey } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { forbidden, invalid } from '../http/errors';
import { parseBody } from '../http/validate';
import { noRealtime, type Realtime } from '../realtime/hub';
import { audit } from '../services/audit';
import { loadModules } from '../services/modules';

const bodySchema = z.union([
  z.object({ preset: z.enum(MODULE_PRESETS.map((p) => p.key) as [string, ...string[]]) }).strict(),
  z.object({ modules: z.partialRecord(z.enum(MODULE_KEYS), z.boolean()) }).strict(),
]);

/**
 * Функции компании: какие крупные разделы включены. Смотреть может любой
 * сотрудник (сайт и приложение прячут выключенное), менять — владелец или
 * администратор. Каждое изменение — в журнале.
 */
export function companyRouter(db: Db, rt: Realtime = noRealtime): Router {
  const r = Router();

  r.get('/modules', async (req, res) => {
    const actor = actorOf(req);
    res.json({ data: { modules: await loadModules(db, actor.company_id), can_change: canManageOrg(actor) } });
  });

  /** { modules: { sales: false } } — поменять отдельные разделы; { preset: 'university' } — готовый набор целиком. */
  r.put('/modules', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Функции компании меняет владелец или администратор');
    const body = parseBody(bodySchema, req.body);
    if ('modules' in body && !Object.keys(body.modules).length) throw invalid('Нечего менять', { modules: 'Выберите раздел' });
    const data = await db.tx(async (q) => {
      const before = await loadModules(q, actor.company_id);
      const after: CompanyModules =
        'preset' in body ? { ...MODULE_PRESETS.find((p) => p.key === body.preset)!.modules } : { ...before, ...(body.modules as Partial<Record<ModuleKey, boolean>>) };
      const changes = modulesDiff(before, after);
      if (Object.keys(changes).length) {
        await q.query(`UPDATE companies SET disabled_modules = $2 WHERE id = $1`, [actor.company_id, disabledModules(after)]);
        await audit(q, {
          company_id: actor.company_id,
          entity_type: 'company',
          entity_id: actor.company_id,
          actor_id: actor.id,
          event_type: 'company.modules_changed',
          old_values: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as ModuleKey]])),
          new_values: { ...Object.fromEntries(Object.keys(changes).map((k) => [k, after[k as ModuleKey]])), ...('preset' in body ? { preset: body.preset } : {}) },
        });
      }
      return { modules: companyModules(disabledModules(after)), can_change: true, changed: Object.keys(changes) as ModuleKey[] };
    });
    // Сайт и приложение у всех сотрудников сразу перестраивают меню.
    if (data.changed.length) rt.emitCompany(actor.company_id, 'modules_changed', { changed: data.changed });
    res.json({ data: { modules: data.modules, can_change: data.can_change } });
  });

  /** Кто и когда менял функции — последние 20 изменений, для экрана настроек. */
  r.get('/modules/history', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Журнал функций компании видит владелец или администратор');
    const { rows } = await db.query(
      `SELECT e.id, e.created_at, e.old_values, e.new_values, u.display_name AS actor_name
         FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.company_id = $1 AND e.entity_type = 'company' AND e.event_type = 'company.modules_changed'
        ORDER BY e.created_at DESC LIMIT 20`,
      [actor.company_id],
    );
    res.json({ data: rows });
  });

  return r;
}
