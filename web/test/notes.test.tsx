import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteSummary } from '@offix/core';
import type { Dashboard, Me } from '../src/lib/types';
import { roadmap, TODAY } from './fixtures';
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
const base = { 'GET /users/me': ME, 'GET /dashboard': DASH };

const summary = (id: string, over: Partial<NoteSummary> = {}): NoteSummary => ({ id, title: `Заметка ${id}`, excerpt: 'Отрывок', goal_id: null, goal_title: null, author_name: 'Ольга Смирнова', updated_at: '2026-10-18T10:00:00.000Z', ...over });
const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'Как мы считаем KPI',
  body: '## Правило\n\n- замер **раз в неделю**\n- [x] источник согласован\n\n[СЭД](https://sed.example) и [плохая](javascript:alert(1))\n\n<script>alert(1)</script>',
  goal_id: null,
  goal_title: null,
  author_id: 'u-olga',
  author_name: 'Ольга Смирнова',
  updated_by_name: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
  can_edit: true,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('база знаний', () => {
  it('список с отрывком и целью; поиск уходит на сервер', async () => {
    const calls = mockApi({ ...base, 'GET /notes': (c: { path: string }) => (c.path.includes('q=') ? [summary('n2', { title: 'Регламент договоров' })] : [summary('n1', { goal_id: 'g1', goal_title: 'Сократить время' })]) });
    renderApp('/app/notes');
    const link = await screen.findByRole('link', { name: /Заметка n1/ });
    expect(link).toHaveAttribute('href', '/app/notes/n1');
    expect(link).toHaveTextContent('Сократить время');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск заметок' }), 'договор');
    expect(await screen.findByRole('link', { name: /Регламент договоров/ })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/notes?q=%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80')).toBe(true);
  });

  it('пустая база — приглашение написать первую', async () => {
    mockApi({ ...base, 'GET /notes': [] });
    renderApp('/app/notes');
    expect(await screen.findByText('Заметок пока нет')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Написать первую' })).toBeInTheDocument();
  });

  it('заметка: разметка без HTML и опасных ссылок', async () => {
    mockApi({ ...base, 'GET /notes/n1': note() });
    renderApp('/app/notes/n1');
    const sheet = await screen.findByRole('article', { name: 'Как мы считаем KPI' });
    expect(within(sheet).getByRole('heading', { name: 'Правило' })).toBeInTheDocument();
    expect(within(sheet).getByText('раз в неделю').tagName).toBe('STRONG');
    expect(within(sheet).getByRole('img', { name: 'Сделано' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'СЭД' })).toHaveAttribute('href', 'https://sed.example');
    expect(within(sheet).queryByRole('link', { name: 'плохая' })).not.toBeInTheDocument();
    expect(within(sheet).getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script[src], .md script')).toBeNull();
  });

  it('новая заметка: без заголовка — ошибка, с заголовком — POST и переход', async () => {
    const calls = mockApi({ ...base, 'POST /notes': note({ id: 'n9', title: 'Итоги встречи', body: 'Решили' }), 'GET /notes/n9': note({ id: 'n9', title: 'Итоги встречи', body: 'Решили' }), 'GET /notes': [] });
    renderApp('/app/notes/new?goal=g1');
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('Введите заголовок')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.type(screen.getByLabelText(/Заголовок/), 'Итоги встречи');
    await userEvent.type(screen.getByRole('textbox', { name: 'Текст заметки' }), 'Решили');
    await userEvent.click(screen.getByRole('tab', { name: /Просмотр/ }));
    expect(screen.getByText('Решили')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ title: 'Итоги встречи', body: 'Решили', goal_id: 'g1' }));
    expect(await screen.findByRole('article', { name: 'Итоги встречи' })).toBeInTheDocument();
  });

  it('правка — PATCH; чужую заметку изменить нельзя', async () => {
    const calls = mockApi({ ...base, 'GET /notes/n1': note(), 'PATCH /notes/n1': note({ title: 'KPI: методика' }), 'GET /notes': [] });
    renderApp('/app/notes/n1');
    await userEvent.click(await screen.findByRole('button', { name: 'Изменить' }));
    const title = screen.getByLabelText(/Заголовок/);
    await userEvent.clear(title);
    await userEvent.type(title, 'KPI: методика');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ title: 'KPI: методика' }));
    cleanup();
    mockApi({ ...base, 'GET /notes/n1': note({ can_edit: false }) });
    renderApp('/app/notes/n1');
    await screen.findByRole('article');
    expect(screen.queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument();
  });

  it('недоступная заметка — понятная заглушка', async () => {
    mockApi({ ...base, 'GET /notes/n404': () => apiError(404, 'Заметка не найдена') });
    renderApp('/app/notes/n404');
    expect(await screen.findByText('Заметка не найдена')).toBeInTheDocument();
  });

  it('вкладка «Заметки» на цели — заметки этой цели', async () => {
    const calls = mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap(), 'GET /notes': [summary('n5', { title: 'Методика замера', goal_id: 'g1' })] });
    renderApp('/app/goals/g1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Заметки' }));
    expect(await screen.findByRole('link', { name: /Методика замера/ })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/notes?goal_id=g1')).toBe(true);
  });
});
