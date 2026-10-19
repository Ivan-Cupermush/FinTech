import { beforeAll, describe, expect, it } from 'vitest';
import { setup, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

const newTask = (extra: object = {}) => ({ title: 'Собрать требования к форме', start_at: '2026-10-20', due_at: '2026-10-25', ...extra });

describe('задачи', () => {
  it('создание в рамках цели с исполнителем, командой и критерием готовности', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/tasks', newTask({ goal_id: ctx.demo.goals.approvals, assignee_id: ctx.demo.users.anna, team_unit_id: ctx.demo.units.intake, unit_id: ctx.demo.units.office, definition_of_done: 'Список полей согласован' }));
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'todo', assignee: { display_name: 'Анна Королёва' }, team: { name: 'Приём заявок' }, goal_ids: [ctx.demo.goals.approvals] });
    const { rows } = await ctx.db.query(`SELECT title FROM notifications WHERE user_id = $1 AND task_id = $2`, [ctx.demo.users.anna, r.body.data.id]);
    expect(rows[0]!.title).toBe('Новая задача: «Собрать требования к форме»');
  });

  it('подразделение и команда не обязательны — простое поручение остаётся простым', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/tasks', { title: 'Позвонить в деканат' });
    expect(r.status).toBe(201);
    expect(r.body.data.team).toBeNull();
  });

  it('пустое название и срок раньше начала — 422', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/tasks', { title: ' ', start_at: '2026-10-25', due_at: '2026-10-20' });
    expect(r.status).toBe(422);
    expect(r.body.error.fields).toMatchObject({ title: 'Введите название задачи', due_at: 'Срок не может быть раньше даты начала' });
  });

  it('исполнитель-наблюдатель или из другой компании — 422', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/tasks', newTask({ assignee_id: ctx.demo.users.observer }));
    expect(r.status).toBe(422);
    expect(r.body.error.fields.assignee_id).toBeDefined();
  });

  it('сотрудник не может добавить задачу в чужую цель', async () => {
    const anna = await ctx.as('anna');
    const r = await anna.post('/api/v1/tasks', newTask({ goal_id: ctx.demo.goals.main }));
    expect(r.status).toBe(403);
  });

  it('наблюдатель не создаёт задачи', async () => {
    const obs = await ctx.as('observer');
    expect((await obs.post('/api/v1/tasks', newTask())).status).toBe(403);
  });

  it('зависимость, создающая цикл, отклоняется', async () => {
    const olga = await ctx.as('olga');
    // pilot зависит от api; обратная связь замкнёт круг.
    const r = await olga.post(`/api/v1/tasks/${ctx.demo.tasks.api}/dependencies`, { depends_on: ctx.demo.tasks.pilot });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.depends_on).toMatch(/замкнутый круг/);
  });

  it('зависимость от себя самой — 422', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post(`/api/v1/tasks/${ctx.demo.tasks.api}/dependencies`, { depends_on: ctx.demo.tasks.api });
    expect(r.status).toBe(422);
  });

  it('добавление и удаление зависимости', async () => {
    const olga = await ctx.as('olga');
    const a = (await olga.post('/api/v1/tasks', newTask({ title: 'A' }))).body.data;
    const b = (await olga.post('/api/v1/tasks', newTask({ title: 'B', depends_on: [a.id] }))).body.data;
    expect(b.depends_on).toEqual([a.id]);
    expect((await olga.delete(`/api/v1/tasks/${b.id}/dependencies/${a.id}`)).status).toBe(204);
    expect((await olga.get(`/api/v1/tasks/${b.id}`)).body.data.depends_on).toEqual([]);
  });

  it('блокировка требует причину — иначе 422', async () => {
    const dima = await ctx.as('dima');
    const r = await dima.post(`/api/v1/tasks/${ctx.demo.tasks.api}/status`, { status: 'blocked' });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.blocked_reason).toBeDefined();
  });

  it('исполнитель блокирует задачу: причина, следующий шаг, уведомления помогающим', async () => {
    const dima = await ctx.as('dima');
    const r = await dima.post(`/api/v1/tasks/${ctx.demo.tasks.api}/status`, { status: 'blocked', blocked_reason: 'technical', blocked_note: 'реестр недоступен', next_step: 'Написать в поддержку реестра' });
    expect(r.status).toBe(200);
    expect(r.body.data.blocker).toMatchObject({ reason: 'technical', note: 'реестр недоступен', next_step: 'Написать в поддержку реестра', since: '2026-10-19T12:00:00.000Z' });
    const { rows } = await ctx.db.query(`SELECT user_id FROM notifications WHERE task_id = $1 AND kind = 'task_blocked'`, [ctx.demo.tasks.api]);
    // Автор задачи и владелец подцели (Игорь) — а Ольга автор.
    expect(rows.map((x) => x.user_id).sort()).toEqual([ctx.demo.users.igor, ctx.demo.users.olga].sort());
  });

  it('повторная блокировка с новой причиной не сбрасывает время начала', async () => {
    const dima = await ctx.as('dima');
    const r = await dima.post(`/api/v1/tasks/${ctx.demo.tasks.autofill}/status`, { status: 'blocked', blocked_reason: 'approval' });
    expect(r.status).toBe(200);
    expect(r.body.data.blocker.reason).toBe('approval');
    expect(r.body.data.blocker.since).not.toBe('2026-10-19T12:00:00.000Z');
  });

  it('снятие блокировки очищает причину, история остаётся', async () => {
    const dima = await ctx.as('dima');
    const r = await dima.post(`/api/v1/tasks/${ctx.demo.tasks.api}/status`, { status: 'in_progress' });
    expect(r.body.data.blocker).toBeNull();
    const t = (await dima.get(`/api/v1/tasks/${ctx.demo.tasks.api}`)).body.data;
    expect(t.history.map((h: { status: string }) => h.status)).toEqual(['todo', 'in_progress', 'blocked', 'in_progress', 'blocked', 'in_progress']);
  });

  it('недопустимый переход — 409', async () => {
    const maria = await ctx.as('maria');
    const r = await maria.post(`/api/v1/tasks/${ctx.demo.tasks.acceptance}/status`, { status: 'done' });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/Не начата/);
  });

  it('выполнение фиксирует время', async () => {
    const maria = await ctx.as('maria');
    await maria.post(`/api/v1/tasks/${ctx.demo.tasks.acceptance}/status`, { status: 'in_progress' });
    const r = await maria.post(`/api/v1/tasks/${ctx.demo.tasks.acceptance}/status`, { status: 'done' });
    expect(r.body.data.done_at).toBe('2026-10-19T12:00:00.000Z');
  });

  it('исполнитель не может отменить задачу — только автор или руководитель', async () => {
    const dima = await ctx.as('dima');
    expect((await dima.post(`/api/v1/tasks/${ctx.demo.tasks.api}/status`, { status: 'cancelled' })).status).toBe(403);
  });

  it('исполнитель меняет статус, но не поля задачи', async () => {
    const dima = await ctx.as('dima');
    expect((await dima.patch(`/api/v1/tasks/${ctx.demo.tasks.api}`, { due_at: '2026-12-31' })).status).toBe(403);
  });

  it('руководитель IT правит задачу своей команды', async () => {
    const igor = await ctx.as('igor');
    const r = await igor.patch(`/api/v1/tasks/${ctx.demo.tasks.api}`, { due_at: '2026-10-28' });
    expect(r.status).toBe(200);
    expect(r.body.data.due_at).toBe('2026-10-28');
  });

  it('руководитель другого отдела задачу не видит — 404', async () => {
    const elena = await ctx.as('elena');
    expect((await elena.get(`/api/v1/tasks/${ctx.demo.tasks.api}`)).status).toBe(404);
  });

  it('список «мои задачи»', async () => {
    const dima = await ctx.as('dima');
    const r = await dima.get('/api/v1/tasks?mine=1');
    expect(r.body.data.every((t: { assignee: { id: string } }) => t.assignee.id === ctx.demo.users.dima)).toBe(true);
  });

  it('привязка существующей задачи к цели без копирования', async () => {
    const olga = await ctx.as('olga');
    const t = (await olga.post('/api/v1/tasks', newTask({ title: 'Отдельная задача' }))).body.data;
    expect((await olga.post(`/api/v1/goals/${ctx.demo.goals.quality}/tasks`, { task_id: t.id })).status).toBe(204);
    expect((await olga.post(`/api/v1/goals/${ctx.demo.goals.quality}/tasks`, { task_id: t.id })).status).toBe(204);
    const { rows } = await ctx.db.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE title = 'Отдельная задача'`);
    expect(rows[0]).toEqual({ n: 1 });
    const links = await ctx.db.query(`SELECT COUNT(*)::int AS n FROM goal_tasks WHERE task_id = $1`, [t.id]);
    expect(links.rows[0]).toEqual({ n: 1 });
    expect((await olga.delete(`/api/v1/goals/${ctx.demo.goals.quality}/tasks/${t.id}`)).status).toBe(204);
  });
});

describe('журнал аудита неизменяем', () => {
  it('UPDATE и DELETE запрещены на уровне базы', async () => {
    await expect(ctx.db.query(`UPDATE audit_events SET event_type = 'x'`)).rejects.toThrow(/append-only/);
    await expect(ctx.db.query(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
  });

  it('аудит цели читает владелец, но не сотрудник', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.get(`/api/v1/goals/${ctx.demo.goals.main}/audit`)).status).toBe(403);
    const olga = await ctx.as('olga');
    expect((await olga.get(`/api/v1/goals/${ctx.demo.goals.main}/audit`)).status).toBe(200);
  });
});
