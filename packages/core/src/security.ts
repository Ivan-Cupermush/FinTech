import { describeDevice } from './account';
import { plural } from './units';

/**
 * Защита данных: журнал входов, защита от подбора пароля, журнал событий
 * для администратора, выгрузка «Мои данные» и согласие на обработку
 * персональных данных (152-ФЗ).
 */

/** Версия политики обработки персональных данных: меняется — согласие спрашиваем заново. */
export const PRIVACY_VERSION = '2026-11-02';

// ------------------------------------------------------------ входы

export type LoginMethod = 'password' | 'qr' | 'register';
export type LoginFailure = 'bad_password' | 'locked' | 'inactive';

export interface LoginEvent {
  id: string;
  at: string;
  ok: boolean;
  method: LoginMethod;
  /** Почему не вошёл; у удачного входа — null. */
  failure: LoginFailure | null;
  ip: string | null;
  device: string;
  /** Для журнала администратора: кто входил (null — почта неизвестна системе). */
  user_id?: string | null;
  display_name?: string | null;
}

export const LOGIN_METHOD_LABELS: Record<LoginMethod, string> = {
  password: 'Пароль',
  qr: 'QR-код',
  register: 'Регистрация',
};

export const LOGIN_FAILURE_LABELS: Record<LoginFailure, string> = {
  bad_password: 'Неверный пароль',
  locked: 'Вход временно закрыт',
  inactive: 'Сотрудник отключён',
};

/**
 * Устройство для журнала входов: как на экране подтверждения QR («Chrome на
 * Windows»), плюс приложение offix и программы (curl, скрипты) — их тоже
 * видно в журнале, а User-Agent целиком человеку ничего не говорит.
 */
export function deviceLabel(ua: string | null | undefined): string {
  const s = (ua ?? '').trim();
  if (s && !/Mozilla/.test(s)) {
    // Приложение (Expo / React Native) шлёт свой User-Agent.
    if (/offix|Expo|okhttp|CFNetwork|Darwin/i.test(s)) return 'Приложение offix';
    if (/curl|wget|python|node|axios|Go-http|PostmanRuntime/i.test(s)) return 'Программа';
  }
  const d = describeDevice(s);
  return d.label === 'Браузер' && !/Mozilla/.test(s) ? 'Неизвестное устройство' : d.label;
}

/** Защита от подбора: столько неудачных попыток за окно закрывают вход в учётную запись. */
export const LOCKOUT_ATTEMPTS = 10;
export const LOCKOUT_WINDOW_MIN = 15;

/**
 * Закрыт ли вход после неудачных попыток. Считаем только попытки после
 * последнего удачного входа: человек вспомнил пароль — счёт сначала.
 * Закрыто до момента «последняя неудача + окно».
 */
export function lockout(failures: readonly Date[], lastSuccess: Date | null, now: Date, opts: { attempts?: number; windowMin?: number } = {}): { locked: boolean; until: Date | null; left: number } {
  const attempts = opts.attempts ?? LOCKOUT_ATTEMPTS;
  const windowMs = (opts.windowMin ?? LOCKOUT_WINDOW_MIN) * 60_000;
  const recent = failures.filter((f) => now.getTime() - f.getTime() < windowMs && (!lastSuccess || f.getTime() > lastSuccess.getTime()));
  if (recent.length < attempts) return { locked: false, until: null, left: attempts - recent.length };
  const last = Math.max(...recent.map((f) => f.getTime()));
  return { locked: true, until: new Date(last + windowMs), left: 0 };
}

/** «через 12 минут» — сколько ждать до открытия входа. */
export function lockoutWait(until: Date, now: Date): string {
  const min = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  const mod10 = min % 10;
  const mod100 = min % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'минуту' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'минуты' : 'минут';
  return `через ${min} ${word}`;
}

// ------------------------------------------------------------ журнал событий

export interface AuditRow {
  id: string;
  at: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  actor_name: string | null;
  /** Имя сотрудника, если событие о нём (entity_type = member). */
  target_name: string | null;
  old_values: unknown;
  new_values: unknown;
}

export type AuditGroup = 'security' | 'people' | 'work' | 'all';

export const AUDIT_GROUP_LABELS: Record<AuditGroup, string> = {
  security: 'Безопасность',
  people: 'Сотрудники и права',
  work: 'Цели и задачи',
  all: 'Все события',
};

