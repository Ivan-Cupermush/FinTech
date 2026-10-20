import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Integration, IntegrationRun, IntegrationTarget } from '@offix/core';
import { runSummary } from '../src/features/integrations/IntegrationsPage';
import type { Dashboard, Me } from '../src/lib/types';
import { TODAY } from './fixtures';
import { apiError, mockApi, renderApp } from './render';

const me = (role: Me['role']): Me => ({
  id: 'u-dir',
  email: 'director@offix.demo',
  display_name: 'Алексей Петров',
  position: 'Проректор',
  role,
  company_id: 'c1',
  company_name: 'Демо-университет',
  setup_mode: 'structured',
  units: [],
});
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const base = { 'GET /users/me': me('owner'), 'GET /dashboard': DASH };

const TARGETS: IntegrationTarget[] = [
  { metric_id: 'm-contracts', metric_name: 'Срок согласования договора', unit: 'days', goal_id: 'g-contracts', goal_title: 'Сократить срок согласования договоров' },
  { metric_id: 'm-course', metric_name: 'Завершили курс', unit: 'percent', goal_id: 'g-course', goal_title: 'Цифровая грамотность' },
];

const run = (id: string, over: Partial<IntegrationRun> = {}): IntegrationRun => ({
  id,
  trigger: 'schedule',
  status: 'ok',
  started_at: '2026-10-19T07:00:00.000Z',
  finished_at: '2026-10-19T07:00:00.000Z',
  fetched: 112,
  imported: 1,
  skipped: 0,
  error: null,
  ...over,
});

