import type { RequestHandler } from 'express';
import type { CompanyRole, SandboxInfo, SandboxPerson } from '@offix/core';
import { actorOf, hashPassword } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { forbidden } from '../http/errors';
import { isUuid } from '../http/validate';
import type { KnowledgeService } from '../services/knowledge';
import type { MediaStore } from '../services/media';
import { seedDemo, type DemoUser } from './demo';
import { seedDemoKnowledge } from './demo-knowledge';
import { seedDemoMedia } from './demo-media';
import { seedDemoPersonal } from './demo-personal';
import { seedDemoTaskFlow } from './demo-task-flow';

/**
 * Песочница для жюри (OFFIX_SANDBOX=1): университет с готовыми данными и
 * сотрудниками, у которых самые простые логины. На странице входа — список
 * этих людей; щелчок — и вы внутри под нужной ролью.
 *
 * Продажи и выплаты в университете не нужны — раздел выключен через
 * «Функции компании», как сделал бы ректор. Включить его можно там же.
 *
 * Имена — с улыбкой, но имена: в сообщениях и задачах демо люди зовут
 * друг друга по имени, поэтому имена остаются прежними, меняются фамилии.
 */

export const SANDBOX_COMPANY = 'Университет · песочница';

interface SandboxSeat extends SandboxPerson {
  /** Чьи данные из демо получает этот вход. */
  demo: DemoUser;
  /** Полное имя в демо — заменяем в текстах сообщений и уведомлений. */
  was: string;
}

const seat = (login: string, demo: DemoUser, was: string, display_name: string, position: string, role: CompanyRole, blurb: string): SandboxSeat => ({
  login,
  password: login,
  demo,
  was,
  display_name,
  position,
  role,
  blurb,
});

export const SANDBOX_SEATS: readonly SandboxSeat[] = [
  seat('rector', 'director', 'Алексей Петров', 'Алексей Звездин', 'Ректор', 'owner', 'Видит весь университет, включает и выключает функции'),
  seat('prorector', 'igor', 'Игорь Лебедев', 'Игорь Цифров', 'Проректор по цифровизации', 'manager', 'Ведёт IT и автоматизацию заявок'),
  seat('office', 'olga', 'Ольга Смирнова', 'Ольга Дедлайнова', 'Руководитель учебного офиса', 'manager', 'Главная цель: заявка за 30 минут'),
  seat('method', 'sergey', 'Сергей Ким', 'Сергей Методкин', 'Методист учебного офиса', 'member', 'Регламенты, разбор заявок, база знаний'),
  seat('spec', 'anna', 'Анна Королёва', 'Анна Заявкина', 'Специалист по работе с заявками', 'member', 'Свои задачи, чаты и отчёт за день'),
  seat('guest', 'observer', 'Ректорат', 'Учёный совет', 'Наблюдатель', 'observer', 'Только смотрит: прогресс целей и отчёт'),
];

const LOGINS = SANDBOX_SEATS.map((s) => s.login);

export const isSandboxLogin = (email: string | null | undefined) => !!email && LOGINS.includes(email.toLowerCase());

/** Песочница уже заведена: вход ректора есть. Повторный запуск ничего не трогает. */
async function sandboxExists(q: Queryable): Promise<boolean> {
  return (await q.query(`SELECT 1 FROM users WHERE lower(email) = 'rector'`)).rows.length > 0;
}

/**
 * Заводит песочницу один раз: при каждом запуске сервера проверяет, есть ли
 * она уже. Данные живут в той же базе, что и всё остальное, поэтому
 * переживают перезапуск.
 */
