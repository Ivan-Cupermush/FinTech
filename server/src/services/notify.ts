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
}

/**
 * Уведомление человеку. Себе самому уведомления не шлём. Push на телефон
 * отправит фоновая рассылка (services/push.ts), когда транзакция завершится.
 */
export async function notify(q: Queryable, n: NewNotification, actorId: string | null): Promise<void> {
  if (n.user_id === actorId) return;
  await q.query(
    `INSERT INTO notifications (company_id, user_id, kind, title, body, goal_id, task_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [n.company_id, n.user_id, n.kind, n.title, n.body ?? null, n.goal_id ?? null, n.task_id ?? null],
  );
}
