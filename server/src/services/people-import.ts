import { randomInt } from 'node:crypto';
import { checkNesting, planPeopleImport, tempPassword, unitIndex, unitPathKey, type CompanyRole, type ImportedCredential, type OrgUnit, type PeopleMapping, type PeoplePlan } from '@offix/core';
import { hashPassword, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { invalid } from '../http/errors';
import { audit } from './audit';

/**
 * Импорт сотрудников и структуры: план (что будет с каждой строкой) и его
 * выполнение одной транзакцией. Пароли временные, показываются один раз и
 * хранятся только хешем.
 */

async function context(q: Queryable, actor: AuthedActor, emails: string[]) {
  const units = await q.query<OrgUnit>(`SELECT id, parent_unit_id, name, unit_type, status FROM org_units WHERE company_id = $1`, [actor.company_id]);
  const found = await q.query<{ email: string; in_company: boolean }>(
    `SELECT lower(u.email) AS email, EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = u.id AND m.company_id = $2) AS in_company
       FROM users u WHERE lower(u.email) = ANY($1::text[])`,
    [emails, actor.company_id],
  );
  return {
    units: units.rows,
    companyEmails: found.rows.filter((r) => r.in_company).map((r) => r.email),
    takenEmails: found.rows.filter((r) => !r.in_company).map((r) => r.email),
  };
}

export async function planForCompany(q: Queryable, actor: AuthedActor, rows: string[][], lines: number[], mapping: PeopleMapping): Promise<{ plan: PeoplePlan; units: OrgUnit[] }> {
  const emailCol = mapping.email;
  const emails = emailCol >= 0 ? [...new Set(rows.map((r) => (r[emailCol] ?? '').trim().toLowerCase()).filter(Boolean))] : [];
  const ctx = await context(q, actor, emails);
  return { plan: planPeopleImport(rows, lines, mapping, { ...ctx, actorRole: actor.role as CompanyRole }), units: ctx.units };
}

export interface ImportResult {
  plan: PeoplePlan;
  created: number;
  units_created: number;
  credentials: ImportedCredential[];
}

/**
 * Выполнить план. Пароли хешируем до транзакции (bcrypt — это время), а в
 * транзакции план пересчитываем: если за это время кто-то занял почту или
 * удалил подразделение, строка не создастся криво.
 */
export async function runPeopleImport(db: Db, actor: AuthedActor, rows: string[][], lines: number[], mapping: PeopleMapping): Promise<ImportResult> {
  const first = await planForCompany(db, actor, rows, lines, mapping);
  if (!first.plan.counts.new) throw invalid('Некого добавлять', { rows: 'В файле нет новых сотрудников без ошибок' });
  const secrets = new Map<string, { password: string; hash: string }>();
  for (const r of first.plan.rows) {
    if (r.status !== 'new') continue;
    const password = tempPassword((n) => randomInt(n));
    secrets.set(r.email, { password, hash: await hashPassword(password) });
  }

  return db.tx(async (q) => {
    const { plan, units } = await planForCompany(q, actor, rows, lines, mapping);
    const index = unitIndex(units);
    const byType = new Map(units.map((u) => [u.id, u.unit_type]));
    const created = new Map<string, string>();
    for (const u of plan.units) {
      const parentId = u.parent_id ?? (u.parent_path ? created.get(unitPathKey(u.parent_path)) ?? null : null);
      const parentType = parentId ? byType.get(parentId) : null;
      if (parentType) {
        const e = checkNesting(parentType, u.unit_type);
        if (e) throw invalid('Не удалось создать структуру', { units: `«${u.path.join(' / ')}»: ${e}` });
      }
      const { rows: ins } = await q.query<{ id: string }>(
        `INSERT INTO org_units (company_id, parent_unit_id, name, unit_type) VALUES ($1, $2, $3, $4) RETURNING id`,
        [actor.company_id, parentId, u.name, u.unit_type],
      );
      const id = ins[0]!.id;
      created.set(unitPathKey(u.path), id);
      byType.set(id, u.unit_type);
      await audit(q, { company_id: actor.company_id, entity_type: 'org_unit', entity_id: id, actor_id: actor.id, event_type: 'org_unit.created', new_values: { name: u.name, unit_type: u.unit_type, via: 'import' } });
    }
    if (plan.units.length) await q.query(`UPDATE companies SET setup_mode = 'structured' WHERE id = $1`, [actor.company_id]);

    const credentials: ImportedCredential[] = [];
    for (const r of plan.rows) {
      if (r.status !== 'new') continue;
      const secret = secrets.get(r.email);
      if (!secret) continue; // строка стала новой только сейчас — пусть повторят импорт
      const { rows: ins } = await q.query<{ id: string }>(`INSERT INTO users (email, password_hash, display_name, position) VALUES ($1, $2, $3, $4) RETURNING id`, [
        r.email,
        secret.hash,
        r.name,
        r.position,
      ]);
      const id = ins[0]!.id;
      await q.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)`, [actor.company_id, id, r.role]);
      if (r.unit_path.length) {
        const key = unitPathKey(r.unit_path);
        const unitId = created.get(key) ?? index.get(key)?.id;
        if (unitId) await q.query(`INSERT INTO org_memberships (company_id, user_id, unit_id, is_manager, is_primary) VALUES ($1, $2, $3, $4, true)`, [actor.company_id, id, unitId, r.is_manager]);
      }
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: id, actor_id: actor.id, event_type: 'member.invited', new_values: { email: r.email, role: r.role, via: 'import' } });
      credentials.push({ name: r.name, email: r.email, password: secret.password });
    }
    await audit(q, {
      company_id: actor.company_id,
      entity_type: 'member',
      entity_id: actor.id,
      actor_id: actor.id,
      event_type: 'member.imported',
      new_values: { created: credentials.length, units: plan.units.length, skipped: plan.counts.exists, errors: plan.counts.error },
    });
    return { plan, created: credentials.length, units_created: plan.units.length, credentials };
  });
}
