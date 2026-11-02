import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CompanyModules, FunctionDetail } from '@offix/core';
import { dueIntegrations } from '../src/services/integrations';
import { NOW, recordingRealtime, setup, type Ctx } from './helpers';

const API = '/api/v1';
const rt = recordingRealtime();
let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup({ realtime: rt });
});
beforeEach(async () => {
  rt.clear();
  await ctx.db.query(`UPDATE companies SET disabled_modules = '{}' WHERE id = $1`, [ctx.demo.companyId]);
});

const ALL_ON: CompanyModules = { sales: true, chats: true, knowledge_ai: true, my_notes: true, integrations: true };

describe('функции компании', () => {
  it('по умолчанию включено всё, и это видно в /users/me', async () => {
    const anna = await ctx.as('anna');
    const me = await anna.get(`${API}/users/me`);
    expect(me.body.data.modules).toEqual(ALL_ON);
    const view = await anna.get(`${API}/company/modules`);
    expect(view.body.data).toEqual({ modules: ALL_ON, can_change: false });
  });

  it('менять может только владелец или администратор', async () => {
    for (const who of ['anna', 'olga', 'observer'] as const) {
      const r = await (await ctx.as(who)).put(`${API}/company/modules`, { modules: { sales: false } });
      expect(r.status).toBe(403);
    }
    const r = await (await ctx.as('director')).put(`${API}/company/modules`, { modules: { sales: false } });
    expect(r.status).toBe(200);
    expect(r.body.data.modules.sales).toBe(false);
  });

  it('выключенный раздел API не отдаёт: 403 с кодом и понятным текстом', async () => {
    const dir = await ctx.as('director');
    expect((await dir.get(`${API}/sales/month`)).status).toBe(200);
    await dir.put(`${API}/company/modules`, { modules: { sales: false } });
    const r = await dir.get(`${API}/sales/month`);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: 'MODULE_DISABLED', fields: { module: 'sales' } });
    expect(r.body.error.message).toContain('«Продажи и выплаты» выключен');
    // Другие разделы работают.
    expect((await dir.get(`${API}/chats`)).status).toBe(200);
    expect((await dir.get(`${API}/goals`)).status).toBe(200);
  });

  it('каждый раздел закрывается своим ключом', async () => {
    const dir = await ctx.as('director');
    const urls: Record<string, string[]> = {
      chats: ['/chats', '/chats/unread', '/messages/search?q=a'],
      knowledge_ai: ['/knowledge/docs', '/knowledge/status'],
      my_notes: ['/my-notes'],
      integrations: ['/integrations'],
    };
    for (const [key, list] of Object.entries(urls)) {
      await dir.put(`${API}/company/modules`, { modules: { ...ALL_ON, [key]: false } });
      for (const u of list) {
        const r = await dir.get(`${API}${u}`);
        expect(r.status, `${key} ${u}`).toBe(403);
        expect(r.body.error.fields.module).toBe(key);
      }
    }
    // Статьи базы знаний — не ИИ: остаются при выключенном помощнике.
    await dir.put(`${API}/company/modules`, { modules: { ...ALL_ON, knowledge_ai: false } });
    expect((await dir.get(`${API}/notes`)).status).toBe(200);
  });

  it('без чатов заметку в чат не отправить, а сами заметки работают', async () => {
    const olga = await ctx.as('olga');
    const note = await olga.post(`${API}/my-notes`, { title: 'Для чата', body: 'Текст' });
    expect(note.status).toBe(201);
    await (await ctx.as('director')).put(`${API}/company/modules`, { modules: { chats: false } });
    const r = await olga.post(`${API}/my-notes/${note.body.data.id}/share`, { chat_id: ctx.demo.chats.team, text: '' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MODULE_DISABLED');
    expect((await olga.get(`${API}/my-notes/${note.body.data.id}`)).status).toBe(200);
  });

  it('готовые наборы: университет — без продаж, компания — всё', async () => {
    const dir = await ctx.as('director');
    const uni = await dir.put(`${API}/company/modules`, { preset: 'university' });
    expect(uni.body.data.modules).toEqual({ ...ALL_ON, sales: false });
    const all = await dir.put(`${API}/company/modules`, { preset: 'company' });
    expect(all.body.data.modules).toEqual(ALL_ON);
    expect((await dir.put(`${API}/company/modules`, { preset: 'circus' })).status).toBe(400);
    expect((await dir.put(`${API}/company/modules`, { modules: { teleport: false } })).status).toBe(400);
    expect((await dir.put(`${API}/company/modules`, { modules: {} })).status).toBe(422);
  });

  it('изменение — в журнале и в истории, у всех сотрудников меню перестраивается', async () => {
    const dir = await ctx.as('director');
    await dir.put(`${API}/company/modules`, { preset: 'university' });
    const { rows } = await ctx.db.query<{ old_values: unknown; new_values: unknown; actor_id: string }>(
      `SELECT old_values, new_values, actor_id FROM audit_events WHERE company_id = $1 AND event_type = 'company.modules_changed' ORDER BY id DESC LIMIT 1`,
      [ctx.demo.companyId],
    );
    expect(rows[0]).toEqual({ old_values: { sales: true }, new_values: { sales: false, preset: 'university' }, actor_id: ctx.demo.users.director });
    expect(rt.of('modules_changed')).toHaveLength(1);
    const history = await dir.get(`${API}/company/modules/history`);
    expect(history.body.data[0]).toMatchObject({ actor_name: 'Алексей Петров', new_values: { sales: false, preset: 'university' } });
    expect((await (await ctx.as('anna')).get(`${API}/company/modules/history`)).status).toBe(403);
    // Повтор того же набора ничего не пишет.
    rt.clear();
    await dir.put(`${API}/company/modules`, { preset: 'university' });
    expect(rt.of('modules_changed')).toHaveLength(0);
  });

  it('без продаж функции продаж у сотрудников прячутся и не включаются', async () => {
    const dir = await ctx.as('director');
    await dir.put(`${API}/company/modules`, { modules: { sales: false } });
    const me = (await (await ctx.as('olga')).get(`${API}/functions/me`)).body.data.functions as FunctionDetail[];
    expect(me.map((f) => f.key)).toEqual(['kpi_record', 'kpi_assign', 'knowledge_manage']);
    const r = await dir.put(`${API}/functions/users/${ctx.demo.users.anna}`, { changes: { sales_reports: true } });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MODULE_DISABLED');
    const ok = await dir.put(`${API}/functions/users/${ctx.demo.users.anna}`, { changes: { kpi_record: true } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.functions.some((f: FunctionDetail) => f.key.startsWith('sales_'))).toBe(false);
  });

  it('выключенные интеграции не синхронизируются по расписанию, настройки остаются', async () => {
    const later = new Date(NOW.getTime() + 30 * 86_400_000);
    const before = await dueIntegrations(ctx.db, later);
    expect(before.length).toBeGreaterThan(0);
    await (await ctx.as('director')).put(`${API}/company/modules`, { modules: { integrations: false } });
    expect(await dueIntegrations(ctx.db, later)).toEqual([]);
    const { rows } = await ctx.db.query(`SELECT 1 FROM integrations WHERE company_id = $1`, [ctx.demo.companyId]);
    expect(rows.length).toBe(before.length);
  });

  it('другая компания не затронута', async () => {
    await (await ctx.as('director')).put(`${API}/company/modules`, { modules: { sales: false } });
    const { rows } = await ctx.db.query<{ id: string }>(`INSERT INTO companies (name, setup_mode) VALUES ('Другая', 'quick') RETURNING id`);
    const other = await ctx.db.query<{ disabled_modules: string[] }>(`SELECT disabled_modules FROM companies WHERE id = $1`, [rows[0]!.id]);
    expect(other.rows[0]!.disabled_modules).toEqual([]);
  });
});
