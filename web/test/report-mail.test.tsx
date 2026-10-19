import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReport, productMetrics, type ReportSubscription } from '@offix/core';
import type { Dashboard, Me } from '../src/lib/types';
import { TODAY } from './fixtures';
import { apiError, mockApi, renderApp } from './render';

const ME: Me = {
  id: 'u-dir',
  email: 'director@offix.demo',
  display_name: 'Алексей Петров',
  position: 'Проректор',
  role: 'owner',
  company_id: 'c1',
  company_name: 'Демо-университет',
  setup_mode: 'structured',
  units: [],
};
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const NOW = '2026-10-19T12:00:00.000Z';
const REPORT = buildReport({ company: 'Демо-университет', scope: 'company', author: 'Алексей Петров', at: NOW, days: 30, goals: [], metrics: productMetrics({ goals: [], events: [], tasks: [] }, NOW, { windowDays: 30 }) });
const OFF: ReportSubscription = { enabled: false, schedule: 'weekly', email: 'director@offix.demo', last_sent_at: null, next_at: null, mail_available: true };
const base = { 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /report': REPORT };

/** Сервер: сохраняет подписку и считает следующее письмо, как настоящий. */
const server = (initial: ReportSubscription) => {
  let s = initial;
  return {
    'GET /report/subscription': () => s,
    'PUT /report/subscription': (c: { body: unknown }) => {
      const b = c.body as Pick<ReportSubscription, 'enabled' | 'schedule'>;
      s = { ...s, ...b, next_at: b.enabled ? (b.schedule === 'weekly' ? '2026-10-26T06:00:00.000Z' : '2026-11-01T06:00:00.000Z') : null };
      return s;
    },
  };
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('отчёт на почту', () => {
  it('выключено: переключатель и адрес, частоты не видно', async () => {
    mockApi({ ...base, ...server(OFF) });
    renderApp('/app/report');
    const sw = await screen.findByRole('switch', { name: 'Присылать отчёт на почту' });
    expect(sw).not.toBeChecked();
    expect(screen.getByText(/Тот же отчёт письмом на director@offix\.demo/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Как часто присылать' })).not.toBeInTheDocument();
  });

  it('включить: PUT, дата следующего письма, выбор частоты', async () => {
    const calls = mockApi({ ...base, ...server(OFF) });
    renderApp('/app/report');
    await userEvent.click(await screen.findByRole('switch', { name: 'Присылать отчёт на почту' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ enabled: true, schedule: 'weekly' }));
    expect(await screen.findByText(/Следующее письмо — понедельник, 26 октября, 9:00/)).toBeInTheDocument();
    expect(screen.getByText('По понедельникам в 9:00 по Москве, отчёт за неделю')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Раз в месяц' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ enabled: true, schedule: 'monthly' }));
    expect(await screen.findByText(/Следующее письмо — воскресенье, 1 ноября, 9:00/)).toBeInTheDocument();
  });

  it('почта на сервере не настроена — честно предупреждаем', async () => {
    mockApi({ ...base, ...server({ ...OFF, enabled: true, next_at: '2026-10-26T06:00:00.000Z', mail_available: false }) });
    renderApp('/app/report');
    expect(await screen.findByText(/Отправка писем на сервере пока не настроена/)).toBeInTheDocument();
  });

  it('ошибка сохранения — переключатель возвращается', async () => {
    mockApi({ ...base, 'GET /report/subscription': OFF, 'PUT /report/subscription': () => apiError(500, 'Сервер недоступен') });
    renderApp('/app/report');
    const sw = await screen.findByRole('switch', { name: 'Присылать отчёт на почту' });
    await userEvent.click(sw);
    expect(await screen.findByText('Не удалось сохранить: Сервер недоступен')).toBeInTheDocument();
    await waitFor(() => expect(sw).not.toBeChecked());
  });
});
