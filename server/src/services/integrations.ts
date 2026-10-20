import {
  integrationState,
  maskSecret,
  moodleCompletionPoint,
  moodleUrl,
  nextSyncAt,
  oneCPoints,
  oneCRecords,
  oneCUrl,
  planSync,
  redactSecret,
  type IntegrationConfig,
  type IntegrationKind,
  type MoodleConfig,
  type OneCConfig,
  type SyncPoint,
  type UnitId,
} from '@offix/core';
import type { Db, Queryable } from '../db/db';
import { loadMetrics } from './goals';
import { addObservations, lockObservationDays } from './observations';

/** fetch, который можно подменить: в тестах и демо — поддельные 1С и Moodle. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface IntegrationRow {
  id: string;
  company_id: string;
  goal_id: string;
  metric_id: string;
  kind: IntegrationKind;
  name: string;
  config: IntegrationConfig;
  username: string | null;
  secret: string | null;
  enabled: boolean;
  interval_hours: number;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  goal_title: string;
  goal_status: string;
  goal_owner_id: string | null;
  metric_name: string;
  metric_unit: UnitId;
}

const SELECT = `SELECT i.*, g.title AS goal_title, g.status AS goal_status, g.owner_id AS goal_owner_id, m.name AS metric_name, m.unit AS metric_unit
                  FROM integrations i JOIN goals g ON g.id = i.goal_id JOIN goal_metrics m ON m.id = i.metric_id`;

export async function loadIntegrations(q: Queryable, companyId: string, id?: string): Promise<IntegrationRow[]> {
  const { rows } = await q.query<IntegrationRow>(`${SELECT} WHERE i.company_id = $1 ${id ? 'AND i.id = $2' : ''} ORDER BY i.created_at`, id ? [companyId, id] : [companyId]);
  return rows;
}

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);

/** Подключение для API: пароль или токен — только маска. */
export function serializeIntegration(i: IntegrationRow, now: Date) {
  const view = { enabled: i.enabled, last_sync_at: iso(i.last_sync_at), last_error: i.last_error, interval_hours: i.interval_hours };
  return {
    id: i.id,
    kind: i.kind,
    name: i.name,
    goal: { id: i.goal_id, title: i.goal_title },
    metric: { id: i.metric_id, name: i.metric_name, unit: i.metric_unit },
    config: i.config,
    username: i.username,
    secret_mask: maskSecret(i.secret),
    enabled: i.enabled,
    interval_hours: i.interval_hours,
    state: integrationState(view),
    last_sync_at: view.last_sync_at,
    last_success_at: iso(i.last_success_at),
    last_error: i.last_error,
    next_sync_at: nextSyncAt(view, now),
    created_at: iso(i.created_at),
  };
}

/** Ошибка, понятная администратору: без стека и без пароля. */
export class IntegrationError extends Error {}

const TIMEOUT_MS = 20_000;

