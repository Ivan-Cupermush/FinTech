import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setup, validGoal, type Ctx } from './helpers';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});

describe('POST /api/v1/goals — создание цели (ТЗ 4.10)', () => {
  it('корректная цель с KPI — 201 и карточка цели', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga));
    expect(r.status).toBe(201);
    const g = r.body.data;
    expect(g.id).toMatch(/[0-9a-f-]{36}/);
    expect(g.status).toBe('draft');
    expect(g.owner).toMatchObject({ id: ctx.demo.users.olga, display_name: 'Ольга Смирнова' });
    expect(g.metrics[0]).toMatchObject({ name: 'Среднее время ответа', unit: 'hours', baseline: 24, target: 8, direction: 'decrease', current_value: null });
    expect(g.metrics[0].planned_change).toBeCloseTo(-66.67, 1);
  });

  it('без фактических измерений прогресс — null, KPI — «Нет данных»', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga));
    expect(r.body.data.progress).toBeNull();
    expect(r.body.data.metrics[0].progress).toEqual({ state: 'no_data', raw: null, bar: null });
  });

  it('пустое название — 422 с понятным сообщением', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', { ...validGoal(ctx.demo.users.olga), title: '   ' });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Не удалось сохранить цель', fields: { title: 'Введите название цели' } });
  });

  it('отрицательное время обработки — 422 на KPI', async () => {
    const olga = await ctx.as('olga');
    const body = validGoal(ctx.demo.users.olga);
    body.metrics[0]!.baseline = -10;
    const r = await olga.post('/api/v1/goals', body);
    expect(r.status).toBe(422);
    expect(r.body.error.fields['metrics.0.baseline']).toMatch(/отрицательным/);
  });

  it('уменьшение при target ≥ baseline — 422', async () => {
    const olga = await ctx.as('olga');
    const body = validGoal(ctx.demo.users.olga);
    body.metrics[0]!.target = 30;
    const r = await olga.post('/api/v1/goals', body);
    expect(r.status).toBe(422);
    expect(r.body.error.fields['metrics.0.target']).toMatch(/меньше исходного/);
  });

  it('несуществующий владелец — 422, без технического ID в сообщении', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', validGoal('00000000-0000-4000-8000-000000000000'));
    expect(r.status).toBe(422);
    expect(r.body.error.fields.owner_id).toBe('Нельзя назначить выбранного владельца: сотрудник не найден');
    expect(JSON.stringify(r.body)).not.toContain('00000000-0000-4000');
  });

  it('владелец из другой компании отклоняется', async () => {
    const other = await (await import('../src/seed/demo')).seedDemo(ctx.db, { companyName: 'Другая компания', now: new Date('2026-10-19T12:00:00Z') });
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', validGoal(other.users.olga));
    expect(r.status).toBe(422);
  });

  it('владелец-наблюдатель — нельзя', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.observer));
    expect(r.status).toBe(422);
    expect(r.body.error.fields.owner_id).toMatch(/Наблюдатель/);
  });

  it('отключённый владелец — нельзя', async () => {
    await ctx.db.query(`UPDATE users SET active = FALSE WHERE id = $1`, [ctx.demo.users.sergey]);
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.sergey));
    expect(r.status).toBe(422);
    expect(r.body.error.fields.owner_id).toMatch(/отключён/);
    await ctx.db.query(`UPDATE users SET active = TRUE WHERE id = $1`, [ctx.demo.users.sergey]);
  });

  it('без авторизации — 401', async () => {
    const r = await request(ctx.app).post('/api/v1/goals').send(validGoal(ctx.demo.users.olga));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('поддельный токен — 401', async () => {
    const r = await request(ctx.app).get('/api/v1/goals').set('Authorization', 'Bearer abc.def.ghi');
    expect(r.status).toBe(401);
  });

  it('сотрудник не может создать операционную цель — 403', async () => {
    const anna = await ctx.as('anna');
    const r = await anna.post('/api/v1/goals', validGoal(ctx.demo.users.anna));
    expect(r.status).toBe(403);
  });

  it('сотрудник может создать личную цель для себя, но не для коллеги', async () => {
    const anna = await ctx.as('anna');
    const own = await anna.post('/api/v1/goals', { ...validGoal(ctx.demo.users.anna), type: 'personal', title: 'Освоить SQL' });
    expect(own.status).toBe(201);
    const other = await anna.post('/api/v1/goals', { ...validGoal(ctx.demo.users.sergey), type: 'personal' });
    expect(other.status).toBe(403);
  });

  it('наблюдатель не создаёт цели — 403', async () => {
    const obs = await ctx.as('observer');
    expect((await obs.post('/api/v1/goals', validGoal(ctx.demo.users.olga))).status).toBe(403);
  });

  it('повторная отправка с тем же ключом не создаёт дубликат', async () => {
    const olga = await ctx.as('olga');
    const body = { ...validGoal(ctx.demo.users.olga), title: 'Цель для проверки идемпотентности' };
    const a = await olga.post('/api/v1/goals', body).set('Idempotency-Key', 'key-123');
    const b = await olga.post('/api/v1/goals', body).set('Idempotency-Key', 'key-123');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    const { rows } = await ctx.db.query(`SELECT COUNT(*)::int AS n FROM goals WHERE title = $1`, [body.title]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('тот же ключ с другим телом — 409', async () => {
    const olga = await ctx.as('olga');
    await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga)).set('Idempotency-Key', 'key-xyz');
    const r = await olga.post('/api/v1/goals', { ...validGoal(ctx.demo.users.olga), title: 'Другое' }).set('Idempotency-Key', 'key-xyz');
    expect(r.status).toBe(409);
  });

  it('ошибка при создании KPI откатывает всю транзакцию', async () => {
    const olga = await ctx.as('olga');
    const title = 'Цель с ломающимся KPI';
    // Обходим проверки ядра: unit длиннее 30 символов отвергнет сама база на вставке KPI.
    const r = await olga.post('/api/v1/goals', {
      ...validGoal(ctx.demo.users.olga),
      title,
      metrics: [{ name: 'Ок', unit: 'minutes', baseline: 10, target: 5, direction: 'decrease' }, { name: 'Ок2', unit: 'minutes', baseline: 1e20, target: 5, direction: 'decrease' }],
    });
    expect(r.status).toBe(500);
    expect(r.body.error.message).toBe('Внутренняя ошибка сервера');
    expect(JSON.stringify(r.body)).not.toMatch(/numeric|overflow|SQL/i);
    const { rows } = await ctx.db.query(`SELECT COUNT(*)::int AS n FROM goals WHERE title = $1`, [title]);
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('создание активной цели сразу требует полный набор полей', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', { title: 'Активная без KPI', type: 'operational', status: 'active' });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.fields).sort()).toEqual(['due_at', 'metrics', 'owner_id']);
  });

  it('некорректный формат (строка вместо числа) — 400', async () => {
    const olga = await ctx.as('olga');
    const body = { ...validGoal(ctx.demo.users.olga), metrics: [{ name: 'X', unit: 'minutes', baseline: '40', target: 30, direction: 'decrease' }] };
    expect((await olga.post('/api/v1/goals', body)).status).toBe(400);
  });

  it('битый JSON — 400', async () => {
    const t = await ctx.token('olga');
    const r = await request(ctx.app).post('/api/v1/goals').set('Authorization', `Bearer ${t}`).set('Content-Type', 'application/json').send('{"title":');
    expect(r.status).toBe(400);
  });

  it('создание пишет событие в аудит', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', { ...validGoal(ctx.demo.users.olga), title: 'Цель с аудитом' });
    const { rows } = await ctx.db.query(`SELECT event_type, actor_id FROM audit_events WHERE goal_id = $1`, [r.body.data.id]);
    expect(rows).toEqual([{ event_type: 'goal.created', actor_id: ctx.demo.users.olga }]);
  });

  it('created_by берётся из сессии, а не из тела', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post('/api/v1/goals', { ...validGoal(ctx.demo.users.olga), created_by: ctx.demo.users.director });
    // Лишнее поле игнорируется схемой — автор всё равно Ольга.
    expect(r.status).toBe(201);
    expect(r.body.data.created_by.id).toBe(ctx.demo.users.olga);
  });

  it('владелец получает уведомление', async () => {
    const director = await ctx.as('director');
    const r = await director.post('/api/v1/goals', { ...validGoal(ctx.demo.users.maria), title: 'Цель для Марии' });
    const { rows } = await ctx.db.query(`SELECT title FROM notifications WHERE user_id = $1 AND goal_id = $2`, [ctx.demo.users.maria, r.body.data.id]);
    expect(rows[0]).toEqual({ title: 'Вы владелец цели «Цель для Марии»' });
  });
});

