import type { ShiftProposal } from '@offix/core';
import type { Queryable } from '../db/db';

/**
 * Учёт предложенных переносов сроков для метрики «Доверие к переносам».
 *
 * Предложение записываем, когда его увидел тот, кто может перенести сроки
 * (руководитель цели открыл её страницу). Дальше у него четыре исхода:
 * - подтвердили перенос — «принято»;
 * - нажали «Оставить как есть» — «отклонено»;
 * - срок задачи поменяли руками: не раньше предложенного — «принято»,
 *   раньше — «отклонено» (решили по-своему);
 * - задержка рассосалась сама (предшественник успел, задача закрыта) —
 *   предложение больше не о чем, строку удаляем: в метрику оно не идёт.
 * Молчание дольше двух недель метрика считает отказом сама (см. ядро).
 * Время пишем по часам приложения, а не базы: метрики считаются по ним же.
 */

interface OpenRow {
  id: string;
  task_id: string;
  from_due: string;
  to_due: string;
}

interface TaskState {
  id: string;
  status: string;
  due_at: string | null;
}

export async function recordProposals(q: Queryable, companyId: string, goalId: string, proposals: readonly ShiftProposal[], tasks: readonly TaskState[], at: string): Promise<void> {
  const open = await q.query<OpenRow>(
    `SELECT id, task_id, from_due, to_due FROM reschedule_proposals WHERE goal_id = $1 AND decided_at IS NULL`,
    [goalId],
  );
  if (!open.rows.length && !proposals.length) return;
  // «Оставить как есть» — ответ на это предложение: пока срок задачи тот же,
  // заново не спрашиваем и второй отказ не считаем.
  const declined = await q.query<{ task_id: string; from_due: string }>(`SELECT task_id, from_due FROM reschedule_proposals WHERE goal_id = $1 AND outcome = 'dismissed'`, [goalId]);
  const said = new Set(declined.rows.map((r) => `${r.task_id}|${r.from_due}`));
  const byTask = new Map(open.rows.map((r) => [r.task_id, r]));
  const current = new Set(proposals.map((p) => p.task_id));
  for (const p of proposals) {
    const row = byTask.get(p.task_id);
    if (!row && said.has(`${p.task_id}|${p.from_due}`)) continue;
    if (!row) {
      await q.query(
        `INSERT INTO reschedule_proposals (company_id, goal_id, task_id, from_due, to_due, shown_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (goal_id, task_id) WHERE decided_at IS NULL DO NOTHING`,
        [companyId, goalId, p.task_id, p.from_due, p.to_due, at],
      );
    } else if (row.from_due !== p.from_due) {
      // Срок задачи поменяли руками, а задержка осталась: прежнее предложение
      // получило ответ, новое ждёт своего.
      await q.query(`UPDATE reschedule_proposals SET decided_at = GREATEST(shown_at, $3::timestamptz), outcome = $2 WHERE id = $1`, [row.id, p.from_due >= row.to_due ? 'accepted' : 'dismissed', at]);
      await q.query(`INSERT INTO reschedule_proposals (company_id, goal_id, task_id, from_due, to_due, shown_at) VALUES ($1, $2, $3, $4, $5, $6)`, [companyId, goalId, p.task_id, p.from_due, p.to_due, at]);
    } else if (row.to_due !== p.to_due) {
      // Задержка выросла или уменьшилась — то же предложение с новым сроком.
      await q.query(`UPDATE reschedule_proposals SET to_due = $2 WHERE id = $1`, [row.id, p.to_due]);
    }
  }
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  for (const row of open.rows) {
    if (current.has(row.task_id)) continue;
    const t = taskById.get(row.task_id);
    if (!t || !t.due_at || t.due_at === row.from_due || t.status === 'done' || t.status === 'cancelled') {
      await q.query(`DELETE FROM reschedule_proposals WHERE id = $1`, [row.id]);
      continue;
    }
    await q.query(`UPDATE reschedule_proposals SET decided_at = GREATEST(shown_at, $3::timestamptz), outcome = $2 WHERE id = $1`, [row.id, t.due_at >= row.to_due ? 'accepted' : 'dismissed', at]);
  }
}

/** Руководитель ответил на предложение: подтвердил или оставил как есть. */
export async function decideProposals(q: Queryable, companyId: string, goalId: string, decided: readonly { task_id: string; from_due: string | null; to_due: string }[], outcome: 'accepted' | 'dismissed', at: string): Promise<number> {
  let n = 0;
  for (const d of decided) {
    const r = await q.query(`UPDATE reschedule_proposals SET decided_at = GREATEST(shown_at, $4::timestamptz), outcome = $3 WHERE goal_id = $1 AND task_id = $2 AND decided_at IS NULL RETURNING id`, [goalId, d.task_id, outcome, at]);
    if (r.rows.length) {
      n += r.rows.length;
      continue;
    }
    // Предложение не успели записать (страницу открыли до обновления) —
    // решение всё равно учитываем.
    if (!d.from_due) continue;
    await q.query(
      `INSERT INTO reschedule_proposals (company_id, goal_id, task_id, from_due, to_due, shown_at, decided_at, outcome) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
      [companyId, goalId, d.task_id, d.from_due, d.to_due, at, outcome],
    );
    n++;
  }
  return n;
}

export interface ProposalRow {
  shown_at: string;
  decided_at: string | null;
  outcome: 'accepted' | 'dismissed' | null;
}

export async function loadProposals(q: Queryable, companyId: string, goalIds: readonly string[]): Promise<ProposalRow[]> {
  if (!goalIds.length) return [];
  const r = await q.query<ProposalRow>(
    `SELECT shown_at, decided_at, outcome FROM reschedule_proposals WHERE company_id = $1 AND goal_id = ANY($2::uuid[]) ORDER BY shown_at`,
    [companyId, goalIds],
  );
  return r.rows;
}