async function getJson(doFetch: FetchLike, url: string, headers: Record<string, string>, secret: string | null): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const reason = e instanceof Error && e.name === 'TimeoutError' ? 'нет ответа 20 секунд' : redactSecret(e instanceof Error ? e.message : String(e), secret);
    throw new IntegrationError(`Система недоступна: ${reason}`);
  }
  if (res.status === 401 || res.status === 403) throw new IntegrationError('Система отклонила логин и пароль');
  if (res.status === 404) throw new IntegrationError('Адрес не найден: проверьте адрес публикации и имя документа или регистра');
  if (!res.ok) throw new IntegrationError(`Система ответила ошибкой HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new IntegrationError('Ответ не похож на JSON: проверьте, что указан адрес публикации, а не страница входа');
  }
}

/** Замеры из 1С. since — последняя удачная синхронизация: берём только новое. */
async function oneCFetch(cfg: OneCConfig, username: string | null, password: string | null, since: string | null, doFetch: FetchLike) {
  const auth = `Basic ${Buffer.from(`${username ?? ''}:${password ?? ''}`).toString('base64')}`;
  const json = await getJson(doFetch, oneCUrl(cfg, since), { Authorization: auth }, password);
  const records = oneCRecords(json);
  if (!records) throw new IntegrationError('1С вернула ответ без списка записей');
  return oneCPoints(records, cfg);
}

/** Столько слушателей опрашиваем за раз: у каждого — свой запрос статуса. */
const MOODLE_MAX_STUDENTS = 3000;

async function moodleCall(cfg: MoodleConfig, token: string, fn: string, params: Record<string, number>, doFetch: FetchLike): Promise<unknown> {
  const json = await getJson(doFetch, moodleUrl(cfg, token, fn, params), {}, token);
  // Moodle сообщает об ошибке с кодом 200: { exception, errorcode, message }.
  if (json && typeof json === 'object' && 'exception' in json) {
    const code = String((json as { errorcode?: unknown }).errorcode ?? '');
    if (code === 'invalidtoken') throw new IntegrationError('Moodle не принял токен веб-сервиса');
    if (code === 'nocriteriaset') throw new IntegrationError('В курсе не настроены условия завершения');
    if (code === 'invalidrecord' || code === 'invalidcourseid') throw new IntegrationError('Курс не найден: проверьте номер курса');
    if (code === 'accessexception') throw new IntegrationError('У токена нет доступа к этой функции: добавьте её во внешний сервис');
    throw new IntegrationError(`Moodle: ${redactSecret(String((json as { message?: unknown }).message ?? code), token)}`);
  }
  return json;
}

/**
 * Доля завершивших курс: слушатели курса (core_enrol_get_enrolled_users,
 * только роль student) и статус завершения у каждого
 * (core_completion_get_course_completion_status).
 */
async function moodleFetch(cfg: MoodleConfig, token: string, doFetch: FetchLike, now: Date) {
  const users = await moodleCall(cfg, token, 'core_enrol_get_enrolled_users', { courseid: cfg.course_id }, doFetch);
  if (!Array.isArray(users)) throw new IntegrationError('Moodle вернул неожиданный ответ на список слушателей');
  const students = users
    .filter((u): u is { id: number; roles?: { shortname?: string }[] } => !!u && typeof u === 'object' && typeof (u as { id?: unknown }).id === 'number')
    .filter((u) => !Array.isArray(u.roles) || u.roles.some((r) => r?.shortname === 'student'))
    .slice(0, MOODLE_MAX_STUDENTS);
  let completed = 0;
  for (const s of students) {
    const st = (await moodleCall(cfg, token, 'core_completion_get_course_completion_status', { courseid: cfg.course_id, userid: s.id }, doFetch)) as {
      completionstatus?: { completed?: unknown };
    };
    if (st?.completionstatus?.completed === true) completed++;
  }
  const point = moodleCompletionPoint({ enrolled: students.length, completed }, now);
  return { points: point ? [point] : [], records: students.length, invalid: 0 };
}

export interface FetchedPoints {
  points: SyncPoint[];
  records: number;
  invalid: number;
}

export async function fetchPoints(
  i: { kind: IntegrationKind; config: IntegrationConfig; username: string | null; secret: string | null },
  since: string | null,
  doFetch: FetchLike,
  now: Date,
): Promise<FetchedPoints> {
  if (i.kind === 'onec') return oneCFetch(i.config as OneCConfig, i.username, i.secret, since, doFetch);
  if (!i.secret) throw new IntegrationError('Не задан токен веб-сервиса Moodle');
  return moodleFetch(i.config as MoodleConfig, i.secret, doFetch, now);
}

/** Проверка подключения: запрос в систему без записи замеров. */
export async function testConnection(i: Parameters<typeof fetchPoints>[0], doFetch: FetchLike, now: Date) {
  try {
    const r = await fetchPoints(i, null, doFetch, now);
    const what = i.kind === 'onec' ? `записей: ${r.records}, дней с замером: ${r.points.length}` : `слушателей: ${r.records}`;
    return { ok: true as const, message: `Подключение работает — ${what}`, records: r.records, invalid: r.invalid, points: r.points.slice(-5) };
  } catch (e) {
    if (e instanceof IntegrationError) return { ok: false as const, message: e.message, records: 0, invalid: 0, points: [] };
    throw e;
  }
}

export interface RunResult {
  id: string;
  trigger: 'manual' | 'schedule';
  status: 'ok' | 'error';
  started_at: string;
  finished_at: string | null;
  fetched: number;
  imported: number;
  skipped: number;
  error: string | null;
}

/**
 * Одна синхронизация: забрать данные из системы, записать новые дни в KPI,
 * записать итог в журнал запусков. Ошибка системы не роняет сервер: она
 * сохраняется у подключения и видна администратору.
 */
export async function syncIntegration(
  db: Db,
  companyId: string,
  id: string,
  opts: { fetch: FetchLike; now: Date; trigger: 'manual' | 'schedule'; actorId?: string | null },
): Promise<RunResult> {
  const [i] = await loadIntegrations(db, companyId, id);
  if (!i) throw new Error('Интеграция не найдена');
  const at = opts.now.toISOString();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO integration_runs (integration_id, company_id, trigger, started_by, started_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [i.id, companyId, opts.trigger, opts.actorId ?? null, at],
  );
  const runId = rows[0]!.id;

  const fail = async (message: string) => {
    await db.query(`UPDATE integrations SET last_sync_at = $2, last_error = $3 WHERE id = $1`, [i.id, at, message]);
    await db.query(`UPDATE integration_runs SET status = 'error', finished_at = $2, error = $3 WHERE id = $1`, [runId, at, message]);
    return loadRun(db, runId);
  };

  if (i.goal_status === 'cancelled') return fail('Цель отменена — замеры в неё не записываются');
  let fetched: FetchedPoints;
  try {
    fetched = await fetchPoints(i, iso(i.last_success_at), opts.fetch, opts.now);
  } catch (e) {
    if (e instanceof IntegrationError) return fail(e.message);
    return fail('Не удалось получить данные: внутренняя ошибка');
  }

  await db.tx(async (q) => {
    const [metric] = (await loadMetrics(q, [i.goal_id])).filter((m) => m.id === i.metric_id);
    const days = await lockObservationDays(q, i.metric_id);
    const plan = planSync(fetched.points, { unit: i.metric_unit, now: opts.now, existingDays: days });
    const r = await addObservations(q, {
      companyId,
      goalId: i.goal_id,
      goalOwnerId: i.goal_owner_id,
      metric: metric!,
      rows: plan.observations,
      source: 'integration',
      actorId: opts.actorId ?? null,
      note: `Интеграция «${i.name}»`,
      days,
      auditExtra: { integration_id: i.id, kind: i.kind },
    });
    const skipped = plan.duplicates + plan.rejected.length + fetched.invalid;
    // Отклонённые дни — не сбой подключения, но о них стоит знать.
    const warning = plan.rejected.length ? `Не записаны: ${plan.rejected.map((x) => `${x.day} — ${x.reason}`).slice(0, 3).join('; ')}` : null;
    await q.query(`UPDATE integrations SET last_sync_at = $2, last_success_at = $2, last_error = NULL WHERE id = $1`, [i.id, at]);
    await q.query(`UPDATE integration_runs SET status = 'ok', finished_at = $2, fetched = $3, imported = $4, skipped = $5, error = $6 WHERE id = $1`, [
      runId,
      at,
      fetched.records,
      r.imported,
      skipped,
      warning,
    ]);
  });
  return loadRun(db, runId);
}

export async function loadRun(q: Queryable, runId: string): Promise<RunResult> {
  const { rows } = await q.query<RunResult>(
    `SELECT id, trigger, status, started_at, finished_at, fetched, imported, skipped, error FROM integration_runs WHERE id = $1`,
    [runId],
  );
  return serializeRun(rows[0]!);
}

export const serializeRun = (r: RunResult): RunResult => ({ ...r, started_at: iso(r.started_at)!, finished_at: iso(r.finished_at) });

/** Подключения, которым пора синхронизироваться. */
export async function dueIntegrations(q: Queryable, now: Date): Promise<{ id: string; company_id: string }[]> {
  const { rows } = await q.query<{ id: string; company_id: string }>(
    `SELECT id, company_id FROM integrations
      WHERE enabled AND (last_sync_at IS NULL OR last_sync_at + make_interval(hours => interval_hours) <= $1)
      ORDER BY last_sync_at NULLS FIRST LIMIT 20`,
    [now.toISOString()],
  );
  return rows;
}

/** Синхронизация по расписанию: шаг раз в минуту, без наложения шагов. Включается INTEGRATIONS_ENABLED=1. */
export function startIntegrationLoop(db: Db, doFetch: FetchLike, opts: { intervalMs?: number; now?: () => Date; onError?: (e: unknown) => void } = {}): () => void {
  const now = opts.now ?? (() => new Date());
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (const d of await dueIntegrations(db, now())) await syncIntegration(db, d.company_id, d.id, { fetch: doFetch, now: now(), trigger: 'schedule' });
    } catch (e) {
      opts.onError?.(e);
    } finally {
      running = false;
    }
  }, opts.intervalMs ?? 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
