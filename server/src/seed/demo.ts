import { addDays, todayIso } from '@offix/core';
import { hashPassword } from '../auth/auth';
import type { Db, Queryable } from '../db/db';
import { sealSecret } from '../services/secret-box';
import { DEMO_1C_URL } from './fake-systems';
import { seedDemoChats, type DemoChats } from './demo-chats';

/**
 * Демо-организация для показа и тестов: сквозной сценарий из ТЗ.
 * Учебный офис, IT и контроль качества вместе сокращают время обработки
 * заявки студента с 40 до 30 минут; у IT задержка, которая сдвигает приёмку.
 * Даты считаются от «сегодня», чтобы демо всегда выглядело живым.
 */
export const DEMO_PASSWORD = 'offix-demo';

export interface DemoIds {
  companyId: string;
  users: Record<DemoUser, string>;
  units: Record<string, string>;
  goals: Record<string, string>;
  tasks: Record<string, string>;
  chats: DemoChats;
}

type DemoUser = 'director' | 'olga' | 'anna' | 'igor' | 'dima' | 'maria' | 'sergey' | 'elena' | 'observer';

const PEOPLE: Record<DemoUser, { name: string; email: string; position: string; role: string }> = {
  director: { name: 'Алексей Петров', email: 'director@offix.demo', position: 'Проректор по цифровой трансформации', role: 'owner' },
  olga: { name: 'Ольга Смирнова', email: 'olga@offix.demo', position: 'Руководитель учебного офиса', role: 'manager' },
  anna: { name: 'Анна Королёва', email: 'anna@offix.demo', position: 'Специалист по работе с заявками', role: 'member' },
  igor: { name: 'Игорь Лебедев', email: 'igor@offix.demo', position: 'Руководитель IT-департамента', role: 'manager' },
  dima: { name: 'Дмитрий Орлов', email: 'dima@offix.demo', position: 'Разработчик автоматизации', role: 'member' },
  maria: { name: 'Мария Васильева', email: 'maria@offix.demo', position: 'Руководитель контроля качества', role: 'manager' },
  sergey: { name: 'Сергей Ким', email: 'sergey@offix.demo', position: 'Аналитик процессов', role: 'member' },
  elena: { name: 'Елена Фёдорова', email: 'elena@offix.demo', position: 'HR-партнёр', role: 'manager' },
  observer: { name: 'Ректорат', email: 'rector@offix.demo', position: 'Наблюдатель', role: 'observer' },
};

async function one<T = { id: string }>(q: Queryable, sql: string, params: unknown[]): Promise<T> {
  const { rows } = await q.query<T>(sql, params);
  return rows[0]!;
}