describe('просмотр и доступ', () => {
  it('знание UUID не даёт доступа: чужая цель — 404', async () => {
    const elena = await ctx.as('elena');
    const r = await elena.get(`/api/v1/goals/${ctx.demo.goals.main}`);
    expect(r.status).toBe(404);
  });

  it('сотрудник команды видит цель своего отдела', async () => {
    const anna = await ctx.as('anna');
    const r = await anna.get(`/api/v1/goals/${ctx.demo.goals.main}`);
    expect(r.status).toBe(200);
    expect(r.body.data.permissions).toMatchObject({ edit: false, manage: false, activate: false });
  });

  it('подцель видна тем, кто видит цель', async () => {
    const anna = await ctx.as('anna');
    expect((await anna.get(`/api/v1/goals/${ctx.demo.goals.automation}`)).status).toBe(200);
  });

  it('некорректный id — 404', async () => {
    const olga = await ctx.as('olga');
    expect((await olga.get('/api/v1/goals/not-a-uuid')).status).toBe(404);
  });

  it('список: только видимые цели, с главным KPI и фактом', async () => {
    const elena = await ctx.as('elena');
    const r = await elena.get('/api/v1/goals?scope=top');
    const titles = r.body.data.map((g: { title: string }) => g.title);
    expect(titles).toContain('Ускорить адаптацию новых сотрудников');
    expect(titles).not.toContain('Сократить время обработки заявки студента');
    const olga = await ctx.as('olga');
    const main = (await olga.get('/api/v1/goals?scope=top')).body.data.find((g: { id: string }) => g.id === ctx.demo.goals.main);
    expect(main.primary_metric.current_value).toBe(36.5);
    expect(main.progress).toBeCloseTo(35);
    expect(main.task_progress).toEqual({ done: 3, total: 8, percent: 38 });
    expect(main.blocked).toBe(1);
    expect(main.overdue).toBe(1);
  });

  it('фильтр по подцелям', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.get(`/api/v1/goals?parent=${ctx.demo.goals.main}`);
    expect(r.body.data.map((g: { title: string }) => g.title)).toEqual(['Убрать лишние согласования', 'Автоматизировать проверку данных', 'Сохранить качество обработки']);
  });

  it('карточка цели: KPI без подмены исходных значений, чек-лист, участники', async () => {
    const olga = await ctx.as('olga');
    const g = (await olga.get(`/api/v1/goals/${ctx.demo.goals.main}`)).body.data;
    expect(g.metrics[0]).toMatchObject({ baseline: 40, target: 30, current_value: 36.5 });
    expect(g.metrics[0].progress.state).toBe('progress');
    expect(g.units.map((u: { name: string; role: string }) => `${u.name}:${u.role}`).sort()).toEqual(['Автоматизация:executor', 'Контроль качества:approver', 'Учебный офис:owner']);
    expect(g.checklist.every((c: { done: boolean }) => c.done)).toBe(true);
    expect(g.children_count).toBe(3);
    expect(g.permissions.manage).toBe(true);
  });
});

