import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Task, TaskDetail } from '@offix/core';
import { NOW, recordingRealtime, setup, type Ctx } from './helpers';

const API = '/api/v1';
const DAY = 86_400_000;
const rt = recordingRealtime();
let clock = NOW.getTime();
let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup({ realtime: rt, now: () => new Date(clock) });
});
beforeEach(() => {
  rt.clear();
  clock = NOW.getTime();
});

const notes = async (who: string, taskId: string | undefined) =>
  (await ctx.db.query<{ kind: string; title: string; body: string | null }>(`SELECT kind, title, body FROM notifications WHERE user_id = $1 AND task_id = $2 ORDER BY created_at`, [who, taskId])).rows;

async function request(extra: object = {}) {
  const anna = await ctx.as('anna');
  const r = await anna.post(`${API}/tasks`, { kind: 'request', title: 'Выгрузить список заявок за сентябрь', assignee_id: ctx.demo.users.igor, due_at: '2026-10-23', ...extra });
  expect(r.status).toBe(201);
  return r.body.data as Task;
}

describe('просьба коллеге', () => {
  it('Анна просит Игоря из IT: просьба, уведомление и сигнал во «Входящие»', async () => {
    const t = await request();
    expect(t).toMatchObject({ kind: 'request', status: 'todo', assignee: { display_name: 'Игорь Лебедев' }, created_by_name: 'Анна Королёва', thanked_at: null, archived: null });
    expect(await notes(ctx.demo.users.igor, t.id)).toEqual([{ kind: 'task_request', title: 'Анна Королёва просит: «Выгрузить список заявок за сентябрь»', body: 'К 23.10.2026' }]);
    expect(rt.of('notification')).toEqual([expect.objectContaining({ users: [ctx.demo.users.igor] })]);
    expect(rt.of('notification')[0]!.payloadFor(ctx.demo.users.igor)).toMatchObject({ kind: 'task_request' });
  });

  it('себе, без исполнителя, в цель или с согласующим — 422', async () => {
    const anna = await ctx.as('anna');
    const base = { kind: 'request', title: 'Помочь' };
    const self = await anna.post(`${API}/tasks`, { ...base, assignee_id: ctx.demo.users.anna });
    expect(self.body.error.fields.assignee_id).toBe('Просьбу отправляют коллеге, а не себе');
    expect((await anna.post(`${API}/tasks`, base)).body.error.fields.assignee_id).toBe('Выберите, кого просите');
    const goal = await anna.post(`${API}/tasks`, { ...base, assignee_id: ctx.demo.users.igor, goal_id: ctx.demo.goals.approvals });
    expect(goal.status).toBe(422);
    expect(goal.body.error.fields.goal_id).toContain('не входит в план цели');
    const appr = await anna.post(`${API}/tasks`, { ...base, assignee_id: ctx.demo.users.igor, participants: [{ user_id: ctx.demo.users.olga, role: 'approver' }] });
    expect(appr.body.error.fields.participants).toBe('У просьбы нет согласующих и наблюдателей');
  });

  it('у просьбы нет приёмки: исполнитель сразу отмечает «Выполнено», автор узнаёт', async () => {
    const t = await request();
    const igor = await ctx.as('igor');
    const review = await igor.post(`${API}/tasks/${t.id}/status`, { status: 'in_progress' }).then(() => igor.post(`${API}/tasks/${t.id}/status`, { status: 'review' }));
    expect(review.status).toBe(409);
    expect(review.body.error.message).toBe('У просьбы нет приёмки: исполнитель сам отмечает «Выполнено»');
    rt.clear();
    const done = await igor.post(`${API}/tasks/${t.id}/status`, { status: 'done' });
    expect(done.status).toBe(200);
    expect((await notes(ctx.demo.users.anna, t.id)).at(-1)).toEqual({ kind: 'task_done', title: 'Просьба выполнена: «Выгрузить список заявок за сентябрь»', body: 'Поблагодарите, если всё в порядке' });
    expect(rt.of('notification').map((e) => e.users)).toEqual([[ctx.demo.users.anna]]);
  });

  it('«Спасибо»: запись в обсуждении и уведомление, один раз на выполнение', async () => {
    const t = await request();
    const igor = await ctx.as('igor');
    const anna = await ctx.as('anna');
    expect((await anna.post(`${API}/tasks/${t.id}/thanks`)).status).toBe(409);
    await igor.post(`${API}/tasks/${t.id}/status`, { status: 'done' });
    expect((await igor.post(`${API}/tasks/${t.id}/thanks`)).status).toBe(403);
    const r = await anna.post(`${API}/tasks/${t.id}/thanks`, { text: 'Спасибо, очень выручили!' });
    expect(r.status).toBe(200);
    expect(r.body.data.thanked_at).toBe(NOW.toISOString());
    await anna.post(`${API}/tasks/${t.id}/thanks`);
    const comments = await ctx.db.query(`SELECT body FROM comments WHERE entity_type = 'task' AND entity_id = $1`, [t.id]);
    expect(comments.rows).toEqual([{ body: 'Спасибо, очень выручили!' }]);
    expect((await notes(ctx.demo.users.igor, t.id)).filter((n) => n.kind === 'task_thanks')).toEqual([
      { kind: 'task_thanks', title: 'Анна Королёва благодарит за «Выгрузить список заявок за сентябрь»', body: 'Спасибо, очень выручили!' },
    ]);
    // Вернули в работу и выполнили снова — можно поблагодарить ещё раз.
    await igor.post(`${API}/tasks/${t.id}/status`, { status: 'in_progress' });
    const again = await igor.post(`${API}/tasks/${t.id}/status`, { status: 'done' });
    expect(again.body.data.thanked_at).toBeNull();
    expect((await anna.post(`${API}/tasks/${t.id}/thanks`)).body.data.thanked_at).not.toBeNull();
  });

  it('во «Входящих» у просьбы есть её состояние: исполнитель берёт в работу, автор благодарит', async () => {
    const t = await request({ title: 'Найти шаблон справки' });
    const igor = await ctx.as('igor');
    const anna = await ctx.as('anna');
    const feed = async (who: typeof igor) => ((await who.get(`${API}/notifications`)).body.data as { kind: string; task_id: string; task_state: unknown }[]).find((n) => n.task_id === t.id);
    expect((await feed(igor))?.task_state).toEqual({ kind: 'request', status: 'todo', thanked: false, mine: false, assignee: true });
    await igor.post(`${API}/tasks/${t.id}/status`, { status: 'done' });
    expect((await feed(anna))).toMatchObject({ kind: 'task_done', task_state: { status: 'done', thanked: false, mine: true } });
    await anna.post(`${API}/tasks/${t.id}/thanks`);
    expect((await feed(anna))?.task_state).toMatchObject({ thanked: true });
  });

  it('за задачу «спасибо» не говорят — только за просьбу', async () => {
    const olga = await ctx.as('olga');
    expect((await olga.post(`${API}/tasks/${ctx.demo.tasks.regulation}/thanks`)).status).toBe(409);
  });

  it('фильтры списка: мои просьбы, просьбы мне', async () => {
    const t = await request({ title: 'Проверить доступы к реестру' });
    const anna = await ctx.as('anna');
    const igor = await ctx.as('igor');
    const mine = (await anna.get(`${API}/tasks?created=1&kind=request`)).body.data as Task[];
    expect(mine.map((x) => x.id)).toContain(t.id);
    expect(mine.every((x) => x.kind === 'request' && x.created_by === ctx.demo.users.anna)).toBe(true);
    const toMe = (await igor.get(`${API}/tasks?mine=1&kind=request`)).body.data as Task[];
    expect(toMe.map((x) => x.id)).toContain(t.id);
    expect(((await igor.get(`${API}/tasks?mine=1&kind=task`)).body.data as Task[]).some((x) => x.id === t.id)).toBe(false);
  });
});

