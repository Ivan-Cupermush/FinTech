import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import type { Db } from '../src/db/db';
import { migrate } from '../src/db/migrate';
import { createPgliteDb } from '../src/db/pglite';
import { DEMO_PASSWORD, seedDemo, type DemoIds } from '../src/seed/demo';
import { fakeSystemsFetch } from '../src/seed/fake-systems';
import type { FetchLike } from '../src/services/integrations';

/** Фиксированное «сегодня» — тесты не зависят от даты запуска. */
export const NOW = new Date('2026-10-19T12:00:00Z');
export const TODAY = '2026-10-19';
export const SECRET = 'test-secret-test-secret-test-secret-123';

export interface Ctx {
  db: Db;
  app: Express;
  demo: DemoIds;
  token: (who: keyof DemoIds['users']) => Promise<string>;
  as: (who: keyof DemoIds['users']) => Promise<Agent>;
}

export interface Agent {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  delete: (url: string) => request.Test;
}

const EMAILS: Record<keyof DemoIds['users'], string> = {
  director: 'director@offix.demo',
  olga: 'olga@offix.demo',
  anna: 'anna@offix.demo',
  igor: 'igor@offix.demo',
  dima: 'dima@offix.demo',
  maria: 'maria@offix.demo',
  sergey: 'sergey@offix.demo',
  elena: 'elena@offix.demo',
  observer: 'rector@offix.demo',
};

export async function setup(opts: { integrationFetch?: FetchLike } = {}): Promise<Ctx> {
  const db = await createPgliteDb();
  await migrate(db);
  const demo = await seedDemo(db, { now: NOW });
  const app = createApp({ db, config: { jwtSecret: SECRET, corsOrigins: ['http://localhost:5173'] }, now: () => NOW, rateLimit: false, integrationFetch: opts.integrationFetch ?? fakeSystemsFetch(() => NOW) });
  const cache = new Map<string, string>();
  const token = async (who: keyof DemoIds['users']) => {
    if (!cache.has(who)) {
      const r = await request(app).post('/api/v1/auth/login').send({ email: EMAILS[who], password: DEMO_PASSWORD });
      if (r.status !== 200) throw new Error(`login failed for ${who}: ${r.status}`);
      cache.set(who, r.body.data.token);
    }
    return cache.get(who)!;
  };
  const as = async (who: keyof DemoIds['users']): Promise<Agent> => {
    const t = await token(who);
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body) => auth(request(app).post(url)).send(body ?? {}),
      patch: (url, body) => auth(request(app).patch(url)).send(body ?? {}),
      put: (url, body) => auth(request(app).put(url)).send(body ?? {}),
      delete: (url) => auth(request(app).delete(url)),
    };
  };
  return { db, app, demo, token, as };
}

export const validGoal = (ownerId: string) => ({
  title: 'Сократить время ответа на обращение',
  description: 'Без потери качества ответа',
  type: 'operational',
  owner_id: ownerId,
  due_at: '2026-12-31',
  status: 'draft',
  metrics: [{ name: 'Среднее время ответа', unit: 'hours', baseline: 24, target: 8, direction: 'decrease' }],
});
