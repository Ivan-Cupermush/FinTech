import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KpiFilePreview, SalesEmployee, SalesImportPreview, SalesMonth, SalesPlan, SalesReportImport, SalesTeam } from '@offix/core';
import { salesHeroStats } from '../src/lib/hero-stats';
import type { Dashboard, Me } from '../src/lib/types';
import { TODAY } from './fixtures';
import { mockUploads } from './fake-xhr';
import { apiError, mockApi, renderApp } from './render';

const person = (id: string, name: string, role: Me['role'] = 'member'): Me => ({
  id,
  email: `${id}@offix.demo`,
  display_name: name,
  position: 'Менеджер программ ДПО',
  role,
  company_id: 'c1',
  company_name: 'Демо-университет',
  setup_mode: 'structured',
  units: [],
});
const PAVEL = person('u-pavel', 'Павел Соколов');
const NATALIA = person('u-natalia', 'Наталья Белова', 'manager');
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };

const calc = (over: Partial<SalesPlan['calc']> = {}): SalesPlan['calc'] => ({
  source: 'report',
  tracked: true,
  percent: 87,
  now: 0,
  forecast: 31862,
  forecast_value: 690341,
  forecast_percent: 106,
  max: 30000,
  marks: [90],
  rule: 'от 100 % — 30 000 ₽, 90–100 % — 15 000 ₽ (× 0,5)',
  condition: null,
  hint: 'До 90 % — ещё 22 500 ₽',
  items: null,
  as_of: '2026-10-18',
  ...over,
});

const plan = (id: string, over: Partial<SalesPlan> = {}): SalesPlan => ({
  id,
  user_id: 'u-pavel',
  month: '2026-10',
  name: 'Выручка по курсам',
  kind: 'other',
  unit: 'rub',
  plan: 650000,
  fact: 562500,
  bonus: 30000,
  payment: null,
  file_percent: null,
  fact_rule: { type: 'revenue', groups: ['КУРСЫ'], clients: 'all', measure: 'revenue' },
  payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }, { from: 90, k: 0.5 }], over: 'proportional' },
  fact_details: null,
  file_items: null,
  source: 'manual',
  description: null,
  fact_updated_at: null,
  sort_order: 0,
  rules_custom: false,
  calc: calc(),
  ...over,
});

const SALARY = plan('p-salary', {
  name: 'Оклад',
  kind: 'salary',
  plan: 0,
  fact: 0,
  bonus: 45000,
  fact_rule: { type: 'manual' },
  payout_rule: { type: 'fixed' },
  calc: calc({ source: 'manual', tracked: false, percent: 0, now: 45000, forecast: 45000, forecast_value: null, forecast_percent: null, max: 45000, marks: [], rule: 'фиксированная выплата', hint: null, as_of: null }),
});
const WEBINARS = plan('p-web', {
  name: 'Вебинары',
  plan: 40000,
  fact: 36000,
  bonus: 4000,
  fact_rule: { type: 'manual' },
  payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }], over: 'cap' },
  calc: calc({ source: 'manual', tracked: false, percent: 90, now: 0, forecast: 4000, forecast_value: 60000, forecast_percent: 150, max: 4000, marks: [], hint: 'До 100 % — ещё 4 000 ₽', as_of: null }),
});

const month = (over: Partial<SalesMonth> = {}): SalesMonth => ({
  month: '2026-10',
  user: { id: 'u-pavel', name: 'Павел Соколов', position: 'Менеджер программ ДПО' },
  plans: [SALARY, plan('p-rev'), WEBINARS],
  totals: { fixed: 45000, now: 45000, forecast: 80862, max: 79000, file: null },
  coverage: { as_of: '2026-10-18', elapsed: 18, days: 31, work_elapsed: 15, work_days: 27, reports: 2 },
  stats: { as_of: '2026-10-18', elapsed: 18, days: 31, work_elapsed: 15, work_days: 27, reports: 2, revenue: 562500, clients: 5, per_day: 37500, quantity: 12 },
  reports: [],
  entries: { count: 1, amount: 12000, quantity: 1 },
  months: ['2026-10', '2026-09'],
  can: { edit: false, fact: true, kpi_file: false, add_entry: true, team: false, reports: false },
  lists: { key: 1, merge: 0 },
  ...over,
});

