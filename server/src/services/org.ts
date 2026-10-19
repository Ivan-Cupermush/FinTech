import type { Membership, OrgContext, OrgUnit } from '@offix/core';
import type { Queryable } from '../db/db';

/** Оргструктура компании для проверки прав: активные узлы и текущие членства. */
export async function loadOrg(q: Queryable, companyId: string): Promise<OrgContext> {
  const units = await q.query<OrgUnit>(
    `SELECT id, parent_unit_id, name, unit_type, status FROM org_units WHERE company_id = $1`,
    [companyId],
  );
  const memberships = await q.query<Membership>(
    `SELECT user_id, unit_id, is_manager, is_primary FROM org_memberships WHERE company_id = $1 AND ended_at IS NULL`,
    [companyId],
  );
  return { units: units.rows, memberships: memberships.rows };
}
