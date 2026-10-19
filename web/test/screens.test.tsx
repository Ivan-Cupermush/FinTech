import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kpiProgress } from '@offix/core';
import type { Dashboard, Me } from '../src/lib/types';
import { KpiTrack } from '../src/ui/KpiTrack';
import { goalCard, metric, roadmap, task, TODAY } from './fixtures';
import { apiError, mockApi, renderApp } from './render';

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

const DASH: Dashboard = {
  today: TODAY,
  goals: [{ id: 'g1', title: 'Сократить время согласования заявки', type: 'strategic', due_at: '2026-12-31', primary_metric: metric(), progress: 35, task_progress: { done: 1, total: 3 }, risk_level: 'critical' }],
  risks: [{ ...roadmap().risks[0]!, severity: 'critical', goal_id: 'g1', goal_title: 'Сократить время согласования заявки' }],
  my_tasks: [task('t3', { title: 'Обучить сотрудников' })],
  help_needed: [task('t2', { title: 'Подключить API', status: 'blocked', blocker: { reason: 'technical', note: 'Нет доступа', since: '2026-10-16T09:00:00Z', next_step: null } })],
  unread_notifications: 2,
  drafts: [{ id: 'g9', title: 'Повысить NPS' }],
};

const base = { 'GET /users/me': ME, 'GET /dashboard': DASH };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('KpiTrack', () => {
  it('показывает путь «было → сейчас → цель»', () => {
    render(<KpiTrack baseline={40} target={30} current={36.5} unit="minutes" progress={kpiProgress({ baseline: 40, target: 30, direction: 'decrease' }, 36.5)} name="Время" />);
    const g = screen.getByRole('group');
    expect(g).toHaveAccessibleName(/Время: 36,5 мин, цель 30 мин/);
    expect(g).toHaveTextContent('40');
    expect(g).toHaveTextContent('36,5');
  });
  it('без замеров — «Нет данных», а не 0%', () => {
    render(<KpiTrack baseline={12} target={10} current={null} unit="days" progress={kpiProgress({ baseline: 12, target: 10, direction: 'decrease' }, null)} name="Договор" />);
    expect(screen.getByRole('group')).toHaveTextContent(/Нет данных/);
    expect(screen.getByRole('group')).not.toHaveTextContent('0%');
  });
});

describe('Пульс', () => {
  it('приветствует, показывает цели, критичные риски и кому нужна помощь', async () => {
    mockApi(base);
    renderApp('/app');
    expect(await screen.findByRole('heading', { level: 1, name: /Ольга/ })).toBeInTheDocument();
    expect(screen.getByText('1 вопрос требует решения сегодня.')).toBeInTheDocument();
    expect(screen.getAllByText('Сократить время согласования заявки').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /Кому нужна помощь/ })).toBeInTheDocument();
    expect(screen.getByText(/Технические проблемы|Нет доступа/)).toBeInTheDocument();
    expect(screen.getByText('Повысить NPS')).toBeInTheDocument();
  });
  it('пустая компания видит приглашение создать первую цель', async () => {
    mockApi({ ...base, 'GET /dashboard': { ...DASH, goals: [], risks: [], my_tasks: [], help_needed: [], drafts: [] } });
    renderApp('/app');
    expect(await screen.findByText('Начните с одной измеримой цели')).toBeInTheDocument();
    expect(screen.getByText('Всё под контролем')).toBeInTheDocument();
  });
  it('без токена отправляет на вход', async () => {
    mockApi(base);
    renderApp('/app', { token: null });
    expect(await screen.findByRole('button', { name: /Войти/ })).toBeInTheDocument();
  });
});

