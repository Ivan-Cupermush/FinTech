import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRIVACY_SECTIONS, type AccountProfile, type AuditRow, type CompanyModules, type LoginEvent, type Member, type SecuritySummary } from '@offix/core';
import { consentLine, exportName } from '../src/features/security/MyData';
import { leaversOf } from '../src/features/security/SecurityPage';
import type { Dashboard, Me } from '../src/lib/types';
import { TODAY } from './fixtures';
import { mockApi, renderApp } from './render';

const UNI: CompanyModules = { sales: false, chats: true, knowledge_ai: true, my_notes: true, integrations: true };
const me = (over: Partial<Me> = {}): Me => ({
  id: 'u-rector',
  email: 'rector',
  display_name: 'Алексей Звездин',
  position: 'Ректор',
  role: 'owner',
  company_id: 'c1',
  company_name: 'Университет',
  setup_mode: 'structured',
  units: [],
  modules: UNI,
  ...over,
});
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const base = (m: Me) => ({ 'GET /users/me': m, 'GET /dashboard': DASH, 'GET /chats/unread': { unread: 0 } });

const login = (id: string, over: Partial<LoginEvent> = {}): LoginEvent => ({ id, at: '2026-11-02T09:05:00.000Z', ok: true, method: 'password', failure: null, ip: '10.0.0.7', device: 'Chrome на Windows', ...over });
const member = (id: string, over: Partial<Member> = {}): Member => ({ id, display_name: `Сотрудник ${id}`, position: null, email: `${id}@uni.ru`, active: true, role: 'member', units: [], ...over });
const SUMMARY: SecuritySummary = { logins_7d: 42, failures_7d: 3, lockouts_7d: 1, dormant: 0, to_anonymize: 1, default_passwords: 0 };
const event = (id: string, over: Partial<AuditRow> = {}): AuditRow => ({
  id,
  at: '2026-11-02T10:00:00.000Z',
  event_type: 'member.password_reset',
  entity_type: 'member',
  entity_id: 'u2',
  actor_id: 'u-rector',
  actor_name: 'Алексей Звездин',
  target_name: 'Анна Заявкина',
  old_values: null,
  new_values: null,
  ...over,
});
const PROFILE: AccountProfile = {
  id: 'u-rector',
  email: 'rector@uni.ru',
  display_name: 'Алексей Звездин',
  position: 'Ректор',
  avatar_url: null,
  role: 'owner',
  company_name: 'Университет',
  last_login_at: '2026-11-02T08:00:00.000Z',
  password_changed_at: null,
  joined_at: '2026-09-01T08:00:00.000Z',
  consent_version: '2026-11-02',
  consent_at: '2026-11-02T08:00:00.000Z',
};

const sidebar = () => document.querySelector<HTMLElement>('.sidebar')!;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('меню не мигает выключенными разделами', () => {
  it('пока профиль не пришёл, «Продаж» в меню нет; пришёл с выключенными — так и нет', async () => {
    let answer!: (v: unknown) => void;
    mockApi({ 'GET /users/me': () => new Promise((r) => (answer = r)), 'GET /dashboard': DASH, 'GET /chats/unread': { unread: 0 } });
    renderApp('/app');
    await waitFor(() => expect(within(sidebar()).getByRole('link', { name: /Цели/ })).toBeInTheDocument());
    expect(within(sidebar()).queryByRole('link', { name: /Продажи/ })).not.toBeInTheDocument();
    answer(me());
    await waitFor(() => expect(within(sidebar()).getByRole('link', { name: /Безопасность/ })).toBeInTheDocument());
    expect(within(sidebar()).queryByRole('link', { name: /Продажи/ })).not.toBeInTheDocument();
  });

  it('«Безопасность» в меню только у владельца и администратора', async () => {
    mockApi(base(me({ role: 'member' })));
    renderApp('/app');
    await waitFor(() => expect(within(sidebar()).getByRole('link', { name: /Мои заметки/ })).toBeInTheDocument());
    expect(within(sidebar()).queryByRole('link', { name: /Безопасность/ })).not.toBeInTheDocument();
  });
});

