import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOAL_TEMPLATES, findTemplate, templateDueDate, todayIso } from '@offix/core';
import type { Dashboard, Me } from '../src/lib/types';
import { goalCard, roadmap, TODAY } from './fixtures';
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
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const base = { 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /org/units': [], 'GET /users?search=': [] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('Новая цель: с чего начать', () => {
  it('выбор «С нуля» или «Из шаблона» и галерея всех шаблонов', async () => {
    mockApi(base);
    renderApp('/app/goals/new');
    expect(await screen.findByRole('radiogroup', { name: 'С чего начать' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Из шаблона/ })).toHaveAttribute('aria-checked', 'true');
    for (const t of GOAL_TEMPLATES) expect(screen.getByRole('button', { name: t.title })).toBeInTheDocument();
    const card = screen.getByRole('button', { name: 'Сократить время обработки заявки студента' });
    expect(card).toHaveTextContent('40 → 30 мин');
    expect(card).toHaveTextContent('2 подцели · 6 задач · 90 дней');
  });

  it('«С нуля» открывает мастер', async () => {
    mockApi(base);
    renderApp('/app/goals/new');
    await userEvent.click(await screen.findByRole('radio', { name: /С нуля/ }));
    expect(await screen.findByRole('button', { name: /Шаг 1/ })).toHaveAttribute('aria-current', 'step');
  });

  it('поиск и фильтр по направлению', async () => {
    mockApi(base);
    renderApp('/app/goals/new');
    const search = await screen.findByRole('searchbox', { name: 'Поиск шаблона' });
    await userEvent.type(search, 'договор');
    expect(screen.getByRole('button', { name: 'Сократить срок согласования договоров' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сократить время обработки заявки студента' })).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.click(within(screen.getByRole('group', { name: 'Направление' })).getByRole('button', { name: 'IT и цифровые сервисы' }));
    expect(screen.getByRole('button', { name: 'Сократить срок закрытия заявок в IT' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сократить срок согласования договоров' })).not.toBeInTheDocument();
    await userEvent.type(search, 'абракадабра');
    expect(screen.getByText('Шаблон не найден')).toBeInTheDocument();
  });

  it('начатый черновик мастера открывается сразу, без выбора', async () => {
    sessionStorage.setItem('offix.goal-draft', JSON.stringify({ title: 'Снизить текучесть' }));
    mockApi(base);
    renderApp('/app/goals/new');
    expect(await screen.findByDisplayValue('Снизить текучесть')).toBeInTheDocument();
  });
});

describe('Цель из шаблона', () => {
  const t = findTemplate('application-time')!;

  it('превью: KPI с подсказкой, владелец — я, срок по плану, задачи по подцелям', async () => {
    mockApi(base);
    renderApp('/app/goals/new?template=application-time');
    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
    expect(screen.getByLabelText('Сейчас')).toHaveValue('40');
    expect(screen.getByLabelText('Цель к сроку')).toHaveValue('30');
    expect(screen.getByText(t.kpi.hint)).toBeInTheDocument();
    expect(await screen.findByText('Ольга Смирнова')).toBeInTheDocument();
    expect(screen.getByLabelText(/Срок достижения/)).toHaveValue(templateDueDate(t, todayIso()));
    const plan = screen.getByRole('complementary', { name: 'План шаблона' });
    for (const s of t.subgoals) expect(within(plan).getByText(s.title)).toBeInTheDocument();
    expect(within(plan).getAllByRole('listitem')).toHaveLength(t.tasks.length);
  });

  it('свои цифры и создание черновика: POST apply и переход на карточку', async () => {
    const calls = mockApi({
      ...base,
      'POST /templates/application-time/apply': goalCard({ id: 'tpl1', status: 'draft', title: t.title }),
      'GET /goals/tpl1/roadmap': roadmap({ goal: goalCard({ id: 'tpl1', status: 'draft', title: t.title }) }),
    });
    renderApp('/app/goals/new?template=application-time');
    const now = await screen.findByLabelText('Сейчас');
    await userEvent.clear(now);
    await userEvent.type(now, '52,5');
    await screen.findByText('Ольга Смирнова');
    await userEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ owner_id: 'u-olga', due_at: templateDueDate(t, todayIso()), baseline: 52.5, target: 30 });
    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
  });

  it('цифры не в ту сторону — ошибка у поля, запроса нет', async () => {
    const calls = mockApi(base);
    renderApp('/app/goals/new?template=application-time');
    const goal = await screen.findByLabelText('Цель к сроку');
    await userEvent.clear(goal);
    await userEvent.type(goal, '50');
    await userEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    expect(await screen.findByText(/целевое значение должно быть меньше исходного/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('ошибка сервера показывается у поля', async () => {
    mockApi({ ...base, 'POST /templates/application-time/apply': () => apiError(422, 'Не удалось создать цель из шаблона', { owner_id: 'Нельзя назначить выбранного владельца' }) });
    renderApp('/app/goals/new?template=application-time');
    await screen.findByText('Ольга Смирнова');
    await userEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    expect(await screen.findByText('Нельзя назначить выбранного владельца')).toBeInTheDocument();
    expect(screen.getByText('Не удалось создать цель из шаблона')).toBeInTheDocument();
  });

  it('сотрудник без роли руководителя не может создать цель из шаблона', async () => {
    mockApi({ ...base, 'GET /users/me': { ...ME, role: 'member' } });
    renderApp('/app/goals/new?template=application-time');
    expect(await screen.findByText(/Недостаточно прав/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать черновик' })).toBeDisabled();
  });
});