describe('наблюдатели рядом с согласующим', () => {
  it('Игорь добавляет Елену наблюдателем: она видит задачу, узнаёт о блокировке и выполнении, но статус не меняет', async () => {
    const igor = await ctx.as('igor');
    const elena = await ctx.as('elena');
    expect((await elena.get(`${API}/tasks/${ctx.demo.tasks.pilot}`)).status).toBe(404);
    const r = await igor.put(`${API}/tasks/${ctx.demo.tasks.pilot}/watchers`, { user_ids: [ctx.demo.users.elena] });
    expect(r.status).toBe(200);
    expect(r.body.data.watcher_ids).toEqual([ctx.demo.users.elena]);
    expect((await notes(ctx.demo.users.elena, ctx.demo.tasks.pilot)).at(-1)?.title).toBe('Вы наблюдаете за задачей «Пилот автопроверки на одном факультете»');
    const seen = (await elena.get(`${API}/tasks/${ctx.demo.tasks.pilot}`)).body.data as TaskDetail;
    expect(seen.permissions).toMatchObject({ view: true, status: false, mark: true, edit: false });
    expect(seen.participants).toEqual(expect.arrayContaining([expect.objectContaining({ display_name: 'Елена Фёдорова', role: 'watcher' })]));
    expect((await elena.post(`${API}/tasks/${ctx.demo.tasks.pilot}/status`, { status: 'in_progress' })).status).toBe(403);
    expect(((await elena.get(`${API}/tasks?watching=1`)).body.data as Task[]).map((t) => t.id)).toEqual([ctx.demo.tasks.pilot]);

    await igor.post(`${API}/tasks/${ctx.demo.tasks.pilot}/status`, { status: 'blocked', blocked_reason: 'data' });
    expect((await notes(ctx.demo.users.elena, ctx.demo.tasks.pilot)).at(-1)?.kind).toBe('task_blocked');
    await igor.post(`${API}/tasks/${ctx.demo.tasks.pilot}/status`, { status: 'in_progress' });
    await igor.post(`${API}/tasks/${ctx.demo.tasks.pilot}/status`, { status: 'done' });
    expect((await notes(ctx.demo.users.elena, ctx.demo.tasks.pilot)).at(-1)).toMatchObject({ kind: 'task_done', title: 'Задача выполнена: «Пилот автопроверки на одном факультете»' });
  });

  it('наблюдатель — активный сотрудник; у просьбы наблюдателей нет; менять состав — автору или руководителю', async () => {
    const igor = await ctx.as('igor');
    expect((await igor.put(`${API}/tasks/${ctx.demo.tasks.autofill}/watchers`, { user_ids: [ctx.demo.users.observer] })).status).toBe(422);
    const t = await request();
    const anna = await ctx.as('anna');
    expect((await anna.put(`${API}/tasks/${t.id}/watchers`, { user_ids: [ctx.demo.users.olga] })).status).toBe(409);
    const dima = await ctx.as('dima');
    expect((await dima.put(`${API}/tasks/${ctx.demo.tasks.api}/watchers`, { user_ids: [] })).status).toBe(403);
  });
});

