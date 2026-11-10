import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planPeopleImport, type Member, type OrgUnit, type PeopleMapping } from '@offix/core';
import type { Dashboard, Me } from '../src/lib/types';
import { TODAY } from './fixtures';
import { mockUploads } from './fake-xhr';
import { apiError, mockApi, renderApp, type Call } from './render';

const ME: Me = {
  id: 'u-olga',
  email: 'olga@offix.demo',
  display_name: 'Ольга Смирнова',
  position: null,
  role: 'admin',
  company_id: 'c1',
  company_name: 'Демо-университет',
  setup_mode: 'structured',
  units: [],
};
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const MEMBERS: Member[] = [{ id: 'u-olga', display_name: 'Ольга Смирнова', position: null, email: 'olga@offix.demo', active: true, role: 'admin', units: [] }];
const UNITS: OrgUnit[] = [{ id: 'u-inst', parent_unit_id: null, name: 'Институт экономики', unit_type: 'division' }];

/** Сервер в тесте планирует тем же кодом, что и настоящий. */
const dryRun = (call: Call) => {
  const b = call.body as { rows: string[][]; lines: number[]; mapping: PeopleMapping; dry_run: boolean };
  const plan = planPeopleImport(b.rows, b.lines, b.mapping, { companyEmails: ['olga@offix.demo'], units: UNITS, actorRole: 'admin' });
  if (b.dry_run) return { plan };
  const credentials = plan.rows.filter((r) => r.status === 'new').map((r, i) => ({ name: r.name, email: r.email, password: `Ab1${i}-Cd2e-Fg3h` }));
  return new Response(JSON.stringify({ data: { plan, created: credentials.length, units_created: plan.units.length, credentials } }), { status: 201 });
};
const base = { 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /users': MEMBERS, 'GET /org/units': [], 'POST /users/import': dryRun };

const FILE = [
  'ФИО\tПочта\tДолжность\tПодразделение\tРуководитель',
  'Кольцова Мария\tkoltsova@uni.ru\tДиректор\tИнститут экономики\tда',
  'Петров Иван\tpetrov@uni.ru\tДоцент\tИнститут экономики / Кафедра финансов\t',
  'Ольга\tolga@offix.demo\t\t\t',
  'Без почты\t\t\t\t',
].join('\n');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function open() {
  renderApp('/app/org');
  await userEvent.click(await screen.findByRole('button', { name: 'Из Excel' }));
  return screen.getByRole('dialog', { name: 'Сотрудники из Excel' });
}

async function paste(dialog: HTMLElement, text: string) {
  await userEvent.click(within(dialog).getByLabelText('Или вставьте ячейки из таблицы'));
  await userEvent.paste(text);
}

describe('импорт сотрудников на сайте', () => {
  it('кнопка только у администратора', async () => {
    mockApi({ ...base, 'GET /users/me': { ...ME, role: 'manager' } });
    renderApp('/app/org');
    expect(await screen.findByRole('heading', { name: 'Организация' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Из Excel' })).not.toBeInTheDocument();
  });

  it('пустая структура предлагает загрузить файл', async () => {
    mockApi(base);
    renderApp('/app/org');
    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить из Excel' }));
    expect(screen.getByRole('dialog', { name: 'Сотрудники из Excel' })).toBeInTheDocument();
  });

  it('предпросмотр: колонки угаданы, статусы строк, новые подразделения', async () => {
    const calls = mockApi(base);
    const dialog = await open();
    expect(within(dialog).getByRole('button', { name: 'Добавить сотрудников' })).toBeDisabled();
    await paste(dialog, FILE);
    expect(within(dialog).getByLabelText('Почта')).toHaveValue('1');
    expect(within(dialog).getByLabelText('Подразделение')).toHaveValue('3');
    const status = await within(dialog).findByRole('status');
    expect(status).toHaveTextContent('Добавим 2 сотрудника и 1 подразделение, 1 уже в компании, 1 строка с ошибками');
    expect(within(dialog).getByText('Кафедра финансов')).toBeInTheDocument();
    expect(within(dialog).getByText(/Нет почты/)).toBeInTheDocument();
    expect(within(dialog).getByText('Уже в компании')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Добавить 2 сотрудника' })).toBeEnabled();
    // На сервер ушли только нужные колонки и как предпросмотр.
    const sent = calls.filter((c) => c.path === '/users/import').at(-1)!.body as { rows: string[][]; dry_run: boolean };
    expect(sent.dry_run).toBe(true);
    expect(sent.rows[0]).toEqual(['Кольцова Мария', 'koltsova@uni.ru', 'Директор', 'Институт экономики', 'да']);
  });

  it('без колонки почты — подсказка и никакого запроса', async () => {
    const calls = mockApi(base);
    const dialog = await open();
    await paste(dialog, 'Сотрудник;Отдел\nПетров Иван;Кафедра');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Выберите колонку с почтой');
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.some((c) => c.path === '/users/import')).toBe(false);
  });

  it('колонку можно выбрать руками — план пересчитывается', async () => {
    const calls = mockApi(base);
    const dialog = await open();
    await paste(dialog, 'Кто;Связь;Где\nПетров Иван;petrov@uni.ru;Кафедра финансов');
    await userEvent.selectOptions(within(dialog).getByLabelText('Подразделение'), '2');
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('Добавим 1 сотрудника и 1 подразделение'));
    const last = calls.filter((c) => c.path === '/users/import').at(-1)!.body as { mapping: PeopleMapping };
    expect(last.mapping.unit).toBe(2);
  });

  it('добавление: пароли один раз, файлом, и предупреждение при закрытии без файла', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (blobs.push(b), 'blob:x')), revokeObjectURL: vi.fn() }));
    const calls = mockApi(base);
    const dialog = await open();
    await paste(dialog, FILE);
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Добавить 2 сотрудника' }));
    const done = await screen.findByRole('dialog', { name: 'Сотрудники добавлены' });
    expect(within(done).getByText('Добавили 2 сотрудника и 1 подразделение')).toBeInTheDocument();
    expect(within(done).getByText('Ab10-Cd2e-Fg3h')).toBeInTheDocument();
    expect((calls.filter((c) => c.path === '/users/import').at(-1)!.body as { dry_run: boolean }).dry_run).toBe(false);

    await userEvent.click(within(done).getByRole('button', { name: 'Готово' }));
    expect(within(done).getByRole('alert')).toHaveTextContent('Пароли ещё не скачаны');
    await userEvent.click(within(done).getByRole('button', { name: 'Скачать пароли' }));
    const csv = await blobs.at(-1)!.text();
    expect(csv).toContain('koltsova@uni.ru;Ab10-Cd2e-Fg3h');
    await userEvent.click(within(done).getByRole('button', { name: 'Готово' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ошибка сервера при добавлении видна в окне', async () => {
    mockApi({ ...base, 'POST /users/import': (c: Call) => ((c.body as { dry_run: boolean }).dry_run ? dryRun(c) : apiError(422, 'Некого добавлять', { rows: 'В файле нет новых сотрудников без ошибок' })) });
    const dialog = await open();
    await paste(dialog, FILE);
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Добавить 2 сотрудника' }));
    expect(await within(dialog).findByText(/нет новых сотрудников/)).toBeInTheDocument();
  });

  it('Excel разбирает сервер, CSV читается в браузере', async () => {
    mockApi(base);
    const uploads = mockUploads(() => ({ status: 200, data: { text: 'ФИО\tПочта\nИванов Иван\tivanov@uni.ru' } }));
    const dialog = await open();
    const input = within(dialog).getByLabelText('Файл с сотрудниками');
    await userEvent.upload(input, new File(['xlsx'], 'staff.xlsx'));
    expect(await within(dialog).findByText('staff.xlsx')).toBeInTheDocument();
    expect(uploads[0]!.path).toBe('/users/import/table');
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Добавим 1 сотрудника');

    await userEvent.upload(input, new File(['ФИО;Почта\nА Б;ab@uni.ru\nВ Г;vg@uni.ru'], 'staff.csv', { type: 'text/csv' }));
    expect(await within(dialog).findByText('staff.csv')).toBeInTheDocument();
    expect(uploads).toHaveLength(1);
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('Добавим 2 сотрудника'));
  });

  it('неподходящий файл — понятная ошибка', async () => {
    mockApi(base);
    mockUploads(() => ({ status: 422, error: { message: 'Не тот формат', fields: { file: 'Нужен файл .xlsx или .csv' } } }));
    const dialog = await open();
    // Перетащить можно что угодно — фильтр окна выбора файла не спасёт.
    await userEvent.setup({ applyAccept: false }).upload(within(dialog).getByLabelText('Файл с сотрудниками'), new File(['x'], 'staff.pdf'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Нужен файл .xlsx или .csv');
  });
});