describe('редактирование', () => {
  it('черновик можно открыть и продолжить заполнять', async () => {
    const olga = await ctx.as('olga');
    const created = await olga.post('/api/v1/goals', { title: 'Черновик без всего', type: 'operational' });
    expect(created.status).toBe(201);
    expect(created.body.data.checklist.filter((c: { done: boolean }) => !c.done).map((c: { key: string }) => c.key)).toEqual(['owner', 'due', 'kpi']);
    const r = await olga.patch(`/api/v1/goals/${created.body.data.id}`, { owner_id: ctx.demo.users.anna, due_at: '2026-12-01' });
    expect(r.status).toBe(200);
    expect(r.body.data.owner.id).toBe(ctx.demo.users.anna);
    expect(r.body.data.due_at).toBe('2026-12-01');
  });

  it('изменение пишет в аудит старое и новое значение', async () => {
    const olga = await ctx.as('olga');
    const created = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga));
    await olga.patch(`/api/v1/goals/${created.body.data.id}`, { due_at: '2026-11-30' });
    const audit = await olga.get(`/api/v1/goals/${created.body.data.id}/audit`);
    const upd = audit.body.data.find((e: { event_type: string }) => e.event_type === 'goal.updated');
    expect(upd.old_values).toEqual({ due_at: '2026-12-31' });
    expect(upd.new_values).toEqual({ due_at: '2026-11-30' });
    expect(upd.actor_name).toBe('Ольга Смирнова');
  });

  it('без изменений — без события в аудите', async () => {
    const olga = await ctx.as('olga');
    const created = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga));
    await olga.patch(`/api/v1/goals/${created.body.data.id}`, { title: validGoal('').title });
    const { rows } = await ctx.db.query(`SELECT COUNT(*)::int AS n FROM audit_events WHERE goal_id = $1 AND event_type = 'goal.updated'`, [created.body.data.id]);
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('владелец-сотрудник меняет описание, но не срок', async () => {
    const olga = await ctx.as('olga');
    const created = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.anna));
    const anna = await ctx.as('anna');
    expect((await anna.patch(`/api/v1/goals/${created.body.data.id}`, { description: 'Уточнила' })).status).toBe(200);
    expect((await anna.patch(`/api/v1/goals/${created.body.data.id}`, { due_at: '2027-01-01' })).status).toBe(403);
  });

  it('нельзя сделать цель подцелью её же подцели', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.patch(`/api/v1/goals/${ctx.demo.goals.main}`, { parent_goal_id: ctx.demo.goals.automation });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.parent_goal_id).toMatch(/её же подцели/);
  });

  it('цель не может быть подцелью самой себя', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.patch(`/api/v1/goals/${ctx.demo.goals.main}`, { parent_goal_id: ctx.demo.goals.main });
    expect(r.status).toBe(422);
  });

  it('у активной цели нельзя убрать владельца', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.patch(`/api/v1/goals/${ctx.demo.goals.main}`, { owner_id: null });
    expect(r.status).toBe(422);
    expect(r.body.error.fields.owner_id).toBeDefined();
  });
});