describe('контрольные точки', () => {
  it('ставит руководитель, не позже срока задачи; исполнитель узнаёт', async () => {
    const igor = await ctx.as('igor');
    const late = await igor.post(`${API}/tasks/${ctx.demo.tasks.autofill}/checkpoints`, { title: 'Стенд', due_at: '2027-12-01' });
    expect(late.status).toBe(422);
    expect(late.body.error.fields.due_at).toBe('Контрольная точка — не позже срока задачи');
    const r = await igor.post(`${API}/tasks/${ctx.demo.tasks.api}/checkpoints`, { title: 'Доступ к тестовому реестру', due_at: '2026-10-14' });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual([expect.objectContaining({ title: 'Доступ к тестовому реестру', due_at: '2026-10-14', status: 'pending', done_by_name: null })]);
    expect((await notes(ctx.demo.users.dima, ctx.demo.tasks.api)).at(-1)).toMatchObject({ title: 'Контрольная точка в «Подключить проверку данных к реестру студентов»', body: 'Доступ к тестовому реестру — к 14.10.2026' });
    const dima = await ctx.as('dima');
    expect((await dima.post(`${API}/tasks/${ctx.demo.tasks.api}/checkpoints`, { title: 'Ещё', due_at: '2026-10-14' })).status).toBe(403);
  });

  it('исполнитель задачи свою точку не принимает — отмечает наблюдатель; в списке точки идут в светофор', async () => {
    const igor = await ctx.as('igor');
    const dima = await ctx.as('dima');
    const sergey = await ctx.as('sergey');
    const cps = (await igor.post(`${API}/tasks/${ctx.demo.tasks.autofill}/checkpoints`, { title: 'Прототип формы', due_at: '2026-10-18' })).body.data;
    const cp = cps.at(-1);
    const list = ((await igor.get(`${API}/tasks`)).body.data as Task[]).find((t) => t.id === ctx.demo.tasks.autofill)!;
    expect(list.checkpoints.at(-1)).toEqual({ id: cp.id, title: 'Прототип формы', due_at: '2026-10-18', status: 'pending' });
    expect((await dima.patch(`${API}/tasks/${ctx.demo.tasks.autofill}/checkpoints/${cp.id}`, { status: 'done' })).status).toBe(403);
    await igor.put(`${API}/tasks/${ctx.demo.tasks.autofill}/watchers`, { user_ids: [ctx.demo.users.sergey] });
    const ok = await sergey.patch(`${API}/tasks/${ctx.demo.tasks.autofill}/checkpoints/${cp.id}`, { status: 'done' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.find((c: { id: string }) => c.id === cp.id)).toMatchObject({ status: 'done', done_by_name: 'Сергей Ким', done_at: NOW.toISOString() });
    expect((await sergey.patch(`${API}/tasks/${ctx.demo.tasks.autofill}/checkpoints/${cp.id}`, { title: 'Другое' })).status).toBe(403);
    const back = await sergey.patch(`${API}/tasks/${ctx.demo.tasks.autofill}/checkpoints/${cp.id}`, { status: 'pending' });
    expect(back.body.data.find((c: { id: string }) => c.id === cp.id)).toMatchObject({ status: 'pending', done_by_name: null, done_at: null });
    expect((await igor.delete(`${API}/tasks/${ctx.demo.tasks.autofill}/checkpoints/${cp.id}`)).status).toBe(204);
    expect((await igor.delete(`${API}/tasks/${ctx.demo.tasks.autofill}/checkpoints/${cp.id}`)).status).toBe(404);
  });

  it('в просьбе точку отмечает исполнитель', async () => {
    const t = await request({ title: 'Подготовить справку', due_at: '2026-10-30' });
    const anna = await ctx.as('anna');
    const igor = await ctx.as('igor');
    const cp = (await anna.post(`${API}/tasks/${t.id}/checkpoints`, { title: 'Черновик', due_at: '2026-10-25' })).body.data[0];
    expect((await igor.patch(`${API}/tasks/${t.id}/checkpoints/${cp.id}`, { status: 'done' })).status).toBe(200);
  });

  it('точки можно передать сразу при создании', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post(`${API}/tasks`, { title: 'Обновить шаблоны писем', due_at: '2026-11-10', checkpoints: [{ title: 'Список шаблонов', due_at: '2026-10-25' }, { title: 'Согласование', due_at: '2026-11-20' }] });
    expect(r.status).toBe(422);
    expect(r.body.error.fields['checkpoints.1']).toBe('Контрольная точка — не позже срока задачи');
    const ok = await olga.post(`${API}/tasks`, { title: 'Обновить шаблоны писем', due_at: '2026-11-10', checkpoints: [{ title: 'Список шаблонов', due_at: '2026-10-25' }] });
    expect(ok.body.data.checkpoints).toEqual([expect.objectContaining({ title: 'Список шаблонов', status: 'pending' })]);
  });
});