const ENTRY = { id: 'e1', user_id: 'u-pavel', plan_id: 'p-web', product: 'Вебинар по Excel', client: 'ООО «Альфа»', quantity: 1, amount: 12000, sold_on: '2026-10-05', note: null, created_at: '2026-10-05T10:00:00Z', can_delete: true };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('продажи: формулы для шапки', () => {
  it('выручка, клиенты и среднее выполнение; без отчётов — продажи вручную', () => {
    const s = salesHeroStats(month());
    expect(s.map((x) => x.label)).toEqual(['выручка за месяц', 'клиентов с продажами', 'выполнение плана']);
    expect(s[1]!.value).toBe(5);
    expect(s[2]).toMatchObject({ value: '89 %' });
    const manual = salesHeroStats(month({ stats: null, plans: [] }));
    expect(manual[0]!.label).toBe('продажи вручную');
    expect(manual[1]!.value).toBe('—');
    expect(manual[2]!.value).toBe('—');
  });
});

describe('продажи: мой месяц', () => {
  const routes = (m: SalesMonth = month(), extra: Record<string, unknown> = {}) => ({ 'GET /users/me': PAVEL, 'GET /dashboard': DASH, 'GET /sales/month': m, 'GET /sales/entries': [ENTRY], ...extra });

  it('выплата, показатели с порогами и подсказкой, записанные продажи', async () => {
    mockApi(routes());
    renderApp('/app/sales?month=2026-10');
    expect(await screen.findByRole('heading', { name: 'Мои продажи' })).toBeInTheDocument();
    const pay = await screen.findByRole('region', { name: 'Выплата за месяц' });
    expect(within(pay).getByText('80 862 ₽')).toBeInTheDocument();
    expect(within(pay).getByText(/Продажи по 18 октября · 2 отчёта из 1С/)).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Выручка по курсам' });
    expect(within(card).getByText('562 500 ₽')).toBeInTheDocument();
    expect(within(card).getByText('87 %')).toBeInTheDocument();
    expect(within(card).getByText('Отчёты 1С')).toBeInTheDocument();
    expect(within(card).getByText('До 90 % — ещё 22 500 ₽')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Выполнено 87 % плана, прогноз 106 %' })).toBeInTheDocument();
    expect(within(card).getByText('90%')).toBeInTheDocument();
    // Оклад — сумма без полосы.
    const salary = screen.getByRole('article', { name: 'Оклад' });
    expect(within(salary).getByText('45 000 ₽')).toBeInTheDocument();
    expect(within(salary).queryByRole('img')).toBeNull();
    // У сотрудника без функций продаж нет вкладок команды.
    expect(screen.queryByRole('tab', { name: /Команда/ })).toBeNull();
    expect(await screen.findByText('Вебинар по Excel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Показатель' })).toBeNull();
  });

  it('сотрудник отмечает факт «ручного» показателя, но не правит план', async () => {
    const calls = mockApi(routes(month(), { 'PATCH /sales/plans/p-web': plan('p-web') }));
    renderApp('/app/sales?month=2026-10');
    expect(await screen.findByRole('article', { name: 'Вебинары' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Отметить факт «Выручка по курсам»/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Отметить факт «Вебинары»' }));
    const dialog = screen.getByRole('dialog', { name: 'Отметить факт' });
    const input = within(dialog).getByLabelText(/Факт за месяц/);
    await userEvent.clear(input);
    await userEvent.type(input, '-5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await within(dialog).findByText('Факт — число не меньше нуля')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '38 500,5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ fact: 38500.5 }));
    expect(await screen.findByText('Факт обновлён')).toBeInTheDocument();
  });

  it('записать продажу: прибавить к «ручному» показателю, ошибки — у полей', async () => {
    let n = 0;
    const calls = mockApi(
      routes(month(), {
        'POST /sales/entries': () => (++n === 1 ? apiError(422, 'Не удалось записать продажу', { product: 'Укажите товар или услугу' }) : ENTRY),
      }),
    );
    renderApp('/app/sales?month=2026-10');
    await userEvent.click(await screen.findByRole('button', { name: 'Записать продажу' }));
    const dialog = screen.getByRole('dialog', { name: 'Записать продажу' });
    // В списке — только показатели «вручную»: оклад и показатели по отчётам не подходят.
    const select = within(dialog).getByLabelText('Прибавить к показателю') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['Не прибавлять', 'Вебинары']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Записать' }));
    expect(await within(dialog).findByText('Укажите товар или услугу')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Товар или услуга/), 'Вебинар по Excel');
    await userEvent.type(within(dialog).getByLabelText('Сумма, ₽'), '12000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const body = calls.filter((c) => c.method === 'POST' && c.path === '/sales/entries')[1]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ product: 'Вебинар по Excel', amount: '12000', quantity: '1', plan_id: 'p-web' });
    expect(body.user_id).toBeUndefined();
  });

  it('удаляет свою продажу', async () => {
    const calls = mockApi(routes(month(), { 'DELETE /sales/entries/e1': new Response(null, { status: 204 }) }));
    renderApp('/app/sales?month=2026-10');
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить продажу «Вебинар по Excel»' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/sales/entries/e1')).toBe(true));
  });

  it('плана нет — понятная пустая страница; месяц переключается', async () => {
    const calls = mockApi(routes(month({ plans: [], totals: { fixed: 0, now: 0, forecast: 0, max: 0, file: null } })));
    renderApp('/app/sales?month=2026-10');
    expect(await screen.findByText('План на месяц не задан')).toBeInTheDocument();
    expect(screen.getByText(/Руководитель ещё не поставил план/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Выплата за месяц' })).toBeNull();
    expect(screen.getByText('Октябрь 2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(await screen.findByText('Сентябрь 2026')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.path === '/sales/month?month=2026-09')).toBe(true));
  });

  it('итоги из файла KPI: «к выплате» вместо прогноза', async () => {
    const filePlan = plan('p-file', { source: 'file', payment: 30000, calc: calc({ source: 'file', now: 30000, forecast: 30000, hint: 'План выполнен' }) });
    mockApi(routes(month({ plans: [filePlan], totals: { fixed: 0, now: 30000, forecast: 30000, max: 30000, file: 75000 } })));
    renderApp('/app/sales?month=2026-10');
    const pay = await screen.findByRole('region', { name: 'Выплата за месяц' });
    expect(within(pay).getByText('К выплате по файлу KPI')).toBeInTheDocument();
    expect(within(pay).getByText('75 000 ₽')).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Выручка по курсам' });
    expect(within(card).getByText('Файл KPI')).toBeInTheDocument();
    expect(within(card).getByText('К выплате')).toBeInTheDocument();
  });
});

describe('продажи: импорт из Excel', () => {
  const preview = (over: Partial<SalesImportPreview> = {}): SalesImportPreview => ({
    id: 'imp1',
    file_name: 'продажи.xlsx',
    headers: ['Дата', 'Товар', 'Сумма'],
    mapping: { product: 1, quantity: null, amount: 2, sold_on: 0, client: null, note: null },
    sample: [['2026-10-02', 'Курс Python', '90000']],
    total_rows: 3,
    valid: 2,
    amount: 102000,
    errors: [{ row: 4, message: 'Нет даты' }],
    ...over,
  });

  it('файл → колонки → проверка → запись; закрыть без записи — отмена загрузки', async () => {
    const calls = mockApi({
      'GET /users/me': PAVEL,
      'GET /dashboard': DASH,
      'GET /sales/month': month(),
      'GET /sales/entries': [],
      'POST /sales/entries/import/imp1': (c: { body: { dry_run?: boolean; mapping: { client: number | null } } }) =>
        c.body.dry_run ? { preview: preview({ mapping: { ...preview().mapping, client: c.body.mapping.client }, valid: 3 }), imported: 0, skipped: 0 } : { preview: preview(), imported: 3, skipped: 0 },
      'DELETE /sales/entries/import/imp1': new Response(null, { status: 204 }),
    });
    const uploads = mockUploads(() => ({ data: preview() }));
    renderApp('/app/sales?month=2026-10');
    await userEvent.click(await screen.findByRole('button', { name: 'Из Excel' }));
    const dialog = screen.getByRole('dialog', { name: 'Продажи из Excel' });
    await userEvent.upload(within(dialog).getByLabelText('Таблица продаж'), new File(['x'], 'продажи.xlsx'));
    expect(await within(dialog).findByText(/Пройдёт строк: 2 из 3/)).toBeInTheDocument();
    expect(uploads[0]!.path).toBe('/sales/entries/import');
    expect(within(dialog).getByText('Строка 4: Нет даты')).toBeInTheDocument();
    expect((within(dialog).getByLabelText('Товар') as HTMLSelectElement).value).toBe('1');
    fireEvent.change(within(dialog).getByLabelText('Клиент'), { target: { value: '1' } });
    expect(await within(dialog).findByText(/Пройдёт строк: 3 из 3/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/sales/entries/import/imp1')?.body).toMatchObject({ dry_run: true, mapping: { client: 1, product: 1 } });
    await userEvent.click(within(dialog).getByRole('button', { name: /Записать 3 продажи/ }));
    expect(await screen.findByText('Записано продаж: 3')).toBeInTheDocument();
    const final = calls.filter((c) => c.path === '/sales/entries/import/imp1' && c.method === 'POST').at(-1)!.body as Record<string, unknown>;
    expect(final.dry_run).toBeUndefined();
    expect(final.plan_id).toBe('p-web');
    // Записали — отменять нечего.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('закрыли окно после загрузки — загрузка отменяется', async () => {
    const calls = mockApi({ 'GET /users/me': PAVEL, 'GET /dashboard': DASH, 'GET /sales/month': month(), 'GET /sales/entries': [], 'DELETE /sales/entries/import/imp1': new Response(null, { status: 204 }) });
    mockUploads(() => ({ data: preview() }));
    renderApp('/app/sales?month=2026-10');
    await userEvent.click(await screen.findByRole('button', { name: 'Из Excel' }));
    const dialog = screen.getByRole('dialog', { name: 'Продажи из Excel' });
    await userEvent.upload(within(dialog).getByLabelText('Таблица продаж'), new File(['x'], 'продажи.xlsx'));
    await within(dialog).findByText(/Пройдёт строк/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/sales/entries/import/imp1')).toBe(true));
  });
});

describe('продажи: руководитель', () => {
  const TEAM: SalesTeam = {
    month: '2026-10',
    members: [
      { user: { id: 'u-pavel', name: 'Павел Соколов', position: 'Менеджер' }, plans: 3, percent: 90, totals: { fixed: 45000, now: 55000, forecast: 86862, max: 91000, file: null }, stats: month().stats, entries: { count: 0, amount: 0 } },
      { user: { id: 'u-ksenia', name: 'Ксения Морозова', position: null }, plans: 0, percent: null, totals: { fixed: 0, now: 0, forecast: 0, max: 0, file: null }, stats: null, entries: { count: 2, amount: 9000 } },
    ],
    totals: { revenue: 571500, now: 55000, forecast: 86862, max: 91000 },
    can: { upload: true, kpi_files: true, assign: true },
  };
  const NAT_MONTH = month({ user: { id: 'u-natalia', name: 'Наталья Белова', position: null }, plans: [], can: { edit: true, fact: true, kpi_file: true, add_entry: true, team: true, reports: true } });
  const PAVEL_MONTH = month({ can: { edit: true, fact: false, kpi_file: true, add_entry: true, team: true, reports: true } });
  const EMPLOYEE: SalesEmployee = { month: PAVEL_MONTH, tasks: { open: 4, overdue: 1, blocked: 0, done_30d: 7 }, top_products: [{ name: 'Курс «Python для аналитиков»', quantity: 6, revenue: 270000 }], entries: [] };
  const base = { 'GET /users/me': NATALIA, 'GET /dashboard': DASH, 'GET /sales/month': NAT_MONTH, 'GET /sales/team': TEAM, 'GET /sales/entries': [], 'GET /sales/people': [{ id: 'u-pavel', name: 'Павел Соколов', position: null }, { id: 'u-new', name: 'Олег Новиков', position: null }] };

  it('команда: выручка, выполнение и прогноз каждого; ссылка на страницу сотрудника', async () => {
    mockApi(base);
    renderApp('/app/sales?tab=team&month=2026-10');
    expect(await screen.findByRole('heading', { name: 'Продажи команды' })).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /Павел Соколов/ });
    expect(link).toHaveAttribute('href', '/app/sales/people/u-pavel?month=2026-10');
    expect(within(link).getByText(/Выручка 562 500 ₽ · 90 % плана в среднем/)).toBeInTheDocument();
    expect(within(link).getByText('86 862 ₽')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ксения Морозова/ })).toHaveTextContent('Вручную 9 000 ₽ · плана нет');
    // Поставить план тому, кого ещё нет в списке.
    const pick = (await screen.findByLabelText('Поставить план сотруднику')) as HTMLSelectElement;
    expect([...pick.options].map((o) => o.text)).toEqual(['Поставить план…', 'Олег Новиков']);
    for (const t of ['Мой месяц', 'Команда', 'Загрузки', 'Настройки']) expect(screen.getByRole('tab', { name: new RegExp(t) })).toBeInTheDocument();
  });

  it('страница сотрудника: месяц, задачи и что продаёт; новый показатель уходит с правилами', async () => {
    const calls = mockApi({ ...base, 'GET /sales/people/u-pavel': EMPLOYEE, 'GET /sales/groups': [{ path: 'КУРСЫ', name: 'КУРСЫ', depth: 0, revenue: 1 }], 'POST /sales/plans': plan('p-new') });
    renderApp('/app/sales/people/u-pavel?month=2026-10');
    expect(await screen.findByRole('heading', { name: 'Павел Соколов' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Команда/ }).map((a) => a.getAttribute('href'))).toContain('/app/sales?tab=team');
    const tasks = screen.getByRole('region', { name: 'Задачи сотрудника' });
    expect(within(tasks).getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Курс «Python для аналитиков»')).toBeInTheDocument();
    // Руководитель правит показатель, а не отмечает факт.
    expect(screen.getByRole('button', { name: 'Изменить «Выручка по курсам»' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Показатель' }));
    const dialog = screen.getByRole('dialog', { name: 'Новый показатель' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await within(dialog).findByText('Назовите показатель')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/sales/plans')).toBe(false);
    await userEvent.type(within(dialog).getByLabelText(/Название/), 'Выручка без ключевых');
    fireEvent.change(within(dialog).getByLabelText('Как считается факт'), { target: { value: 'revenue' } });
    await userEvent.click(await within(dialog).findByRole('button', { name: '+ КУРСЫ' }));
    fireEvent.change(within(dialog).getByLabelText('Клиенты'), { target: { value: 'non_key' } });
    await userEvent.type(within(dialog).getByLabelText('План, ₽'), '400 000');
    await userEvent.type(within(dialog).getByLabelText('Бонус, ₽'), '20000');
    const steps = within(dialog).getByLabelText('Пороги');
    await userEvent.clear(steps);
    await userEvent.type(steps, '100: 1{enter}90: 0,5');
    expect(within(dialog).getByText(/Выплата: от 100 % — 20 000 ₽, 90–100 % — 10 000 ₽/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/sales/plans')).toBe(true));
    expect(calls.find((c) => c.path === '/sales/plans')!.body).toEqual({
      name: 'Выручка без ключевых',
      unit: 'rub',
      plan: 400000,
      bonus: 20000,
      description: null,
      fact_rule: { type: 'revenue', groups: ['КУРСЫ'], clients: 'non_key', measure: 'revenue' },
      payout_rule: { type: 'threshold', steps: [{ from: 100, k: 1 }, { from: 90, k: 0.5 }], over: 'cap' },
      user_id: 'u-pavel',
      month: '2026-10',
    });
  });

  it('показатель из файла KPI: меняется только правило выплаты; удаление — с подтверждением', async () => {
    const filePlan = plan('p-file', { source: 'file', fact_rule: { type: 'manual' }, calc: calc({ source: 'file' }) });
    const calls = mockApi({
      ...base,
      'GET /sales/people/u-pavel': { ...EMPLOYEE, month: { ...PAVEL_MONTH, plans: [filePlan] } },
      'PATCH /sales/plans/p-file': filePlan,
      'DELETE /sales/plans/p-file': new Response(null, { status: 204 }),
    });
    renderApp('/app/sales/people/u-pavel?month=2026-10');
    await userEvent.click(await screen.findByRole('button', { name: 'Изменить «Выручка по курсам»' }));
    let dialog = screen.getByRole('dialog', { name: 'Правило выплаты' });
    expect(within(dialog).queryByLabelText(/Название/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Как считается выплата'), { target: { value: 'rate' } });
    await userEvent.type(within(dialog).getByLabelText('Процент от продаж'), '3,5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ payout_rule: { type: 'rate', rate: 0.035, min: 0 } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Изменить «Выручка по курсам»' }));
    dialog = screen.getByRole('dialog', { name: 'Правило выплаты' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    const confirm = screen.getByRole('dialog', { name: 'Удалить показатель?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/sales/plans/p-file')).toBe(true));
  });

  it('отчёт 1С: результат по менеджерам и путь к сопоставлению', async () => {
    const result: SalesReportImport = {
      report: { id: 'r1', file_name: 'Валовая.xlsx', period_start: '2026-10-01', period_end: '2026-10-18', month: '2026-10', total: 130500, warnings: [], uploaded_by_name: 'Наталья Белова', created_at: '2026-10-19T08:00:00Z', people: 2, unmatched: 1, can_delete: true },
      replaced: 1,
      people: [
        { manager: 'Соколов Павел', user: { id: 'u-pavel', name: 'Павел Соколов', position: null }, status: 'ok', total: 118500, key: 0, non_key: 118500, clients: 3, plans_updated: 2, error: null },
        { manager: 'Гусев Олег', user: null, status: 'unmatched', total: 12000, key: 0, non_key: 12000, clients: 1, plans_updated: 0, error: 'Сотрудник не найден — выберите вручную' },
      ],
      key_list_empty: true,
      warnings: ['Сумма по строкам расходится с «Итого» на 10 ₽'],
      goals_updated: 1,
    };
    const calls = mockApi({ ...base, 'GET /sales/reports': [result.report], 'GET /sales/lists': { key: [], merge: [] }, 'GET /sales/clients': [], 'GET /sales/unmatched': [], 'GET /sales/aliases': [], 'GET /sales/goal-links': [], 'GET /sales/goal-links/targets': { metrics: [], units: [], company: true } });
    const uploads = mockUploads(() => ({ data: result }));
    renderApp('/app/sales?tab=uploads&month=2026-10');
    await userEvent.upload(await screen.findByLabelText('Отчёт о продажах из 1С', { selector: 'input' }), new File(['x'], 'Валовая.xlsx'));
    expect(await screen.findByText('Отчёт 01.10–18.10: 130 500 ₽')).toBeInTheDocument();
    expect(uploads[0]!.path).toBe('/sales/reports');
    expect(screen.getByText('Заменил прежний: 1')).toBeInTheDocument();
    expect(screen.getByText('KPI целей обновлено: 1')).toBeInTheDocument();
    expect(screen.getByText('Сумма по строкам расходится с «Итого» на 10 ₽')).toBeInTheDocument();
    expect(screen.getByText('Не нашли сотрудника')).toBeInTheDocument();
    // Метка уже говорит «не нашли», подсказку с сервера не повторяем.
    expect(screen.queryByText('Сотрудник не найден — выберите вручную')).toBeNull();
    expect(screen.getByText(/Список ключевых клиентов пуст/)).toBeInTheDocument();
    // Из результата — в настройки, к сопоставлению.
    await userEvent.click(screen.getByRole('button', { name: 'Сопоставить' }));
    expect(await screen.findByRole('region', { name: 'Ключевые клиенты' })).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/sales/unmatched'))).toBe(true);
  });

  it('загруженный отчёт удаляется после подтверждения', async () => {
    const report = { id: 'r1', file_name: 'Валовая.xlsx', period_start: '2026-10-01', period_end: '2026-10-18', month: '2026-10', total: 130500, warnings: [], uploaded_by_name: 'Наталья Белова', created_at: '2026-10-19T08:00:00Z', people: 2, unmatched: 0, can_delete: true };
    const calls = mockApi({ ...base, 'GET /sales/reports': [report, { ...report, id: 'r2', file_name: 'Чужой.xlsx', can_delete: false }], 'DELETE /sales/reports/r1': new Response(null, { status: 204 }) });
    renderApp('/app/sales?tab=uploads&month=2026-10');
    expect(await screen.findByText('Чужой.xlsx')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить отчёт «Чужой.xlsx»' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Удалить отчёт «Валовая.xlsx»' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Удалить отчёт?' })).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/sales/reports/r1')).toBe(true));
    expect(await screen.findByText('Отчёт удалён, факт пересчитан')).toBeInTheDocument();
  });

  it('файл KPI: предпросмотр, выбор сотрудника и месяца, сохранение', async () => {
    const preview: KpiFilePreview = {
      sheets: [
        {
          sheet: 'Лист1',
          employee: 'Иванов Иван',
          month: '2026-11',
          suggested_user: null,
          has_results: false,
          warnings: ['Строка «Итого» не найдена'],
          metrics: [{ name: 'План продаж, руб (порог 90%)', kind: 'other', unit: 'rub', plan: 600000, fact: null, bonus: 30000, payment: null, percent: 0, rule: 'от 90 % — 30 000 ₽' }],
        },
      ],
      people: [{ id: 'u-pavel', name: 'Павел Соколов', position: 'Менеджер' }],
    };
    mockApi({ ...base, 'GET /sales/reports': [] });
    const uploads = mockUploads((u) => (u.fields.dry_run ? { status: 200, data: preview } : { data: { results: [{ sheet: 'Лист1', employee: 'Иванов Иван', user: { id: 'u-pavel', name: 'Павел Соколов', position: null }, month: '2026-11', created: 1, replaced: 2, error: null }] } }));
    renderApp('/app/sales?tab=uploads&month=2026-10');
    await userEvent.upload(await screen.findByLabelText('Файлы KPI сотрудников'), new File(['x'], 'kpi.xlsx'));
    expect(await screen.findByText('План продаж, руб (порог 90%)')).toBeInTheDocument();
    expect(uploads[0]!.fields).toEqual({ dry_run: '1' });
    expect(screen.getByText('Строка «Итого» не найдена')).toBeInTheDocument();
    expect(screen.getByText('600 000 ₽')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Загрузить показатели' });
    expect(save).toBeDisabled();
    expect((screen.getByLabelText('Месяц', { selector: 'input' }) as HTMLInputElement).value).toBe('2026-11');
    fireEvent.change(screen.getByLabelText(/Сотрудник/), { target: { value: 'u-pavel' } });
    await userEvent.click(save);
    expect(await screen.findByText(/показателей: 1, заменено: 2/)).toBeInTheDocument();
    expect(uploads[1]!.fields).toEqual({ user_id: 'u-pavel', month: '2026-11' });
    expect(uploads[1]!.path).toBe('/sales/kpi-files');
  });

  it('настройки: ключевые клиенты, сопоставление менеджера и KPI цели из продаж', async () => {
    const calls = mockApi({
      ...base,
      'GET /sales/lists': { key: [{ id: 'l1', kind: 'key', pattern: 'ГК «Меридиан»', created_by_name: 'Наталья Белова', created_at: '2026-10-01T00:00:00Z' }], merge: [] },
      'GET /sales/clients': [{ name: 'ООО «Вектор»', revenue: 90000, managers: ['Соколов Павел'], key: null, merge: null, key_hint: true }],
      'GET /sales/unmatched': [{ name: 'Гусев Олег', revenue: 275500, last_date: '2026-10-18' }],
      'GET /sales/aliases': [{ id: 'a1', name: 'Мишина А.', user: { id: 'u-pavel', name: 'Павел Соколов', position: null }, created_at: '2026-10-01T00:00:00Z' }],
      'GET /sales/goal-links': [
        { metric_id: 'm1', metric_name: 'Выручка за месяц', metric_unit: 'rub', goal_id: 'g1', goal_title: 'Выручка центра ДПО', measure: 'revenue', unit_id: 'unit1', unit_name: 'Центр ДПО', last_value: 1456000, last_month: '2026-09', can_edit: true },
      ],
      'GET /sales/goal-links/targets': { metrics: [{ metric_id: 'm2', metric_name: 'Новые клиенты', unit: 'count', goal_id: 'g2', goal_title: 'Рост клиентской базы' }], units: [{ id: 'unit1', name: 'Центр ДПО' }], company: false },
      'POST /sales/lists': { added: 2, skipped: 1, plans_updated: 3 },
      'POST /sales/aliases': { months: 2, lines: 14, plans_updated: 1, goals_updated: 0 },
      'POST /sales/goal-links': { metric_id: 'm2', goals_updated: 2 },
      'DELETE /sales/lists/l1': new Response(null, { status: 204 }),
    });
    renderApp('/app/sales?tab=settings&month=2026-10');
    const key = await screen.findByRole('region', { name: 'Ключевые клиенты' });
    expect(await within(key).findByText('ГК «Меридиан»')).toBeInTheDocument();
    await userEvent.type(within(key).getByLabelText('Добавить'), 'Альфа{enter}Бета');
    await userEvent.click(within(key).getByRole('button', { name: 'Добавить в список' }));
    expect(await screen.findByText('Добавлено: 2, пропущено повторов: 1 · пересчитано показателей: 3')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/sales/lists' && c.method === 'POST')!.body).toEqual({ kind: 'key', text: 'Альфа\nБета' });
    await userEvent.click(within(key).getByRole('button', { name: 'Убрать «ГК «Меридиан»»' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/sales/lists/l1')).toBe(true));

    // Клиент из отчёта, похожий на ключевого, — в список одной кнопкой.
    const clients = screen.getByRole('region', { name: 'Клиенты из отчётов' });
    expect(await within(clients).findByText('Похож на ключевого')).toBeInTheDocument();
    await userEvent.click(within(clients).getByRole('button', { name: 'В ключевые' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/sales/lists' && c.method === 'POST').at(-1)!.body).toEqual({ kind: 'key', text: 'ООО «Вектор»' }));

    const match = screen.getByRole('region', { name: 'Сопоставление менеджеров' });
    expect(await within(match).findByText('Гусев Олег')).toBeInTheDocument();
    expect(within(match).getByText('Мишина А. → Павел Соколов')).toBeInTheDocument();
    const go = within(match).getByRole('button', { name: 'Сопоставить' });
    expect(go).toBeDisabled();
    fireEvent.change(within(match).getByLabelText('Сотрудник для «Гусев Олег»'), { target: { value: 'u-pavel' } });
    await userEvent.click(go);
    expect(await screen.findByText('Строк отчётов перешло: 14 · пересчитано показателей: 1')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/sales/aliases' && c.method === 'POST')!.body).toEqual({ name: 'Гусев Олег', user_id: 'u-pavel' });

    const links = screen.getByRole('region', { name: 'KPI целей из продаж' });
    expect(await within(links).findByText('Выручка центра ДПО')).toBeInTheDocument();
    expect(within(links).getByText(/Сентябрь 2026: 1 456 000 ₽/)).toBeInTheDocument();
    fireEvent.change(within(links).getByLabelText('KPI цели'), { target: { value: 'm2' } });
    // Для KPI в штуках — штуки или клиенты; без «всей компании» нужно подразделение.
    expect([...(within(links).getByLabelText('Что считать') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['quantity', 'clients']);
    const link = within(links).getByRole('button', { name: 'Связать с продажами' });
    expect(link).toBeDisabled();
    fireEvent.change(within(links).getByLabelText('Что считать'), { target: { value: 'clients' } });
    fireEvent.change(within(links).getByLabelText('Чьи продажи'), { target: { value: 'unit1' } });
    await userEvent.click(link);
    expect(await screen.findByText('Связано · замеров добавлено: 2')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/sales/goal-links' && c.method === 'POST')!.body).toEqual({ metric_id: 'm2', measure: 'clients', unit_id: 'unit1' });
  });
});
