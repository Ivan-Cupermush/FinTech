import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { canManageOrg, COMPANY_ROLES } from '@offix/core';
import { actorOf, hashPassword } from '../auth/auth';
import type { Db } from '../db/db';
import { conflict, forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { audit } from '../services/audit';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function usersRouter(db: Db): Router {
  const r = Router();

  r.get('/me', async (req, res) => {
    const actor = actorOf(req);
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.display_name, u.position, m.role, c.id AS company_id, c.name AS company_name, c.setup_mode
         FROM users u JOIN company_members m ON m.user_id = u.id JOIN companies c ON c.id = m.company_id
        WHERE u.id = $1 AND c.id = $2`,
      [actor.id, actor.company_id],
    );
    const units = await db.query(
      `SELECT o.id, o.name, o.unit_type, mm.is_manager, mm.is_primary FROM org_memberships mm JOIN org_units o ON o.id = mm.unit_id
        WHERE mm.user_id = $1 AND mm.company_id = $2 AND mm.ended_at IS NULL ORDER BY mm.is_primary DESC, o.name`,
      [actor.id, actor.company_id],
    );
    res.json({ data: { ...rows[0], units: units.rows } });
  });

  /** Поиск сотрудников для выбора владельца или исполнителя. */
  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const includeInactive = req.query.include_inactive === '1' && canManageOrg(actor);
    const { rows } = await db.query(
      `SELECT u.id, u.display_name, u.position, u.email, u.active, m.role,
              COALESCE((SELECT json_agg(json_build_object('id', o.id, 'name', o.name, 'is_manager', mm.is_manager) ORDER BY mm.is_primary DESC, o.name)
                 FROM org_memberships mm JOIN org_units o ON o.id = mm.unit_id
                WHERE mm.user_id = u.id AND mm.company_id = m.company_id AND mm.ended_at IS NULL), '[]'::json) AS units
         FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $1
        WHERE ($2 = '' OR u.display_name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%' OR u.position ILIKE '%' || $2 || '%')
          AND ($3 OR u.active)
        ORDER BY u.display_name LIMIT 200`,
      [actor.company_id, search, includeInactive],
    );
    res.json({ data: rows });
  });

  /** Пригласить сотрудника. Пока без почты: возвращаем временный пароль администратору. */
  r.post('/', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Приглашать сотрудников может администратор');
    const body = parseBody(
      z.object({
        email: z.string().max(254),
        display_name: z.string().max(1000),
        position: z.string().max(1000).nullable().optional(),
        role: z.enum(COMPANY_ROLES).default('member'),
        unit_ids: z.array(z.string()).max(20).optional(),
      }),
      req.body,
    );
    const errors: Record<string, string> = {};
    if (!EMAIL.test(body.email.trim())) errors.email = 'Введите корректную почту';
    if (!body.display_name.trim()) errors.display_name = 'Введите имя сотрудника';
    if (body.role === 'owner' && actor.role !== 'owner') errors.role = 'Назначить владельца может только владелец';
    if ((body.unit_ids ?? []).some((u) => !isUuid(u))) errors.unit_ids = 'Подразделение не найдено';
    if (Object.keys(errors).length) throw invalid('Не удалось пригласить сотрудника', errors);
    const tempPassword = randomBytes(9).toString('base64url');
    const hash = await hashPassword(tempPassword);
    const data = await db.tx(async (q) => {
      const exists = await q.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [body.email.trim()]);
      if (exists.rows.length) throw invalid('Не удалось пригласить сотрудника', { email: 'Сотрудник с такой почтой уже есть' });
      const { rows } = await q.query<{ id: string }>(`INSERT INTO users (email, password_hash, display_name, position) VALUES ($1, $2, $3, $4) RETURNING id`, [
        body.email.trim(),
        hash,
        body.display_name.trim(),
        body.position?.trim() || null,
      ]);
      const id = rows[0]!.id;
      await q.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)`, [actor.company_id, id, body.role]);
      for (const [i, unitId] of (body.unit_ids ?? []).entries()) {
        const u = await q.query(`SELECT 1 FROM org_units WHERE id = $1 AND company_id = $2`, [unitId, actor.company_id]);
        if (!u.rows.length) throw invalid('Не удалось пригласить сотрудника', { unit_ids: 'Подразделение не найдено' });
        await q.query(`INSERT INTO org_memberships (company_id, user_id, unit_id, is_primary) VALUES ($1, $2, $3, $4)`, [actor.company_id, id, unitId, i === 0]);
      }
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: id, actor_id: actor.id, event_type: 'member.invited', new_values: { email: body.email.trim(), role: body.role } });
      return { id, display_name: body.display_name.trim(), role: body.role, temp_password: tempPassword };
    });
    res.status(201).json({ data });
  });

  /** Роль и активность. Отключённый сотрудник теряет доступ сразу — токен проверяется по базе. */
  r.patch('/:id', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Менять роли может администратор');
    const id = idParam(req.params.id);
    const body = parseBody(z.object({ role: z.enum(COMPANY_ROLES).optional(), active: z.boolean().optional(), position: z.string().max(120).nullable().optional() }), req.body);
    const data = await db.tx(async (q) => {
      const { rows } = await q.query<{ role: string; active: boolean }>(
        `SELECT m.role, u.active FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1 AND m.user_id = $2`,
        [actor.company_id, id],
      );
      const cur = rows[0];
      if (!cur) throw notFound('Сотрудник не найден');
      if (id === actor.id && (body.active === false || (body.role && body.role !== cur.role))) throw conflict('Нельзя отключить себя или изменить свою роль');
      if ((cur.role === 'owner' || body.role === 'owner') && actor.role !== 'owner') throw forbidden('Права владельца меняет только владелец');
      if (body.role) await q.query(`UPDATE company_members SET role = $3 WHERE company_id = $1 AND user_id = $2`, [actor.company_id, id, body.role]);
      if (body.active !== undefined) await q.query(`UPDATE users SET active = $2 WHERE id = $1`, [id, body.active]);
      if (body.position !== undefined) await q.query(`UPDATE users SET position = $2 WHERE id = $1`, [id, body.position?.trim() || null]);
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: id, actor_id: actor.id, event_type: 'member.updated', old_values: cur, new_values: body });
      return { id, ...body };
    });
    res.json({ data });
  });

  return r;
}
