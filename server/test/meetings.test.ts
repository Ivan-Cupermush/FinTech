import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { setup, type Ctx } from './helpers';

const endpoint = '/api/v1/meetings';
const date = { starts_at: '2026-11-01T10:00:00.000Z', ends_at: '2026-11-01T10:30:00.000Z' };
let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });

describe('совещания', () => {
  it('сохраняет встречу один раз, показывает участникам и в архиве после окончания', async () => {
    const organizer = await ctx.as('olga');
    const participant = await ctx.as('anna');
    const other = await ctx.as('dima');
    const body = {
      ...date, title: 'План учебного офиса', agenda: 'Согласовать сроки', location: 'Аудитория 12',
      participant_ids: [ctx.demo.users.anna, ctx.demo.users.anna],
    };
    const first = await organizer.post(endpoint, body).set('Idempotency-Key', 'planning-01');
    expect(first.status).toBe(201);
    const meeting = first.body.data;
    expect(meeting).toMatchObject({
      title: body.title, agenda: body.agenda, location: body.location, organizer_id: ctx.demo.users.olga,
      participants: expect.arrayContaining([{ id: ctx.demo.users.anna, display_name: expect.any(String) }]),
    });
    expect(meeting.participants).toHaveLength(2);
    const repeat = await organizer.post(endpoint, body).set('Idempotency-Key', 'planning-01');
    expect(repeat.status).toBe(201);
    expect(repeat.body.data.id).toBe(meeting.id);
    expect((await participant.get(endpoint)).body.data.upcoming.map((item: { id: string }) => item.id)).toEqual([meeting.id]);
    expect((await other.get(endpoint)).body.data).toEqual({ upcoming: [], past: [] });

    await ctx.db.query(`UPDATE meetings SET starts_at = '2026-10-18 10:00Z', ends_at = '2026-10-18 10:30Z' WHERE id = $1`, [meeting.id]);
    const { data } = (await participant.get(endpoint)).body;
    expect(data.upcoming).toEqual([]);
    expect(data.past).toEqual([expect.objectContaining({ id: meeting.id, agenda: body.agenda })]);
  });

  it('отклоняет неверное время, доступ без входа и создание наблюдателем', async () => {
    const organizer = await ctx.as('olga');
    const observer = await ctx.as('observer');
    const body = { ...date, title: 'Проверка', participant_ids: [] };
    expect((await organizer.post(endpoint, { ...body, ends_at: date.starts_at })).status).toBe(422);
    expect((await organizer.post(endpoint, { ...body, starts_at: '2026-10-01T09:00:00Z' })).status).toBe(422);
    expect((await observer.post(endpoint, body)).status).toBe(403);
    expect((await request(ctx.app).get(endpoint)).status).toBe(401);
  });

  it('запрещает приглашать сотрудника другой компании', async () => {
    const registration = await request(ctx.app).post('/api/v1/auth/register').send({
      company_name: 'Другая команда', display_name: 'Другой организатор',
      email: 'meeting-other@example.test', password: 'ExamplePassword42!', consent: true,
    });
    expect(registration.status).toBe(201);
    const token = registration.body.data.token;
    const other = await request(ctx.app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
    expect(other.status).toBe(200);
    const organizer = await ctx.as('director');
    const meeting = await organizer.post(endpoint, { ...date, title: 'Проверка', participant_ids: [other.body.data.id] });
    expect(meeting.status).toBe(422);
    expect((await request(ctx.app).get(endpoint).set('Authorization', `Bearer ${token}`)).body.data).toEqual({ upcoming: [], past: [] });
  });
});
