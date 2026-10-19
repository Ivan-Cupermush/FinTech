import { parsePushSettings, pushMessage, shouldPush, type PushMessage, type PushSettings } from '@offix/core';
import type { Db, Queryable } from '../db/db';

/** Ответ Expo на одно сообщение. */
export interface PushTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo принимает до 100 сообщений за запрос. */
const EXPO_CHUNK = 100;

/** Отправка через Expo Push API: один сервис и для iOS (APNs), и для Android (FCM). */
export function expoSender(opts: { accessToken?: string; fetch?: typeof fetch } = {}): PushSender {
  const doFetch = opts.fetch ?? fetch;
  return {
    async send(messages) {
      const tickets: PushTicket[] = [];
      for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
        const chunk = messages.slice(i, i + EXPO_CHUNK);
        const res = await doFetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
          },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) throw new Error(`Expo push: HTTP ${res.status}`);
        const json = (await res.json()) as { data?: PushTicket[] };
        const data = json.data ?? [];
        // На случай укороченного ответа: всё, что не подтверждено, считаем ошибкой.
        for (let k = 0; k < chunk.length; k++) tickets.push(data[k] ?? { status: 'error', message: 'Нет ответа' });
      }
      return tickets;
    },
  };
}

export async function loadPushSettings(q: Queryable, userId: string, companyId: string): Promise<PushSettings> {
  const { rows } = await q.query<{ muted: string[]; quiet_hours: boolean }>(`SELECT muted, quiet_hours FROM push_settings WHERE user_id = $1 AND company_id = $2`, [userId, companyId]);
  return parsePushSettings(rows[0]);
}

interface PendingRow {
  id: string;
  company_id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  goal_id: string | null;
  task_id: string | null;
  fresh: boolean;
}

export interface DispatchResult {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Разослать push по новым уведомлениям. Вызывается по таймеру: берёт пачку
 * уведомлений без решения, для каждого проверяет настройки человека и его
 * устройства, отправляет и записывает итог. Уведомления старше часа на
 * телефон не шлём — они уже ждут во «Входящих». Если Expo недоступен, пачка
 * возвращается в очередь и уйдёт на следующем шаге.
 */
export async function dispatchPush(db: Db, sender: PushSender, at: string, opts: { batch?: number; maxAgeMinutes?: number } = {}): Promise<DispatchResult> {
  const batch = opts.batch ?? 100;
  const maxAge = opts.maxAgeMinutes ?? 60;
  const result: DispatchResult = { sent: 0, skipped: 0, failed: 0 };

  // Забираем пачку в работу. SKIP LOCKED — чтобы два процесса не слали одно и то же.
  const claimed = await db.tx(async (q) => {
    const { rows } = await q.query<PendingRow>(
      `UPDATE notifications n SET push_state = 'sending'
        WHERE n.id IN (SELECT id FROM notifications WHERE push_state IS NULL ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING n.id, n.company_id, n.user_id, n.kind, n.title, n.body, n.goal_id, n.task_id,
                  n.created_at > NOW() - make_interval(mins => $2::int) AS fresh`,
      [batch, maxAge],
    );
    return rows;
  });
  if (!claimed.length) return result;

  const finish = (ids: string[], state: 'sent' | 'skipped' | 'failed' | null) =>
    ids.length ? db.query(`UPDATE notifications SET push_state = $2::varchar, pushed_at = CASE WHEN $2::varchar = 'sent' THEN NOW() END WHERE id = ANY($1::uuid[])`, [ids, state]) : null;

  const skipped: string[] = [];
  const outgoing: { notification: PendingRow; messages: PushMessage[]; devices: string[] }[] = [];
  for (const n of claimed) {
    if (!n.fresh) {
      skipped.push(n.id);
      continue;
    }
    const settings = await loadPushSettings(db, n.user_id, n.company_id);
    if (!shouldPush(n.kind, settings, at).send) {
      skipped.push(n.id);
      continue;
    }
    const devices = await db.query<{ id: string; token: string }>(
      `SELECT id, token FROM push_devices WHERE user_id = $1 AND company_id = $2 AND disabled_at IS NULL ORDER BY last_seen_at DESC LIMIT 10`,
      [n.user_id, n.company_id],
    );
    if (!devices.rows.length) {
      skipped.push(n.id);
      continue;
    }
    const unread = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND company_id = $2 AND read_at IS NULL`, [n.user_id, n.company_id]);
    outgoing.push({
      notification: n,
      messages: devices.rows.map((d) => pushMessage(d.token, n, unread.rows[0]?.n ?? 0)),
      devices: devices.rows.map((d) => d.id),
    });
  }
  await finish(skipped, 'skipped');
  result.skipped = skipped.length;
  if (!outgoing.length) return result;

  const messages = outgoing.flatMap((o) => o.messages);
  let tickets: PushTicket[];
  try {
    tickets = await sender.send(messages);
  } catch {
    // Сеть или Expo недоступны: вернём в очередь, попробуем на следующем шаге.
    await finish(
      outgoing.map((o) => o.notification.id),
      null,
    );
    return result;
  }

  const sent: string[] = [];
  const failed: string[] = [];
  const dead: string[] = [];
  let k = 0;
  for (const o of outgoing) {
    let ok = false;
    for (const deviceId of o.devices) {
      const t = tickets[k++];
      if (t?.status === 'ok') ok = true;
      // Приложение удалили или токен сменился — устройство больше не беспокоим.
      else if (t?.details?.error === 'DeviceNotRegistered') dead.push(deviceId);
    }
    (ok ? sent : failed).push(o.notification.id);
  }
  if (dead.length) await db.query(`UPDATE push_devices SET disabled_at = NOW() WHERE id = ANY($1::uuid[])`, [dead]);
  await finish(sent, 'sent');
  await finish(failed, 'failed');
  result.sent = sent.length;
  result.failed = failed.length;
  return result;
}

/** Фоновая рассылка: шаг раз в несколько секунд, без наложения шагов друг на друга. */
export function startPushLoop(db: Db, sender: PushSender, opts: { intervalMs?: number; now?: () => Date; onError?: (e: unknown) => void } = {}): () => void {
  const now = opts.now ?? (() => new Date());
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await dispatchPush(db, sender, now().toISOString());
    } catch (e) {
      opts.onError?.(e);
    } finally {
      running = false;
    }
  }, opts.intervalMs ?? 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}
