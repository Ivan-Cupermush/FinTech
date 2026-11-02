import type { RequestHandler } from 'express';
import { companyModules, moduleOffMessage, type CompanyModules, type ModuleKey } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Queryable } from '../db/db';
import { ApiError } from '../http/errors';

/** Включённые разделы компании. Компании нет — считаем, что включено всё. */
export async function loadModules(q: Queryable, companyId: string): Promise<CompanyModules> {
  const { rows } = await q.query<{ disabled_modules: string[] }>(`SELECT disabled_modules FROM companies WHERE id = $1`, [companyId]);
  return companyModules(rows[0]?.disabled_modules);
}

export const moduleDisabled = (key: ModuleKey) => new ApiError('MODULE_DISABLED', moduleOffMessage(key), { module: key });

/**
 * Раздел выключен в компании — 403 с кодом MODULE_DISABLED и ключом раздела:
 * сайт и приложение показывают «Раздел выключен», а не общую ошибку прав.
 * Проверяем на каждый запрос: выключили — и раздел закрыт сразу, без перезапуска.
 */
export function requireModule(q: Queryable, ...keys: ModuleKey[]): RequestHandler {
  return async (req, _res, next) => {
    try {
      const mods = await loadModules(q, actorOf(req).company_id);
      const off = keys.find((k) => !mods[k]);
      next(off ? moduleDisabled(off) : undefined);
    } catch (e) {
      next(e);
    }
  };
}