const LABELS: Record<string, string> = {
  'account.renamed': 'Сменил имя',
  'account.email_changed': 'Сменил почту',
  'account.password_changed': 'Сменил пароль',
  'account.logout_all': 'Вышел на всех устройствах',
  'account.data_exported': 'Скачал свои данные',
  'account.consent_given': 'Дал согласие на обработку данных',
  'login.qr': 'Вход по QR-коду',
  'login.qr_approved': 'Подтвердил вход по QR-коду',
  'login.locked': 'Вход закрыт после неудачных попыток',
  'member.invited': 'Пригласил сотрудника',
  'member.updated': 'Изменил роль или доступ',
  'member.password_reset': 'Сбросил пароль сотруднику',
  'member.anonymized': 'Обезличил данные сотрудника',
  'user.functions_changed': 'Изменил функции сотрудника',
  'company.created': 'Создал компанию',
  'company.modules_changed': 'Изменил разделы компании',
  'security.audit_exported': 'Выгрузил журнал событий',
  'org_unit.created': 'Создал подразделение',
  'org_unit.updated': 'Изменил подразделение',
  'org_unit.member_set': 'Добавил в подразделение',
  'org_unit.member_removed': 'Убрал из подразделения',
  'goal.created': 'Создал цель',
  'goal.updated': 'Изменил цель',
  'goal.status_changed': 'Сменил статус цели',
  'goal.child_added': 'Добавил подцель',
  'goal.units_changed': 'Изменил подразделения цели',
  'goal.task_linked': 'Привязал задачу к цели',
  'goal.task_unlinked': 'Отвязал задачу от цели',
  'task.created': 'Создал задачу',
  'task.updated': 'Изменил задачу',
  'task.status_changed': 'Сменил статус задачи',
  'task.rescheduled': 'Перенёс срок задачи',
  'task.archived': 'Убрал задачу в архив',
  'task.unarchived': 'Вернул задачу из архива',
  'task.thanked': 'Поблагодарил за задачу',
  'task.watchers_changed': 'Изменил наблюдателей',
  'task.files_added': 'Прикрепил файлы к задаче',
  'task.file_removed': 'Убрал файл из задачи',
  'task.dependency_added': 'Добавил зависимость',
  'task.dependency_removed': 'Убрал зависимость',
  'task.checkpoint_added': 'Добавил контрольную точку',
  'task.checkpoint_changed': 'Изменил контрольную точку',
  'task.checkpoint_removed': 'Убрал контрольную точку',
  'metric.created': 'Создал KPI',
  'metric.updated': 'Изменил KPI',
  'metric.observed': 'Внёс замер KPI',
  'metric.synced': 'Замер KPI из интеграции',
  'sales_report.uploaded': 'Загрузил отчёт о продажах',
  'sales_report.deleted': 'Удалил отчёт о продажах',
  'sales_plan.file_uploaded': 'Загрузил файл KPI',
};

/** Событие журнала по-русски; неизвестное — как есть, чтобы ничего не потерять. */
export const auditLabel = (eventType: string): string => LABELS[eventType] ?? eventType;

const SECURITY_MEMBER = ['member.updated', 'member.password_reset', 'member.anonymized'];

/** К какой группе относится событие. */
export function auditGroup(eventType: string): Exclude<AuditGroup, 'all'> {
  // Роль и доступ (member.updated) — тоже безопасность: кто кому дал права и кого отключил.
  if (/^(account|login|security)\./.test(eventType) || SECURITY_MEMBER.includes(eventType)) return 'security';
  if (/^(member|user|company|org_unit)\./.test(eventType)) return 'people';
  return 'work';
}

/** SQL-префиксы событий группы — фильтр на сервере. */
export function auditGroupTypes(group: AuditGroup): { prefixes: string[]; exact: string[] } | null {
  if (group === 'all') return null;
  if (group === 'security') return { prefixes: ['account.', 'login.', 'security.'], exact: SECURITY_MEMBER };
  if (group === 'people') return { prefixes: ['user.', 'company.', 'org_unit.'], exact: ['member.invited'] };
  return { prefixes: ['goal.', 'task.', 'metric.', 'sales_report.', 'sales_plan.'], exact: [] };
}

