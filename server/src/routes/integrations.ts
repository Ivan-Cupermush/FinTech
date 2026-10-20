import { Router } from 'express';
import { z } from 'zod';
import { INTEGRATION_KINDS, SYNC_INTERVALS, validateIntegrationConfig, type IntegrationKind } from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db } from '../db/db';
import { forbidden, invalid, notFound } from '../http/errors';
import { idParam, isUuid, parseBody } from '../http/validate';
import { loadIntegrations, serializeIntegration, serializeRun, syncIntegration, testConnection, type FetchLike, type RunResult } from '../services/integrations';
import { sealSecret } from '../services/secret-box';

const admin = (a: AuthedActor) => {
  if (a.role !== 'owner' && a.role !== 'admin') throw forbidden('Интеграции настраивает администратор');
};

const interval = z.number().refine((n): n is (typeof SYNC_INTERVALS)[number] => (SYNC_INTERVALS as readonly number[]).includes(n));

const baseSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  name: z.string().max(120),
  metric_id: z.string(),
  config: z.record(z.string(), z.unknown()),
  username: z.string().max(120).nullable().optional(),
  secret: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  interval_hours: interval.optional(),
});

/**
 * Подключения к 1С и Moodle. Настраивает только администратор. Пароль или
 * токен принимается, но не отдаётся: в ответе — маска. Проверка подключения
 * ничего не пишет; синхронизация пишет замеры в KPI так же, как импорт.
 */
