import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FunctionDetail } from '@offix/core';
import { recordingRealtime, setup, type Ctx } from './helpers';

const API = '/api/v1';
const rt = recordingRealtime();
let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup({ realtime: rt });
});
beforeEach(() => rt.clear());

type View = { functions: FunctionDetail[]; can_change: boolean; reason: string | null };
const enabled = (v: View) => Object.fromEntries(v.functions.map((f) => [f.key, f.enabled]));
const obs = (value: number) => ({ value, observed_at: '2026-10-19T10:00:00Z' });

describe('функции сотрудника', () => {
  it('по должности: у руководителя узла — KPI, у сотрудника — ничего, у владельца — всё', async () => {
    const olga = await ctx.as('olga');
    const me = (await olga.get(`${API}/functions/me`)).body.data as View;
    expect(enabled(me)).toEqual({ kpi_record: true, kpi_assign: true, knowledge_manage: false, sales_reports: true, sales_files: true, sales_assign: true });
    expect(me.can_change).toBe(false);
    const anna = (await olga.get(`${API}/functions/users/${ctx.demo.users.anna}`)).body.data as View;
    expect(enabled(anna)).toEqual({ kpi_record: false, kpi_assign: false, knowledge_manage: false, sales_reports: false, sales_files: false, sales_assign: false });
    expect(anna.can_change).toBe(true);
    const dir = await ctx.as('director');
    const owner = (await dir.get(`${API}/functions/me`)).body.data as View;
    expect(owner.functions.every((f) => f.enabled && f.locked)).toBe(true);
  });

  it('чужие функции видят только руководители и администраторы', async () => {
    const igor = await ctx.as('igor');
    expect((await igor.get(`${API}/functions/users/${ctx.demo.users.anna}`)).status).toBe(404);
    const sergey = await ctx.as('sergey');
    expect((await sergey.get(`${API}/functions/users/${ctx.demo.users.anna}`)).status).toBe(404);
  });

  it('Ольга включает Анне «Вносить измерения KPI»: Анна вносит факт по цели учебного офиса, но не по цели HR', async () => {
    const anna = await ctx.as('anna');
    const goal = (await anna.get(`${API}/goals/${ctx.demo.goals.main}`)).body.data;
    const metric = goal.metrics[0].id;
    expect((await anna.post(`${API}/goals/${ctx.demo.goals.main}/metrics/${metric}/observations`, obs(33))).status).toBe(403);

    const olga = await ctx.as('olga');
    const r = await olga.put(`${API}/functions/users/${ctx.demo.users.anna}`, { changes: { kpi_record: true } });
    expect(r.status).toBe(200);
    expect(r.body.data.functions[0]).toMatchObject({ key: 'kpi_record', enabled: true, override: true, where: 'units' });
    const n = await ctx.db.query(`SELECT kind, title FROM notifications WHERE user_id = $1 AND kind = 'function_granted'`, [ctx.demo.users.anna]);
    expect(n.rows).toEqual([{ kind: 'function_granted', title: 'Вам включили: «Вносить измерения KPI»' }]);
    expect(rt.of('notification').map((e) => e.users)).toEqual([[ctx.demo.users.anna]]);

    expect((await anna.post(`${API}/goals/${ctx.demo.goals.main}/metrics/${metric}/observations`, obs(33))).status).toBe(201);
    const hr = (await (await ctx.as('director')).get(`${API}/goals/${ctx.demo.goals.onboarding}`)).body.data;
    const other = await anna.post(`${API}/goals/${ctx.demo.goals.onboarding}/metrics/${hr.metrics[0].id}/observations`, obs(20));
    expect([403, 404]).toContain(other.status);
  });

  it('включить можно только то, что есть у себя; своим подчинённым; не себе и не администраторам', async () => {
    const olga = await ctx.as('olga');
    const kb = await olga.put(`${API}/functions/users/${ctx.demo.users.anna}`, { changes: { knowledge_manage: true } });
    expect(kb.status).toBe(403);
    expect(kb.body.error.message).toBe('Нельзя включить функцию, которой нет у вас: «Вести базу знаний»');
    expect((await olga.put(`${API}/functions/users/${ctx.demo.users.maria}`, { changes: { kpi_record: true } })).body.error.message).toBe('Менять функции можно только своим подчинённым');
    expect((await olga.put(`${API}/functions/users/${ctx.demo.users.olga}`, { changes: { kpi_record: false } })).body.error.message).toBe('Свои функции включает руководитель');
    const dir = await ctx.as('director');
    expect((await dir.put(`${API}/functions/users/${ctx.demo.users.observer}`, { changes: { kpi_record: true } })).status).toBe(403);
    expect((await dir.put(`${API}/functions/users/${ctx.demo.users.anna}`, { changes: {} })).status).toBe(422);
  });

  it('владелец включает Сергею «Вести базу знаний» — Сергей правит чужую статью; отключили — снова нельзя', async () => {
    const dir = await ctx.as('director');
    const note = (await dir.post(`${API}/notes`, { title: 'Регламент приёма', body: 'Черновик' })).body.data;
    const sergey = await ctx.as('sergey');
    expect((await sergey.patch(`${API}/notes/${note.id}`, { body: 'Правка' })).status).toBe(403);
    await dir.put(`${API}/functions/users/${ctx.demo.users.sergey}`, { changes: { knowledge_manage: true } });
    expect((await sergey.patch(`${API}/notes/${note.id}`, { body: 'Правка' })).status).toBe(200);
    await dir.put(`${API}/functions/users/${ctx.demo.users.sergey}`, { changes: { knowledge_manage: null } });
    expect((await sergey.patch(`${API}/notes/${note.id}`, { body: 'Ещё правка' })).status).toBe(403);
  });

  it('отключённая функция снимает и право по роли: Игорь больше не меняет KPI своей цели', async () => {
    const igor = await ctx.as('igor');
    const goal = (await igor.get(`${API}/goals/${ctx.demo.goals.main}`)).body.data;
    const metric = goal.metrics[0].id;
    expect((await igor.patch(`${API}/goals/${ctx.demo.goals.main}/metrics/${metric}`, { name: 'Среднее время обработки заявки' })).status).toBe(200);
    const dir = await ctx.as('director');
    const off = await dir.put(`${API}/functions/users/${ctx.demo.users.igor}`, { changes: { kpi_assign: false } });
    expect(off.body.data.functions.find((f: FunctionDetail) => f.key === 'kpi_assign')).toMatchObject({ enabled: false, override: false });
    expect((await ctx.db.query(`SELECT title FROM notifications WHERE user_id = $1 AND kind = 'function_granted'`, [ctx.demo.users.igor])).rows).toEqual([{ title: 'Вам отключили: «Менять KPI целей»' }]);
    expect((await igor.patch(`${API}/goals/${ctx.demo.goals.main}/metrics/${metric}`, { name: 'Другое' })).status).toBe(403);
    // Вернуть «по должности» — право снова есть, а строки в базе нет.
    await dir.put(`${API}/functions/users/${ctx.demo.users.igor}`, { changes: { kpi_assign: true } });
    expect((await ctx.db.query(`SELECT 1 FROM user_functions WHERE user_id = $1`, [ctx.demo.users.igor])).rows).toEqual([]);
    expect((await igor.patch(`${API}/goals/${ctx.demo.goals.main}/metrics/${metric}`, { name: 'Среднее время обработки' })).status).toBe(200);
  });

  it('изменения функций пишутся в журнал', async () => {
    const rows = (await ctx.db.query(`SELECT actor_id, new_values FROM audit_events WHERE event_type = 'user.functions_changed' AND entity_id = $1`, [ctx.demo.users.anna])).rows;
    expect(rows[0]).toMatchObject({ actor_id: ctx.demo.users.olga, new_values: { kpi_record: true } });
  });
});
