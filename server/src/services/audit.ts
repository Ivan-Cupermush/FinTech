import type { Queryable } from '../db/db';

export interface AuditEntry {
  company_id: string;
  entity_type: 'goal' | 'task' | 'org_unit' | 'member' | 'metric';
  entity_id: string;
  goal_id?: string | null;
  actor_id: string | null;
  event_type: string;
  old_values?: unknown;
  new_values?: unknown;
}

/** Пишет событие в журнал. Вызывается внутри той же транзакции, что и изменение. */
export async function audit(q: Queryable, e: AuditEntry): Promise<void> {
  await q.query(
    `INSERT INTO audit_events (company_id, entity_type, entity_id, goal_id, actor_id, event_type, old_values, new_values)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      e.company_id,
      e.entity_type,
      e.entity_id,
      e.goal_id ?? null,
      e.actor_id,
      e.event_type,
      e.old_values === undefined ? null : JSON.stringify(e.old_values),
      e.new_values === undefined ? null : JSON.stringify(e.new_values),
    ],
  );
}

/** Только изменившиеся поля: { old, new } для журнала. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { old: Partial<T>; new: Partial<T> } | null {
  const o: Partial<T> = {};
  const n: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
      o[k] = before[k];
      n[k] = after[k];
    }
  }
  return Object.keys(n).length ? { old: o, new: n } : null;
}