const FIELD_LABELS: Record<string, string> = {
  role: 'роль',
  active: 'доступ',
  position: 'должность',
  display_name: 'имя',
  email: 'почта',
  ip: 'IP',
  user_agent: 'устройство',
  name: 'название',
  status: 'статус',
  due_date: 'срок',
};

const ROLE_RU: Record<string, string> = { owner: 'владелец', admin: 'администратор', manager: 'руководитель', member: 'сотрудник', observer: 'наблюдатель' };

function show(k: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'active') return v ? 'включён' : 'отключён';
  if (k === 'role' && typeof v === 'string') return ROLE_RU[v] ?? v;
  if (k === 'user_agent' && typeof v === 'string') return deviceLabel(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Что изменилось — одной строкой: «роль: сотрудник → руководитель».
 * Пароли и хеши в журнал не пишутся, но на всякий случай не показываем
 * поля, похожие на секреты.
 */
export function auditDetails(oldValues: unknown, newValues: unknown): string {
  const o = (oldValues && typeof oldValues === 'object' ? oldValues : {}) as Record<string, unknown>;
  const n = (newValues && typeof newValues === 'object' ? newValues : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(n), ...Object.keys(o)])].filter((k) => !/pass|hash|token|secret/i.test(k));
  const parts: string[] = [];
  for (const k of keys) {
    const label = FIELD_LABELS[k] ?? k;
    const has = Object.hasOwn(n, k);
    if (has && Object.hasOwn(o, k)) {
      if (JSON.stringify(o[k]) === JSON.stringify(n[k])) continue;
      parts.push(`${label}: ${show(k, o[k])} → ${show(k, n[k])}`);
    } else if (has) parts.push(`${label}: ${show(k, n[k])}`);
  }
  return parts.slice(0, 4).join('; ');
}

// ------------------------------------------------------------ сводка для администратора

export interface SecuritySummary {
  /** Удачных входов за 7 дней. */
  logins_7d: number;
  /** Неудачных попыток за 7 дней. */
  failures_7d: number;
  /** Сколько раз за 7 дней вход закрывался после подбора. */
  lockouts_7d: number;
  /** Сотрудников без входа больше 30 дней (активных). */
  dormant: number;
  /** Отключённых, чьи данные ещё не обезличены. */
  to_anonymize: number;
  /** Сотрудников, которые ещё ни разу не меняли выданный пароль. */
  default_passwords: number;
}

export interface SecurityAdvice {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
}

/** Что сделать администратору — по сводке, от главного. */
export function securityAdvice(s: SecuritySummary): SecurityAdvice[] {
  const out: SecurityAdvice[] = [];
  const n = (v: number, forms: readonly [string, string, string]) => `${v} ${plural(v, forms)}`;
  if (s.lockouts_7d > 0) out.push({ tone: 'bad', text: `За неделю вход закрывался ${n(s.lockouts_7d, ['раз', 'раза', 'раз'])} после подбора пароля — проверьте неудачные попытки` });
  if (s.to_anonymize > 0)
    out.push({ tone: 'warn', text: `${n(s.to_anonymize, ['отключённый сотрудник', 'отключённых сотрудника', 'отключённых сотрудников'])} с персональными данными — обезличьте, когда данные больше не нужны` });
  if (s.default_passwords > 0) out.push({ tone: 'warn', text: `${n(s.default_passwords, ['сотрудник не сменил', 'сотрудника не сменили', 'сотрудников не сменили'])} выданный пароль` });
  if (s.dormant > 0) out.push({ tone: 'warn', text: `${n(s.dormant, ['сотрудник не входил', 'сотрудника не входили', 'сотрудников не входили'])} больше 30 дней — отключите тех, кто ушёл` });
  if (!out.length) out.push({ tone: 'ok', text: 'Подбора паролей нет, ушедших сотрудников с данными нет' });
  return out;
}

// ------------------------------------------------------------ обезличивание

/** Имя вместо настоящего после обезличивания: по нему коллеги понимают, что человек ушёл. */
export const anonymizedName = (n: number) => `Бывший сотрудник ${n}`;
export const ANONYMIZED_EMAIL_DOMAIN = 'anonymized.offix.invalid';
export const isAnonymizedEmail = (email: string) => email.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`);
