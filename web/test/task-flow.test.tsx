import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, DELEGABLE_FUNCTIONS, todayIso, type Checkpoint, type Discussion, type FunctionDetail, type Member, type PersonCard, type TaskDetail } from '@offix/core';
import type { Dashboard, Me, Notification, Task } from '../src/lib/types';
import { lastSocket } from './fake-socket';
import { task } from './fixtures';
import { apiError, mockApi, renderApp } from './render';

const today = todayIso();
const ME: Me = {
  id: 'u-olga',
  email: 'olga@offix.demo',
  display_name: 'Ольга Смирнова',
  position: 'Руководитель офиса',
  role: 'manager',
  company_id: 'c1',
  company_name: 'Демо-университет',
  setup_mode: 'structured',
  units: [],
};
const DASH: Dashboard = { today, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const discussion: Discussion = { comments: [], unread: 0, last_read_at: null, can_comment: true, people: [] };
const base = { 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /files/avatars': [], 'GET /contacts/names': [] };
const members: Member[] = [
  { id: 'u-olga', display_name: 'Ольга Смирнова', position: 'Руководитель офиса', email: 'olga@offix.demo', active: true, role: 'manager', units: [] },
  { id: 'u-igor', display_name: 'Игорь Лебедев', position: 'Руководитель IT', email: 'igor@offix.demo', active: true, role: 'manager', units: [] },
  { id: 'u-anna', display_name: 'Анна Королёва', position: 'Специалист приёмной комиссии', email: 'anna@offix.demo', active: true, role: 'member', units: [] },
];

const detail = (t: Task, over: Partial<TaskDetail> = {}): TaskDetail => ({ ...t, checkpoints: [], history: [], dependencies: [], participants: [], files: [], ...over }) as TaskDetail;
const cp = (id: string, over: Partial<Checkpoint> = {}): Checkpoint => ({ id, title: `Точка ${id}`, due_at: addDays(today, 3), status: 'pending', done_at: null, done_by_name: null, ...over });
const panelRoutes = (id: string) => ({ [`GET /discussions/task/${id}`]: discussion, [`GET /discussions/task/${id}/summary`]: { total: 0, unread: 0 } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('список задач', () => {
  it('светофор: у строки цвет и объяснение, красные — выше', async () => {
    mockApi({
      ...base,
      'GET /tasks?mine=1': [
        task('g', { title: 'Обучить сотрудников', status: 'in_progress', due_at: addDays(today, 20) }),
        task('y', { title: 'Собрать отзывы', status: 'in_progress', due_at: addDays(today, -2) }),
        task('r', { title: 'Подключить API', status: 'blocked', blocker: { reason: 'technical', note: null, since: `${addDays(today, -4)}T09:00:00Z`, next_step: null } }),
      ],
    });
    renderApp('/app/tasks');
    expect(await screen.findByRole('img', { name: 'Критичный риск: Заблокирована 4 дня: техническая проблема' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Есть риск: Просрочена на 2 дня' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Идёт по плану: Срок / })).toBeInTheDocument();
  });

  it('вкладки: мои просьбы, наблюдаю и архив — свои запросы и пустые состояния', async () => {
    const calls = mockApi({
      ...base,
      'GET /tasks?mine=1': [],
      'GET /tasks?created=1&kind=request': [task('q', { title: 'Подписать приказ', kind: 'request', created_by: 'u-olga', created_by_name: 'Ольга Смирнова', checkpoints: [{ id: 'c1', title: 'Черновик', due_at: today, status: 'done' }, { id: 'c2', title: 'Подпись', due_at: addDays(today, 2), status: 'pending' }] })],
      'GET /tasks?watching=1': [],
      'GET /tasks?archived=1': [task('a', { title: 'Старый отчёт', status: 'done', archived: { at: `${addDays(today, -1)}T10:00:00Z`, by_name: null } })],
    });
    renderApp('/app/tasks');
    await userEvent.click(await screen.findByRole('tab', { name: 'Мои просьбы' }));
    expect(await screen.findByText('Подписать приказ')).toBeInTheDocument();
    expect(screen.getByText('Просьба')).toBeInTheDocument();
    expect(screen.getByTitle('Контрольные точки')).toHaveTextContent('1/2');
    await userEvent.click(screen.getByRole('tab', { name: 'Наблюдаю' }));
    expect(await screen.findByText('Вы ни за чем не наблюдаете')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Архив' }));
    expect(await screen.findByText('Старый отчёт')).toBeInTheDocument();
    expect(screen.getByText('Убрана в архив вчера автоматически — через 3 дня после закрытия')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Вид' })).not.toBeInTheDocument();
    expect(calls.map((c) => c.path).filter((p) => p.startsWith('/tasks'))).toEqual(['/tasks?mine=1', '/tasks?created=1&kind=request', '/tasks?watching=1', '/tasks?archived=1']);
  });

  it('календарь: сроки по дням, просроченные отдельно, клик по дню — его задачи', async () => {
    mockApi({
      ...base,
      'GET /tasks?mine=1': [
        task('a', { title: 'Сверить списки', status: 'in_progress', due_at: today }),
        task('b', { title: 'Отправить письма', status: 'todo', due_at: addDays(today, 2) }),
        task('c', { title: 'Старый долг', status: 'in_progress', due_at: addDays(today, -3) }),
        task('d', { title: 'Через месяц', status: 'todo', due_at: addDays(today, 40) }),
      ],
    });
    renderApp('/app/tasks');
    await screen.findByText('Сверить списки');
    await userEvent.click(screen.getByRole('tab', { name: /Календарь/ }));
    expect(await screen.findByRole('region', { name: 'Календарь задач' })).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Сроки' });
    expect(within(list).getByRole('heading', { name: 'Ближайшая неделя' })).toBeInTheDocument();
    expect(within(list).getByText('Просрочены')).toBeInTheDocument();
    expect(within(list).getByText('Старый долг')).toBeInTheDocument();
    expect(within(list).getByText('Отправить письма')).toBeInTheDocument();
    expect(within(list).queryByText('Через месяц')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('gridcell', { current: 'date' }));
    expect(within(list).getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument();
    expect(within(list).getByText('Сверить списки')).toBeInTheDocument();
    expect(within(list).queryByText('Отправить письма')).not.toBeInTheDocument();
  });
});

describe('просьба коллеге', () => {
  it('проверяет форму и отправляет просьбу с контрольной точкой', async () => {
    const calls = mockApi({
      ...base,
      'GET /tasks?mine=1': [],
      'GET /tasks?created=1&kind=request': [],
      'GET /users': [...members, { id: 'u-rector', display_name: 'Ректорат', position: 'Наблюдатель', email: 'rector@offix.demo', active: true, role: 'observer', units: [] }],
      'POST /tasks': (c: { body: unknown }) => task('n', { ...(c.body as Partial<Task>), kind: 'request' }),
    });
    renderApp('/app/tasks');
    await userEvent.click(await screen.findByRole('button', { name: 'Попросить коллегу' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая просьба' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить просьбу' }));
    expect(within(dialog).getByText('Выберите, кого просите')).toBeInTheDocument();
    expect(within(dialog).getByText('Напишите, о чём просите')).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /Ольга Смирнова/ })).not.toBeInTheDocument();
    await userEvent.click(await within(dialog).findByRole('option', { name: /Игорь Лебедев/ }));
    // Наблюдателю работу не поручить — в списке его нет.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Изменить' }));
    expect(within(dialog).queryByRole('option', { name: /Ректорат/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('option', { name: /Игорь Лебедев/ }));
    await userEvent.type(within(dialog).getByLabelText(/О чём просите/), 'Выдать доступ к справочнику');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    await userEvent.type(within(dialog).getByLabelText('Контрольная точка 1'), 'Заявка в IT');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Завтра' }));
    expect(within(dialog).getByRole('button', { name: 'Завтра' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить просьбу' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/tasks')?.body).toEqual({
        kind: 'request',
        title: 'Выдать доступ к справочнику',
        description: null,
        assignee_id: 'u-igor',
        due_at: addDays(today, 1),
        checkpoints: [{ title: 'Заявка в IT', due_at: today }],
      }),
    );
    expect(await screen.findByText('Просьба отправлена — Игорь Лебедев увидит её во «Входящих»')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Мои просьбы' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ошибку сервера показывает у поля', async () => {
    mockApi({ ...base, 'GET /tasks?mine=1': [], 'GET /users': members, 'POST /tasks': () => apiError(422, 'Не удалось сохранить задачу', { title: 'Название — не длиннее 200 символов' }) });
    renderApp('/app/tasks');
    await userEvent.click(await screen.findByRole('button', { name: 'Попросить коллегу' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая просьба' });
    await userEvent.click(await within(dialog).findByRole('option', { name: /Анна Королёва/ }));
    await userEvent.type(within(dialog).getByLabelText(/О чём просите/), 'Проверить');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить просьбу' }));
    expect(await within(dialog).findByText('Название — не длиннее 200 символов')).toBeInTheDocument();
  });

  it('с карточки коллеги просьба уходит ему', async () => {
    const person: PersonCard = { id: 'u-igor', display_name: 'Игорь Лебедев', my_name: null, position: 'Руководитель IT', email: 'igor@offix.demo', avatar_url: null, role: 'manager', active: true, units: [], online: false, last_seen_at: null, is_me: false };
    const calls = mockApi({ ...base, 'GET /contacts/u-igor': person, 'GET /contacts/u-igor/groups': [], 'GET /functions/users/u-igor': () => apiError(404, 'Сотрудник не найден'), 'GET /users': members, 'POST /tasks': task('n', { kind: 'request' }) });
    renderApp('/app/people/u-igor');
    await userEvent.click(await screen.findByRole('button', { name: 'Попросить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая просьба' });
    expect(await within(dialog).findByText('Игорь Лебедев')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/О чём просите/), 'Посмотреть сервер');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить просьбу' }));
    await waitFor(() => expect((calls.find((c) => c.method === 'POST')?.body as { assignee_id: string }).assignee_id).toBe('u-igor'));
    expect(screen.queryByRole('region', { name: 'Функции' })).not.toBeInTheDocument();
  });
});

describe('карточка задачи', () => {
  it('выполненная просьба: «Спасибо» один раз, приёмки у просьбы нет', async () => {
    const done = task('q', { title: 'Подписать приказ', kind: 'request', status: 'done', created_by: 'u-olga', created_by_name: 'Ольга Смирнова', assignee: { id: 'u-igor', display_name: 'Игорь Лебедев' } });
    let current = done;
    const calls = mockApi({
      ...base,
      ...panelRoutes('q'),
      'GET /tasks?mine=1': [done],
      'GET /tasks/q': () => detail(current),
      'POST /tasks/q/thanks': () => {
        current = { ...done, thanked_at: `${today}T10:00:00Z` };
        return current;
      },
    });
    renderApp('/app/tasks');
    await userEvent.click(await screen.findByText('Подписать приказ'));
    const panel = await screen.findByRole('dialog', { name: 'Подписать приказ' });
    expect(await within(panel).findByText('Игорь Лебедев выполнил(а) вашу просьбу')).toBeInTheDocument();
    expect(within(panel).getByText('Ваша просьба')).toBeInTheDocument();
    // Закрытую можно вернуть в работу, а новые точки в ней уже не ставят.
    expect(within(panel).getByRole('button', { name: 'Вернуть в работу' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Взять в работу' })).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText('Новая контрольная точка')).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Спасибо' }));
    expect(await within(panel).findByText(/^Вы поблагодарили/)).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Спасибо' })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/tasks/q/thanks')).toHaveLength(1);
  });

  it('просьба в работе: «Выполнено» сразу, без «На приёмку»; светофор с причиной', async () => {
    const t = task('q', { title: 'Выдать доступ', kind: 'request', status: 'in_progress', due_at: addDays(today, -1), created_by: 'u-igor', created_by_name: 'Игорь Лебедев', assignee: { id: 'u-olga', display_name: 'Ольга Смирнова' } });
    mockApi({ ...base, ...panelRoutes('q'), 'GET /tasks?mine=1': [t], 'GET /tasks/q': detail(t) });
    renderApp('/app/tasks');
    expect(await screen.findByText(/просит Игорь Лебедев/)).toBeInTheDocument();
    await userEvent.click(await screen.findByText('Выдать доступ'));
    const panel = await screen.findByRole('dialog', { name: 'Выдать доступ' });
    expect(await within(panel).findByRole('button', { name: 'Выполнено' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'На приёмку' })).not.toBeInTheDocument();
    expect(within(panel).getByText('Вас просят')).toBeInTheDocument();
    expect(within(panel).getByText('Есть риск')).toBeInTheDocument();
    expect(within(panel).getByText(/Просрочена на 1 день/)).toBeInTheDocument();
    expect(within(panel).queryByText('Наблюдатели')).not.toBeInTheDocument();
  });

  it('контрольные точки: отметить, сорвать просроченную, добавить и убрать', async () => {
    const t = task('t', { title: 'Запустить пилот', status: 'in_progress', due_at: addDays(today, 10) });
    let cps = [cp('c1', { title: 'Макет формы' }), cp('c2', { title: 'Данные', due_at: addDays(today, -1) })];
    const calls = mockApi({
      ...base,
      ...panelRoutes('t'),
      'GET /tasks?mine=1': [t],
      'GET /tasks/t': () => detail(t, { checkpoints: cps }),
      'PATCH /tasks/t/checkpoints/c1': () => {
        cps = cps.map((c) => (c.id === 'c1' ? { ...c, status: 'done', done_by_name: 'Ольга Смирнова' } : c));
        return cps;
      },
      'PATCH /tasks/t/checkpoints/c2': () => {
        cps = cps.map((c) => (c.id === 'c2' ? { ...c, status: 'missed' } : c));
        return cps;
      },
      'POST /tasks/t/checkpoints': (c: { body: unknown }) => {
        cps = [...cps, cp('c3', c.body as Partial<Checkpoint>)];
        return cps;
      },
      'DELETE /tasks/t/checkpoints/c3': () => {
        cps = cps.filter((c) => c.id !== 'c3');
        return null;
      },
    });
    renderApp('/app/tasks');
    await userEvent.click(await screen.findByText('Запустить пилот'));
    const panel = await screen.findByRole('dialog', { name: 'Запустить пилот' });
    expect(await within(panel).findByText(/Контрольная точка не пройдена в срок/)).toBeInTheDocument();
    expect(within(panel).getByText(/^Срок прошёл ·/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Отметить пройденной: Макет формы' }));
    expect(await within(panel).findByText('Отметил(а) Ольга Смирнова')).toBeInTheDocument();
    expect(within(panel).getByText('1 из 2')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Сорвана' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/tasks/t/checkpoints/c2')?.body).toEqual({ status: 'missed' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Добавить' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('Назовите контрольную точку');
    await userEvent.type(within(panel).getByLabelText('Новая контрольная точка'), 'Итоги пилота');
    await userEvent.click(within(panel).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/tasks/t/checkpoints')?.body).toEqual({ title: 'Итоги пилота', due_at: today }));
    await userEvent.click(await within(panel).findByRole('button', { name: 'Убрать точку «Итоги пилота»' }));
    await waitFor(() => expect(within(panel).queryByText('Итоги пилота')).not.toBeInTheDocument());
  });

  it('наблюдатель отмечает точки, но статус не меняет', async () => {
    const t = task('t', { title: 'Обучить сотрудников', status: 'in_progress', permissions: { view: true, edit: false, status: false, mark: true } });
    mockApi({ ...base, ...panelRoutes('t'), 'GET /tasks?watching=1': [t], 'GET /tasks?mine=1': [], 'GET /tasks/t': detail(t, { checkpoints: [cp('c1')], participants: [{ user_id: 'u-olga', role: 'watcher', display_name: 'Ольга Смирнова' }] }) });
    renderApp('/app/tasks?scope=watching');
    await userEvent.click(await screen.findByText('Обучить сотрудников'));
    const panel = await screen.findByRole('dialog', { name: 'Обучить сотрудников' });
    expect(await within(panel).findByRole('checkbox', { name: 'Отметить пройденной: Точка c1' })).toBeEnabled();
    expect(within(panel).queryByRole('button', { name: 'Выполнено' })).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText('Новая контрольная точка')).not.toBeInTheDocument();
    expect(within(panel).getByText('Наблюдатели')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Изменить наблюдателей' })).not.toBeInTheDocument();
  });

  it('наблюдатели: автор выбирает людей, исполнителя выбрать нельзя', async () => {
    const t = task('t', { title: 'Обучить сотрудников', status: 'todo' });
    const calls = mockApi({ ...base, ...panelRoutes('t'), 'GET /users': members, 'GET /tasks?mine=1': [t], 'GET /tasks/t': detail(t), 'PUT /tasks/t/watchers': t });
    renderApp('/app/tasks');
    await userEvent.click(await screen.findByText('Обучить сотрудников'));
    const panel = await screen.findByRole('dialog', { name: 'Обучить сотрудников' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Добавить наблюдателей' }));
    const dialog = await screen.findByRole('dialog', { name: 'Наблюдатели' });
    expect(await within(dialog).findByRole('checkbox', { name: /Анна Королёва/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Игорь Лебедев/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ user_ids: ['u-igor'] }));
  });

  it('архив: убрать выполненную и вернуть обратно', async () => {
    let t = task('t', { title: 'Старый отчёт', status: 'done' });
    const calls = mockApi({
      ...base,
      ...panelRoutes('t'),
      'GET /tasks?mine=1': [t],
      'GET /tasks/t': () => detail(t),
      'POST /tasks/t/archive': () => {
        t = { ...t, archived: { at: `${today}T10:00:00Z`, by_name: 'Ольга Смирнова' } };
        return t;
      },
      'POST /tasks/t/unarchive': () => {
        t = { ...t, archived: null };
        return t;
      },
    });
    renderApp('/app/tasks');
    await userEvent.click(await screen.findByText('Старый отчёт'));
    const panel = await screen.findByRole('dialog', { name: 'Старый отчёт' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Убрать в архив' }));
    expect(await within(panel).findByText('Убрана в архив сегодня · Ольга Смирнова')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(within(panel).queryByText(/Убрана в архив/)).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/tasks/t/archive', '/tasks/t/unarchive']);
  });
});

describe('входящие: просьбы', () => {
  const n = (id: string, over: Partial<Notification>): Notification => ({ id, kind: 'task_request', title: 'Игорь Лебедев просит: «Подписать приказ»', body: null, goal_id: null, task_id: 'q', read_at: null, created_at: `${today}T09:00:00.000Z`, actor_id: 'u-igor', actor_name: 'Игорь Лебедев', ...over });

  it('«Взять в работу» и «Спасибо» прямо из ленты; подписи вместо кнопок', async () => {
    const calls = mockApi({
      ...base,
      'GET /notifications': [
        n('1', { task_state: { kind: 'request', status: 'todo', thanked: false, mine: false, assignee: true } }),
        n('2', { kind: 'task_done', title: 'Просьба выполнена: «Выдать доступ»', task_id: 'w', task_state: { kind: 'request', status: 'done', thanked: false, mine: true, assignee: false } }),
        n('3', { kind: 'task_request', title: 'Анна просит: «Проверить список»', task_id: 'z', read_at: `${today}T10:00:00Z`, task_state: { kind: 'request', status: 'done', thanked: true, mine: false, assignee: true } }),
      ],
      'POST /tasks/q/status': task('q', { status: 'in_progress' }),
      'POST /tasks/w/thanks': task('w'),
      'POST /notifications/read': null,
      'GET /push/settings': { muted: [], quiet_hours: true, devices: 0 },
    });
    renderApp('/app/notifications');
    expect(await screen.findByText('Выполнено · вас поблагодарили')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/tasks/q/status')?.body).toEqual({ status: 'in_progress' }));
    expect(await screen.findByText('Взяли в работу — автор увидит')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Спасибо' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/tasks/w/thanks')).toBe(true));
    expect(calls.filter((c) => c.path === '/notifications/read').map((c) => c.body)).toEqual([{ ids: ['1'] }, { ids: ['2'] }]);
  });
});

describe('живые уведомления', () => {
  it('просьба коллеги всплывает тостом и обновляет список задач; прочее — молча', async () => {
    let tasks: Task[] = [];
    const calls = mockApi({ ...base, 'GET /tasks?mine=1': () => tasks });
    renderApp('/app/tasks');
    expect(await screen.findByText('Задач нет')).toBeInTheDocument();
    await waitFor(() => expect(() => lastSocket()).not.toThrow());
    tasks = [task('q', { title: 'Подписать приказ', kind: 'request' })];
    lastSocket().receive('notification', { kind: 'task_request', title: 'Игорь Лебедев просит: «Подписать приказ»' });
    expect(await screen.findByText('Игорь Лебедев просит: «Подписать приказ»')).toBeInTheDocument();
    expect(await screen.findByText('Подписать приказ')).toBeInTheDocument();
    lastSocket().receive('notification', { kind: 'note_request', title: 'Запрос заметки' });
    await waitFor(() => expect(calls.filter((c) => c.path === '/tasks?mine=1').length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText('Запрос заметки')).not.toBeInTheDocument();
  });
});

describe('функции сотрудника', () => {
  const fn = (key: FunctionDetail['key'], over: Partial<FunctionDetail> = {}): FunctionDetail => {
    const labels: Record<FunctionDetail['key'], string> = Object.fromEntries(DELEGABLE_FUNCTIONS.map((f) => [f.key, f.label])) as Record<FunctionDetail['key'], string>;
    return { key, label: labels[key], hint: '', default: false, override: null, enabled: false, where: null, locked: false, ...over };
  };
  const anna: PersonCard = { id: 'u-anna', display_name: 'Анна Королёва', my_name: null, position: 'Специалист', email: 'anna@offix.demo', avatar_url: null, role: 'member', active: true, units: [], online: false, last_seen_at: null, is_me: false };

  it('руководитель включает подчинённой функцию и возвращает «по должности»', async () => {
    let view = { functions: [fn('kpi_record'), fn('kpi_assign'), fn('knowledge_manage')], can_change: true, reason: null };
    const calls = mockApi({
      ...base,
      'GET /contacts/u-anna': anna,
      'GET /contacts/u-anna/groups': [],
      'GET /functions/users/u-anna': () => view,
      'PUT /functions/users/u-anna': (c: { body: unknown }) => {
        const v = (c.body as { changes: Record<string, boolean | null> }).changes.kpi_record;
        view = { ...view, functions: [fn('kpi_record', { enabled: !!v, override: v, where: v ? 'units' : null }), fn('kpi_assign'), fn('knowledge_manage')] };
        return view;
      },
    });
    renderApp('/app/people/u-anna');
    const card = await screen.findByRole('region', { name: 'Функции' });
    const sw = await within(card).findByRole('switch', { name: 'Вносить измерения KPI' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(within(card).getByText('Включено руководителем · в подразделениях руководителя')).toBeInTheDocument();
    expect(await screen.findByText('Анна узнает, что функцию включили')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Вернуть по должности — выключено' }));
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([{ changes: { kpi_record: true } }, { changes: { kpi_record: null } }]);
  });

  it('отказ сервера — тостом; у администратора переключатели заблокированы', async () => {
    mockApi({
      ...base,
      'GET /contacts/u-anna': anna,
      'GET /contacts/u-anna/groups': [],
      'GET /functions/users/u-anna': { functions: [fn('kpi_record'), fn('knowledge_manage', { locked: true, enabled: true, where: 'company' })], can_change: true, reason: null },
      'PUT /functions/users/u-anna': () => apiError(403, 'Нельзя включить функцию, которой нет у вас: «Вносить измерения KPI»'),
    });
    renderApp('/app/people/u-anna');
    expect(await screen.findByRole('switch', { name: 'Вести базу знаний' })).toBeDisabled();
    expect(screen.getByText('Всегда включено у администраторов')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Вносить измерения KPI' }));
    expect(await screen.findByText('Нельзя включить функцию, которой нет у вас: «Вносить измерения KPI»')).toBeInTheDocument();
  });

  it('в профиле — «Мои функции» без переключателей', async () => {
    mockApi({
      ...base,
      'GET /account': { id: 'u-olga', email: 'olga@offix.demo', display_name: 'Ольга Смирнова', position: null, avatar_url: null, role: 'manager', company_name: 'Демо', last_login_at: null, password_changed_at: null, joined_at: '2026-09-01T08:00:00.000Z' },
      'GET /functions/me': { functions: [fn('kpi_record', { default: true, enabled: true, where: 'units' }), fn('knowledge_manage')], can_change: false, reason: 'Свои функции включает руководитель' },
    });
    renderApp('/app/profile');
    const card = await screen.findByRole('region', { name: 'Мои функции' });
    expect(await within(card).findByText('По должности · в подразделениях руководителя')).toBeInTheDocument();
    expect(within(card).getByLabelText('Включено')).toBeInTheDocument();
    expect(within(card).getByLabelText('Выключено')).toBeInTheDocument();
    expect(within(card).queryByRole('switch')).not.toBeInTheDocument();
  });
});
