// Standalone recovery drill using the real offix API and synthetic users/data.
// Called in two separate processes: create, then verify after offline restore.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { migrate } from '../src/db/migrate';
import { createPgliteDb } from '../src/db/pglite';
import { DEMO_PASSWORD, seedDemo } from '../src/seed/demo';
import { fakeSystemsFetch } from '../src/seed/fake-systems';
import { createMediaStore } from '../src/services/media';

const [mode, dir] = process.argv.slice(2);
if (!dir || (mode !== 'create' && mode !== 'verify')) throw new Error('create|verify data-directory');
const now = new Date('2026-10-19T12:00:00Z');
const secret = 'synthetic-recovery-secret-for-tests-only';
const contents = 'Synthetic offix recovery attachment\n';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const db = await createPgliteDb(join(dir, 'pgdata'));
const store = createMediaStore({ dir: join(dir, 'uploads'), maxBytes: 1024 * 1024, store: 'fs', ffmpegDir: null }, secret);
try {
  if (mode === 'create') {
    await migrate(db);
    await seedDemo(db, { now });
  }
  const app = createApp({ db, media: store, now: () => now, rateLimit: false,
    config: { jwtSecret: secret, corsOrigins: [] }, integrationFetch: fakeSystemsFetch(() => now) });
  async function token(email: string) {
    const result = await request(app).post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD }).expect(200);
    return result.body.data.token as string;
  }
  const olga = await token('olga@offix.demo');
  const anna = await token('anna@offix.demo');
  const dima = await token('dima@offix.demo');
  const auth = (tokenValue: string) => ({ Authorization: `Bearer ${tokenValue}` });
  if (mode === 'create') {
    const me = await request(app).get('/api/v1/users/me').set(auth(anna)).expect(200);
    const meeting = await request(app).post('/api/v1/meetings').set(auth(olga)).send({
      title: 'Synthetic recovery meeting', agenda: 'Synthetic agenda', participant_ids: [me.body.data.id],
      starts_at: '2026-11-01T10:00:00.000Z', ends_at: '2026-11-01T10:30:00.000Z',
    }).expect(201);
    const chat = await request(app).post('/api/v1/chats/direct').set(auth(olga)).send({ user_id: me.body.data.id });
    assert.ok([200, 201].includes(chat.status), `chat: ${chat.status}`);
    const file = await request(app).post('/api/v1/files').set(auth(anna))
      .attach('file', Buffer.from(contents), { filename: 'synthetic.txt', contentType: 'text/plain' }).expect(201);
    await request(app).post(`/api/v1/chats/${chat.body.data.id}/messages`).set(auth(anna))
      .send({ text: 'Synthetic recovery message', attachment_ids: [file.body.data.id] }).expect(201);
    await writeFile(join(dir, 'fixture.json'), JSON.stringify({ meetingId: meeting.body.data.id, fileId: file.body.data.id }));
  } else {
    const { meetingId, fileId } = JSON.parse(await readFile(join(dir, 'fixture.json'), 'utf8')) as { meetingId: string; fileId: string };
    const visible = await request(app).get('/api/v1/meetings').set(auth(anna)).expect(200);
    assert.ok(visible.body.data.upcoming.some((m: { id: string; title: string }) => m.id === meetingId && m.title === 'Synthetic recovery meeting'));
    const hidden = await request(app).get('/api/v1/meetings').set(auth(dima)).expect(200);
    assert.ok(![...hidden.body.data.upcoming, ...hidden.body.data.past].some((m: { id: string }) => m.id === meetingId));
    await request(app).get(`/api/v1/files/${fileId}`).set(auth(dima)).expect(404);
    const file = await request(app).get(`/api/v1/files/${fileId}`).set(auth(olga)).expect(200);
    const raw = await request(app).get(file.body.data.url).expect(200);
    assert.equal(sha256(raw.text), sha256(contents));
    console.log(`Verified restored meeting, two users' access and attachment SHA-256 ${sha256(contents)}`);
  }
} finally {
  store.close();
  await db.close();
}