describe('архив', () => {
  it('живую задачу в архив не убрать; выполненную — можно, и вернуть', async () => {
    const olga = await ctx.as('olga');
    const t = (await olga.post(`${API}/tasks`, { title: 'Разослать памятку', assignee_id: ctx.demo.users.anna })).body.data as Task;
    expect((await olga.post(`${API}/tasks/${t.id}/archive`)).body.error.message).toBe('В архив убирают выполненные и отменённые задачи');
    await olga.post(`${API}/tasks/${t.id}/status`, { status: 'in_progress' });
    await olga.post(`${API}/tasks/${t.id}/status`, { status: 'done' });
    const anna = await ctx.as('anna');
    expect((await anna.post(`${API}/tasks/${t.id}/archive`)).status).toBe(403);
    const r = await olga.post(`${API}/tasks/${t.id}/archive`);
    expect(r.body.data.archived).toEqual({ at: NOW.toISOString(), by_name: 'Ольга Смирнова' });
    expect(((await olga.get(`${API}/tasks`)).body.data as Task[]).some((x) => x.id === t.id)).toBe(false);
    expect(((await olga.get(`${API}/tasks?archived=1`)).body.data as Task[]).map((x) => x.id)).toContain(t.id);
    expect((await olga.post(`${API}/tasks/${t.id}/status`, { status: 'in_progress' })).body.error.message).toBe('Задача в архиве — сначала верните её');
    const back = await olga.post(`${API}/tasks/${t.id}/unarchive`);
    expect(back.body.data.archived).toBeNull();
    expect((await olga.post(`${API}/tasks/${t.id}/unarchive`)).status).toBe(409);
  });

  it('сама уходит через 3 дня после выполнения; возвращённая — больше не уходит', async () => {
    const olga = await ctx.as('olga');
    const t = (await olga.post(`${API}/tasks`, { title: 'Обновить контакты на сайте' })).body.data as Task;
    await olga.post(`${API}/tasks/${t.id}/status`, { status: 'in_progress' });
    await olga.post(`${API}/tasks/${t.id}/status`, { status: 'done' });
    clock = NOW.getTime() + 2 * DAY;
    expect(((await olga.get(`${API}/tasks`)).body.data as Task[]).some((x) => x.id === t.id)).toBe(true);
    clock = NOW.getTime() + 3 * DAY + 1000;
    expect(((await olga.get(`${API}/tasks`)).body.data as Task[]).some((x) => x.id === t.id)).toBe(false);
    const archived = ((await olga.get(`${API}/tasks?archived=1`)).body.data as Task[]).find((x) => x.id === t.id)!;
    expect(archived.archived).toMatchObject({ by_name: null });
    const audit = await ctx.db.query(`SELECT actor_id, new_values FROM audit_events WHERE entity_id = $1 AND event_type = 'task.archived'`, [t.id]);
    expect(audit.rows).toEqual([{ actor_id: null, new_values: { auto: true, after_days: 3 } }]);
    await olga.post(`${API}/tasks/${t.id}/unarchive`);
    clock = NOW.getTime() + 10 * DAY;
    expect(((await olga.get(`${API}/tasks`)).body.data as Task[]).some((x) => x.id === t.id)).toBe(true);
  });

  it('отменённая задача тоже уходит в архив сама', async () => {
    const olga = await ctx.as('olga');
    const t = (await olga.post(`${API}/tasks`, { title: 'Лишний шаг' })).body.data as Task;
    await olga.post(`${API}/tasks/${t.id}/status`, { status: 'cancelled' });
    clock = NOW.getTime() + 4 * DAY;
    expect(((await olga.get(`${API}/tasks?archived=1`)).body.data as Task[]).map((x) => x.id)).toContain(t.id);
  });
});