describe('Вход', () => {
  it('пустые поля подсвечиваются без запроса на сервер', async () => {
    const calls = mockApi({});
    renderApp('/login', { token: null });
    await userEvent.click(await screen.findByRole('button', { name: /^Войти/ }));
    expect(screen.getByText('Введите почту')).toBeInTheDocument();
    expect(screen.getByText('Введите пароль')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
  it('неверный пароль — понятное сообщение, форма остаётся', async () => {
    mockApi({ 'POST /auth/login': apiError(401, 'Неверная почта или пароль') });
    renderApp('/login', { token: null });
    await userEvent.type(await screen.findByLabelText('Почта'), 'olga@offix.demo');
    await userEvent.type(screen.getByLabelText('Пароль'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /^Войти/ }));
    expect(await screen.findByText('Неверная почта или пароль')).toBeInTheDocument();
    expect(screen.getByLabelText('Почта')).toHaveValue('olga@offix.demo');
  });
  it('успешный вход ведёт в Пульс', async () => {
    mockApi({ ...base, 'POST /auth/login': { token: 'new-token' } });
    renderApp('/login', { token: null });
    await userEvent.type(await screen.findByLabelText('Почта'), 'olga@offix.demo');
    await userEvent.type(screen.getByLabelText('Пароль'), 'offix-demo');
    await userEvent.click(screen.getByRole('button', { name: /^Войти/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /Ольга/ })).toBeInTheDocument();
    expect(localStorage.getItem('offix.token')).toBe('new-token');
  });
});

describe('Мастер цели', () => {
  it('не пускает на шаг 2 без названия и показывает ошибку у поля', async () => {
    mockApi({ ...base, 'GET /org/units': [], 'GET /users?search=': [] });
    renderApp('/app/goals/new?from=scratch');
    await userEvent.click(await screen.findByRole('button', { name: /Далее/ }));
    expect(screen.getByRole('button', { name: /Шаг 1/ })).toHaveAttribute('aria-current', 'step');
    expect(await screen.findByText(/Введите название|Сформулируйте/)).toBeInTheDocument();
  });
  it('считает плановое изменение KPI и подсказывает, что это не прогресс', async () => {
    mockApi({ ...base, 'GET /org/units': [], 'GET /users?search=': [] });
    renderApp('/app/goals/new?from=scratch');
    await userEvent.type(await screen.findByLabelText(/Сейчас/), '40');
    await userEvent.type(screen.getByLabelText(/Цель к сроку/), '30');
    expect((await screen.findAllByText(/−25\s%/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Это план, а не достижение/)).toBeInTheDocument();
  });
  it('подсказывает, если название звучит как задача', async () => {
    mockApi({ ...base, 'GET /org/units': [], 'GET /users?search=': [] });
    renderApp('/app/goals/new?from=scratch');
    await userEvent.type(await screen.findByLabelText(/^Название цели/), 'Провести анализ процессов');
    expect(await screen.findByText(/Похоже на задачу/)).toBeInTheDocument();
  });
  it('черновик сохраняется и ведёт на карточку цели', async () => {
    const calls = mockApi({ ...base, 'GET /org/units': [], 'GET /users?search=': [], 'POST /goals': goalCard({ id: 'new1', status: 'draft' }), 'GET /goals/new1/roadmap': roadmap({ goal: goalCard({ id: 'new1', status: 'draft' }) }) });
    renderApp('/app/goals/new?from=scratch');
    await userEvent.type(await screen.findByLabelText(/^Название цели/), 'Сократить время согласования');
    await userEvent.click(screen.getByRole('radio', { name: /Операционная/ }));
    await userEvent.click(screen.getByRole('button', { name: /Сохранить черновик/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/goals')).toBe(true));
    const post = calls.find((c) => c.path === '/goals')!;
    expect(post.body).toMatchObject({ title: 'Сократить время согласования', status: 'draft', type: 'operational' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Сократить время согласования заявки' })).toBeInTheDocument();
  });
});

describe('Карточка цели', () => {
  it('черновик показывает, чего не хватает для запуска; кнопка недоступна', async () => {
    const draft = goalCard({
      status: 'draft',
      metrics: [],
      checklist: [
        { key: 'title', label: 'Название результата', done: true },
        { key: 'kpi', label: 'Измеримый KPI', done: false },
      ],
    });
    mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap({ goal: draft, risks: [] }) });
    renderApp('/app/goals/g1');
    expect(await screen.findByText('Чтобы запустить цель')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Запустить цель/ })).toBeDisabled();
    expect(screen.getByText('KPI не задан')).toBeInTheDocument();
  });
  it('перенос сроков применяется только после подтверждения', async () => {
    const calls = mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap(), 'POST /goals/g1/reschedule': { updated: 1 } });
    renderApp('/app/goals/g1');
    await userEvent.click(await screen.findByRole('button', { name: 'Посмотреть перенос сроков' }));
    const dialog = screen.getByRole('dialog', { name: 'Перенести сроки' });
    expect(within(dialog).getByText('Обучить сотрудников')).toBeInTheDocument();
    expect(within(dialog).getByText('+4 дн.')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/reschedule'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Применить перенос' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/reschedule'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/reschedule'))!.body).toEqual({ changes: [{ task_id: 't3', start_at: '2026-10-21', due_at: '2026-10-28' }] });
  });
  it('внесение факта: проверка числа и единиц до отправки', async () => {
    const calls = mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap(), 'POST /goals/g1/metrics/m1/observations': { id: 'o1' } });
    renderApp('/app/goals/g1');
    await userEvent.click(await screen.findByRole('button', { name: 'Внести значение' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText(/Значение/);
    await userEvent.type(input, '-5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(within(dialog).getByText(/не может быть отрицательным/)).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '35,5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/observations'))?.body).toEqual({ value: 35.5 }));
  });
  it('таймлайн и аналитика переключаются', async () => {
    mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap() });
    renderApp('/app/goals/g1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Таймлайн' }));
    expect(screen.getByRole('region', { name: 'Таймлайн задач' })).toBeInTheDocument();
    expect(screen.getByText('Предложенный перенос')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Аналитика' }));
    expect(screen.getByText('Где теряется время')).toBeInTheDocument();
    expect(screen.getByText('Ожидание проверки')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });
  it('нет доступа — «Цель не найдена», без подробностей', async () => {
    mockApi({ ...base, 'GET /goals/zzz/roadmap': apiError(404, 'Цель не найдена') });
    renderApp('/app/goals/zzz');
    expect(await screen.findByRole('heading', { name: 'Цель не найдена' })).toBeInTheDocument();
  });
  it('наблюдатель не видит кнопок изменения', async () => {
    const ro = goalCard({ permissions: { edit: false, manage: false, activate: false, record: false, audit: false } });
    mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap({ goal: ro }) });
    renderApp('/app/goals/g1');
    await screen.findByRole('heading', { level: 1, name: ro.title });
    expect(screen.queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Внести значение' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Посмотреть перенос сроков' })).not.toBeInTheDocument();
  });
});

describe('Задачи', () => {
  it('группирует по срочности и ищет по названию', async () => {
    mockApi({ ...base, 'GET /tasks?mine=1': [task('a', { title: 'Подключить API', status: 'blocked', blocker: { reason: 'technical', note: null, since: '2026-10-16T00:00:00Z', next_step: null } }), task('b', { title: 'Обучить сотрудников' })] });
    renderApp('/app/tasks');
    expect(await screen.findByRole('heading', { name: 'Заблокированы' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'К выполнению' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Поиск задач'), 'обуч');
    expect(screen.queryByRole('heading', { name: 'Заблокированы' })).not.toBeInTheDocument();
    expect(screen.getByText('Обучить сотрудников')).toBeInTheDocument();
  });
});

describe('Лендинг', () => {
  it('объясняет продукт и ведёт в демо', () => {
    mockApi({});
    renderApp('/', { token: null });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Цели, которые\s*двигают цифры/);
    expect(screen.getAllByRole('link', { name: /Открыть демо/ })[0]).toHaveAttribute('href', '/login');
    expect(screen.getByText('Задача заблокирована')).toBeInTheDocument();
  });
});