describe('политика и согласие', () => {
  it('страница политики открывается без входа и содержит все разделы', async () => {
    mockApi({});
    renderApp('/privacy', { token: null });
    expect(await screen.findByRole('heading', { level: 1, name: 'Политика обработки персональных данных' })).toBeInTheDocument();
    for (const s of PRIVACY_SECTIONS) expect(screen.getByRole('heading', { name: new RegExp(s.title) })).toBeInTheDocument();
    expect(screen.getAllByText(/152-ФЗ/).length).toBeGreaterThan(0);
  });

  it('регистрация без галочки согласия не уходит на сервер; с галочкой — consent: true', async () => {
    const calls = mockApi({ 'GET /auth/sandbox': { enabled: false, company_name: null, people: [] }, 'POST /auth/register': { token: 'new-token' }, ...base(me()) });
    renderApp('/login', { token: null });
    await userEvent.click(await screen.findByRole('tab', { name: 'Новая компания' }));
    await userEvent.type(screen.getByLabelText('Организация'), 'Колледж');
    await userEvent.type(screen.getByLabelText('Как вас зовут'), 'Ирина Петрова');
    await userEvent.type(screen.getByLabelText('Почта'), 'irina@college.ru');
    await userEvent.type(screen.getByLabelText('Пароль'), 'длинный пароль');
    await userEvent.click(screen.getByRole('button', { name: /Создать и начать/ }));
    expect(await screen.findByText('Подтвердите согласие на обработку персональных данных')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/register')).toBe(false);
    expect(screen.getByRole('link', { name: 'политике offix' })).toHaveAttribute('href', '/privacy');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /Создать и начать/ }));
    await waitFor(() => expect(calls.find((c) => c.path === '/auth/register')?.body).toMatchObject({ email: 'irina@college.ru', consent: true }));
  });
});

