import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PushMessage } from '@offix/core';
import { dispatchPush, expoSender, type PushSender, type PushTicket } from '../src/services/push';
import { setup, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

const DAY = '2026-10-19T09:00:00.000Z'; // 12:00 по Москве
const NIGHT = '2026-10-19T21:30:00.000Z'; // 00:30 по Москве
const ANNA_PHONE = 'ExponentPushToken[anna-phone-0001]';
const ANNA_TABLET = 'ExponentPushToken[anna-tablet-001]';

function fakeSender(ticket: (m: PushMessage) => PushTicket = () => ({ status: 'ok' })) {
  const sent: PushMessage[] = [];
  const sender: PushSender & { sent: PushMessage[]; fail?: boolean } = {
    sent,
    async send(messages) {
      if (sender.fail) throw new Error('network');
      sent.push(...messages);
      return messages.map(ticket);
    },
  };
  return sender;
}

/** Ольга ставит Анне задачу — у Анны появляется уведомление. */
async function assignToAnna(title = 'Сверить заявки с реестром') {
  const olga = await ctx.as('olga');
  const r = await olga.post('/api/v1/tasks', { title, assignee_id: ctx.demo.users.anna });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

const stateOf = async (taskId: string) =>
  (await ctx.db.query<{ push_state: string | null; pushed_at: string | null }>(`SELECT push_state, pushed_at FROM notifications WHERE task_id = $1 AND user_id = $2`, [taskId, ctx.demo.users.anna])).rows[0]!;

async function drain() {
  // Всё, что накопилось в других тестах, к этому тесту не относится.
  await ctx.db.query(`UPDATE notifications SET push_state = 'skipped' WHERE push_state IS NULL`);
}

describe('устройства', () => {
  it('без входа — 401', async () => {
    expect((await request(ctx.app).post('/api/v1/push/devices').send({ token: ANNA_PHONE, platform: 'ios' })).status).toBe(401);
  });

  it('регистрация: 201, повтор — 200 без дубля', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.post('/api/v1/push/devices', { token: ANNA_PHONE, platform: 'ios' })).status).toBe(201);
    expect((await anna.post('/api/v1/push/devices', { token: ANNA_PHONE, platform: 'ios' })).status).toBe(200);
    const { rows } = await ctx.db.query(`SELECT user_id FROM push_devices WHERE token = $1`, [ANNA_PHONE]);
    expect(rows).toEqual([{ user_id: ctx.demo.users.anna }]);
  });

  it('некорректный токен или платформа — ошибка с полем', async () => {
    const anna = await ctx.as('anna');
    const bad = await anna.post('/api/v1/push/devices', { token: 'fcm:123', platform: 'ios' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.token).toBe('Некорректный токен устройства');
    expect((await anna.post('/api/v1/push/devices', { token: ANNA_PHONE, platform: 'web' })).status).toBe(400);
  });

  it('вошёл другой сотрудник — телефон переходит к нему', async () => {
    const shared = 'ExponentPushToken[shared-phone-01]';
    await (await ctx.as('dima')).post('/api/v1/push/devices', { token: shared, platform: 'android' });
    await (await ctx.as('maria')).post('/api/v1/push/devices', { token: shared, platform: 'android' });
    const { rows } = await ctx.db.query(`SELECT user_id FROM push_devices WHERE token = $1`, [shared]);
    expect(rows).toEqual([{ user_id: ctx.demo.users.maria }]);
  });

  it('выход отвязывает телефон, чужой токен не удаляется', async () => {
    const t = 'ExponentPushToken[igor-phone-0001]';
    await (await ctx.as('igor')).post('/api/v1/push/devices', { token: t, platform: 'ios' });
    expect((await (await ctx.as('dima')).delete(`/api/v1/push/devices/${encodeURIComponent(t)}`)).status).toBe(204);
    expect((await ctx.db.query(`SELECT 1 FROM push_devices WHERE token = $1`, [t])).rows).toHaveLength(1);
    expect((await (await ctx.as('igor')).delete(`/api/v1/push/devices/${encodeURIComponent(t)}`)).status).toBe(204);
    expect((await ctx.db.query(`SELECT 1 FROM push_devices WHERE token = $1`, [t])).rows).toHaveLength(0);
  });
});