export async function seedDemo(db: Db, opts: { now?: Date; companyName?: string } = {}): Promise<DemoIds> {
  const now = opts.now ?? new Date();
  const today = todayIso(now);
  const d = (n: number) => addDays(today, n);
  const ts = (n: number, h = 10) => new Date(Date.parse(`${d(n)}T00:00:00Z`) + h * 3_600_000).toISOString();
  const hash = await hashPassword(DEMO_PASSWORD);

  return db.tx(async (q) => {
    const { id: companyId } = await one(q, `INSERT INTO companies (name, setup_mode) VALUES ($1, 'structured') RETURNING id`, [opts.companyName ?? 'Университет · демо']);
    const users = {} as Record<DemoUser, string>;
    for (const [key, p] of Object.entries(PEOPLE) as [DemoUser, (typeof PEOPLE)[DemoUser]][]) {
      const email = opts.companyName ? `${companyId.slice(0, 8)}.${p.email}` : p.email;
      const { id } = await one(q, `INSERT INTO users (email, password_hash, display_name, position) VALUES ($1, $2, $3, $4) RETURNING id`, [email, hash, p.name, p.position]);
      users[key] = id;
      await q.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)`, [companyId, id, p.role]);
    }

    const unit = async (name: string, type: string, parent: string | null, color: string) =>
      (await one(q, `INSERT INTO org_units (company_id, parent_unit_id, name, unit_type, color) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [companyId, parent, name, type, color])).id;
    const units: Record<string, string> = {};
    units.office = await unit('Учебный офис', 'department', null, '#2F6BFF');
    units.intake = await unit('Приём заявок', 'team', units.office, '#2F6BFF');
    units.it = await unit('IT-департамент', 'department', null, '#7A5AF8');
    units.automation = await unit('Автоматизация', 'team', units.it, '#7A5AF8');
    units.quality = await unit('Контроль качества', 'department', null, '#12B76A');
    units.review = await unit('Проверка', 'team', units.quality, '#12B76A');
    units.hr = await unit('Управление персоналом', 'department', null, '#F79009');

    const member = (user: DemoUser, unitKey: string, manager = false, primary = true) =>
      q.query(`INSERT INTO org_memberships (company_id, user_id, unit_id, is_manager, is_primary, started_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
        companyId,
        users[user],
        units[unitKey],
        manager,
        primary,
        d(-200),
      ]);
    await member('olga', 'office', true);
    await member('anna', 'intake');
    await member('sergey', 'intake');
    await member('igor', 'it', true);
    await member('dima', 'automation');
    // Дмитрий временно помогает приёму заявок — участие в нескольких командах.
    await member('dima', 'intake', false, false);
    await member('maria', 'quality', true);
    await member('elena', 'hr', true);

    // Цели заводятся черновиком и запускаются позже: журнал хранит обе даты,
    // по ним считается метрика «Запуск целей».
    const goal = async (g: { title: string; description: string; type: string; owner: DemoUser; by: DemoUser; status: string; due: string; parent?: string; position?: number; activated?: number }) => {
      const { id } = await one(
        q,
        `INSERT INTO goals (company_id, parent_goal_id, title, description, goal_type, owner_id, created_by, status, due_at, position, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [companyId, g.parent ?? null, g.title, g.description, g.type, users[g.owner], users[g.by], g.status, g.due, g.position ?? 0, ts(-30)],
      );
      const event = (type: string, values: object, at: string) =>
        q.query(`INSERT INTO audit_events (company_id, entity_type, entity_id, goal_id, actor_id, event_type, new_values, created_at) VALUES ($1, 'goal', $2, $2, $3, $4, $5, $6)`, [
          companyId,
          id,
          users[g.by],
          type,
          JSON.stringify(values),
          at,
        ]);
      await event('goal.created', { title: g.title, status: 'draft' }, ts(-30));
      if (g.activated !== undefined) await event('goal.status_changed', { status: 'active' }, ts(g.activated, 12));
      return id;
    };
    const metric = async (goalId: string, m: { name: string; unit: string; baseline: number; target: number; direction: string }, obs: [number, number][]) => {
      const { id } = await one(q, `INSERT INTO goal_metrics (goal_id, name, unit, baseline, target_value, direction, is_primary) VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id`, [
        goalId,
        m.name,
        m.unit,
        m.baseline,
        m.target,
        m.direction,
      ]);
      for (const [dayOffset, value] of obs) {
        await q.query(`INSERT INTO goal_metric_observations (metric_id, value, observed_at, recorded_by) VALUES ($1, $2, $3, $4)`, [id, value, ts(dayOffset, 9), users.olga]);
      }
      return id;
    };
    const goalUnits = async (goalId: string, list: [string, string][]) => {
      for (const [u, role] of list) await q.query(`INSERT INTO goal_org_units (goal_id, unit_id, role) VALUES ($1, $2, $3)`, [goalId, units[u], role]);
    };

    const goals: Record<string, string> = {};
    goals.main = await goal({
      title: 'Сократить время обработки заявки студента',
      description:
        'Сократить среднее время обработки заявки на справку с 40 до 30 минут без ухудшения качества и нарушения контрольных процедур. Участвуют учебный офис, IT и контроль качества.',
      type: 'operational',
      owner: 'olga',
      by: 'director',
      status: 'active',
      due: d(73),
      activated: -29,
    });
    await metric(goals.main, { name: 'Среднее время обработки', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease' }, [
      [-28, 40],
      [-21, 39],
      [-14, 38],
      [-7, 37],
      [-1, 36.5],
    ]);
    await goalUnits(goals.main, [
      ['office', 'owner'],
      ['automation', 'executor'],
      ['quality', 'approver'],
    ]);
    goals.approvals = await goal({ title: 'Убрать лишние согласования', description: 'Найти этапы, которые не добавляют ценности, и предложить новый регламент.', type: 'operational', owner: 'olga', by: 'olga', status: 'active', due: d(20), parent: goals.main, position: 1, activated: -28 });
    goals.automation = await goal({ title: 'Автоматизировать проверку данных', description: 'Сократить ручной ввод и сверку одних и тех же данных в разных системах.', type: 'operational', owner: 'igor', by: 'olga', status: 'active', due: d(45), parent: goals.main, position: 2, activated: -28 });
    goals.quality = await goal({ title: 'Сохранить качество обработки', description: 'Определить контрольные показатели и подтвердить, что ошибок не стало больше.', type: 'operational', owner: 'maria', by: 'olga', status: 'active', due: d(70), parent: goals.main, position: 3, activated: -27 });

    goals.contracts = await goal({
      title: 'Сократить срок согласования договоров',
      description: 'Договор проходит пять этапов согласования; больше всего ждёт на правовой экспертизе.',
      type: 'strategic',
      owner: 'director',
      by: 'director',
      status: 'active',
      due: d(120),
      activated: -27,
    });
    const contractsMetric = await metric(goals.contracts, { name: 'Срок согласования договора', unit: 'days', baseline: 12, target: 5, direction: 'decrease' }, [
      [-20, 12],
      [-5, 10],
    ]);
    await goalUnits(goals.contracts, [['office', 'contributor'], ['it', 'executor']]);

    goals.onboarding = await goal({
      title: 'Ускорить адаптацию новых сотрудников',
      description: 'Новый сотрудник знает, к кому обратиться и какие системы освоить, и выходит на рабочий ритм быстрее.',
      type: 'strategic',
      owner: 'elena',
      by: 'director',
      status: 'active',
      due: d(150),
      activated: -12,
    });
    await metric(goals.onboarding, { name: 'Время до первой самостоятельной задачи', unit: 'days', baseline: 30, target: 14, direction: 'decrease' }, []);
    await goalUnits(goals.onboarding, [['hr', 'owner']]);

    goals.nps = await goal({
      title: 'Повысить удовлетворённость студентов сервисом',
      description: 'Черновик: KPI уточняем после опроса.',
      type: 'strategic',
      owner: 'director',
      by: 'director',
      status: 'draft',
      due: d(200),
    });

    const task = async (t: {
      title: string;
      goal: string;
      assignee: DemoUser;
      unit?: string;
      team?: string;
      start: number;
      due: number;
      status: string;
      dod?: string;
      blocked?: { reason: string; note: string; since: number; next?: string };
      doneAt?: number;
      history: [number, string, string?][];
    }) => {
      const { id } = await one(
        q,
        `INSERT INTO tasks (company_id, title, status, assignee_id, unit_id, team_unit_id, start_at, due_at, done_at, definition_of_done,
                            blocked_reason, blocked_note, blocked_since, next_step, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [
          companyId,
          t.title,
          t.status,
          users[t.assignee],
          t.unit ? units[t.unit] : null,
          t.team ? units[t.team] : null,
          d(t.start),
          d(t.due),
          t.doneAt !== undefined ? ts(t.doneAt, 16) : null,
          t.dod ?? null,
          t.blocked?.reason ?? null,
          t.blocked?.note ?? null,
          t.blocked ? ts(t.blocked.since, 11) : null,
          t.blocked?.next ?? null,
          users.olga,
          ts(t.history[0]?.[0] ?? -20, 9),
        ],
      );
      for (const [day, status, reason] of t.history) {
        await q.query(`INSERT INTO task_status_events (task_id, status, blocked_reason, actor_id, at) VALUES ($1, $2, $3, $4, $5)`, [id, status, reason ?? null, users[t.assignee], ts(day, status === 'done' ? 16 : 10)]);
      }
      await q.query(`INSERT INTO goal_tasks (goal_id, task_id, linked_by) VALUES ($1, $2, $3)`, [goals[t.goal], id, users.olga]);
      return id;
    };

    const tasks: Record<string, string> = {};
    tasks.map = await task({ title: 'Описать текущий маршрут заявки', goal: 'approvals', assignee: 'sergey', unit: 'office', team: 'intake', start: -25, due: -18, status: 'done', doneAt: -19, dod: 'Схема из всех этапов со временем на каждом', history: [[-25, 'todo'], [-24, 'in_progress'], [-19, 'done']] });
    tasks.interviews = await task({ title: 'Интервью с сотрудниками приёма', goal: 'approvals', assignee: 'anna', unit: 'office', team: 'intake', start: -20, due: -14, status: 'done', doneAt: -12, history: [[-20, 'todo'], [-19, 'in_progress'], [-17, 'blocked', 'colleague'], [-15, 'in_progress'], [-12, 'done']] });
    tasks.regulation = await task({ title: 'Предложить новый регламент согласования', goal: 'approvals', assignee: 'olga', unit: 'office', start: -10, due: 8, status: 'in_progress', dod: 'Регламент согласован с правовым управлением', history: [[-10, 'todo'], [-9, 'in_progress']] });
    tasks.api = await task({ title: 'Подключить проверку данных к реестру студентов', goal: 'automation', assignee: 'dima', unit: 'it', team: 'automation', start: -14, due: -3, status: 'in_progress', dod: 'Номер студенческого проверяется автоматически', history: [[-14, 'todo'], [-13, 'in_progress'], [-9, 'blocked', 'approval'], [-6, 'in_progress']] });
    tasks.autofill = await task({
      title: 'Автозаполнение формы заявки',
      goal: 'automation',
      assignee: 'dima',
      unit: 'it',
      team: 'automation',
      start: -6,
      due: 6,
      status: 'blocked',
      blocked: { reason: 'data', note: 'нет доступа к справочнику подразделений', since: -4, next: 'Запросить выгрузку у учебного офиса' },
      history: [[-6, 'todo'], [-5, 'in_progress'], [-4, 'blocked', 'data']],
    });
    tasks.pilot = await task({ title: 'Пилот автопроверки на одном факультете', goal: 'automation', assignee: 'igor', unit: 'it', start: 0, due: 10, status: 'todo', history: [[-6, 'todo']] });
    tasks.controls = await task({ title: 'Определить контрольные показатели качества', goal: 'quality', assignee: 'maria', unit: 'quality', team: 'review', start: -8, due: -1, status: 'done', doneAt: -2, history: [[-8, 'todo'], [-7, 'in_progress'], [-3, 'review'], [-2, 'done']] });
    tasks.acceptance = await task({ title: 'Приёмка автопроверки', goal: 'quality', assignee: 'maria', unit: 'quality', team: 'review', start: 0, due: 4, status: 'todo', dod: 'Доля ошибок не выше исходной', history: [[-6, 'todo']] });

    const dep = (from: string, to: string) => q.query(`INSERT INTO task_dependencies (company_id, from_task_id, to_task_id) VALUES ($1, $2, $3)`, [companyId, tasks[from], tasks[to]]);
    await dep('map', 'regulation');
    await dep('api', 'pilot');
    await dep('api', 'acceptance');
    await dep('controls', 'acceptance');
    await dep('autofill', 'pilot');

    await q.query(`INSERT INTO task_participants (task_id, user_id, role) VALUES ($1, $2, 'approver'), ($1, $3, 'contributor')`, [tasks.acceptance, users.olga, users.dima]);

    await q.query(`INSERT INTO comments (company_id, entity_type, entity_id, author_id, body, created_at) VALUES ($1, 'goal', $2, $3, $4, $5)`, [
      companyId,
      goals.main,
      users.anna,
      'Больше всего времени уходит на сверку номера студенческого с реестром — до 12 минут на заявку.',
      ts(-15, 14),
    ]);
    // Обсуждение: ответ с упоминанием и вопрос в задаче — чтобы в демо было что открыть.
    const first = await q.query<{ id: string }>(`SELECT id FROM comments WHERE entity_id = $1 ORDER BY created_at LIMIT 1`, [goals.main]);
    await q.query(`INSERT INTO comments (company_id, entity_type, entity_id, author_id, body, parent_id, mention_ids, created_at) VALUES ($1, 'goal', $2, $3, $4, $5, $6::uuid[], $7)`, [
      companyId,
      goals.main,
      users.olga,
      '@Дмитрий Орлов, сверку можно автоматизировать через API реестра? Это самый долгий этап.',
      first.rows[0]!.id,
      [users.dima],
      ts(-15, 16),
    ]);
    await q.query(`INSERT INTO comments (company_id, entity_type, entity_id, author_id, body, created_at) VALUES ($1, 'task', $2, $3, $4, $5)`, [
      companyId,
      tasks.autofill,
      users.dima,
      'Ждём доступ к справочнику подразделений. Заявку в ИБ подали, номер 4412.',
      ts(-4, 12),
    ]);

    // База знаний: общая методика и заметка цели.
    await q.query(`INSERT INTO notes (company_id, goal_id, title, body, created_by, created_at, updated_at) VALUES ($1, NULL, $2, $3, $4, $5, $5), ($1, $6, $7, $8, $9, $10, $10)`, [
      companyId,
      'Как мы считаем время обработки заявки',
      [
        '## Что считаем',
        '',
        'От регистрации заявки в СЭД до ответа студенту. Выходные не исключаем: студент ждёт и в выходные.',
        '',
        '## Как замеряем',
        '',
        '- выборка — **30 заявок** за неделю',
        '- источник — журнал СЭД, поля «Зарегистрирована» и «Ответ отправлен»',
        '- замер вносит владелец цели по понедельникам',
        '',
        '> Цифра без источника в KPI не попадает.',
      ].join('\n'),
      users.olga,
      ts(-20, 10),
      goals.main,
      'Решения встречи по маршруту заявки',
      [
        '- [x] Убрать согласование с деканатом для типовых заявок',
        '- [x] Автозаполнение формы — делает IT, срок 31 октября',
        '- [ ] Проверить, не выросла ли доля ошибок',
        '',
        'Следующая встреча — после пилота автопроверки.',
      ].join('\n'),
      users.olga,
      ts(-9, 15),
    ]);

    await q.query(`INSERT INTO notifications (company_id, user_id, kind, title, body, goal_id, task_id, created_at, push_state) VALUES ($1, $2, 'task_blocked', $3, $4, $5, $6, $7, 'skipped')`, [
      companyId,
      users.olga,
      '«Автозаполнение формы заявки» заблокирована',
      'Не хватает данных: нет доступа к справочнику подразделений',
      goals.main,
      tasks.autofill,
      ts(-4, 11),
    ]);

    // Интеграция с 1С (в демо — поддельная публикация): замер за −5 день пришёл из неё.
    const { id: integrationId } = await one(
      q,
      `INSERT INTO integrations (company_id, goal_id, metric_id, kind, name, config, username, secret, interval_hours, last_sync_at, last_success_at, created_by, created_at)
       VALUES ($1, $2, $3, 'onec', $4, $5, 'offix', $9, 24, $6, $6, $7, $8) RETURNING id`,
      [
        companyId,
        goals.contracts,
        contractsMetric,
        '1С: договоры',
        JSON.stringify({ base_url: DEMO_1C_URL, entity: 'Document_ДоговорКонтрагента', date_field: 'Date', value_field: 'СрокСогласования', filter: '', aggregate: 'avg' }),
        ts(-5, 7),
        users.director,
        ts(-6, 15),
        sealSecret('demo-1c-password'),
      ],
    );
    await q.query(`UPDATE goal_metric_observations SET source = 'integration', recorded_by = NULL, note = 'Интеграция «1С: договоры»' WHERE metric_id = $1 AND observed_at = $2`, [
      contractsMetric,
      ts(-5, 9),
    ]);
    const run = (at: string, status: string, fetched: number, imported: number, skipped: number, error: string | null, trigger = 'schedule') =>
      q.query(
        `INSERT INTO integration_runs (integration_id, company_id, trigger, started_by, started_at, finished_at, status, fetched, imported, skipped, error) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10)`,
        [integrationId, companyId, trigger, trigger === 'manual' ? users.director : null, at, status, fetched, imported, skipped, error],
      );
    await run(ts(-6, 15), 'error', 0, 0, 0, 'Система отклонила логин и пароль', 'manual');
    await run(ts(-5, 7), 'ok', 112, 1, 0, null, 'manual');

    const chats = await seedDemoChats(q, companyId, users, now);
    return { companyId, users, units, goals, tasks, chats };
  });
}
