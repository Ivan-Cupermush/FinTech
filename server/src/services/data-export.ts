import { PRIVACY_VERSION, deviceLabel } from '@offix/core';
import type { Queryable } from '../db/db';

/**
 * «Мои данные» (152-ФЗ, ст. 14: право знать, какие данные о тебе хранятся).
 * Всё, что offix хранит о человеке и что он сам написал, одним JSON-файлом:
 * профиль, членство, задачи и цели, сообщения, комментарии, заметки, файлы
 * (без содержимого — только что за файлы), входы и журнал его действий.
 *
 * Чужое сюда не попадает: в сообщениях — только свои, в задачах — только те,
 * где человек исполнитель или автор. Пароль хранится хешем и не выгружается.
 */

/** Сколько строк каждого вида выгружаем: файл должен открываться и в блокноте. */
const LIMIT = 5000;

export interface PersonalDataExport {
  format: 'offix-personal-data';
  version: 1;
  exported_at: string;
  privacy_version: string;
  profile: Record<string, unknown>;
  companies: unknown[];
  org_units: unknown[];
  goals: unknown[];
  tasks: unknown[];
  comments: unknown[];
  messages: unknown[];
  knowledge_notes: unknown[];
  personal_notes: unknown[];
  files: unknown[];
  contact_names: unknown[];
  push_devices: unknown[];
  logins: unknown[];
  actions: unknown[];
  /** Где выгрузка обрезана по LIMIT. */
  truncated: string[];
}

export async function exportPersonalData(q: Queryable, actor: { id: string; company_id: string }, now: Date): Promise<PersonalDataExport> {
  const one = async <T>(sql: string, params: unknown[]) => (await q.query<T>(sql, params)).rows;
  const truncated: string[] = [];
  const many = async (name: string, sql: string, params: unknown[]) => {
    const rows = await one<Record<string, unknown>>(`${sql} LIMIT ${LIMIT + 1}`, params);
    if (rows.length > LIMIT) {
      truncated.push(name);
      rows.length = LIMIT;
    }
    return rows;
  };
  const me = [actor.id, actor.company_id];

  const [profile] = await one<Record<string, unknown>>(
    `SELECT u.id, u.email, u.display_name, u.position, u.avatar_url, u.created_at, u.last_login_at, u.last_seen_at, u.password_changed_at, u.consent_version, u.consent_at
       FROM users u WHERE u.id = $1`,
    [actor.id],
  );
  const companies = await one(
    `SELECT c.name, m.role, m.joined_at FROM company_members m JOIN companies c ON c.id = m.company_id WHERE m.user_id = $1 ORDER BY m.joined_at`,
    [actor.id],
  );
  const org_units = await one(
    `SELECT o.name, mm.is_manager, mm.is_primary, mm.started_at, mm.ended_at FROM org_memberships mm JOIN org_units o ON o.id = mm.unit_id WHERE mm.user_id = $1 AND mm.company_id = $2 ORDER BY mm.started_at`,
    me,
  );
  const goals = await many('goals', `SELECT id, title, status, due_at, created_at FROM goals WHERE company_id = $2 AND (owner_id = $1 OR created_by = $1) ORDER BY created_at`, me);
  const tasks = await many(
    'tasks',
    `SELECT id, title, description, status, start_at, due_at, done_at, created_at,
            (assignee_id = $1) AS i_am_assignee, (created_by = $1) AS i_am_author
       FROM tasks WHERE company_id = $2 AND (assignee_id = $1 OR created_by = $1) ORDER BY created_at`,
    me,
  );
  const comments = await many('comments', `SELECT entity_type, entity_id, body, created_at FROM comments WHERE company_id = $2 AND author_id = $1 ORDER BY created_at`, me);
  const messages = await many(
    'messages',
    `SELECT m.id, ch.type AS chat_type, ch.name AS chat_name, m.kind, m.text, m.created_at, m.edited_at
       FROM messages m JOIN chats ch ON ch.id = m.chat_id
      WHERE m.company_id = $2 AND m.sender_id = $1 AND NOT m.deleted_for_all ORDER BY m.created_at`,
    me,
  );
  const knowledge_notes = await many('knowledge_notes', `SELECT id, title, body, created_at, updated_at FROM notes WHERE company_id = $2 AND created_by = $1 ORDER BY created_at`, me);
  const personal_notes = await many('personal_notes', `SELECT id, note_date, title, body, is_favorite, created_at, updated_at FROM personal_notes WHERE company_id = $2 AND owner_id = $1 ORDER BY note_date, created_at`, me);
  const files = await many('files', `SELECT name, mime, size, kind, owner_type, created_at FROM attachments WHERE company_id = $2 AND uploaded_by = $1 ORDER BY created_at`, me);
  const contact_names = await one(
    `SELECT u.display_name AS colleague, cn.name AS my_name_for_them, cn.updated_at FROM contact_names cn JOIN users u ON u.id = cn.user_id WHERE cn.owner_id = $1 AND cn.company_id = $2 ORDER BY cn.updated_at`,
    me,
  );
  // Сам push-токен — секрет устройства: показываем только, что устройство есть.
  const push_devices = await one(`SELECT platform, created_at FROM push_devices WHERE user_id = $1 AND company_id = $2 ORDER BY created_at`, me);
  const logins = (
    await many('logins', `SELECT created_at, ok, method, failure, ip, user_agent FROM login_events WHERE user_id = $1 ORDER BY created_at DESC`, [actor.id])
  ).map(({ user_agent, ...r }) => ({ ...r, device: deviceLabel(user_agent as string | null) }));
  const actions = await many('actions', `SELECT event_type, entity_type, created_at FROM audit_events WHERE company_id = $2 AND actor_id = $1 ORDER BY created_at DESC`, me);

  return {
    format: 'offix-personal-data',
    version: 1,
    exported_at: now.toISOString(),
    privacy_version: PRIVACY_VERSION,
    profile: profile ?? {},
    companies,
    org_units,
    goals,
    tasks,
    comments,
    messages,
    knowledge_notes,
    personal_notes,
    files,
    contact_names,
    push_devices,
    logins,
    actions,
    truncated,
  };
}