describe('статусы и активация', () => {
  it('черновик с полным набором активируется', async () => {
    const olga = await ctx.as('olga');
    const created = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga));
    const r = await olga.post(`/api/v1/goals/${created.body.data.id}/activate`);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('active');
  });

  it('активация уже активной цели — 409', async () => {
    const olga = await ctx.as('olga');
    const r = await olga.post(`/api/v1/goals/${ctx.demo.goals.main}/activate`);
    expect(r.status).toBe(409);
  });

  it('черновик без KPI не активируется — 422 и список того, что заполнить', async () => {
    const olga = await ctx.as('olga');
    const created = await olga.post('/api/v1/goals', { title: 'Без KPI', type: 'operational', owner_id: ctx.demo.users.olga, due_at: '2026-12-31' });
    const r = await olga.post(`/api/v1/goals/${created.body.data.id}/activate`);
    expect(r.status).toBe(422);
    expect(r.body.error.fields.metrics).toMatch(/KPI/);
  });

  it('черновик со сроком в прошлом активировать нельзя', async () => {
    const olga = await ctx.as('olga');
    const created = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.olga));
    await ctx.db.query(`UPDATE goals SET due_at = '2026-10-01' WHERE id = $1`, [created.body.data.id]);
    const r = await olga.post(`/api/v1/goals/${created.body.data.id}/activate`);
    expect(r.status).toBe(422);
    expect(r.body.error.fields.due_at).toBe('Срок должен быть не раньше текущей даты');
  });

  it('сотрудник не может активировать цель — 403', async () => {
    const olga = await ctx.as('olga');
    const created = await olga.post('/api/v1/goals', validGoal(ctx.demo.users.anna));
    const anna = await ctx.as('anna');
    expect((await anna.post(`/api/v1/goals/${created.body.data.id}/activate`)).status).toBe(403);
  });

  it('пауза и возобновление, отмена — финальна', async () => {
    const olga = await ctx.as('olga');
    const created = await olga.post('/api/v1/goals', { ...validGoal(ctx.demo.users.olga), status: 'active' });
    const id = created.body.data.id;
    expect((await olga.post(`/api/v1/goals/${id}/status`, { status: 'on_hold' })).body.data.status).toBe('on_hold');
    expect((await olga.post(`/api/v1/goals/${id}/status`, { status: 'active' })).body.data.status).toBe('active');
    expect((await olga.post(`/api/v1/goals/${id}/status`, { status: 'cancelled' })).status).toBe(200);
    expect((await olga.post(`/api/v1/goals/${id}/status`, { status: 'active' })).status).toBe(409);
    expect((await olga.patch(`/api/v1/goals/${id}`, { title: 'Новое' })).status).toBe(409);
  });

  it('база не даст активной цели остаться без владельца даже в обход API', async () => {
    await expect(ctx.db.query(`UPDATE goals SET owner_id = NULL WHERE id = $1`, [ctx.demo.goals.main])).rejects.toThrow();
  });
});
