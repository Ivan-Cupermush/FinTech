import { describe, expect, it } from 'vitest';
import { recordProposals } from '../src/services/reschedule';
import { setup, type Ctx } from './helpers';

/**
 * «Доверие к переносам»: предложения записываются, когда их видит тот, кто
 * может перенести сроки, и закрываются подтверждением, отказом или ручным
 * переносом. Метрика на «Эффекте» считается по этим записям.
 */

type Proposal = { task_id: string; to_start: string | null; to_due: string; from_due: string };

const rows = (ctx: Ctx) =>
  ctx.db.query<{ task_id: string; outcome: string | null; from_due: string; to_due: string }>(`SELECT task_id, outcome, from_due, to_due FROM reschedule_proposals ORDER BY task_id, shown_at`).then((r) => r.rows);

async function proposalsOf(ctx: Ctx, who: 'olga' | 'anna' = 'olga'): Promise<Proposal[]> {
  const a = await ctx.as(who);
  const d = (await a.get(`/api/v1/goals/${ctx.demo.goals.main}/roadmap`)).body.data;
  return d.risks.find((r: { kind: string }) => r.kind === 'dependency_delay')?.proposals ?? [];
}

describe('доверие к переносам', () => {
  it('предложение записывается, только когда его видит руководитель цели, и без дублей', async () => {
    const ctx = await setup();
    expect((await proposalsOf(ctx, 'anna')).length).toBeGreaterThan(0);
    expect(await rows(ctx)).toEqual([]);
    const proposals = await proposalsOf(ctx);
    await proposalsOf(ctx);
    const saved = await rows(ctx);
    expect(saved).toHaveLength(proposals.length);
    expect(saved.every((r) => r.outcome === null)).toBe(true);

    const olga = await ctx.as('olga');
    const m = (await olga.get('/api/v1/metrics')).body.data;
    expect(m.trust).toMatchObject({ value: null, accepted: 0, dismissed: 0, open: proposals.length, expire_days: 14 });
    expect(m.series.trust).toHaveLength(8);
  });

  it('подтверждение и «Оставить как есть» дают долю в метрике, отказ не переспрашивается', async () => {
    const ctx = await setup();
    const [first, second] = await proposalsOf(ctx);
    expect(first && second).toBeTruthy();
    const olga = await ctx.as('olga');
    const anna = await ctx.as('anna');
    expect((await anna.post(`/api/v1/goals/${ctx.demo.goals.main}/reschedule/dismiss`, { task_ids: [second!.task_id] })).status).toBe(403);

    const dismissUrl = `/api/v1/goals/${ctx.demo.goals.main}/reschedule/dismiss`;
    const responses = await Promise.all([
      olga.post(dismissUrl, { task_ids: [second!.task_id, second!.task_id] }),
      olga.post(dismissUrl, { task_ids: [second!.task_id] }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.data.dismissed).sort()).toEqual([0, 1]);
    // Отказ не меняет сроки.
    expect((await olga.get(`/api/v1/tasks/${second!.task_id}`)).body.data.due_at).toBe(second!.from_due);

    const yes = await olga.post(`/api/v1/goals/${ctx.demo.goals.main}/reschedule`, { changes: [{ task_id: first!.task_id, start_at: first!.to_start, due_at: first!.to_due }] });
    expect(yes.status).toBe(200);

    // Страница открыта снова: отклонённое не возвращается в ожидающие.
    await proposalsOf(ctx);
    const saved = await rows(ctx);
    expect(saved.filter((r) => r.outcome === null)).toEqual([]);
    expect(saved.map((r) => r.outcome).sort()).toEqual(['accepted', 'dismissed']);

    const m = (await olga.get('/api/v1/metrics')).body.data;
    expect(m.trust).toMatchObject({ value: 50, accepted: 1, dismissed: 1, open: 0 });
    expect(m.series.trust.at(-1)).toBe(50);
  });

  it('ручной перенос срока закрывает предложение, рассосавшаяся задержка — удаляет', async () => {
    const ctx = await setup();
    const list = await proposalsOf(ctx);
    const big = list.reduce((a, b) => (Date.parse(b.to_due) - Date.parse(b.from_due) > Date.parse(a.to_due) - Date.parse(a.from_due) ? b : a));
    const other = list.find((p) => p.task_id !== big.task_id)!;
    const olga = await ctx.as('olga');
    // Срок сдвинули руками, но меньше предложенного — решили по-своему.
    const own = new Date(Date.parse(big.from_due) + 86_400_000).toISOString().slice(0, 10);
    expect(own < big.to_due).toBe(true);
    expect((await olga.patch(`/api/v1/tasks/${big.task_id}`, { due_at: own })).status).toBe(200);
    // Другую задачу отменили — переносить нечего.
    expect((await olga.post(`/api/v1/tasks/${other.task_id}/status`, { status: 'cancelled' })).status).toBeLessThan(300);
    await proposalsOf(ctx);
    const saved = await rows(ctx);
    const mine = saved.filter((r) => r.task_id === big.task_id);
    expect(mine.find((r) => r.from_due === big.from_due)?.outcome).toBe('dismissed');
    // Если задержка осталась, с новым сроком это уже новое предложение, а не старое.
    expect(mine.filter((r) => r.outcome === null).every((r) => r.from_due === own)).toBe(true);
    expect(saved.some((r) => r.task_id === other.task_id)).toBe(false);
  });

  it('обновление карты сохраняет решение, принятое после чтения открытых предложений', async () => {
    const ctx = await setup();
    const [proposal] = await proposalsOf(ctx);
    const actor = await ctx.as('olga');
    const goalId = ctx.demo.goals.main!;
    const result = await ctx.db.query<{ company_id: string }>('SELECT company_id FROM goals WHERE id = $1', [goalId]);
    const q = {
      async query<T>(sql: string, params?: unknown[]) {
        const current = await ctx.db.query<T>(sql, params);
        if (sql.includes('SELECT id, task_id, from_due, to_due')) {
          const response = await actor.post(`/api/v1/goals/${goalId}/reschedule/dismiss`, { task_ids: [proposal!.task_id] });
          expect(response.body.data.dismissed).toBe(1);
        }
        return current;
      },
    };
    await recordProposals(q, result.rows[0]!.company_id, goalId, [], [], '2026-10-19T12:00:00.000Z');
    expect(await rows(ctx)).toEqual([expect.objectContaining({ task_id: proposal!.task_id, outcome: 'dismissed' })]);
  });
});