const integration = (over: Partial<Integration> = {}): Integration => ({
  id: 'i1',
  kind: 'onec',
  name: '1С: договоры',
  goal: { id: 'g-contracts', title: 'Сократить срок согласования договоров' },
  metric: { id: 'm-contracts', name: 'Срок согласования договора', unit: 'days' },
  config: { base_url: 'https://1c.univ.ru/univ', entity: 'Document_ДоговорКонтрагента', date_field: 'Date', value_field: 'СрокСогласования', filter: '', aggregate: 'avg' },
  username: 'offix',
  secret_mask: '••••••••',
  enabled: true,
  interval_hours: 24,
  state: 'ok',
  last_sync_at: '2026-10-19T07:00:00.000Z',
  last_success_at: '2026-10-19T07:00:00.000Z',
  last_error: null,
  next_sync_at: '2099-10-20T07:00:00.000Z',
  created_at: '2026-10-13T12:00:00.000Z',
  last_run: run('r1'),
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('runSummary', () => {
  it('итог запуска словами', () => {
    expect(runSummary({ status: 'ok', imported: 4, skipped: 1, error: null })).toBe('Записано 4 замера, пропущено 1');
    expect(runSummary({ status: 'ok', imported: 1, skipped: 0, error: null })).toBe('Записано 1 замер');
    expect(runSummary({ status: 'ok', imported: 0, skipped: 3, error: null })).toBe('Новых данных нет — всё уже записано');
    expect(runSummary({ status: 'error', imported: 0, skipped: 0, error: 'Система отклонила логин и пароль' })).toBe('Система отклонила логин и пароль');
  });
});

describe('список интеграций', () => {
  it('администратор видит подключения, состояние и ошибку', async () => {
    mockApi({ ...base, 'GET /integrations': [integration(), integration({ id: 'i2', kind: 'moodle', name: 'Moodle: курс', state: 'error', last_error: 'Moodle не принял токен веб-сервиса', last_run: run('r2', { status: 'error' }) })] });
    renderApp('/app/integrations');
    const list = await screen.findByLabelText('Подключения');
    const rows = within(list).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('href', '/app/integrations/i1');
    expect(within(rows[0]!).getByText('Работает')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/Срок согласования договора · Сократить срок/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/записано 1 замер/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Ошибка')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Moodle не принял токен веб-сервиса')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Интеграции/ })).toBeInTheDocument();
  });

  it('пустой раздел — сразу выбор системы', async () => {
    mockApi({ ...base, 'GET /integrations': [], 'GET /integrations/targets': TARGETS });
    renderApp('/app/integrations');
    await userEvent.click(await screen.findByRole('button', { name: /1С:Предприятие/ }));
    expect(await screen.findByRole('heading', { name: 'Новое подключение' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Адрес публикации базы/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Документ или регистр/)).toBeInTheDocument();
  });

  it('руководителю пункта в меню нет, раздел объясняет, к кому идти', async () => {
    const calls = mockApi({ ...base, 'GET /users/me': me('manager') });
    renderApp('/app/integrations');
    expect(await screen.findByText('Интеграции настраивает администратор')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Интеграции/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/integrations'))).toBe(false);
  });
});

describe('новое подключение', () => {
  it('пустая форма — ошибки у полей, запроса нет', async () => {
    const calls = mockApi({ ...base, 'GET /integrations/targets': TARGETS });
    renderApp('/app/integrations/new?kind=onec');
    await userEvent.click(await screen.findByRole('button', { name: 'Подключить' }));
    expect(screen.getByText('Назовите подключение')).toBeInTheDocument();
    expect(screen.getByText('Укажите адрес')).toBeInTheDocument();
    expect(screen.getByText('Укажите пользователя 1С')).toBeInTheDocument();
    expect(screen.getByText('Укажите пароль пользователя 1С')).toBeInTheDocument();
    expect(screen.getByText('Выберите KPI')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('1С: проверка показывает последние дни, сохранение уводит на карточку', async () => {
    const calls = mockApi({
      ...base,
      'GET /integrations/targets': TARGETS,
      'POST /integrations/test': { ok: true, message: 'Подключение работает — записей: 107, дней с замером: 43', records: 107, invalid: 0, points: [{ at: '2026-10-16T13:00:00.000Z', value: 8.75 }] },
      'POST /integrations': integration({ id: 'i9', state: 'never', last_sync_at: null, last_run: null }),
      'GET /integrations': [integration({ id: 'i9', state: 'never', last_sync_at: null, last_run: null })],
      'GET /integrations/i9/runs': [],
    });
    renderApp('/app/integrations/new?kind=onec');
    await userEvent.type(await screen.findByLabelText(/Название/), '1С: договоры');
    await userEvent.type(screen.getByLabelText(/Адрес публикации базы/), 'https://1c.univ.ru/univ');
    await userEvent.type(screen.getByLabelText(/Пользователь 1С/), 'offix');
    await userEvent.type(screen.getByLabelText(/Пароль/), 'p@ss-2026');
    await userEvent.type(screen.getByLabelText(/Документ или регистр/), 'Document_ДоговорКонтрагента');
    await userEvent.type(screen.getByLabelText(/Поле с числом/), 'СрокСогласования');
    await userEvent.selectOptions(screen.getByLabelText(/Как считать за день/), 'sum');
    await screen.findByRole('option', { name: 'Срок согласования договора' });
    await userEvent.selectOptions(screen.getByLabelText(/^KPI/), 'm-contracts');

    await userEvent.click(screen.getByRole('button', { name: 'Проверить подключение' }));
    const result = await screen.findByRole('status', { name: 'Результат проверки' });
    expect(within(result).getByText(/Подключение работает/)).toBeInTheDocument();
    expect(within(result).getByText('16 окт')).toBeInTheDocument();
    expect(within(result).getByText(/8,8/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/integrations/test')!.body).toEqual({
      kind: 'onec',
      config: { base_url: 'https://1c.univ.ru/univ', entity: 'Document_ДоговорКонтрагента', date_field: 'Date', value_field: 'СрокСогласования', aggregate: 'sum', filter: '' },
      username: 'offix',
      secret: 'p@ss-2026',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/integrations')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/integrations')!.body).toMatchObject({
      kind: 'onec',
      name: '1С: договоры',
      metric_id: 'm-contracts',
      username: 'offix',
      secret: 'p@ss-2026',
      interval_hours: 24,
      enabled: true,
    });
    expect(await screen.findByRole('heading', { name: '1С: договоры' })).toBeInTheDocument();
    expect(await screen.findByText('Запусков ещё не было.')).toBeInTheDocument();
  });

  it('Moodle: свои поля, неудачная проверка — причина словами', async () => {
    mockApi({ ...base, 'GET /integrations/targets': TARGETS, 'POST /integrations/test': { ok: false, message: 'Moodle не принял токен веб-сервиса', records: 0, invalid: 0, points: [] } });
    renderApp('/app/integrations/new?kind=onec');
    await userEvent.click(await screen.findByRole('tab', { name: 'Moodle' }));
    expect(screen.queryByLabelText(/Пользователь 1С/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Адрес Moodle/), 'https://lms.univ.ru');
    await userEvent.type(screen.getByLabelText(/Токен веб-сервиса/), 'bad');
    await userEvent.type(screen.getByLabelText(/Номер курса/), '101');
    await userEvent.click(screen.getByRole('button', { name: 'Проверить подключение' }));
    expect(await screen.findByText('Moodle не принял токен веб-сервиса')).toBeInTheDocument();
  });

  it('ошибки сервера — у своих полей', async () => {
    mockApi({
      ...base,
      'GET /integrations/targets': TARGETS,
      'POST /integrations': apiError(422, 'Не удалось сохранить интеграцию', { metric_id: 'Цель отменена — выберите другой KPI' }),
    });
    renderApp('/app/integrations/new?kind=moodle');
    await userEvent.type(await screen.findByLabelText(/Название/), 'Moodle');
    await userEvent.type(screen.getByLabelText(/Адрес Moodle/), 'https://lms.univ.ru');
    await userEvent.type(screen.getByLabelText(/Токен веб-сервиса/), 'token');
    await userEvent.type(screen.getByLabelText(/Номер курса/), '101');
    await screen.findByRole('option', { name: 'Завершили курс' });
    await userEvent.selectOptions(screen.getByLabelText(/^KPI/), 'm-course');
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(await screen.findByText('Цель отменена — выберите другой KPI')).toBeInTheDocument();
    expect(screen.getByLabelText(/^KPI/)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('карточка подключения', () => {
  const card = (over: Record<string, unknown> = {}) => ({
    ...base,
    'GET /integrations': [integration()],
    'GET /integrations/targets': TARGETS,
    'GET /integrations/i1/runs': [run('r1', { trigger: 'manual' }), run('r0', { status: 'error', imported: 0, fetched: 0, error: 'Система отклонила логин и пароль' })],
    ...over,
  });

  it('настройки, маска пароля и журнал запусков', async () => {
    mockApi(card());
    renderApp('/app/integrations/i1');
    expect(await screen.findByRole('heading', { name: '1С: договоры' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Документ или регистр/)).toHaveValue('Document_ДоговорКонтрагента');
    expect(screen.getByLabelText(/Пароль/)).toHaveValue('');
    expect(screen.getByLabelText(/Пароль/)).toHaveAttribute('placeholder', 'Сохранён ••••••••');
    expect(screen.getByText('Оставьте пустым, чтобы не менять')).toBeInTheDocument();
    const log = await screen.findByRole('list');
    expect(within(log).getByText('Записано 1 замер')).toBeInTheDocument();
    expect(within(log).getByText(/вручную · получено 112/)).toBeInTheDocument();
    expect(within(log).getByText('Система отклонила логин и пароль')).toBeInTheDocument();
  });

  it('сохранение без нового пароля: пароль не отправляется', async () => {
    const calls = mockApi(card({ 'PATCH /integrations/i1': integration({ enabled: false, state: 'paused' }) }));
    renderApp('/app/integrations/i1');
    await userEvent.click(await screen.findByRole('switch', { name: 'Синхронизировать по расписанию' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Каждые 6 часов' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const body = calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
    expect(body).toMatchObject({ enabled: false, interval_hours: 6, username: 'offix', metric_id: 'm-contracts' });
    expect(body).not.toHaveProperty('secret');
    expect(body).not.toHaveProperty('kind');
    expect(await screen.findByText('Изменения сохранены')).toBeInTheDocument();
  });

  it('«Синхронизировать сейчас» — итог во всплывающем сообщении, журнал обновляется', async () => {
    let synced = false;
    const calls = mockApi(
      card({
        'POST /integrations/i1/sync': () => {
          synced = true;
          return { run: run('r2', { trigger: 'manual', imported: 4, skipped: 1 }), integration: integration() };
        },
        'GET /integrations/i1/runs': () => (synced ? [run('r2', { trigger: 'manual', imported: 4, skipped: 1 })] : []),
      }),
    );
    renderApp('/app/integrations/i1');
    await screen.findByText('Запусков ещё не было.');
    await userEvent.click(screen.getByRole('button', { name: 'Синхронизировать сейчас' }));
    expect(await screen.findAllByText('Записано 4 замера, пропущено 1')).toHaveLength(2);
    expect(calls.filter((c) => c.path === '/integrations/i1/runs').length).toBeGreaterThanOrEqual(2);
  });

  it('ошибка подключения видна в состоянии', async () => {
    mockApi(card({ 'GET /integrations': [integration({ state: 'error', last_error: 'Система недоступна: нет ответа 20 секунд' })] }));
    renderApp('/app/integrations/i1');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Система недоступна: нет ответа 20 секунд');
    expect(screen.getAllByText('Ошибка').length).toBeGreaterThan(0);
  });

  it('удаление — с подтверждением, потом к списку', async () => {
    let deleted = false;
    const calls = mockApi(
      card({
        'DELETE /integrations/i1': () => {
          deleted = true;
          return new Response(null, { status: 204 });
        },
        'GET /integrations': () => (deleted ? [] : [integration()]),
      }),
    );
    renderApp('/app/integrations/i1');
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    const dialog = screen.getByRole('dialog', { name: 'Удалить подключение?' });
    expect(within(dialog).getByText(/Замеры, которые уже пришли, останутся в KPI/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(await screen.findByRole('button', { name: /1С:Предприятие/ })).toBeInTheDocument();
  });

  it('несуществующее подключение', async () => {
    mockApi(card({ 'GET /integrations': [] }));
    renderApp('/app/integrations/zzz');
    expect(await screen.findByText('Подключение не найдено')).toBeInTheDocument();
  });
});
