import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanyModules, SandboxInfo } from '@offix/core';
import type { Dashboard, Me } from '../src/lib/types';
import { TODAY } from './fixtures';
import { apiError, mockApi, renderApp } from './render';

const ALL_ON: CompanyModules = { sales: true, chats: true, knowledge_ai: true, my_notes: true, integrations: true };
const UNI: CompanyModules = { ...ALL_ON, sales: false };

const me = (over: Partial<Me> = {}): Me => ({
  id: 'u-rector',
  email: 'rector',
  display_name: 'Алексей Звездин',
  position: 'Ректор',
  role: 'owner',
  company_id: 'c1',
  company_name: 'Университет · песочница',
  setup_mode: 'structured',
  units: [],
  modules: ALL_ON,
  ...over,
});

const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const base = (m: Me) => ({ 'GET /users/me': m, 'GET /dashboard': DASH, 'GET /chats/unread': { unread: 0 } });

/** Боковое меню сайта: на телефоне вместо него — нижняя панель без админских пунктов. */
const sidebar = () => document.querySelector<HTMLElement>('.sidebar')!;

const SANDBOX: SandboxInfo = {
  enabled: true,
  company_name: 'Университет · песочница',
  people: [
    { login: 'rector', password: 'rector', display_name: 'Алексей Звездин', position: 'Ректор', role: 'owner', blurb: 'Видит весь университет' },
    { login: 'spec', password: 'spec', display_name: 'Анна Заявкина', position: 'Специалист по работе с заявками', role: 'member', blurb: 'Свои задачи и чаты' },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('песочница на странице входа', () => {
  it('без песочницы карточки нет, и поле — «Почта»', async () => {
    mockApi({ 'GET /auth/sandbox': { enabled: false, company_name: null, people: [] } });
    renderApp('/login', { token: null });
    expect(await screen.findByText('Демо — войти как')).toBeInTheDocument();
    expect(screen.getByLabelText('Почта')).toBeInTheDocument();
    expect(screen.queryByText('Песочница для жюри')).not.toBeInTheDocument();
  });

  it('в песочнице — люди с логинами и паролями, щелчок входит', async () => {
    const calls = mockApi({ 'GET /auth/sandbox': SANDBOX, 'POST /auth/login': { token: 'sbx-token' }, ...base(me({ modules: UNI })) });
    renderApp('/login', { token: null });
    const card = (await screen.findByText('Песочница для жюри')).closest('section')!;
    expect(within(card).getByText('Университет · песочница')).toBeInTheDocument();
    expect(within(card).getAllByText('rector')).toHaveLength(2);
    expect(screen.getByLabelText('Логин или почта')).toBeInTheDocument();
    expect(screen.queryByText('Демо — войти как')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Войти: Анна Заявкина/ }));
    await waitFor(() => expect(calls.find((c) => c.path === '/auth/login')?.body).toEqual({ email: 'spec', password: 'spec' }));
    await waitFor(() => expect(localStorage.getItem('offix.token')).toBe('sbx-token'));
  });

  it('пока сервер не ответил про песочницу, демо-люди не мелькают', async () => {
    let answer!: (v: unknown) => void;
    mockApi({ 'GET /auth/sandbox': () => new Promise((r) => (answer = r)) });
    const { container } = renderApp('/login', { token: null });
    await waitFor(() => expect(container.querySelector('.auth.is-checking')).not.toBeNull());
    expect(screen.queryByText('Демо — войти как')).not.toBeInTheDocument();
    expect(screen.queryByText('Алексей Петров')).not.toBeInTheDocument();
    answer(SANDBOX);
    expect(await screen.findByText('Песочница для жюри')).toBeInTheDocument();
    expect(container.querySelector('.auth.is-checking')).toBeNull();
    expect(screen.queryByText('Демо — войти как')).not.toBeInTheDocument();
  });

  it('если сервер про песочницу не ответил, обычный вход с демо-людьми', async () => {
    mockApi({ 'GET /auth/sandbox': () => apiError(500, 'нет') });
    renderApp('/login', { token: null });
    expect(await screen.findByText('Демо — войти как')).toBeInTheDocument();
    expect(screen.queryByText('Песочница для жюри')).not.toBeInTheDocument();
  });

  it('логин без почты проходит проверку формы', async () => {
    const calls = mockApi({ 'GET /auth/sandbox': SANDBOX, 'POST /auth/login': { token: 't' }, ...base(me()) });
    renderApp('/login', { token: null });
    await userEvent.type(await screen.findByLabelText('Логин или почта'), 'method');
    await userEvent.type(screen.getByLabelText('Пароль'), 'method');
    await userEvent.click(screen.getByRole('button', { name: /^Войти$/ }));
    await waitFor(() => expect(calls.find((c) => c.path === '/auth/login')?.body).toEqual({ email: 'method', password: 'method' }));
  });
});

