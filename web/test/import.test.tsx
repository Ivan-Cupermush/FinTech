import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTextFile } from '../src/features/goals/ImportDialog';
import type { Dashboard, Me } from '../src/lib/types';
import { goalCard, metric, roadmap, TODAY } from './fixtures';
import { apiError, mockApi, renderApp } from './render';

const ME: Me = {
  id: 'u-olga',
  email: 'olga@offix.demo',
  display_name: 'Ольга Смирнова',
  position: 'Руководитель учебного офиса',
  role: 'manager',
  company_id: 'c1',
  company_name: 'Демо-университет',
  setup_mode: 'structured',
  units: [],
};
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const base = { 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /goals/g1/roadmap': roadmap() };
const EXISTING = [{ id: 'o1', value: 36.5, observed_at: '2026-10-15T09:00:00.000Z', source: 'manual', note: null, recorded_by: 'Ольга Смирнова' }];
const PASTE = 'Дата\tВремя, мин\n01.10.2026\t40\n08.10.2026\t38,5\n15.10.2026\t36\n22.10.2099\t35\nвчера\t30';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function openImport() {
  renderApp('/app/goals/g1');
  await userEvent.click(await screen.findByRole('button', { name: 'Импорт из таблицы' }));
  return screen.getByRole('dialog', { name: 'Импорт из таблицы' });
}

async function paste(dialog: HTMLElement, text: string) {
  await userEvent.click(within(dialog).getByLabelText('Вставьте ячейки из Excel или Google Таблиц'));
  await userEvent.paste(text);
}

describe('импорт замеров из таблицы', () => {
  it('без данных кнопка добавления недоступна', async () => {
    mockApi({ ...base, 'GET /goals/g1/metrics/m1/observations': EXISTING });
    const dialog = await openImport();
    expect(within(dialog).getByRole('button', { name: 'Добавить замеры' })).toBeDisabled();
    expect(within(dialog).queryByRole('status')).toBeNull();
  });

  it('предпросмотр: что добавится, что уже есть, ошибки с причинами и новое текущее значение', async () => {
    mockApi({ ...base, 'GET /goals/g1/metrics/m1/observations': EXISTING });
    const dialog = await openImport();
    await paste(dialog, PASTE);
    const summary = await within(dialog).findByRole('status');
    expect(summary).toHaveTextContent('Добавится 2 · уже есть 1 · ошибок 2');
    expect(within(dialog).getByText('За этот день замер уже есть')).toBeInTheDocument();
    expect(within(dialog).getByText('Дата из будущего')).toBeInTheDocument();
    expect(within(dialog).getByText('Не похоже на дату: «вчера»')).toBeInTheDocument();
    // Новых замеров позже 15 октября нет — текущее значение не меняется.
    expect(within(dialog).getByText(/Текущее значение не изменится/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Добавить 2 замера' })).toBeEnabled();
  });

  it('новый поздний замер станет текущим значением', async () => {
    mockApi({ ...base, 'GET /goals/g1/metrics/m1/observations': EXISTING });
    const dialog = await openImport();
    await paste(dialog, '18.10.2026;34');
    expect(await within(dialog).findByText(/Текущее значение станет 34 мин/)).toBeInTheDocument();
  });

  it('отправляет только добавляемые строки, показывает тост и закрывается', async () => {
    const calls = mockApi({
      ...base,
      'GET /goals/g1/metrics/m1/observations': EXISTING,
      'POST /goals/g1/metrics/m1/observations/import': { imported: 2, skipped: 0, metric: metric() },
    });
    const dialog = await openImport();
    await paste(dialog, PASTE);
    await userEvent.type(within(dialog).getByLabelText('Откуда цифры'), 'Выгрузка');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить 2 замера' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/import'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/import'))!.body).toEqual({
      rows: [
        { observed_at: '2026-10-01T09:00:00.000Z', value: 40 },
        { observed_at: '2026-10-08T09:00:00.000Z', value: 38.5 },
      ],
      note: 'Выгрузка',
    });
    expect(await screen.findByText('Добавлено 2 замера')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Импорт из таблицы' })).toBeNull();
    // После импорта перечитываем карточку цели и метрики.
    await waitFor(() => expect(calls.filter((c) => c.path === '/goals/g1/roadmap').length).toBeGreaterThan(1));
  });

  it('ошибка сервера показывается в окне, окно не закрывается', async () => {
    mockApi({
      ...base,
      'GET /goals/g1/metrics/m1/observations': [],
      'POST /goals/g1/metrics/m1/observations/import': apiError(422, 'Не удалось импортировать замеры: Строка 1: измерение не может быть из будущего'),
    });
    const dialog = await openImport();
    await paste(dialog, '01.10.2026;40');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить 1 замер' }));
    expect(await within(dialog).findByText(/Строка 1: измерение не может быть из будущего/)).toBeInTheDocument();
  });

  it('если колонок больше двух — можно выбрать колонку значения', async () => {
    mockApi({ ...base, 'GET /goals/g1/metrics/m1/observations': [] });
    const dialog = await openImport();
    await paste(dialog, 'Дата;План;Факт\n01.10.2026;40;41\n08.10.2026;39;-2');
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Добавится 2 · уже есть 0 · ошибок 0');
    await userEvent.selectOptions(within(dialog).getByLabelText('Колонка со значением'), 'Факт');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Добавится 1 · уже есть 0 · ошибок 1');
    expect(within(dialog).getByText(/не может быть отрицательным/)).toBeInTheDocument();
  });

  it('если у цели несколько KPI — можно выбрать KPI, замеры грузятся для него', async () => {
    const second = metric({ id: 'm2', name: 'Доля без возврата', unit: 'percent', baseline: 60, target: 90, direction: 'increase', is_primary: false, current_value: null, last_observed_at: null });
    const calls = mockApi({
      ...base,
      'GET /goals/g1/roadmap': roadmap({ goal: goalCard({ metrics: [metric(), second] }) }),
      'GET /goals/g1/metrics/m1/observations': EXISTING,
      'GET /goals/g1/metrics/m2/observations': [],
    });
    const dialog = await openImport();
    await userEvent.selectOptions(within(dialog).getByLabelText('KPI'), 'Доля без возврата');
    await paste(dialog, '15.10.2026;75 %');
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Добавится 1');
    expect(calls.some((c) => c.path === '/goals/g1/metrics/m2/observations')).toBe(true);
  });

  it('«Скачать шаблон» отдаёт CSV', async () => {
    const createObjectURL = vi.fn(() => 'blob:template');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    mockApi({ ...base, 'GET /goals/g1/metrics/m1/observations': [] });
    const dialog = await openImport();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Скачать шаблон' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('наблюдатель не видит импорта', async () => {
    mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap({ goal: goalCard({ permissions: { edit: false, manage: false, activate: false, record: false, audit: false } }) }) });
    renderApp('/app/goals/g1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Импорт из таблицы' })).toBeNull();
  });
});

describe('readTextFile', () => {
  const file = (bytes: Uint8Array) => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });

  it('читает UTF-8', async () => {
    expect(await readTextFile(file(new TextEncoder().encode('Дата;Значение')) as unknown as Blob)).toBe('Дата;Значение');
  });

  it('если это не UTF-8 — читает как windows-1251', async () => {
    // «Дата» в windows-1251.
    expect(await readTextFile(file(new Uint8Array([0xc4, 0xe0, 0xf2, 0xe0])) as unknown as Blob)).toBe('Дата');
  });
});
