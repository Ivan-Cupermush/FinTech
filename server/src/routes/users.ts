import { randomBytes, randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { canManageOrg, COMPANY_ROLES, PEOPLE_IMPORT_MAX_ROWS, passwordError, SalesFileError, tempPassword, type PeopleMapping } from '@offix/core';
import { actorOf, hashPassword, revokeSessions } from '../auth/auth';
import type { Db } from '../db/db';
import { noRealtime, type Realtime } from '../realtime/hub';
import { conflict, forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { audit } from '../services/audit';
import { loadModules } from '../services/modules';
import type { MediaStore } from '../services/media';
import { ANONYMIZE_MESSAGES, anonymizeMember } from '../services/security';
import { receive, removeAvatar } from './files';
import { planForCompany, runPeopleImport } from '../services/people-import';
import { tableText } from '../services/xlsx';
import { promises as fs } from 'node:fs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMPORT_FILE_BYTES = 10 * 1024 * 1024;

export function usersRouter(db: Db, rt: Realtime = noRealtime, store?: MediaStore): Router {
  const r = Router();

  r.get('/me', async (req, res) => {
    const actor = actorOf(req);
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.display_name, u.position, u.avatar_url, m.role, c.id AS company_id, c.name AS company_name, c.setup_mode
         FROM users u JOIN company_members m ON m.user_id = u.id JOIN companies c ON c.id = m.company_id
        WHERE u.id = $1 AND c.id = $2`,
      [actor.id, actor.company_id],
    );
    const units = await db.query(
      `SELECT o.id, o.name, o.unit_type, mm.is_manager, mm.is_primary FROM org_memberships mm JOIN org_units o ON o.id = mm.unit_id
        WHERE mm.user_id = $1 AND mm.company_id = $2 AND mm.ended_at IS NULL ORDER BY mm.is_primary DESC, o.name`,
      [actor.id, actor.company_id],
    );
    res.json({ data: { ...rows[0], units: units.rows, modules: await loadModules(db, actor.company_id) } });
  });

  /** Поиск сотрудников для выбора владельца или исполнителя. */
  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const includeInactive = req.query.include_inactive === '1' && canManageOrg(actor);
    const { rows } = await db.query(
      `SELECT u.id, u.display_name, u.position, u.email, u.active, u.avatar_url, m.role, u.anonymized_at IS NOT NULL AS anonymized,
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

  /**
   * Импорт сотрудников из Excel или CSV, шаг 1: файл → текст таблицы. Дальше
   * её разбирает тот же parseTable, что и вставку из буфера обмена.
   */
  r.post('/import/table', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Загружать сотрудников может администратор');
    if (!store) throw invalid('Загрузка файлов выключена', { file: 'Вставьте таблицу из Excel через буфер обмена' });
    const file = await receive(store, 'file', { maxBytes: Math.min(store.maxBytes, IMPORT_FILE_BYTES) })(req, res);
    try {
      res.json({ data: { text: tableText(await fs.readFile(file.path), file.originalname) } });
    } catch (e) {
      if (e instanceof SalesFileError) throw invalid(e.message, { file: e.message });
      throw e;
    } finally {
      await fs.rm(file.path, { force: true }).catch(() => undefined);
    }
  });

  /**
   * Шаг 2: план (`dry_run`) и выполнение. Таблица приходит уже разобранной,
   * колонки выбирает человек; сервер заново проверяет каждую строку.
   */
  r.post('/import', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Загружать сотрудников может администратор');
    const col = z.number().int().min(-1).max(60);
    const body = parseBody(
      z.object({
        rows: z.array(z.array(z.string().max(2000)).max(60)).min(1).max(PEOPLE_IMPORT_MAX_ROWS + 200),
        lines: z.array(z.number().int().min(1)).optional(),
        mapping: z.object({ last_name: col, first_name: col, middle_name: col, name: col, email: col, position: col, unit: col, manager: col, role: col }),
        dry_run: z.boolean().default(true),
      }),
      req.body,
    );
    const m: PeopleMapping = body.mapping;
    if (m.email < 0) throw invalid('Не удалось загрузить сотрудников', { mapping: 'Выберите колонку с почтой' });
    if (m.name < 0 && m.last_name < 0 && m.first_name < 0) throw invalid('Не удалось загрузить сотрудников', { mapping: 'Выберите колонку с ФИО' });
    const lines = body.lines?.length === body.rows.length ? body.lines : body.rows.map((_, i) => i + 1);
    if (body.dry_run) {
      const { plan } = await planForCompany(db, actor, body.rows, lines, m);
      res.json({ data: { plan } });
      return;
    }
    const result = await runPeopleImport(db, actor, body.rows, lines, m);
    res.status(201).json({ data: result });
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
      const { rows } = await q.query<{ role: string; active: boolean; anonymized: boolean }>(
        `SELECT m.role, u.active, u.anonymized_at IS NOT NULL AS anonymized FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1 AND m.user_id = $2`,
        [actor.company_id, id],
      );
      const found = rows[0];
      if (!found) throw notFound('Сотрудник не найден');
      const { anonymized, ...cur } = found;
      // Обезличенного не вернуть: ни имени, ни почты, ни пароля у него больше нет.
      if (anonymized) throw conflict('Данные сотрудника обезличены — вернуть доступ нельзя, пригласите его заново');
      if (id === actor.id && (body.active === false || (body.role && body.role !== cur.role))) throw conflict('Нельзя отключить себя или изменить свою роль');
      if ((cur.role === 'owner' || body.role === 'owner') && actor.role !== 'owner') throw forbidden('Права владельца меняет только владелец');
      if (body.role) await q.query(`UPDATE company_members SET role = $3 WHERE company_id = $1 AND user_id = $2`, [actor.company_id, id, body.role]);
      if (body.active !== undefined) await q.query(`UPDATE users SET active = $2 WHERE id = $1`, [id, body.active]);
      // Отключённому — сразу закрываем все сеансы; включат снова — войдёт заново.
      if (body.active === false) await revokeSessions(q, id);
      if (body.position !== undefined) await q.query(`UPDATE users SET position = $2 WHERE id = $1`, [id, body.position?.trim() || null]);
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: id, actor_id: actor.id, event_type: 'member.updated', old_values: cur, new_values: body });
      return { id, ...body };
    });
    if (body.active === false) rt.disconnectUser(actor.company_id, id);
    res.json({ data });
  });

  /**
   * Сброс пароля сотруднику. Пароли хранятся только хешем — показать старый
   * нельзя: администратор задаёт новый или получает временный (один раз,
   * чтобы передать сотруднику). Все сеансы сотрудника завершаются.
   */
  r.post('/:id/reset-password', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Сбросить пароль может администратор');
    const id = idParam(req.params.id);
    const body = parseBody(z.object({ password: z.string().max(1000).optional() }), req.body);
    if (id === actor.id) throw conflict('Свой пароль меняется в профиле');
    const MSG = 'Не удалось сбросить пароль';
    const password = body.password?.length ? body.password : tempPassword((n) => randomInt(n));
    const target = (await db.query<{ role: string; email: string }>(`SELECT m.role, u.email FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1 AND m.user_id = $2`, [actor.company_id, id])).rows[0];
    if (!target) throw notFound('Сотрудник не найден');
    if (target.role === 'owner' && actor.role !== 'owner') throw forbidden('Пароль владельца меняет только владелец');
    // Учётная запись общая для всех компаний человека — чужую компанию пароль не касается.
    const elsewhere = await db.query(`SELECT 1 FROM company_members WHERE user_id = $1 AND company_id <> $2 LIMIT 1`, [id, actor.company_id]);
    if (elsewhere.rows.length) throw forbidden('Сотрудник состоит и в другой компании — пароль он меняет сам');
    const err = body.password?.length ? passwordError(password, { email: target.email }) : null;
    if (err) throw invalid(MSG, { password: err });
    const hash = await hashPassword(password);
    await db.tx(async (q) => {
      await q.query(`UPDATE users SET password_hash = $2, password_changed_at = NOW() WHERE id = $1`, [id, hash]);
      await revokeSessions(q, id);
      await audit(q, { company_id: actor.company_id, entity_type: 'member', entity_id: id, actor_id: actor.id, event_type: 'member.password_reset' });
    });
    rt.disconnectUser(actor.company_id, id);
    res.json({ data: { password: body.password?.length ? null : password } });
  });

  /**
   * Обезличить ушедшего сотрудника: имя, почта, фото, личные заметки и журнал
   * входов исчезают, работа (задачи, цели, сообщения) остаётся под именем
   * «Бывший сотрудник N». Только для отключённых; отменить нельзя.
   */
  r.post('/:id/anonymize', async (req, res) => {
    const actor = actorOf(req);
    if (!canManageOrg(actor)) throw forbidden('Обезличить данные может администратор');
    if (!store) throw forbidden('Обезличивание недоступно');
    const id = idParam(req.params.id);
    const out = await db.tx((q) => anonymizeMember(q, store, actor, id));
    if (!out.ok) {
      const msg = ANONYMIZE_MESSAGES[out.reason];
      if (out.reason === 'not_found') throw notFound(msg);
      if (out.reason === 'owner' || out.reason === 'other_company') throw forbidden(msg);
      throw conflict(msg);
    }
    await removeAvatar(store, out.avatar);
    rt.emitCompany(actor.company_id, 'avatar_changed', { user_id: id, avatar_url: null });
    res.json({ data: { id, display_name: out.name } });
  });

  return r;
}