describe('профиль: входы и мои данные', () => {
  it('последние входы с неудачной попыткой и скачивание файла с данными', async () => {
    const logins = [login('3', { ok: false, failure: 'bad_password', ip: '203.0.113.9' }), login('2', { method: 'qr' }), login('1')];
    const calls = mockApi({ ...base(me()), 'GET /account': PROFILE, 'GET /functions/me': { functions: [], can_change: false, reason: null }, 'GET /account/logins': logins, 'GET /account/export': () => new Response('{"format":"offix-personal-data"}', { status: 200 }) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderApp('/app/profile');
    const card = (await screen.findByRole('heading', { name: /Безопасность и мои данные/ })).closest('section')!;
    expect(await within(card).findByText('Неверный пароль')).toBeInTheDocument();
    expect(within(card).getByText('QR-код')).toBeInTheDocument();
    expect(within(card).getByText(/203\.0\.113\.9/)).toBeInTheDocument();
    expect(within(card).getByText(/Неудачных попыток входа среди последних: 1/)).toBeInTheDocument();
    expect(within(card).getByText(/Согласие на обработку данных дано/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: /Скачать мои данные/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(calls.some((c) => c.path === '/account/export')).toBe(true);
    expect(within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('link', { name: /Безопасность/ })).toHaveAttribute('href', '/app/security');
  });

  it('согласие и имя файла', () => {
    expect(consentLine({ consent_at: null })).toMatch(/создал администратор/);
    expect(exportName('2026-11-02')).toBe('offix-moi-dannye-2026-11-02.json');
  });
});

describe('раздел «Безопасность»', () => {
  const routes = (over: Record<string, unknown> = {}) => ({
    ...base(me()),
    'GET /security/summary': { summary: SUMMARY, advice: [{ tone: 'bad', text: 'За неделю вход закрывался 1 раз после подбора пароля' }] },
    'GET /security/audit': (c: { path: string }) =>
      c.path.includes('before=e2') ? { events: [event('e1', { event_type: 'member.anonymized', target_name: 'Бывший сотрудник 1' })], next: null } : { events: [event('e3', { event_type: 'login.locked', actor_name: null, actor_id: null }), event('e2')], next: 'e2' },
    'GET /security/logins': (c: { path: string }) => ({ logins: c.path.includes('failed=1') ? [login('9', { ok: false, failure: 'locked', display_name: 'Анна Заявкина' })] : [login('8', { display_name: 'Алексей Звездин' })], next: null }),
    'GET /users': [member('u-rector', { role: 'owner' }), member('gone', { active: false, display_name: 'Игорь Ушедший' }), member('anon', { active: false, anonymized: true })],
    ...over,
  });

  it('сводка, совет и журнал с подгрузкой и выгрузкой для Excel', async () => {
    const calls = mockApi({ ...routes(), 'GET /security/audit?group=security&format=csv': () => new Response('﻿Когда', { status: 200 }) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderApp('/app/security');
    expect(await screen.findByText('За неделю вход закрывался 1 раз после подбора пароля')).toBeInTheDocument();
    expect(screen.getByText('ждут обезличивания')).toBeInTheDocument();
    expect((await screen.findAllByText(/Анна Заявкина/)).length).toBeGreaterThan(0);
    expect(screen.getByText('Система')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByText(/Бывший сотрудник 1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Скачать для Excel/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(calls.some((c) => c.path === '/security/audit?group=security&format=csv')).toBe(true);
  });

  it('входы: фильтр неудачных', async () => {
    const calls = mockApi(routes());
    renderApp('/app/security');
    await userEvent.click(await screen.findByRole('tab', { name: /Входы/ }));
    expect(await screen.findByText(/Алексей Звездин ·/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Неудачные' }));
    expect(await screen.findByText('Вход временно закрыт')).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/security/logins?failed=1'))).toBe(true);
  });

  it('ушедшие: только отключённые и не обезличенные; обезличивание — после подтверждения', async () => {
    const calls = mockApi({ ...routes(), 'POST /users/gone/anonymize': { ok: true, name: 'Бывший сотрудник 2' } });
    renderApp('/app/security');
    await userEvent.click(await screen.findByRole('tab', { name: /Ушедшие сотрудники/ }));
    expect(await screen.findByText('Игорь Ушедший')).toBeInTheDocument();
    expect(screen.queryByText('Сотрудник anon')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Обезличить/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Это нельзя отменить/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/users/gone/anonymize')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: /Обезличить навсегда/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/users/gone/anonymize')).toBe(true));
    expect(await screen.findByText(/Бывший сотрудник 2/)).toBeInTheDocument();
  });

  it('сотрудник без прав видит пояснение, а не журнал', async () => {
    const calls = mockApi(base(me({ role: 'member' })));
    renderApp('/app/security');
    expect(await screen.findByText('Раздел видят владелец и администратор')).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/security'))).toBe(false);
  });

  it('leaversOf не трогает владельца и уже обезличенных', () => {
    const list = [member('o', { role: 'owner', active: false }), member('a', { active: false }), member('b', { active: false, anonymized: true }), member('c')];
    expect(leaversOf(list).map((m) => m.id)).toEqual(['a']);
  });
});

describe('организация: сотрудник ушёл', () => {
  it('администратор отключает с подтверждением, отключённого можно вернуть или обезличить', async () => {
    const calls = mockApi({
      ...base(me({ role: 'admin', id: 'u-admin' })),
      'GET /org/units': [],
      'GET /users': [member('u-anna', { display_name: 'Анна Королёва' }), member('gone', { display_name: 'Игорь Ушедший', active: false }), member('anon', { display_name: 'Бывший сотрудник 1', active: false, anonymized: true })],
      'PATCH /users/u-anna': { id: 'u-anna', active: false },
    });
    renderApp('/app/org');
    await userEvent.click(await screen.findByRole('tab', { name: 'Сотрудники' }));
    await screen.findByRole('link', { name: 'Анна Королёва' });
    expect(calls.some((c) => c.path.startsWith('/users?') && c.path.includes('include_inactive=1'))).toBe(true);
    expect(screen.getByText('· данные обезличены')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вернуть доступ: Игорь Ушедший' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Обезличить: Игорь Ушедший' })).toHaveAttribute('href', '/app/security');
    expect(screen.queryByRole('button', { name: 'Вернуть доступ: Бывший сотрудник 1' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Отключить: Анна Королёва' }));
    const dialog = await screen.findByRole('dialog', { name: 'Отключить Анна Королёва?' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Отключить/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/users/u-anna')?.body).toEqual({ active: false }));
  });
});