describe('настройки', () => {
  it('по умолчанию: все темы, тихие часы включены', async () => {
    const r = await (await ctx.as('sergey')).get('/api/v1/push/settings');
    expect(r.body.data).toEqual({ muted: [], quiet_hours: true, devices: 0 });
  });

  it('сохраняются и читаются обратно', async () => {
    const sergey = await ctx.as('sergey');
    const put = await sergey.put('/api/v1/push/settings', { muted: ['comments', 'goals'], quiet_hours: false });
    expect(put.status).toBe(200);
    expect(put.body.data).toEqual({ muted: ['goals', 'comments'], quiet_hours: false });
    expect((await sergey.get('/api/v1/push/settings')).body.data).toMatchObject({ muted: ['goals', 'comments'], quiet_hours: false });
  });

  it('неизвестная тема — ошибка', async () => {
    expect((await (await ctx.as('sergey')).put('/api/v1/push/settings', { muted: ['spam'], quiet_hours: true })).status).toBe(400);
  });
});

describe('рассылка', () => {
  beforeEach(drain);

  it('новая задача — push на телефон Анны с бейджем и переходом к задаче', async () => {
    const taskId = await assignToAnna();
    const sender = fakeSender();
    expect(await dispatchPush(ctx.db, sender, DAY)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      to: ANNA_PHONE,
      title: 'Новая задача: «Сверить заявки с реестром»',
      channelId: 'default',
      data: { kind: 'task_assigned', task_id: taskId },
    });
    expect(sender.sent[0]!.badge).toBeGreaterThan(0);
    expect(await stateOf(taskId)).toMatchObject({ push_state: 'sent' });
    expect((await stateOf(taskId)).pushed_at).toBeTruthy();
  });

  it('второй шаг ничего не шлёт повторно', async () => {
    await assignToAnna();
    const sender = fakeSender();
    await dispatchPush(ctx.db, sender, DAY);
    expect(await dispatchPush(ctx.db, sender, DAY)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(sender.sent).toHaveLength(1);
  });

  it('на все устройства человека', async () => {
    await (await ctx.as('anna')).post('/api/v1/push/devices', { token: ANNA_TABLET, platform: 'android' });
    await assignToAnna();
    const sender = fakeSender();
    await dispatchPush(ctx.db, sender, DAY);
    expect(sender.sent.map((m) => m.to).sort()).toEqual([ANNA_PHONE, ANNA_TABLET].sort());
    await (await ctx.as('anna')).delete(`/api/v1/push/devices/${encodeURIComponent(ANNA_TABLET)}`);
  });

  it('ночью обычная задача ждёт во «Входящих»', async () => {
    const taskId = await assignToAnna();
    const sender = fakeSender();
    expect(await dispatchPush(ctx.db, sender, NIGHT)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(sender.sent).toEqual([]);
    expect((await stateOf(taskId)).push_state).toBe('skipped');
    // Само уведомление никуда не делось.
    const inbox = await (await ctx.as('anna')).get('/api/v1/notifications');
    expect(inbox.body.data.some((n: { task_id: string }) => n.task_id === taskId)).toBe(true);
  });

  it('приглушённая тема не приходит', async () => {
    const anna = await ctx.as('anna');
    await anna.put('/api/v1/push/settings', { muted: ['tasks'], quiet_hours: true });
    await assignToAnna();
    const sender = fakeSender();
    expect((await dispatchPush(ctx.db, sender, DAY)).skipped).toBe(1);
    expect(sender.sent).toEqual([]);
    await anna.put('/api/v1/push/settings', { muted: [], quiet_hours: true });
  });

  it('без устройств — пропуск', async () => {
    const olga = await ctx.as('olga');
    await olga.post('/api/v1/tasks', { title: 'Для Сергея', assignee_id: ctx.demo.users.sergey });
    const sender = fakeSender();
    expect(await dispatchPush(ctx.db, sender, DAY)).toEqual({ sent: 0, skipped: 1, failed: 0 });
  });

  it('уведомление старше часа на телефон не шлём', async () => {
    const taskId = await assignToAnna();
    await ctx.db.query(`UPDATE notifications SET created_at = NOW() - interval '2 hours' WHERE task_id = $1`, [taskId]);
    const sender = fakeSender();
    expect((await dispatchPush(ctx.db, sender, DAY)).skipped).toBe(1);
    expect(sender.sent).toEqual([]);
  });

  it('сбой сети — уведомление возвращается в очередь и уходит потом', async () => {
    const taskId = await assignToAnna();
    const sender = fakeSender();
    sender.fail = true;
    expect(await dispatchPush(ctx.db, sender, DAY)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect((await stateOf(taskId)).push_state).toBeNull();
    sender.fail = false;
    expect((await dispatchPush(ctx.db, sender, DAY)).sent).toBe(1);
  });

  it('удалённое приложение: устройство отключается, push помечен неудачным', async () => {
    const t = 'ExponentPushToken[anna-old-phone1]';
    await (await ctx.as('anna')).delete(`/api/v1/push/devices/${encodeURIComponent(ANNA_PHONE)}`);
    await (await ctx.as('anna')).post('/api/v1/push/devices', { token: t, platform: 'ios' });
    const taskId = await assignToAnna();
    const sender = fakeSender(() => ({ status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }));
    expect(await dispatchPush(ctx.db, sender, DAY)).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect((await stateOf(taskId)).push_state).toBe('failed');
    const dev = await ctx.db.query<{ disabled_at: string | null }>(`SELECT disabled_at FROM push_devices WHERE token = $1`, [t]);
    expect(dev.rows[0]!.disabled_at).toBeTruthy();
    // Следующее уведомление на отключённое устройство уже не идёт.
    await assignToAnna('Ещё одна');
    const next = fakeSender();
    expect(await dispatchPush(ctx.db, next, DAY)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    // Тот же телефон снова вошёл — снова получает.
    await (await ctx.as('anna')).post('/api/v1/push/devices', { token: t, platform: 'ios' });
    expect((await ctx.db.query(`SELECT disabled_at FROM push_devices WHERE token = $1`, [t])).rows[0]).toEqual({ disabled_at: null });
  });

  it('отменённая операция не шлёт push: уведомление в той же транзакции', async () => {
    const before = (await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications WHERE push_state IS NULL`)).rows[0]!.n;
    const r = await (await ctx.as('olga')).post('/api/v1/tasks', { title: ' ', assignee_id: ctx.demo.users.anna });
    expect(r.status).toBe(422);
    expect((await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications WHERE push_state IS NULL`)).rows[0]!.n).toBe(before);
  });
});

describe('expoSender', () => {
  it('шлёт пачками по 100 на Expo с токеном доступа', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body)) as unknown[];
      return new Response(JSON.stringify({ data: body.map(() => ({ status: 'ok' })) }), { status: 200 });
    }) as unknown as typeof fetch;
    const sender = expoSender({ accessToken: 'secret', fetch: fetchMock });
    const msg = { to: 'ExponentPushToken[abcdefgh]', title: 't', sound: 'default', badge: 0, channelId: 'default', priority: 'default', data: { notification_id: 'n', kind: 'k', goal_id: null, task_id: null } } as PushMessage;
    const tickets = await sender.send(Array.from({ length: 150 }, () => msg));
    expect(tickets).toHaveLength(150);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://exp.host/--/api/v2/push/send');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(String(calls[1]!.init.body))).toHaveLength(50);
  });

  it('ошибка HTTP — исключение, рассылка повторит позже', async () => {
    const sender = expoSender({ fetch: (async () => new Response('fail', { status: 503 })) as unknown as typeof fetch });
    await expect(sender.send([{} as PushMessage])).rejects.toThrow('HTTP 503');
  });

  it('укороченный ответ — неподтверждённые считаются ошибкой', async () => {
    const sender = expoSender({ fetch: (async () => new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 })) as unknown as typeof fetch });
    const t = await sender.send([{} as PushMessage, {} as PushMessage]);
    expect(t.map((x) => x.status)).toEqual(['ok', 'error']);
  });
});
