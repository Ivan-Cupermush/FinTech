import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountProfile, ChatHistory, ChatSummary, ContactName, PersonCard, PersonGroup, QrLoginInfo, QrPollResult } from '@offix/core';
import { signToken } from '../src/auth/auth';
import { DEMO_PASSWORD } from '../src/seed/demo';
import { NOW, SECRET, recordingRealtime, setup, type Ctx } from './helpers';

type Who = keyof Ctx['demo']['users'];
const API = '/api/v1';
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

const id = (who: Who) => ctx.demo.users[who];

async function login(email: string, password: string) {
  return request(ctx.app).post(`${API}/auth/login`).send({ email, password });
}

async function freshToken(email: string, password = DEMO_PASSWORD): Promise<string> {
  const r = await login(email, password);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data.token;
}

const withToken = (token: string) => ({
  get: (url: string) => request(ctx.app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url: string, body: object = {}) => request(ctx.app).post(url).set('Authorization', `Bearer ${token}`).send(body),
});

/** Отдельный сотрудник на тест — смена пароля и выход не задевают общие токены. */
async function hire(name: string, email: string): Promise<{ id: string; token: string; password: string }> {
  const r = await (await ctx.as('director')).post(`${API}/users`, { email, display_name: name, role: 'member' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const password = r.body.data.temp_password as string;
  return { id: r.body.data.id, password, token: await freshToken(email, password) };
}

describe('профиль', () => {
  it('отдаёт свой профиль: почта, роль, компания, когда входил', async () => {
    const r = await (await ctx.as('anna')).get(`${API}/account`);
    expect(r.status).toBe(200);
    const p: AccountProfile = r.body.data;
    expect(p).toMatchObject({ id: id('anna'), email: 'anna@offix.demo', display_name: 'Анна Королёва', role: 'member' });
    expect(p.company_name).toBeTruthy();
    expect(p.last_login_at).toBeTruthy();
    expect(p.password_changed_at).toBeNull();
  });

  it('меняет имя, пишет в журнал и рассылает событие', async () => {
    const igor = await ctx.as('igor');
    const r = await igor.patch(`${API}/account`, { display_name: '  Игорь Л.  ' });
    expect(r.status).toBe(200);
    expect(r.body.data.display_name).toBe('Игорь Л.');
    expect(rt.of('profile_changed')[0]?.payloadFor('x')).toEqual({ user_id: id('igor') });
    const log = await ctx.db.query(`SELECT old_values, new_values FROM audit_events WHERE entity_id = $1 AND event_type = 'account.renamed'`, [id('igor')]);
    expect(log.rows[0]).toMatchObject({ old_values: { display_name: 'Игорь Лебедев' }, new_values: { display_name: 'Игорь Л.' } });
    await igor.patch(`${API}/account`, { display_name: 'Игорь Лебедев' });
  });

  it('пустое имя — ошибка поля', async () => {
    const r = await (await ctx.as('igor')).patch(`${API}/account`, { display_name: '   ' });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.display_name).toBeTruthy();
  });

  it('почта меняется только с паролем и не на занятую', async () => {
    const u = await hire('Почтовый Тест', 'mail-test@offix.demo');
    const a = withToken(u.token);
    expect((await a.post(`${API}/account/email`, { email: 'new-mail@offix.demo', password: 'wrong-password' })).body.error.fields.password).toBe('Неверный пароль');
    expect((await a.post(`${API}/account/email`, { email: 'anna@offix.demo', password: u.password })).body.error.fields.email).toBe('Эта почта уже занята');
    expect((await a.post(`${API}/account/email`, { email: 'не почта', password: u.password })).status).toBe(422);
    const ok = await a.post(`${API}/account/email`, { email: 'new-mail@offix.demo', password: u.password });
    expect(ok.status).toBe(200);
    expect(ok.body.data.email).toBe('new-mail@offix.demo');
    expect((await login('new-mail@offix.demo', u.password)).status).toBe(200);
  });
});

describe('пароль и сеансы', () => {
  it('смена пароля: старые токены и сокеты закрыты, новый токен работает', async () => {
    const u = await hire('Смена Пароля', 'pwd-change@offix.demo');
    const other = await freshToken('pwd-change@offix.demo', u.password);
    const r = await withToken(u.token).post(`${API}/account/password`, { current_password: u.password, new_password: 'quiet-river-2026' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const next = r.body.data.token as string;
    expect((await withToken(u.token).get(`${API}/account`)).status).toBe(401);
    const stale = await withToken(other).get(`${API}/account`);
    expect(stale.status).toBe(401);
    expect(stale.body.error.message).toBe('Сессия завершена — войдите снова');
    expect((await withToken(next).get(`${API}/account`)).body.data.password_changed_at).toBe(NOW.toISOString());
    expect(rt.of('disconnect_user')[0]?.users).toEqual([u.id]);
    expect((await login('pwd-change@offix.demo', u.password)).status).toBe(401);
    expect((await login('pwd-change@offix.demo', 'quiet-river-2026')).status).toBe(200);
  });

  it('неверный текущий, тот же самый и слабый пароль отклоняются', async () => {
    const u = await hire('Слабый Пароль', 'pwd-weak@offix.demo');
    const a = withToken(u.token);
    const wrong = await a.post(`${API}/account/password`, { current_password: 'nope-nope-nope', new_password: 'quiet-river-2026' });
    expect(wrong.body.error.fields.current_password).toBe('Текущий пароль неверный');
    const same = await a.post(`${API}/account/password`, { current_password: u.password, new_password: u.password });
    expect(same.body.error.fields.new_password).toBe('Новый пароль совпадает с текущим');
    for (const weak of ['1234567', 'password1', 'aaaaaaaaaa', 'pwd-weak-2026']) {
      const r = await a.post(`${API}/account/password`, { current_password: u.password, new_password: weak });
      expect(r.status, weak).toBe(422);
      expect(r.body.error.fields.new_password, weak).toBeTruthy();
    }
    expect((await a.get(`${API}/account`)).status).toBe(200);
  });

  it('«выйти везде» с этим устройством и без него', async () => {
    const u = await hire('Выход Везде', 'logout-all@offix.demo');
    const phone = await freshToken('logout-all@offix.demo', u.password);
    const keep = await withToken(u.token).post(`${API}/account/logout-all`, {});
    expect(keep.status).toBe(200);
    const kept = keep.body.data.token as string;
    expect((await withToken(phone).get(`${API}/account`)).status).toBe(401);
    expect((await withToken(kept).get(`${API}/account`)).status).toBe(200);
    const all = await withToken(kept).post(`${API}/account/logout-all`, { keep_current: false });
    expect(all.body.data.token).toBeNull();
    expect((await withToken(kept).get(`${API}/account`)).status).toBe(401);
    expect(rt.of('disconnect_user')).toHaveLength(2);
  });

  it('токен без версии (выданный до обновления) живёт до первого «выйти везде»', async () => {
    const u = await hire('Старый Токен', 'old-token@offix.demo');
    const old = signToken(SECRET, u.id, ctx.demo.companyId);
    expect((await withToken(old).get(`${API}/account`)).status).toBe(200);
    await withToken(u.token).post(`${API}/account/logout-all`, {});
    expect((await withToken(old).get(`${API}/account`)).status).toBe(401);
  });

  it('отключённый сотрудник выходит отовсюду сразу', async () => {
    const u = await hire('Уволенный', 'fired@offix.demo');
    const r = await (await ctx.as('director')).patch(`${API}/users/${u.id}`, { active: false });
    expect(r.status).toBe(200);
    expect(rt.of('disconnect_user')[0]?.users).toEqual([u.id]);
    expect((await withToken(u.token).get(`${API}/account`)).status).toBe(401);
  });
});

describe('сброс пароля администратором', () => {
  it('временный пароль: сеансы закрыты, войти можно только с ним', async () => {
    const u = await hire('Забыл Пароль', 'forgot@offix.demo');
    const r = await (await ctx.as('director')).post(`${API}/users/${u.id}/reset-password`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const temp = r.body.data.password as string;
    expect(temp).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    expect((await withToken(u.token).get(`${API}/account`)).status).toBe(401);
    expect((await login('forgot@offix.demo', u.password)).status).toBe(401);
    expect((await login('forgot@offix.demo', temp)).status).toBe(200);
    expect(rt.of('disconnect_user')[0]?.users).toEqual([u.id]);
    const log = await ctx.db.query(`SELECT actor_id FROM audit_events WHERE entity_id = $1 AND event_type = 'member.password_reset'`, [u.id]);
    expect(log.rows[0]?.actor_id).toBe(id('director'));
  });

  it('свой пароль администратора: проверяется на надёжность, в ответе не возвращается', async () => {
    const u = await hire('Свой Пароль', 'own-reset@offix.demo');
    const dir = await ctx.as('director');
    expect((await dir.post(`${API}/users/${u.id}/reset-password`, { password: '12345678' })).body.error.fields.password).toBeTruthy();
    const ok = await dir.post(`${API}/users/${u.id}/reset-password`, { password: 'bright-maple-77' });
    expect(ok.body.data.password).toBeNull();
    expect((await login('own-reset@offix.demo', 'bright-maple-77')).status).toBe(200);
  });

  it('не администратор, свой аккаунт, чужая компания и владелец — нельзя', async () => {
    expect((await (await ctx.as('olga')).post(`${API}/users/${id('anna')}/reset-password`, {})).status).toBe(403);
    expect((await (await ctx.as('director')).post(`${API}/users/${id('director')}/reset-password`, {})).status).toBe(409);
    expect((await (await ctx.as('director')).post(`${API}/users/00000000-0000-4000-8000-000000000000/reset-password`, {})).status).toBe(404);
    // Администратор (не владелец) не трогает пароль владельца.
    await ctx.db.query(`UPDATE company_members SET role = 'admin' WHERE user_id = $1`, [id('elena')]);
    try {
      const elena = withToken(await freshToken('elena@offix.demo'));
      expect((await elena.post(`${API}/users/${id('director')}/reset-password`, {})).status).toBe(403);
    } finally {
      await ctx.db.query(`UPDATE company_members SET role = 'manager' WHERE user_id = $1`, [id('elena')]);
    }
  });
});

describe('вход на сайт по QR', () => {
  const browser = () => request(ctx.app).post(`${API}/auth/qr`).set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36');
  const poll = (token: string, secret: string) => request(ctx.app).post(`${API}/auth/qr/poll`).send({ token, secret });

  it('полный путь: код → скан → подтверждение → сайт получает вход ровно один раз', async () => {
    const c = await browser();
    expect(c.status).toBe(201);
    const { token, secret, ttl } = c.body.data;
    expect(ttl).toBe(90);
    expect((await poll(token, secret)).body.data).toEqual({ status: 'pending' });

    const phone = await ctx.as('maria');
    const scan = await phone.get(`${API}/account/qr/${token}`);
    expect(scan.status).toBe(200);
    const info: QrLoginInfo = scan.body.data;
    expect(info.status).toBe('scanned');
    expect(info.device).toEqual({ kind: 'desktop', label: 'Chrome на Windows' });
    expect((await poll(token, secret)).body.data).toEqual({ status: 'scanned', user: { display_name: 'Мария Васильева' } });

    expect((await phone.post(`${API}/account/qr/${token}/approve`)).body.data.status).toBe('approved');
    const got = await poll(token, secret);
    const res: QrPollResult = got.body.data;
    expect(res.status).toBe('approved');
    if (res.status !== 'approved') return;
    expect(res.user).toMatchObject({ id: id('maria'), role: 'manager' });
    expect((await withToken(res.token).get(`${API}/account`)).body.data.id).toBe(id('maria'));
    // Второй раз — уже нет.
    expect((await poll(token, secret)).body.data).toEqual({ status: 'expired' });
    const log = await ctx.db.query(`SELECT event_type FROM audit_events WHERE entity_id = $1 AND event_type LIKE 'login.qr%' ORDER BY created_at`, [id('maria')]);
    expect(log.rows.map((r) => r.event_type)).toEqual(expect.arrayContaining(['login.qr_approved', 'login.qr']));
  });

  it('без подтверждения сайт входа не получает, даже после скана', async () => {
    const { token, secret } = (await browser()).body.data;
    await (await ctx.as('anna')).get(`${API}/account/qr/${token}`);
    for (let i = 0; i < 3; i++) expect((await poll(token, secret)).body.data.status).toBe('scanned');
  });

  it('чужой secret — как будто кода нет', async () => {
    const { token } = (await browser()).body.data;
    const other = (await browser()).body.data;
    expect((await poll(token, other.secret)).status).toBe(404);
    expect((await poll('x'.repeat(32), other.secret)).status).toBe(404);
  });

  it('код отсканировал один — подтвердить или отклонить другой не может', async () => {
    const { token, secret } = (await browser()).body.data;
    await (await ctx.as('anna')).get(`${API}/account/qr/${token}`);
    const igor = await ctx.as('igor');
    expect((await igor.get(`${API}/account/qr/${token}`)).status).toBe(403);
    expect((await igor.post(`${API}/account/qr/${token}/approve`)).status).toBe(403);
    expect((await igor.post(`${API}/account/qr/${token}/decline`)).status).toBe(403);
    expect((await poll(token, secret)).body.data.status).toBe('scanned');
  });

  it('отклонил — сайт узнаёт, подтвердить потом нельзя', async () => {
    const { token, secret } = (await browser()).body.data;
    const anna = await ctx.as('anna');
    await anna.get(`${API}/account/qr/${token}`);
    expect((await anna.post(`${API}/account/qr/${token}/decline`)).body.data.status).toBe('declined');
    expect((await poll(token, secret)).body.data).toEqual({ status: 'declined' });
    expect((await anna.post(`${API}/account/qr/${token}/approve`)).status).toBe(409);
  });

  it('через 90 секунд код недействителен: и подтвердить, и забрать вход нельзя', async () => {
    const { token, secret } = (await browser()).body.data;
    const anna = await ctx.as('anna');
    await anna.get(`${API}/account/qr/${token}`);
    clock += 91_000;
    expect((await anna.get(`${API}/account/qr/${token}`)).body.data.status).toBe('expired');
    expect((await anna.post(`${API}/account/qr/${token}/approve`)).status).toBe(409);
    expect((await poll(token, secret)).body.data).toEqual({ status: 'expired' });
  });

  it('подтвердил, но сайт опоздал — вход не выдаётся', async () => {
    const { token, secret } = (await browser()).body.data;
    const anna = await ctx.as('anna');
    await anna.post(`${API}/account/qr/${token}/approve`);
    clock += 91_000;
    expect((await poll(token, secret)).body.data).toEqual({ status: 'expired' });
  });

  it('битый и несуществующий код с телефона', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.get(`${API}/account/qr/${encodeURIComponent('не код')}`)).status).toBe(400);
    expect((await anna.get(`${API}/account/qr/${'a'.repeat(32)}`)).status).toBe(404);
  });

  it('отключённый сотрудник подтвердил заранее — вход не выдаётся', async () => {
    const u = await hire('Подтвердил И Ушёл', 'qr-fired@offix.demo');
    const { token, secret } = (await browser()).body.data;
    await withToken(u.token).post(`${API}/account/qr/${token}/approve`);
    await (await ctx.as('director')).patch(`${API}/users/${u.id}`, { active: false });
    expect((await poll(token, secret)).body.data).toEqual({ status: 'expired' });
  });

  it('в базе только хэши кода и secret', async () => {
    const { token, secret } = (await browser()).body.data;
    const { rows } = await ctx.db.query<{ token_hash: string; secret_hash: string }>(`SELECT token_hash, secret_hash FROM qr_logins`);
    const all = JSON.stringify(rows);
    expect(all).not.toContain(token);
    expect(all).not.toContain(secret);
  });
});

describe('коллеги и свои имена', () => {
  it('своё имя для коллеги видно только мне', async () => {
    const anna = await ctx.as('anna');
    const put = await anna.put(`${API}/contacts/${id('igor')}/name`, { name: '  Игорь из IT  ' });
    expect(put.status).toBe(200);
    expect(put.body.data).toEqual({ user_id: id('igor'), name: 'Игорь из IT' });
    expect(rt.of('contact_names_changed')[0]?.users).toEqual([id('anna')]);
    const names: ContactName[] = (await anna.get(`${API}/contacts/names`)).body.data;
    expect(names).toEqual([{ user_id: id('igor'), name: 'Игорь из IT' }]);
    expect((await (await ctx.as('dima')).get(`${API}/contacts/names`)).body.data).toEqual([]);
    const card: PersonCard = (await anna.get(`${API}/contacts/${id('igor')}`)).body.data;
    expect(card).toMatchObject({ display_name: 'Игорь Лебедев', my_name: 'Игорь из IT', is_me: false });
    expect((await (await ctx.as('dima')).get(`${API}/contacts/${id('igor')}`)).body.data.my_name).toBeNull();
  });

  it('пустое имя возвращает настоящее, DELETE — тоже', async () => {
    const anna = await ctx.as('anna');
    await anna.put(`${API}/contacts/${id('olga')}/name`, { name: 'Руководитель' });
    await anna.put(`${API}/contacts/${id('olga')}/name`, { name: '' });
    expect((await anna.get(`${API}/contacts/${id('olga')}`)).body.data.my_name).toBeNull();
    await anna.put(`${API}/contacts/${id('olga')}/name`, { name: 'Руководитель' });
    expect((await anna.delete(`${API}/contacts/${id('olga')}/name`)).status).toBe(204);
    expect((await anna.get(`${API}/contacts/${id('olga')}`)).body.data.my_name).toBeNull();
  });

  it('себя переименовать нельзя, чужого и несуществующего — 404, длинное имя — ошибка', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.put(`${API}/contacts/${id('anna')}/name`, { name: 'Я' })).status).toBe(422);
    expect((await anna.put(`${API}/contacts/00000000-0000-4000-8000-000000000000/name`, { name: 'Кто-то' })).status).toBe(404);
    expect((await anna.put(`${API}/contacts/${id('igor')}/name`, { name: 'x'.repeat(121) })).status).toBe(422);
    expect((await anna.get(`${API}/contacts/not-a-uuid`)).status).toBe(404);
  });

  it('карточка: подразделения, своя карточка и сотрудник другой компании', async () => {
    const anna = await ctx.as('anna');
    const me: PersonCard = (await anna.get(`${API}/contacts/${id('anna')}`)).body.data;
    expect(me.is_me).toBe(true);
    expect(me.units.length).toBeGreaterThan(0);
    const other = await request(ctx.app).post(`${API}/auth/register`).send({ company_name: 'Другой вуз', display_name: 'Чужой Директор', email: 'stranger@other.demo', password: 'calm-forest-19' });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    expect((await anna.get(`${API}/contacts/${other.body.data.user.id}`)).status).toBe(404);
    expect((await anna.put(`${API}/contacts/${other.body.data.user.id}/name`, { name: 'Чужой' })).status).toBe(404);
  });

  it('в списке чатов — моё имя для собеседника и автора последнего сообщения, у других — настоящее', async () => {
    const anna = await ctx.as('anna');
    const igor = await ctx.as('igor');
    await anna.put(`${API}/contacts/${id('igor')}/name`, { name: 'Игорь из IT' });
    const direct: ChatSummary = (await anna.post(`${API}/chats/direct`, { user_id: id('igor') })).body.data;
    expect((await igor.post(`${API}/chats/${direct.id}/messages`, { text: 'Привет' })).status).toBe(201);
    expect((await igor.post(`${API}/chats/${ctx.demo.chats.team}/messages`, { text: 'Всем привет' })).status).toBe(201);
    const mine: ChatSummary[] = (await anna.get(`${API}/chats`)).body.data;
    const chat = mine.find((c) => c.id === direct.id)!;
    expect(chat.title).toBe('Игорь из IT');
    expect(chat.peer).toMatchObject({ display_name: 'Игорь Лебедев', contact_name: 'Игорь из IT' });
    expect(mine.find((c) => c.id === ctx.demo.chats.team)!.last_message?.sender_name).toBe('Игорь из IT');
    const detail = (await anna.get(`${API}/chats/${direct.id}`)).body.data;
    expect(detail.title).toBe('Игорь из IT');
    const dima: ChatSummary[] = (await (await ctx.as('dima')).get(`${API}/chats`)).body.data;
    expect(dima.find((c) => c.id === ctx.demo.chats.team)!.last_message?.sender_name).toBe('Игорь Лебедев');
    const back: ChatSummary[] = (await igor.get(`${API}/chats`)).body.data;
    expect(back.find((c) => c.id === direct.id)!.peer?.contact_name).toBeNull();
  });

  it('у цитаты есть автор — клиент подставит своё имя', async () => {
    const igor = await ctx.as('igor');
    const base = (await igor.post(`${API}/chats/${ctx.demo.chats.team}/messages`, { text: 'Вопрос' })).body.data;
    const anna = await ctx.as('anna');
    expect((await anna.post(`${API}/chats/${ctx.demo.chats.team}/messages`, { text: 'Ответ', reply_to_id: base.id })).status).toBe(201);
    const h: ChatHistory = (await anna.get(`${API}/chats/${ctx.demo.chats.team}/messages`)).body.data;
    const reply = h.messages.find((m) => m.text === 'Ответ')!;
    expect(reply.reply_to).toMatchObject({ id: base.id, sender_id: id('igor'), sender_name: 'Игорь Лебедев' });
  });

  it('мои группы: где коллега уже есть и куда мне можно добавлять', async () => {
    const groups: PersonGroup[] = (await (await ctx.as('olga')).get(`${API}/contacts/${id('dima')}/groups`)).body.data;
    expect(groups.length).toBeGreaterThan(0);
    const team = groups.find((g) => g.id === ctx.demo.chats.team);
    expect(team).toBeDefined();
    expect(typeof team!.can_add).toBe('boolean');
    expect(typeof team!.is_member).toBe('boolean');
  });
});
