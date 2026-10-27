import { addDays, todayIso } from '@offix/core';
import type { Db } from '../db/db';
import { notify, type NewNotification } from '../services/notify';
import type { DemoIds } from './demo';

/**
 * Просьбы, контрольные точки, наблюдатели, архив и функции в демо.
 * У директора во «Входящих» — новая просьба Ольги и выполненная просьба
 * Игоря, за которую можно поблагодарить; в «Моих просьбах» — проверка у
 * Марии с точками; в «Наблюдаю» — регламент и автозаполнение; в архиве —
 * закрытые задачи. Ольга включила Анне «Вносить измерения KPI».
 * Отдельно от seedDemo — тестам задач нужна база без просьб.
 */
export async function seedDemoTaskFlow(db: Db, demo: DemoIds, now = new Date()): Promise<void> {
  const u = demo.users;
  const t = demo.tasks;
  const today = todayIso(now);
  const day = (n: number) => addDays(today, n);
  const at = (n: number, hour = 10) => `${day(n)}T${String(hour).padStart(2, '0')}:00:00Z`;
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  await db.tx(async (q) => {
    const task = async (v: { title: string; description?: string; kind: 'task' | 'request'; by: string; to: string; status: string; due: number | null; created: number; doneAt?: number; history: [number, string][] }) => {
      const closed = v.doneAt !== undefined ? at(v.doneAt, 16) : null;
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO tasks (company_id, title, description, kind, status, assignee_id, due_at, done_at, closed_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10) RETURNING id`,
        [demo.companyId, v.title, v.description ?? null, v.kind, v.status, v.to, v.due === null ? null : day(v.due), closed, v.by, at(v.created, 9)],
      );
      const id = rows[0]!.id;
      for (const [d, status] of v.history) await q.query(`INSERT INTO task_status_events (task_id, status, actor_id, at) VALUES ($1, $2, $3, $4)`, [id, status, status === 'todo' ? v.by : v.to, at(d, status === 'done' ? 16 : 10)]);
      return id;
    };
    const checkpoint = (taskId: string, title: string, due: number, by: string, done?: { by: string; at: number }) =>
      q.query(`INSERT INTO task_checkpoints (task_id, title, due_at, status, done_at, done_by, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        taskId,
        title,
        day(due),
        done ? 'done' : 'pending',
        done ? at(done.at, 15) : null,
        done?.by ?? null,
        by,
      ]);
    const inbox = async (userId: string, actor: string, n: Omit<NewNotification, 'company_id' | 'user_id'>, min: number) => {
      await notify(q, { company_id: demo.companyId, user_id: userId, ...n }, actor);
      await q.query(`UPDATE notifications SET created_at = $2 WHERE id = (SELECT id FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`, [userId, ago(min)]);
    };

    // Ольга просит директора согласовать регламент — ждёт «Взять в работу».
    const agree = await task({
      title: 'Согласовать регламент приёма заявок',
      description: 'Черновик — в группе «Заявки за 30 минут». Главное: срок ответа студенту 30 минут и выборочная проверка 10% заявок.',
      kind: 'request',
      by: u.olga,
      to: u.director,
      status: 'todo',
      due: 2,
      created: 0,
      history: [[0, 'todo']],
    });
    await checkpoint(agree, 'Прочитать черновик', 1, u.olga);
    await inbox(u.director, u.olga, { kind: 'task_request', title: 'Ольга Смирнова просит: «Согласовать регламент приёма заявок»', body: `К ${day(2).split('-').reverse().join('.')}`, task_id: agree }, 25);

    // Игорь выполнил просьбу директора — можно поблагодарить прямо из ленты.
    const export_ = await task({ title: 'Выгрузить заявки за сентябрь', description: 'Нужна таблица: номер, дата, время обработки, кто обработал.', kind: 'request', by: u.director, to: u.igor, status: 'done', due: 0, created: -3, doneAt: -1, history: [[-3, 'todo'], [-2, 'in_progress'], [-1, 'done']] });
    await inbox(u.director, u.igor, { kind: 'task_done', title: 'Просьба выполнена: «Выгрузить заявки за сентябрь»', body: 'Поблагодарите, если всё в порядке', task_id: export_ }, 60 * 18);

    // Мария проверяет заявки по просьбе директора: одна точка пройдена, вторая впереди.
    const check = await task({ title: 'Выборочно проверить 20 заявок', kind: 'request', by: u.director, to: u.maria, status: 'in_progress', due: 4, created: -2, history: [[-2, 'todo'], [-1, 'in_progress']] });
    await checkpoint(check, 'Первые 10 заявок', 0, u.director, { by: u.maria, at: 0 });
    await checkpoint(check, 'Ещё 10 и вывод', 3, u.director);

    // Контрольные точки в задачах цели: у пилота точка сорвана — светофор жёлтый.
    await checkpoint(t.regulation!, 'Черновик регламента', -3, u.olga, { by: u.director, at: -3 });
    await checkpoint(t.regulation!, 'Согласовать с правовым управлением', 3, u.olga);
    await checkpoint(t.regulation!, 'Утвердить у проректора', 7, u.olga);
    await checkpoint(t.pilot!, 'Выбрать факультет для пилота', -1, u.olga);
    await checkpoint(t.pilot!, 'Пилот на 50 заявках', 7, u.olga);

    // Наблюдатели: директор следит за регламентом и автозаполнением, Ольга — за реестром.
    for (const [taskId, user] of [
      [t.regulation!, u.director],
      [t.autofill!, u.director],
      [t.api!, u.olga],
    ] as const) {
      await q.query(`INSERT INTO task_participants (task_id, user_id, role) VALUES ($1, $2, 'watcher') ON CONFLICT DO NOTHING`, [taskId, user]);
    }

    // Архив: одна задача закрыта пять дней назад — уйдёт сама; другую Ольга убрала вчера.
    await task({ title: 'Собрать отзывы первокурсников о приёме', kind: 'task', by: u.olga, to: u.anna, status: 'done', due: -6, created: -14, doneAt: -5, history: [[-14, 'todo'], [-12, 'in_progress'], [-5, 'done']] });
    const letter = await task({ title: 'Обновить шаблон письма абитуриенту', kind: 'task', by: u.olga, to: u.anna, status: 'done', due: -2, created: -7, doneAt: -2, history: [[-7, 'todo'], [-6, 'in_progress'], [-2, 'done']] });
    await q.query(`UPDATE tasks SET archived_at = $2, archived_by = $3 WHERE id = $1`, [letter, at(-1, 12), u.olga]);

    // Ольга включила Анне «Вносить измерения KPI» — в её подразделениях.
    await q.query(`INSERT INTO user_functions (company_id, user_id, fn, allowed, granted_by) VALUES ($1, $2, 'kpi_record', TRUE, $3)`, [demo.companyId, u.anna, u.olga]);
    await inbox(u.anna, u.olga, { kind: 'function_granted', title: 'Вам включили: «Вносить измерения KPI»', body: 'Что и где можно — в профиле, в разделе «Мои функции»' }, 60 * 3);
  });
}
