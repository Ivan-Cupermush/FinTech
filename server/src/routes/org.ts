import { Router } from 'express';
import { z } from 'zod';
import { canManageOrg, checkNesting, checkReparent, UNIT_TYPES, type UnitType } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { conflict, forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { audit } from '../services/audit';
import { loadOrg } from '../services/org';

const COLOR = /^#[0-9a-f]{6}$/i;

export function orgRouter(db: Db): Router {
  const r = Router();

  /** Плоский список узлов с руководителями и численностью; дерево собирает клиент. */
  r.get('/units', async (req, res) => {
    const actor = actorOf(req);
    const { rows } = await db.query(
      `SELECT o.id, o.parent_unit_id, o.name, o.unit_type, o.description, o.color, o.status,
              (SELECT COUNT(*)::int FROM org_memberships m WHERE m.unit_id = o.id AND m.ended_at IS NULL) AS member_count,
              COALESCE((SELECT json_agg(json_build_object('id', u.id, 'display_name', u.display_name))
                 FROM org_memberships m JOIN users u ON u.id = m.user_id
                WHERE m.unit_id = o.id AND m.is_manager AND m.ended_at IS NULL), '[]'::json) AS managers,
              (SELECT COUNT(*)::int FROM goal_org_units gu JOIN goals g ON g.id = gu.goal_id WHERE gu.unit_id = o.id AND g.status = 'active') AS active_goals
         FROM org_units o WHERE o.company_id = $1 AND ($2 OR o.status = 'active') ORDER BY o.name`,
      [actor.company_id, req.query.include_archived === '1'],
    );
    res.json({ data: rows });
  });

  r.get('/units/:id/members', async (req, res) => {
    const actor = actorOf(req);
    const id = idParam(req.params.id);
    const { rows } = await db.query(
      `SELECT u.id, u.display_name, u.position, m.is_manager, m.is_primary, m.started_at
         FROM org_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.unit_id = $1 AND m.company_id = $2 AND m.ended_at IS NULL ORDER BY m.is_manager DESC, u.display_name`,
      [id, actor.company_id],
    );
    res.json({ data: rows });
  });

  r.post('/units', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Менять структуру может администратор');
    const body = parseBody(
      z.object({ name: z.string().max(1000), unit_type: z.enum(UNIT_TYPES), parent_unit_id: z.string().nullable().optional(), description: z.string().max(2000).nullable().optional(), color: z.string().max(7).nullable().optional() }),
      req.body,
    );
    const errors: Record<string, string> = {};
    if (!body.name.trim()) errors.name = 'Введите название';
    else if (body.name.trim().length > 150) errors.name = 'Название — не длиннее 150 символов';
    if (body.color && !COLOR.test(body.color)) errors.color = 'Цвет в формате #RRGGBB';
    if (body.parent_unit_id && !isUuid(body.parent_unit_id)) errors.parent_unit_id = 'Родительское подразделение не найдено';
    if (Object.keys(errors).length) throw invalid('Не удалось создать подразделение', errors);
    const data = await db.tx(async (q) => {
      if (body.parent_unit_id) {
        const p = await q.query<{ unit_type: UnitType }>(`SELECT unit_type FROM org_units WHERE id = $1 AND company_id = $2 AND status = 'active'`, [body.parent_unit_id, actor.company_id]);
        if (!p.rows[0]) throw invalid('Не удалось создать подразделение', { parent_unit_id: 'Родительское подразделение не найдено' });
        const e = checkNesting(p.rows[0].unit_type, body.unit_type);
        if (e) throw invalid('Не удалось создать подразделение', { unit_type: e });
      }
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO org_units (company_id, parent_unit_id, name, unit_type, description, color) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [actor.company_id, body.parent_unit_id ?? null, body.name.trim(), body.unit_type, body.description?.trim() || null, body.color ?? null],
      );
      await audit(q, { company_id: actor.company_id, entity_type: 'org_unit', entity_id: rows[0]!.id, actor_id: actor.id, event_type: 'org_unit.created', new_values: body });
      // Структурированная организация: компания из быстрого старта получает уровни в любой момент.
      await q.query(`UPDATE companies SET setup_mode = 'structured' WHERE id = $1`, [actor.company_id]);
      return { id: rows[0]!.id, ...body, name: body.name.trim() };
    });
    res.status(201).json({ data });
  });

  r.patch('/units/:id', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Менять структуру может администратор');
    const id = idParam(req.params.id);
    const body = parseBody(
      z.object({ name: z.string().max(1000).optional(), parent_unit_id: z.string().nullable().optional(), description: z.string().max(2000).nullable().optional(), status: z.enum(['active', 'archived']).optional(), color: z.string().max(7).nullable().optional() }),
      req.body,
    );
    const data = await db.tx(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`org-tree:${actor.company_id}`]);
      const org = await loadOrg(q, actor.company_id);
      const unit = org.units.find((u) => u.id === id);
      if (!unit) throw notFound('Подразделение не найдено');
      const errors: Record<string, string> = {};
      if (body.name !== undefined && !body.name.trim()) errors.name = 'Введите название';
      if (body.color && !COLOR.test(body.color)) errors.color = 'Цвет в формате #RRGGBB';
      if (body.parent_unit_id !== undefined) {
        if (body.parent_unit_id && !isUuid(body.parent_unit_id)) errors.parent_unit_id = 'Родительское подразделение не найдено';
        else {
          const e = checkReparent(org.units, id, body.parent_unit_id);
          if (e) errors.parent_unit_id = e;
        }
      }
      if (Object.keys(errors).length) throw invalid('Не удалось сохранить подразделение', errors);
      if (body.status === 'archived') {
        const kids = org.units.filter((u) => u.parent_unit_id === id && u.status !== 'archived');
        if (kids.length) throw conflict('Сначала перенесите или архивируйте вложенные подразделения');
      }
      await q.query(
        `UPDATE org_units SET name = COALESCE($2, name), parent_unit_id = CASE WHEN $3 THEN $4::uuid ELSE parent_unit_id END,
                description = CASE WHEN $5 THEN $6 ELSE description END, status = COALESCE($7, status),
                color = CASE WHEN $8 THEN $9 ELSE color END, updated_at = NOW()
          WHERE id = $1`,
        [id, body.name?.trim() ?? null, body.parent_unit_id !== undefined, body.parent_unit_id ?? null, body.description !== undefined, body.description?.trim() || null, body.status ?? null, body.color !== undefined, body.color ?? null],
      );
      await audit(q, { company_id: actor.company_id, entity_type: 'org_unit', entity_id: id, actor_id: actor.id, event_type: 'org_unit.updated', old_values: unit, new_values: body });
      return { id, ...body };
    });
    res.json({ data });
  });

  /** Добавить человека в узел. Повторное добавление обновляет флаги, а не создаёт дубль. */
  r.post('/units/:id/members', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Менять состав может администратор');
    const id = idParam(req.params.id);
    const body = parseBody(z.object({ user_id: z.string(), is_manager: z.boolean().default(false), is_primary: z.boolean().default(false) }), req.body);
    if (!isUuid(body.user_id)) throw invalid('Не удалось добавить сотрудника', { user_id: 'Сотрудник не найден' });
    await db.tx(async (q) => {
      const u = await q.query(`SELECT 1 FROM org_units WHERE id = $1 AND company_id = $2 AND status = 'active'`, [id, actor.company_id]);
      if (!u.rows.length) throw notFound('Подразделение не найдено');
      const m = await q.query(`SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2`, [actor.company_id, body.user_id]);
      if (!m.rows.length) throw invalid('Не удалось добавить сотрудника', { user_id: 'Сотрудник не найден' });
      if (body.is_primary) await q.query(`UPDATE org_memberships SET is_primary = FALSE WHERE user_id = $1 AND company_id = $2 AND ended_at IS NULL`, [body.user_id, actor.company_id]);
      const upd = await q.query(
        `UPDATE org_memberships SET is_manager = $3, is_primary = $4 WHERE unit_id = $1 AND user_id = $2 AND ended_at IS NULL RETURNING id`,
        [id, body.user_id, body.is_manager, body.is_primary],
      );
      if (!upd.rows.length) {
        await q.query(`INSERT INTO org_memberships (company_id, user_id, unit_id, is_manager, is_primary) VALUES ($1, $2, $3, $4, $5)`, [actor.company_id, body.user_id, id, body.is_manager, body.is_primary]);
      }
      await audit(q, { company_id: actor.company_id, entity_type: 'org_unit', entity_id: id, actor_id: actor.id, event_type: 'org_unit.member_set', new_values: body });
    });
    res.status(204).end();
  });

  /** Убрать из узла: членство закрывается датой, история остаётся. */
  r.delete('/units/:id/members/:userId', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Менять состав может администратор');
    const id = idParam(req.params.id);
    const userId = idParam(req.params.userId);
    await db.tx(async (q) => {
      const r2 = await q.query(
        `UPDATE org_memberships SET ended_at = CURRENT_DATE WHERE unit_id = $1 AND user_id = $2 AND company_id = $3 AND ended_at IS NULL RETURNING id`,
        [id, userId, actor.company_id],
      );
      if (!r2.rows.length) throw notFound('Сотрудник не состоит в подразделении');
      await audit(q, { company_id: actor.company_id, entity_type: 'org_unit', entity_id: id, actor_id: actor.id, event_type: 'org_unit.member_removed', old_values: { user_id: userId } });
    });
    res.status(204).end();
  });

  return r;
}
