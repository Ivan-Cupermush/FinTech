import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { setup, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

const url = (type: 'goal' | 'task', id: string) => `/api/v1/discussions/${type}/${id}`;
const post = async (who: Parameters<Ctx['as']>[0], type: 'goal' | 'task', id: string, body: string, parent_id?: string) => (await ctx.as(who)).post(url(type, id), { body, parent_id });
const inbox = async (who: keyof Ctx['demo']['users'], goalOrTask: string) =>
  (
    await ctx.db.query<{ title: string; body: string; kind: string }>(
      `SELECT title, body, kind FROM notifications WHERE user_id = $1 AND (goal_id = $2 OR task_id = $2) AND kind = 'comment' ORDER BY created_at, id`,
      [ctx.demo.users[who], goalOrTask],
    )
  ).rows;

describe('обсуждение цели', () => {
  it('без входа — 401, неизвестный тип — 404', async () => {
    expect((await request(ctx.app).get(url('goal', ctx.demo.goals.main!))).status).toBe(401);
    expect((await (await ctx.as('olga')).get(`/api/v1/discussions/note/${ctx.demo.goals.main}`)).status).toBe(404);
  });

  it('комментарий, ответ и порядок в ветке', async () => {
    const goal = ctx.demo.goals.approvals!;
    const a = await post('olga', 'goal', goal, 'Регламент на согласовании у юристов');
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ body: 'Регламент на согласовании у юристов', parent_id: null, author_name: 'Ольга Смирнова' });
    const b = await post('anna', 'goal', goal, 'Когда ждать ответа?', a.body.data.id);
    expect(b.status).toBe(201);
    const d = (await (await ctx.as('olga')).get(url('goal', goal))).body.data;
    expect(d.comments.map((c: { body: string }) => c.body)).toEqual(['Регламент на согласовании у юристов', 'Когда ждать ответа?']);
    expect(d.comments[1].parent_id).toBe(a.body.data.id);
    expect(d.can_comment).toBe(true);
    // Анна ответила Ольге — уведомление об ответе, без дубля «новый комментарий» (Ольга и владелец цели).
    expect((await inbox('olga', goal)).map((n) => n.title)).toEqual(['Ответ на ваш комментарий: «Убрать лишние согласования»']);
  });

  it('упоминание: уведомление «Вас упомянули», подсветка и запись упомянутых', async () => {
    const goal = ctx.demo.goals.automation!;
    const r = await post('olga', 'goal', goal, '@Дмитрий Орлов, что с доступом к реестру? @Несуществующий Человек');
    expect(r.body.data.mention_ids).toEqual([ctx.demo.users.dima]);
    const n = await inbox('dima', goal);
    expect(n).toEqual([{ kind: 'comment', title: 'Вас упомянули в обсуждении «Автоматизировать проверку данных»', body: 'Ольга Смирнова: @Дмитрий Орлов, что с доступом к реестру? @Несуществующий Человек' }]);
    const d = (await (await ctx.as('dima')).get(url('goal', goal))).body.data;
    expect(d.people).toEqual([{ id: ctx.demo.users.dima, display_name: 'Дмитрий Орлов' }]);
    // Владелец цели Игорь получает «новый комментарий».
    expect((await inbox('igor', goal)).map((x) => x.title)).toEqual(['Новый комментарий: «Автоматизировать проверку данных»']);
  });

  it('упомянуть того, кто не видит цель, нельзя: ни уведомления, ни отметки', async () => {
    const goal = ctx.demo.goals.onboarding!;
    expect((await (await ctx.as('dima')).get(`/api/v1/goals/${goal}`)).status).toBe(404);
    const r = await post('elena', 'goal', goal, '@Дмитрий Орлов посмотрите');
    expect(r.status).toBe(201);
    expect(r.body.data.mention_ids).toEqual([]);
    expect(await inbox('dima', goal)).toEqual([]);
  });

  it('чужая цель — 404 и на чтение, и на запись', async () => {
    const goal = ctx.demo.goals.onboarding!;
    expect((await (await ctx.as('dima')).get(url('goal', goal))).status).toBe(404);
    expect((await post('dima', 'goal', goal, 'Привет')).status).toBe(404);
  });

  it('наблюдатель читает, но не пишет', async () => {
    const goal = ctx.demo.goals.main!;
    const d = await (await ctx.as('observer')).get(url('goal', goal));
    expect(d.status).toBe(200);
    expect(d.body.data.can_comment).toBe(false);
    expect((await post('observer', 'goal', goal, 'Можно вопрос?')).status).toBe(403);
  });

  it('пустой текст и ответ на комментарий из другого обсуждения — ошибки полей', async () => {
    const empty = await post('olga', 'goal', ctx.demo.goals.main!, '   ');
    expect(empty.status).toBe(422);
    expect(empty.body.error.fields.body).toBe('Напишите комментарий');
    const other = await post('olga', 'goal', ctx.demo.goals.quality!, 'Чужая ветка');
    const wrong = await post('olga', 'goal', ctx.demo.goals.main!, 'Ответ', other.body.data.id);
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.fields.parent_id).toBeTruthy();
  });
});

describe('счётчик новых', () => {
  it('чужие комментарии — новые, после прочтения — ноль, свои — не считаются', async () => {
    const goal = ctx.demo.goals.quality!;
    const maria = await ctx.as('maria');
    const before = (await maria.get(`${url('goal', goal)}/summary`)).body.data;
    await post('olga', 'goal', goal, 'Есть первые контрольные показатели?');
    await post('olga', 'goal', goal, 'И срок приёмки');
    const after = (await maria.get(`${url('goal', goal)}/summary`)).body.data;
    expect(after.unread).toBe(before.unread + 2);
    expect(after.total).toBe(before.total + 2);
    expect((await maria.post(`${url('goal', goal)}/read`)).status).toBe(204);
    expect((await maria.get(`${url('goal', goal)}/summary`)).body.data.unread).toBe(0);
    await post('maria', 'goal', goal, 'Показатели готовы');
    expect((await maria.get(`${url('goal', goal)}/summary`)).body.data.unread).toBe(0);
    expect((await (await ctx.as('olga')).get(url('goal', goal))).body.data.unread).toBe(1);
  });
});

describe('обсуждение задачи', () => {
  it('исполнитель и автор получают «новый комментарий», уведомление ведёт к задаче', async () => {
    const task = ctx.demo.tasks.api!;
    const r = await post('igor', 'task', task, 'Согласование с ИБ получено');
    expect(r.status).toBe(201);
    const n = await ctx.db.query<{ title: string; task_id: string; goal_id: string | null }>(`SELECT title, task_id, goal_id FROM notifications WHERE user_id = $1 AND task_id = $2 AND kind = 'comment'`, [ctx.demo.users.dima, task]);
    expect(n.rows).toEqual([{ title: 'Новый комментарий: «Подключить проверку данных к реестру студентов»', task_id: task, goal_id: ctx.demo.goals.automation }]);
    const d = (await (await ctx.as('dima')).get(url('task', task))).body.data;
    expect(d.comments.at(-1)).toMatchObject({ body: 'Согласование с ИБ получено', author_name: 'Игорь Лебедев' });
    expect(d.unread).toBeGreaterThan(0);
  });

  it('несуществующая задача — 404', async () => {
    expect((await (await ctx.as('olga')).get(url('task', '00000000-0000-4000-8000-000000000000'))).status).toBe(404);
  });
});
