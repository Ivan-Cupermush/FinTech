import { Router } from 'express';
import { z } from 'zod';
import { chatRights, contactNameError, parsePermissions, type ContactName, type PersonCard, type PersonGroup } from '@offix/core';
import { actorOf } from '../auth/auth';
import type { Db } from '../db/db';
import { invalid, notFound } from '../http/errors';
import { idParam, parseBody } from '../http/validate';
import type { Realtime } from '../realtime/hub';

/**
 * Коллеги: `/api/v1/contacts`. Карточка сотрудника (её открывает QR-код
 * профиля), свои имена для коллег («Изменить контакт», как в Telegram —
 * видны только мне) и мои группы, куда коллегу можно добавить.
 */
export function contactsRouter(db: Db, rt: Realtime): Router {
  const r = Router();

  r.get('/names', async (req, res) => {
    const actor = actorOf(req);
    const { rows } = await db.query<ContactName>(`SELECT user_id, name FROM contact_names WHERE owner_id = $1 AND company_id = $2 ORDER BY name`, [actor.id, actor.company_id]);
    res.json({ data: rows });
  });

  /** Пустое имя — вернуть настоящее. */
  r.put('/:userId/name', async (req, res) => {
    const actor = actorOf(req);
    const userId = idParam(req.params.userId);
    const body = parseBody(z.object({ name: z.string().max(1000) }), req.body);
    const err = contactNameError(body.name);
    if (err) throw invalid('Не удалось сохранить имя', { name: err });
    if (userId === actor.id) throw invalid('Не удалось сохранить имя', { name: 'Своё имя меняется в профиле' });
    const member = await db.query(`SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2`, [actor.company_id, userId]);
    if (!member.rows.length) throw notFound('Сотрудник не найден');
    const name = body.name.trim();
    if (!name) await db.query(`DELETE FROM contact_names WHERE owner_id = $1 AND user_id = $2`, [actor.id, userId]);
    else
      await db.query(
        `INSERT INTO contact_names (company_id, owner_id, user_id, name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_id, user_id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [actor.company_id, actor.id, userId, name],
      );
    // Только мне: мои вкладки и приложение обновят подписи сразу.
    rt.emit(actor.company_id, [actor.id], 'contact_names_changed', {});
    res.json({ data: { user_id: userId, name } satisfies ContactName });
  });

  r.delete('/:userId/name', async (req, res) => {
    const actor = actorOf(req);
    await db.query(`DELETE FROM contact_names WHERE owner_id = $1 AND user_id = $2`, [actor.id, idParam(req.params.userId)]);
    rt.emit(actor.company_id, [actor.id], 'contact_names_changed', {});
    res.status(204).end();
  });

  /** Карточка сотрудника своей компании. Чужая компания — 404. */
  r.get('/:userId', async (req, res) => {
    const actor = actorOf(req);
    const userId = idParam(req.params.userId);
    const { rows } = await db.query<Omit<PersonCard, 'online' | 'is_me'>>(
      `SELECT u.id, u.display_name, cn.name AS my_name, u.position, u.email, u.avatar_url, m.role, u.active, u.last_seen_at,
              COALESCE((SELECT json_agg(json_build_object('id', o.id, 'name', o.name, 'is_manager', mm.is_manager) ORDER BY mm.is_primary DESC, o.name)
                 FROM org_memberships mm JOIN org_units o ON o.id = mm.unit_id
                WHERE mm.user_id = u.id AND mm.company_id = m.company_id AND mm.ended_at IS NULL), '[]'::json) AS units
         FROM users u JOIN company_members m ON m.user_id = u.id AND m.company_id = $2
         LEFT JOIN contact_names cn ON cn.owner_id = $3 AND cn.user_id = u.id
        WHERE u.id = $1`,
      [userId, actor.company_id, actor.id],
    );
    const p = rows[0];
    if (!p) throw notFound('Сотрудник не найден');
    const data: PersonCard = { ...p, online: rt.isOnline(actor.company_id, p.id), is_me: p.id === actor.id };
    res.json({ data });
  });

  /** «Добавить в группу»: мои группы, где он уже есть, и куда мне можно добавлять. */
  r.get('/:userId/groups', async (req, res) => {
    const actor = actorOf(req);
    const userId = idParam(req.params.userId);
    const { rows } = await db.query<{ id: string; name: string | null; is_supergroup: boolean; created_by: string | null; members: number; is_member: boolean; permissions: string[] | null; is_admin: boolean }>(
      `SELECT c.id, c.name, c.is_supergroup, c.created_by,
              (SELECT COUNT(*)::int FROM chat_members x WHERE x.chat_id = c.id) AS members,
              EXISTS (SELECT 1 FROM chat_members x WHERE x.chat_id = c.id AND x.user_id = $2) AS is_member,
              a.permissions, a.user_id IS NOT NULL AS is_admin
         FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $1
         LEFT JOIN chat_admins a ON a.chat_id = c.id AND a.user_id = $1
        WHERE c.type = 'group' AND c.company_id = $3
        ORDER BY c.updated_at DESC LIMIT 100`,
      [actor.id, userId, actor.company_id],
    );
    const data: PersonGroup[] = rows.map((c) => ({
      id: c.id,
      name: c.name?.trim() || 'Группа',
      is_supergroup: c.is_supergroup,
      members: c.members,
      is_member: c.is_member,
      can_add: chatRights({ type: 'group', isSupergroup: c.is_supergroup, isMember: true, isCreator: c.created_by === actor.id, adminPermissions: c.is_admin ? parsePermissions(c.permissions) : null }).can('add_users'),
    }));
    res.json({ data });
  });

  return r;
}
