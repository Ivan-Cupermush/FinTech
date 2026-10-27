import { functionDisabled, functionScope, scopeCovers, type CompanyRole, type DelegableFunction, type DelegationContext, type FunctionGrant, type OrgContext } from '@offix/core';
import type { AuthedActor } from '../auth/auth';
import type { Queryable } from '../db/db';
import { loadOrg } from './org';

/** Роли, оргструктура и переданные функции компании — всё, что нужно правилам из core/delegation. */
export async function loadDelegation(q: Queryable, companyId: string, org?: OrgContext): Promise<DelegationContext> {
  const [o, roles, grants] = await Promise.all([
    org ?? loadOrg(q, companyId),
    q.query<{ user_id: string; role: CompanyRole }>(`SELECT m.user_id, m.role FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1 AND u.active`, [companyId]),
    q.query<FunctionGrant>(`SELECT user_id, fn, allowed, granted_by FROM user_functions WHERE company_id = $1`, [companyId]),
  ]);
  return { ...o, roles: new Map(roles.rows.map((r) => [r.user_id, r.role])), grants: grants.rows };
}

/**
 * Право на действие с функцией. «По роли» (как было до функций) — пока
 * функцию явно не отключили; переданная функция добавляет право там, где
 * она действует (вся компания или подразделения того, кто её включил).
 */
export async function allowedByFunction(
  q: Queryable,
  actor: AuthedActor,
  fn: DelegableFunction,
  opts: { byRole: boolean; unitIds?: readonly string[]; org?: OrgContext },
): Promise<boolean> {
  if (actor.role === 'owner' || actor.role === 'admin') return true;
  if (actor.role === 'observer') return false;
  const ctx = await loadDelegation(q, actor.company_id, opts.org);
  if (opts.byRole && !functionDisabled(ctx, actor.id, fn)) return true;
  const scope = functionScope(ctx, actor.id, fn);
  if (!scope) return false;
  return opts.unitIds ? scopeCovers(scope, opts.unitIds) : true;
}
