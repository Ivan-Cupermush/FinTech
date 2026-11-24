import { Router } from 'express';
import { z } from 'zod';
import type { Meeting, Meetings } from '@offix/core';
import { actorOf, type AuthedActor } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { forbidden, invalid } from '../http/errors';
import { isUuid, parseBody } from '../http/validate';
import { withIdempotency } from '../services/idempotency';

const input = z.object({
  title: z.string().trim().min(1).max(150),
  agenda: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(300).optional(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  participant_ids: z.array(z.string().refine(isUuid)).max(100),
});

async function listMeetings(q: Queryable, actor: AuthedActor, meetingId?: string): Promise<Meeting[]> {
  const { rows } = await q.query<Meeting>(
    `SELECT m.id, m.title, m.agenda, m.location, m.starts_at, m.ends_at, m.organizer_id,
       (SELECT json_agg(json_build_object('id', u.id, 'display_name', u.display_name) ORDER BY u.display_name, u.id)
          FROM meeting_participants p JOIN users u ON u.id = p.user_id WHERE p.meeting_id = m.id) AS participants
      FROM meeting_participants viewer JOIN meetings m ON m.id = viewer.meeting_id
     WHERE viewer.company_id = $1 AND viewer.user_id = $2 AND ($3::uuid IS NULL OR m.id = $3)
     ORDER BY m.starts_at, m.id`,
    [actor.company_id, actor.id, meetingId ?? null],
  );
  return rows;
}

export function meetingsRouter(db: Db, now: () => Date): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    const rows = await listMeetings(db, actorOf(req));
    const at = now().getTime();
    const data: Meetings = { upcoming: [], past: [] };
    for (const meeting of rows) {
      if (new Date(meeting.ends_at).getTime() > at) data.upcoming.push(meeting);
      else data.past.push(meeting);
    }
    data.past.reverse();
    res.json({ data });
  });

  r.post('/', async (req, res) => {
    const actor = actorOf(req);
    if (actor.role === 'observer') throw forbidden('Наблюдатель не может назначать совещания');
    const body = parseBody(input, req.body);
    if (Date.parse(body.ends_at) <= Date.parse(body.starts_at)) {
      throw invalid('Проверьте время встречи', { ends_at: 'Окончание должно быть после начала' });
    }
    const participants = [...new Set([actor.id, ...body.participant_ids.map((id) => id.toLowerCase())])];

    const out = await db.tx((q) => withIdempotency(q, {
      userId: actor.id, scope: `meetings:${actor.company_id}`, key: req.header('Idempotency-Key'), body,
    }, async () => {
      if (Date.parse(body.starts_at) < now().getTime()) {
        throw invalid('Проверьте время встречи', { starts_at: 'Выберите время в будущем' });
      }
      const members = await q.query(
        `SELECT m.user_id FROM company_members m JOIN users u ON u.id = m.user_id
          WHERE m.company_id = $1 AND m.user_id = ANY($2::uuid[]) AND u.active
            FOR SHARE OF m, u`,
        [actor.company_id, participants],
      );
      if (members.rows.length !== participants.length) {
        throw invalid('Проверьте участников', { participant_ids: 'Выберите действующих сотрудников вашей компании' });
      }
      const { rows: [meeting] } = await q.query<{ id: string }>(
        `INSERT INTO meetings (company_id, organizer_id, title, agenda, location, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [actor.company_id, actor.id, body.title, body.agenda || null, body.location || null, body.starts_at, body.ends_at],
      );
      await q.query(
        `INSERT INTO meeting_participants (meeting_id, company_id, user_id)
         SELECT $1, $2, user_id FROM unnest($3::uuid[]) AS user_id`,
        [meeting!.id, actor.company_id, participants],
      );
      const [data] = await listMeetings(q, actor, meeting!.id);
      return { status: 201, body: { data } };
    }));
    res.status(out.status).json(out.body);
  });
  return r;
}
