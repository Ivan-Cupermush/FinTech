import type { NotificationKind } from '@offix/core';
import type { Queryable } from '../db/db';

export interface NewNotification {
  company_id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  goal_id?: string | null;
  task_id?: string | null;
  /** Данные для перехода: запрос заметки, просьба и т. п. */
  data?: Record<string, unknown>;
}

/**
 * Уведомление человеку. Себе самому уведомления не шлём. Push на телефон
 * отправит фоновая рассылка (services/push.ts), когда транзакция завершится.
 */
export async function notify(q: Queryable, n: NewNotification, actorId: string | null): Promise<boolean> {
  if (n.user_id === actorId) return false;
  await q.query(
    `INSERT INTO notifications (company_id, user_id, kind, title, body, goal_id, task_id, actor_id, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [n.company_id, n.user_id, n.kind, n.title, n.body ?? null, n.goal_id ?? null, n.task_id ?? null, actorId, JSON.stringify(n.data ?? {})],
  );
  return true;
}

/**
 * Уведомления одного действия: пишем в транзакции, а сигнал «новое во
 * „Входящих“» шлём после неё — открытая вкладка покажет его сразу, без
 * обновления страницы.
 */
export function inbox() {
  const sent = new Map<string, { kind: string; title: string }>();
  return {
    async notify(q: Queryable, n: NewNotification, actorId: string | null) {
      if (await notify(q, n, actorId)) sent.set(n.user_id, { kind: n.kind, title: n.title });
    },
    flush(rt: { emit(companyId: string, userIds: readonly string[], event: string, payload: unknown): void }, companyId: string) {
      for (const [uid, p] of sent) rt.emit(companyId, [uid], 'notification', p);
      sent.clear();
    },
  };
}
