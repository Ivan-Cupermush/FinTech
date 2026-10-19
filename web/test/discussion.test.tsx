import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Discussion, DiscussionComment } from '@offix/core';
import type { Dashboard, Me, Member } from '../src/lib/types';
import { roadmap, task, TODAY } from './fixtures';
import { mockApi, renderApp } from './render';

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
const ANNA: Member = { id: 'u-anna', display_name: 'Анна Королёва', position: 'Специалист', email: 'anna@offix.demo', active: true, role: 'member', units: [] };

const comment = (id: string, over: Partial<DiscussionComment> = {}): DiscussionComment => ({
  id,
  parent_id: null,
  body: id,
  author_id: 'u-dima',
  author_name: 'Дмитрий Орлов',
  mention_ids: [],
  created_at: '2026-10-19T09:00:00.000Z',
  ...over,
});

const thread = (over: Partial<Discussion> = {}): Discussion => ({
  comments: [
    comment('c1', { body: 'Доступ к реестру запросили', author_id: 'u-olga', author_name: 'Ольга Смирнова', created_at: '2026-10-18T09:00:00.000Z' }),
    comment('c2', { body: '@Ольга Смирнова, ИБ согласовала', parent_id: 'c1', mention_ids: ['u-olga'], created_at: '2026-10-19T08:00:00.000Z' }),
    comment('c3', { body: 'Пилот в понедельник', created_at: '2026-10-19T09:00:00.000Z' }),
  ],
  unread: 2,
  last_read_at: '2026-10-18T12:00:00.000Z',
  can_comment: true,
  people: [{ id: 'u-olga', display_name: 'Ольга Смирнова' }],
  ...over,
});

const base = { 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /goals/g1/roadmap': roadmap(), 'GET /notes': [] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

async function openDiscussion() {
  renderApp('/app/goals/g1');
  await userEvent.click(await screen.findByRole('tab', { name: /Обсуждение/ }));
  return screen.findByRole('region', { name: 'Обсуждение' });
}

describe('обсуждение цели', () => {
  it('счётчик новых на вкладке', async () => {
    mockApi({ ...base, 'GET /discussions/goal/g1/summary': { total: 3, unread: 2 } });
    renderApp('/app/goals/g1');
    expect(await screen.findByLabelText('новых: 2')).toHaveTextContent('2');
  });

  it('ветка с ответом, «Новые» с места остановки, упоминание меня подсвечено; открытие отмечает прочитанным', async () => {
    const calls = mockApi({ ...base, 'GET /discussions/goal/g1/summary': { total: 3, unread: 2 }, 'GET /discussions/goal/g1': thread(), 'POST /discussions/goal/g1/read': null });
    const region = await openDiscussion();
    expect(await within(region).findByText('Доступ к реестру запросили')).toBeInTheDocument();
    const reply = within(region).getByRole('article', { name: /ИБ согласовала/ });
    expect(reply).toHaveClass('reply');
    expect(within(reply).getByRole('separator')).toHaveTextContent('Новые');
    expect(within(reply).getByText('@Ольга Смирнова')).toHaveClass('dsc-mention', 'me');
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/discussions/goal/g1/read')).toBe(true));
  });

  it('@ показывает сотрудников, выбор подставляет имя, отправка — POST', async () => {
    const calls = mockApi({
      ...base,
      'GET /discussions/goal/g1': thread({ comments: [], unread: 0 }),
      'GET /users': [ANNA],
      'POST /discussions/goal/g1': comment('new'),
    });
    const region = await openDiscussion();
    const box = within(region).getByRole('textbox', { name: 'Комментарий' });
    await userEvent.type(box, '@Ан');
    const list = await screen.findByRole('listbox', { name: 'Кого упомянуть' });
    expect(within(list).getByRole('option', { name: /Анна Королёва/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('@Анна Королёва ');
    await userEvent.type(box, 'посмотрите регламент');
    await userEvent.click(within(region).getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/discussions/goal/g1')?.body).toEqual({ body: '@Анна Королёва посмотрите регламент', parent_id: null }));
  });

  it('ответ на ответ уходит в корень ветки', async () => {
    const calls = mockApi({ ...base, 'GET /discussions/goal/g1': thread({ unread: 0 }), 'POST /discussions/goal/g1': comment('new') });
    const region = await openDiscussion();
    const reply = await within(region).findByRole('article', { name: /ИБ согласовала/ });
    await userEvent.click(within(reply).getByRole('button', { name: /Ответить/ }));
    expect(within(region).getByText(/Ответ:/)).toBeInTheDocument();
    await userEvent.type(within(region).getByRole('textbox', { name: 'Комментарий' }), 'Отлично');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/discussions/goal/g1')?.body).toEqual({ body: 'Отлично', parent_id: 'c1' }));
  });

  it('наблюдатель читает без поля ввода; пустое обсуждение — подсказка', async () => {
    mockApi({ ...base, 'GET /discussions/goal/g1': thread({ comments: [], unread: 0, can_comment: false }) });
    const region = await openDiscussion();
    expect(await within(region).findByText('Обсуждения пока нет')).toBeInTheDocument();
    expect(within(region).queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('обсуждение задачи', () => {
  it('в панели задачи — та же ветка и поле ввода', async () => {
    const calls = mockApi({
      ...base,
      'GET /tasks/t3': { ...task('t3', { title: 'Обучить сотрудников' }), history: [], dependencies: [], participants: [] },
      'GET /discussions/task/t3': thread({ comments: [comment('k1', { body: 'Материалы готовы' })], unread: 0 }),
      'POST /discussions/task/t3': comment('k2'),
    });
    renderApp('/app/goals/g1');
    await userEvent.click((await screen.findAllByText('Обучить сотрудников'))[0]!);
    const region = await screen.findByRole('region', { name: 'Обсуждение' });
    expect(await within(region).findByText('Материалы готовы')).toBeInTheDocument();
    await userEvent.type(within(region).getByRole('textbox', { name: 'Комментарий' }), 'Спасибо');
    await userEvent.click(within(region).getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/discussions/task/t3')?.body).toEqual({ body: 'Спасибо', parent_id: null }));
  });
});
