import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dashboard, Me } from '../src/lib/types';
import { TODAY } from './fixtures';
import { apiError, mockApi, renderApp } from './render';

const ME: Me = {
  id: 'u1',
  email: 'olga@offix.demo',
  display_name: 'Ольга Смирнова',
  position: 'Руководитель приёмной комиссии',
  role: 'member',
  company_id: 'c1',
  company_name: 'Демо-университет',
  setup_mode: 'structured',
  units: [],
};
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const base = { 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /notifications': [] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('настройки push на странице «Уведомления»', () => {
  it('темы и тихие часы из настроек сервера', async () => {
    mockApi({ ...base, 'GET /push/settings': { muted: ['comments'], quiet_hours: true, devices: 2 } });
    renderApp('/app/notifications');
    expect(await screen.findByRole('switch', { name: /Блокеры/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Обсуждения/ })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /Тихие часы 22:00–08:00/ })).toBeChecked();
    expect(screen.getByText('Push приходят на 2 устройства.')).toBeInTheDocument();
  });

  it('выключить тему — PUT с ней в muted, тумблер сразу выключен', async () => {
    const calls = mockApi({ ...base, 'GET /push/settings': { muted: [], quiet_hours: true, devices: 0 }, 'PUT /push/settings': (c: { body: unknown }) => c.body });
    renderApp('/app/notifications');
    const tasks = await screen.findByRole('switch', { name: /Мои задачи/ });
    expect(screen.getByText(/Телефон ещё не привязан/)).toBeInTheDocument();
    await userEvent.click(tasks);
    expect(tasks).not.toBeChecked();
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ muted: ['tasks'], quiet_hours: true }));
  });

  it('тихие часы выключаются, темы не теряются', async () => {
    const calls = mockApi({ ...base, 'GET /push/settings': { muted: ['goals'], quiet_hours: true, devices: 1 }, 'PUT /push/settings': (c: { body: unknown }) => c.body });
    renderApp('/app/notifications');
    await userEvent.click(await screen.findByRole('switch', { name: /Тихие часы/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ muted: ['goals'], quiet_hours: false }));
  });

  it('ошибка сохранения — тумблер возвращается назад', async () => {
    mockApi({ ...base, 'GET /push/settings': { muted: [], quiet_hours: true, devices: 1 }, 'PUT /push/settings': () => apiError(500, 'Сервер недоступен') });
    renderApp('/app/notifications');
    const blockers = await screen.findByRole('switch', { name: /Блокеры/ });
    await userEvent.click(blockers);
    expect(await screen.findByText('Не удалось сохранить: Сервер недоступен')).toBeInTheDocument();
    await waitFor(() => expect(blockers).toBeChecked());
  });
});