export function integrationsRouter(db: Db, now: () => Date, doFetch: FetchLike): Router {
  const r = Router();

  const one = async (actor: AuthedActor, id: string) => {
    const [i] = await loadIntegrations(db, actor.company_id, idParam(id));
    if (!i) throw notFound('Интеграция не найдена');
    return i;
  };

  /** KPI, в который пишет подключение: только из целей своей компании и не отменённых. */
  const target = async (actor: AuthedActor, metricId: string) => {
    if (!isUuid(metricId)) throw invalid('Не удалось сохранить интеграцию', { metric_id: 'Выберите KPI' });
    const { rows } = await db.query<{ goal_id: string; status: string }>(
      `SELECT g.id AS goal_id, g.status FROM goal_metrics m JOIN goals g ON g.id = m.goal_id WHERE m.id = $1 AND g.company_id = $2`,
      [metricId, actor.company_id],
    );
    if (!rows[0]) throw invalid('Не удалось сохранить интеграцию', { metric_id: 'Выберите KPI' });
    if (rows[0].status === 'cancelled') throw invalid('Не удалось сохранить интеграцию', { metric_id: 'Цель отменена — выберите другой KPI' });
    return rows[0].goal_id;
  };

  const check = (kind: IntegrationKind, body: { name?: string; config?: unknown; username?: string | null }, hasSecret: boolean) => {
    const { config, errors } = validateIntegrationConfig(kind, body.config);
    const fields: Record<string, string> = Object.fromEntries(Object.entries(errors).map(([k, v]) => [`config.${k}`, v]));
    if (body.name !== undefined && !body.name.trim()) fields.name = 'Назовите подключение';
    if (kind === 'onec' && body.username !== undefined && !body.username?.trim()) fields.username = 'Укажите пользователя 1С';
    if (!hasSecret) fields.secret = kind === 'onec' ? 'Укажите пароль пользователя 1С' : 'Укажите токен веб-сервиса Moodle';
    if (Object.keys(fields).length) throw invalid('Не удалось сохранить интеграцию', fields);
    return config!;
  };

  r.get('/', async (req, res) => {
    const actor = actorOf(req);
    admin(actor);
    const list = await loadIntegrations(db, actor.company_id);
    const at = now();
    const { rows: last } = await db.query<RunResult & { integration_id: string }>(
      `SELECT DISTINCT ON (integration_id) integration_id, id, trigger, status, started_at, finished_at, fetched, imported, skipped, error
         FROM integration_runs WHERE company_id = $1 ORDER BY integration_id, started_at DESC, created_at DESC`,
      [actor.company_id],
    );
    const byId = new Map(last.map(({ integration_id, ...run }) => [integration_id, serializeRun(run)]));
    res.json({ data: list.map((i) => ({ ...serializeIntegration(i, at), last_run: byId.get(i.id) ?? null })) });
  });

  /** Куда можно писать: KPI целей компании, кроме отменённых и завершённых. */
  r.get('/targets', async (req, res) => {
    const actor = actorOf(req);
    admin(actor);
    const { rows } = await db.query(
      `SELECT m.id AS metric_id, m.name AS metric_name, m.unit, g.id AS goal_id, g.title AS goal_title
         FROM goal_metrics m JOIN goals g ON g.id = m.goal_id
        WHERE g.company_id = $1 AND g.status NOT IN ('cancelled', 'completed')
        ORDER BY g.title, m.is_primary DESC, m.created_at`,
      [actor.company_id],
    );
    res.json({ data: rows });
  });

  /** Проверить ещё не сохранённые настройки. id — если правим подключение и пароль не меняли. */
  r.post('/test', async (req, res) => {
    const actor = actorOf(req);
    admin(actor);
    const body = parseBody(baseSchema.pick({ kind: true, config: true, username: true, secret: true }).extend({ id: z.string().optional() }), req.body);
    let secret = body.secret || null;
    if (!secret && body.id) secret = (await one(actor, body.id)).secret;
    const config = check(body.kind, body, !!secret);
    res.json({ data: await testConnection({ kind: body.kind, config, username: body.username?.trim() || null, secret }, doFetch, now()) });
  });

  r.post('/', async (req, res) => {
    const actor = actorOf(req);
    admin(actor);
    const body = parseBody(baseSchema, req.body);
    const config = check(body.kind, { ...body, username: body.kind === 'onec' ? (body.username ?? '') : undefined }, !!body.secret);
    const goalId = await target(actor, body.metric_id);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO integrations (company_id, goal_id, metric_id, kind, name, config, username, secret, enabled, interval_hours, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        actor.company_id,
        goalId,
        body.metric_id,
        body.kind,
        body.name.trim(),
        JSON.stringify(config),
        body.kind === 'onec' ? body.username!.trim() : null,
        sealSecret(body.secret),
        body.enabled ?? true,
        body.interval_hours ?? 24,
        actor.id,
      ],
    );
    res.status(201).json({ data: serializeIntegration((await loadIntegrations(db, actor.company_id, rows[0]!.id))[0]!, now()) });
  });

  r.patch('/:id', async (req, res) => {
    const actor = actorOf(req);
    admin(actor);
    const cur = await one(actor, String(req.params.id));
    const body = parseBody(baseSchema.omit({ kind: true }).partial(), req.body);
    const next = {
      name: body.name ?? cur.name,
      config: body.config ?? cur.config,
      username: body.username !== undefined ? body.username : cur.username,
      secret: body.secret || cur.secret,
    };
    const config = check(cur.kind, { ...next, username: cur.kind === 'onec' ? (next.username ?? '') : undefined }, !!next.secret);
    const goalId = body.metric_id && body.metric_id !== cur.metric_id ? await target(actor, body.metric_id) : cur.goal_id;
    // Сменили систему или KPI — прошлая отметка «до какого места забрали» больше не годится.
    const reset = body.metric_id !== undefined && body.metric_id !== cur.metric_id;
    await db.query(
      `UPDATE integrations SET name = $2, config = $3, username = $4, secret = $5, enabled = $6, interval_hours = $7, metric_id = $8, goal_id = $9,
              last_success_at = CASE WHEN $10 THEN NULL ELSE last_success_at END, updated_at = NOW()
        WHERE id = $1`,
      [
        cur.id,
        next.name.trim(),
        JSON.stringify(config),
        cur.kind === 'onec' ? next.username?.trim() || null : null,
        sealSecret(next.secret),
        body.enabled ?? cur.enabled,
        body.interval_hours ?? cur.interval_hours,
        body.metric_id ?? cur.metric_id,
        goalId,
        reset || body.config !== undefined,
      ],
    );
    res.json({ data: serializeIntegration((await loadIntegrations(db, actor.company_id, cur.id))[0]!, now()) });
  });

  r.delete('/:id', async (req, res) => {
    const actor = actorOf(req);
    admin(actor);
    const cur = await one(actor, String(req.params.id));
    await db.query(`DELETE FROM integrations WHERE id = $1`, [cur.id]);
    res.status(204).end();
  });

  r.post('/:id/test', async (req, res) => {
    const actor = actorOf(req);
    admin(actor);
    const cur = await one(actor, String(req.params.id));
    res.json({ data: await testConnection(cur, doFetch, now()) });
  });

  r.post('/:id/sync', async (req, res) => {
    const actor = actorOf(req);
    admin(actor);
    const cur = await one(actor, String(req.params.id));
    const run = await syncIntegration(db, actor.company_id, cur.id, { fetch: doFetch, now: now(), trigger: 'manual', actorId: actor.id });
    const [fresh] = await loadIntegrations(db, actor.company_id, cur.id);
    res.json({ data: { run, integration: serializeIntegration(fresh!, now()) } });
  });

  r.get('/:id/runs', async (req, res) => {
    const actor = actorOf(req);
    admin(actor);
    const cur = await one(actor, String(req.params.id));
    const { rows } = await db.query<RunResult>(
      `SELECT id, trigger, status, started_at, finished_at, fetched, imported, skipped, error FROM integration_runs WHERE integration_id = $1 ORDER BY started_at DESC, created_at DESC LIMIT 20`,
      [cur.id],
    );
    res.json({ data: rows.map(serializeRun) });
  });

  return r;
}