export async function seedSandbox(db: Db, media: MediaStore, knowledge: KnowledgeService, now = new Date()): Promise<boolean> {
  if (await sandboxExists(db)) return false;
  // Своё название — и почты демо с префиксом компании: не мешают обычному демо в той же базе.
  const demo = await seedDemo(db, { now, companyName: SANDBOX_COMPANY });
  await seedDemoMedia(db, media, demo, now);
  await seedDemoPersonal(db, demo, now);
  await seedDemoTaskFlow(db, demo, now);
  await seedDemoKnowledge(db, media, knowledge, demo, now);
  await db.tx(async (q) => {
    // Университету продажи и выплаты не нужны — как выключил бы ректор в «Функциях компании».
    await q.query(`UPDATE companies SET disabled_modules = ARRAY['sales'] WHERE id = $1`, [demo.companyId]);
    for (const s of SANDBOX_SEATS) {
      const id = demo.users[s.demo];
      await q.query(`UPDATE users SET email = $2, password_hash = $3, display_name = $4, position = $5 WHERE id = $1`, [id, s.login, await hashPassword(s.password), s.display_name, s.position]);
      await q.query(`UPDATE company_members SET role = $3 WHERE company_id = $1 AND user_id = $2`, [demo.companyId, id, s.role]);
      // Служебные сообщения и уведомления демо называют людей полным именем.
      await q.query(`UPDATE messages SET text = replace(text, $2, $3) WHERE company_id = $1 AND text LIKE '%' || $2 || '%'`, [demo.companyId, s.was, s.display_name]);
      await q.query(
        `UPDATE notifications SET title = replace(title, $2, $3), body = replace(body, $2, $3) WHERE company_id = $1 AND (title LIKE '%' || $2 || '%' OR body LIKE '%' || $2 || '%')`,
        [demo.companyId, s.was, s.display_name],
      );
    }
  });
  return true;
}

/** Для страницы входа: только те входы, что на самом деле есть в базе. */
export async function sandboxInfo(q: Queryable): Promise<SandboxInfo> {
  const { rows } = await q.query<{ email: string; company_name: string }>(
    `SELECT lower(u.email) AS email, c.name AS company_name
       FROM users u JOIN company_members m ON m.user_id = u.id JOIN companies c ON c.id = m.company_id
      WHERE lower(u.email) = ANY($1) AND u.active`,
    [LOGINS],
  );
  const have = new Set(rows.map((r) => r.email));
  const people = SANDBOX_SEATS.filter((s) => have.has(s.login)).map(({ login, password, display_name, position, role, blurb }) => ({ login, password, display_name, position, role, blurb }));
  return { enabled: true, company_name: rows[0]?.company_name ?? null, people };
}

const SHARED = 'В песочнице этот вход общий для всех гостей: почту, пароль и имя здесь не меняют';

/**
 * Входы песочницы общие: один гость сменит пароль ректора — и следующий не
 * войдёт. Поэтому для них закрыто то, что ломает вход другим: почта,
 * пароль, имя, «выйти на всех устройствах», сброс пароля, отключение и
 * смена роли. Всё остальное — пожалуйста.
 */
export function sandboxGuard(db: Db): RequestHandler {
  const emailOf = async (id: string) => (await db.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [id])).rows[0]?.email;
  return async (req, _res, next) => {
    try {
      const path = req.path.replace(/\/+$/, '');
      if (req.method === 'PATCH' && path === '/account') {
        if (isSandboxLogin(await emailOf(actorOf(req).id))) throw forbidden(SHARED);
      }
      if (req.method === 'POST' && ['/account/email', '/account/password', '/account/logout-all'].includes(path)) {
        if (isSandboxLogin(await emailOf(actorOf(req).id))) throw forbidden(SHARED);
      }
      const target = /^\/users\/([^/]+)(\/reset-password)?$/.exec(path);
      if (target && isUuid(target[1]!) && ((req.method === 'POST' && target[2]) || (req.method === 'PATCH' && !target[2]))) {
        const body = (req.body ?? {}) as { role?: unknown; active?: unknown };
        const risky = req.method === 'POST' || body.role !== undefined || body.active === false;
        if (risky && isSandboxLogin(await emailOf(target[1]!))) throw forbidden('В песочнице этот вход общий для всех гостей: его пароль, роль и доступ не меняют');
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