describe('меню по функциям компании', () => {
  it('выключенные разделы пропадают из меню, «Функции компании» — только у администратора', async () => {
    mockApi(base(me({ modules: { ...UNI, chats: false } })));
    renderApp('/app');
    const nav = sidebar();
    await waitFor(() => expect(within(nav).getByRole('link', { name: /Функции компании/ })).toBeInTheDocument());
    expect(within(nav).queryByRole('link', { name: /Продажи/ })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Чаты/ })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Мои заметки/ })).toBeInTheDocument();
  });

  it('у сотрудника нет пункта «Функции компании», а включённые разделы на месте', async () => {
    mockApi(base(me({ role: 'member', modules: ALL_ON })));
    renderApp('/app');
    const nav = sidebar();
    await waitFor(() => expect(within(nav).getByRole('link', { name: /Продажи/ })).toBeInTheDocument());
    expect(within(nav).queryByRole('link', { name: /Функции компании/ })).not.toBeInTheDocument();
  });

  it('прямая ссылка на выключенный раздел — «Раздел выключен», а не ошибка', async () => {
    const calls = mockApi(base(me({ role: 'member', modules: UNI })));
    renderApp('/app/sales');
    expect(await screen.findByText('Раздел выключен')).toBeInTheDocument();
    expect(screen.getByText(/«Продажи и выплаты» в вашей компании не используется/)).toBeInTheDocument();
    expect(screen.getByText(/попросите владельца или администратора/)).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/sales'))).toBe(false);
  });

  it('без ИИ-помощника в базе знаний нет «Документов» и строки вопроса', async () => {
    mockApi({ ...base(me({ modules: { ...ALL_ON, knowledge_ai: false } })), 'GET /notes': [] });
    renderApp('/app/notes');
    expect(await screen.findByRole('heading', { level: 1, name: 'База знаний' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Документы/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Документы/ })).not.toBeInTheDocument();
  });
});

describe('экран «Функции компании»', () => {
  it('карточки разделов: переключатель, описание и что пропадёт; изменение уходит на сервер', async () => {
    let state = UNI;
    const calls = mockApi({
      ...base(me({ modules: UNI })),
      'GET /company/modules': () => ({ modules: state, can_change: true }),
      'GET /company/modules/history': [{ id: 1, created_at: '2026-11-02T10:00:00Z', actor_name: 'Алексей Звездин', old_values: { sales: true }, new_values: { sales: false, preset: 'university' } }],
      'PUT /company/modules': (c: { body: { modules?: Partial<CompanyModules>; preset?: string } }) => {
        state = c.body.preset === 'company' ? ALL_ON : { ...state, ...c.body.modules };
        return { modules: state, can_change: true };
      },
    });
    renderApp('/app/company');
    expect(await screen.findByRole('heading', { level: 1, name: 'Функции компании' })).toBeInTheDocument();
    const sales = await screen.findByRole('switch', { name: 'Продажи и выплаты' });
    expect(sales).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Чаты' })).toBeChecked();
    expect(screen.getByText(/Планы продаж, ежедневные отчёты/)).toBeInTheDocument();
    expect(await screen.findByText('Набор «Университет» — выключил: Продажи и выплаты')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Университет/ })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('switch', { name: 'Чаты' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ modules: { chats: false } }));
    expect(await screen.findByText(/«Чаты» — выключено для всей компании/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Чаты' })).not.toBeChecked());

    await userEvent.click(screen.getByRole('button', { name: /Компания/ }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ preset: 'company' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Продажи и выплаты' })).toBeChecked());
  });

  it('сотрудник видит, что включено, но переключить не может', async () => {
    mockApi({ ...base(me({ role: 'member', modules: UNI })), 'GET /company/modules': { modules: UNI, can_change: false } });
    renderApp('/app/company');
    expect(await screen.findByText(/Менять их может владелец или администратор/)).toBeInTheDocument();
    for (const s of screen.getAllByRole('switch')) expect(s).toBeDisabled();
    expect(screen.queryByText('Журнал изменений')).not.toBeInTheDocument();
  });
});
