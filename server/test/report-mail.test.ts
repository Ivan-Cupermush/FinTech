import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { dispatchReportMail, type MailMessage, type MailSender } from '../src/services/report-mail';
import { NOW, SECRET, setup, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
beforeEach(async () => {
  await ctx.db.query(`DELETE FROM report_subscriptions`);
});

// NOW — понедельник 19 октября, 15:00 по Москве: утренняя отправка уже прошла.
const NEXT_MONDAY = new Date('2026-10-26T06:00:00Z');
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

function fakeMail() {
  const sent: MailMessage[] = [];
  const sender: MailSender & { sent: MailMessage[]; fail?: boolean } = {
    sent,
    async send(m) {
      if (sender.fail) throw new Error('SMTP: соединение отклонено');
      sent.push(m);
    },
  };
  return sender;
}

const subscribe = async (who: Parameters<Ctx['as']>[0], schedule: 'weekly' | 'monthly', enabled = true) => {
  const r = await (await ctx.as(who)).put('/api/v1/report/subscription', { enabled, schedule });
  expect(r.status).toBe(200);
  return r.body.data;
};

const row = async (who: keyof Ctx['demo']['users']) =>
  (await ctx.db.query<{ last_sent_at: string | null; last_error: string | null }>(`SELECT last_sent_at, last_error FROM report_subscriptions WHERE user_id = $1`, [ctx.demo.users[who]])).rows[0];

describe('подписка на отчёт', () => {
  it('без входа — 401', async () => {
    expect((await request(ctx.app).get('/api/v1/report/subscription')).status).toBe(401);
  });

  it('по умолчанию выключена, почта — та, с которой входят', async () => {
    const r = await (await ctx.as('director')).get('/api/v1/report/subscription');
    expect(r.body.data).toEqual({ enabled: false, schedule: 'weekly', email: 'director@offix.demo', last_sent_at: null, next_at: null, mail_available: false });
  });

  it('включить: следующее письмо — в ближайший понедельник 9:00 по Москве', async () => {
    expect(await subscribe('director', 'weekly')).toMatchObject({ enabled: true, schedule: 'weekly', next_at: '2026-10-26T06:00:00.000Z' });
    expect(await subscribe('director', 'monthly')).toMatchObject({ schedule: 'monthly', next_at: '2026-11-01T06:00:00.000Z' });
    expect(await subscribe('director', 'monthly', false)).toMatchObject({ enabled: false, next_at: null });
  });

  it('неизвестная частота — 400', async () => {
    expect((await (await ctx.as('director')).put('/api/v1/report/subscription', { enabled: true, schedule: 'daily' })).status).toBe(400);
  });

  it('сервер с настроенной почтой сообщает об этом', async () => {
    const app = createApp({ db: ctx.db, config: { jwtSecret: SECRET, corsOrigins: [], mail: { enabled: true } }, now: () => NOW, rateLimit: false });
    const r = await request(app).get('/api/v1/report/subscription').set('Authorization', `Bearer ${await ctx.token('director')}`);
    expect(r.body.data.mail_available).toBe(true);
  });
});

describe('рассылка отчёта', () => {
  it('сразу после включения письмо не уходит — только в понедельник', async () => {
    await subscribe('director', 'weekly');
    const mail = fakeMail();
    expect(await dispatchReportMail(ctx.db, mail, minutes(NOW, 1))).toEqual({ sent: 0, failed: 0 });
    expect(await dispatchReportMail(ctx.db, mail, minutes(NEXT_MONDAY, -1))).toEqual({ sent: 0, failed: 0 });
    expect(await dispatchReportMail(ctx.db, mail, NEXT_MONDAY)).toEqual({ sent: 1, failed: 0 });
    expect(mail.sent).toHaveLength(1);
  });

  it('письмо: тема, HTML, текст и CSV во вложении, отчёт за неделю', async () => {
    await subscribe('director', 'weekly');
    const mail = fakeMail();
    await dispatchReportMail(ctx.db, mail, NEXT_MONDAY, { appUrl: 'https://offix.example' });
    const m = mail.sent[0]!;
    expect(m.to).toBe('director@offix.demo');
    expect(m.subject).toMatch(/^Отчёт offix · .+ · неделя, /);
    expect(m.html).toContain('Главное');
    expect(m.html).toContain('href="https://offix.example/app/report?days=7"');
    expect(m.text).toContain('Отчёт offix');
    expect(m.text).not.toContain('<');
    expect(m.attachments).toEqual([expect.objectContaining({ filename: 'offix-otchet-2026-10-26.csv', contentType: 'text/csv; charset=utf-8' })]);
    expect(m.attachments[0]!.content).toContain('Цель;Владелец');
    expect((await row('director'))?.last_sent_at).toBe(NEXT_MONDAY.toISOString());
  });

  it('повторный шаг в тот же слот ничего не задваивает', async () => {
    await subscribe('director', 'weekly');
    const mail = fakeMail();
    await dispatchReportMail(ctx.db, mail, NEXT_MONDAY);
    await dispatchReportMail(ctx.db, mail, minutes(NEXT_MONDAY, 1));
    await dispatchReportMail(ctx.db, mail, minutes(NEXT_MONDAY, 60 * 24 * 3));
    expect(mail.sent).toHaveLength(1);
    await dispatchReportMail(ctx.db, mail, minutes(NEXT_MONDAY, 60 * 24 * 7));
    expect(mail.sent).toHaveLength(2);
  });

  it('два процесса одновременно — одно письмо', async () => {
    await subscribe('director', 'weekly');
    const mail = fakeMail();
    const [a, b] = await Promise.all([dispatchReportMail(ctx.db, mail, NEXT_MONDAY), dispatchReportMail(ctx.db, mail, NEXT_MONDAY)]);
    expect(a.sent + b.sent).toBe(1);
    expect(mail.sent).toHaveLength(1);
  });

  it('руководитель получает отчёт по своей зоне, раз в месяц — за месяц', async () => {
    await subscribe('olga', 'monthly');
    const mail = fakeMail();
    expect((await dispatchReportMail(ctx.db, mail, NEXT_MONDAY)).sent).toBe(0);
    await dispatchReportMail(ctx.db, mail, new Date('2026-11-01T06:00:00Z'));
    const m = mail.sent[0]!;
    expect(m.to).toBe('olga@offix.demo');
    expect(m.subject).toContain('· месяц, ');
    expect(m.text).toContain('цели вашей зоны');
  });

  it('сбой SMTP: письмо не потеряно, ошибка записана, повтор через 15 минут', async () => {
    await subscribe('director', 'weekly');
    const mail = fakeMail();
    mail.fail = true;
    expect(await dispatchReportMail(ctx.db, mail, NEXT_MONDAY)).toEqual({ sent: 0, failed: 1 });
    expect(await row('director')).toMatchObject({ last_sent_at: null, last_error: 'SMTP: соединение отклонено' });
    mail.fail = false;
    expect((await dispatchReportMail(ctx.db, mail, minutes(NEXT_MONDAY, 5))).sent).toBe(0);
    expect((await dispatchReportMail(ctx.db, mail, minutes(NEXT_MONDAY, 16))).sent).toBe(1);
    expect(await row('director')).toMatchObject({ last_error: null });
  });

  it('выключенная подписка и неактивный сотрудник — без писем', async () => {
    await subscribe('director', 'weekly', false);
    await subscribe('anna', 'weekly');
    await ctx.db.query(`UPDATE users SET active = FALSE WHERE id = $1`, [ctx.demo.users.anna]);
    try {
      const mail = fakeMail();
      expect(await dispatchReportMail(ctx.db, mail, NEXT_MONDAY)).toEqual({ sent: 0, failed: 0 });
    } finally {
      await ctx.db.query(`UPDATE users SET active = TRUE WHERE id = $1`, [ctx.demo.users.anna]);
    }
  });

  it('сменили частоту — расписание с этого момента, без письма задним числом', async () => {
    await subscribe('director', 'weekly');
    await ctx.db.query(`UPDATE report_subscriptions SET since_at = '2026-09-01T00:00:00Z'`);
    await subscribe('director', 'monthly');
    const mail = fakeMail();
    // Слот 1 октября уже прошёл, но подписка на месяц включена 19-го — ждём 1 ноября.
    expect((await dispatchReportMail(ctx.db, mail, minutes(NOW, 1))).sent).toBe(0);
  });
});
