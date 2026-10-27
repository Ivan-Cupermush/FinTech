import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addMonths, monthOf, todayIso, type AccountProfile, type ChatSummary, type Member, type MyNote, type MyNoteSummary, type NoteRequestView, type NoteShareView, type PersonCard, type QrLoginInfo } from '@offix/core';
import { safeNext } from '../src/features/auth/LoginPage';
import { QrCode, qrMatrix } from '../src/ui/QrCode';
import type { Dashboard, Me, Notification } from '../src/lib/types';
import { TODAY } from './fixtures';
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

const today = todayIso();
const summary = (id: string, over: Partial<MyNoteSummary> = {}): MyNoteSummary => ({ id, title: `Заметка ${id}`, excerpt: 'Позвонить в бухгалтерию', note_date: today, is_favorite: false, files_count: 0, updated_at: `${today}T09:00:00.000Z`, ...over });
const myNote = (over: Partial<MyNote> = {}): MyNote => ({
  id: 'n1',
  title: 'План на день',
  body: '- [ ] позвонить в бухгалтерию\n- **отправить отчёт**',
  note_date: today,
  is_favorite: false,
  files_count: 0,
  updated_at: `${today}T09:00:00.000Z`,
  created_at: `${today}T09:00:00.000Z`,
  attachments: [],
  ...over,
});
const chat = (id: string, title: string, over: Partial<ChatSummary> = {}): ChatSummary => ({
  id,
  type: 'group',
  is_supergroup: false,
  title,
  peer: null,
  members_count: 7,
  last_message: null,
  unread: 0,
  pinned: false,
  muted: false,
  muted_until: null,
  created_at: '2026-10-01T10:00:00.000Z',
  activity_at: '2026-10-18T10:00:00.000Z',
  ...over,
});
const PROFILE: AccountProfile = {
  id: 'u-olga',
  email: 'olga@offix.demo',
  display_name: 'Ольга Смирнова',
  position: 'Руководитель офиса',
  avatar_url: null,
  role: 'manager',
  company_name: 'Демо-университет',
  last_login_at: '2026-10-18T08:00:00.000Z',
  password_changed_at: null,
  joined_at: '2026-09-01T08:00:00.000Z',
};
const QR = 'Q'.repeat(32);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('мои заметки', () => {
  it('календарь с точками, список дня и избранное', async () => {
    const calls = mockApi({
      ...base,
      'GET /my-notes': (c: { path: string }) => (c.path.includes('favorite=1') ? [summary('n2', { title: 'Шаблон письма', is_favorite: true })] : [summary('n1', { title: 'План на день', files_count: 2 })]),
      'GET /my-notes/days': [{ date: today, count: 2 }],
      'PATCH /my-notes/n1': myNote({ is_favorite: true }),
    });
    renderApp('/app/my-notes');
    expect(await screen.findByRole('heading', { level: 1, name: 'Мои заметки' })).toBeInTheDocument();
    const cal = screen.getByRole('grid');
    const day = await within(cal).findByRole('gridcell', { name: /заметок: 2/ });
    expect(day).toHaveAttribute('aria-current', 'date');
    expect(day.querySelectorAll('.mn-day-dots i')).toHaveLength(2);
    const row = await screen.findByRole('link', { name: /План на день/ });
    expect(row).toHaveAttribute('href', '/app/my-notes/n1');
    expect(row).toHaveTextContent('2');

    await userEvent.click(day);
    await waitFor(() => expect(calls.some((c) => c.path === `/my-notes?date=${today}`)).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: 'В избранное' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ is_favorite: true }));

    await userEvent.click(screen.getByRole('tab', { name: /Избранное/ }));
    expect(await screen.findByRole('link', { name: /Шаблон письма/ })).toBeInTheDocument();
  });

  it('месяцы листаются стрелками, пустой день зовёт записать', async () => {
    const calls = mockApi({ ...base, 'GET /my-notes': [], 'GET /my-notes/days': [] });
    renderApp(`/app/my-notes?date=${today}`);
    expect(await screen.findByText('В этот день заметок нет')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Записать на этот день' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    const next = addMonths(monthOf(today), 1);
    await waitFor(() => expect(calls.some((c) => c.path === `/my-notes/days?month=${next}`)).toBe(true));
  });

  it('новая заметка: пустую не сохранить, с текстом — POST с датой и переход', async () => {
    const created = myNote({ id: 'n9', title: 'Итоги встречи', body: 'Решили', note_date: '2026-10-20' });
    const calls = mockApi({ ...base, 'POST /my-notes': created, 'GET /my-notes/n9': created, 'GET /my-notes': [], 'GET /my-notes/days': [] });
    renderApp('/app/my-notes/new?date=2026-10-20');
    expect(await screen.findByLabelText('День')).toHaveValue('2026-10-20');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Напишите что-нибудь или прикрепите файл')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.type(screen.getByLabelText(/Заголовок/), 'Итоги встречи');
    await userEvent.type(screen.getByLabelText('Текст заметки'), 'Решили');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ title: 'Итоги встречи', body: 'Решили', note_date: '2026-10-20', is_favorite: false, attachment_ids: [] }));
    expect(await screen.findByRole('article', { name: 'Итоги встречи' })).toBeInTheDocument();
  });

  it('заметка: разметка, PDF с токеном и отправка в чат', async () => {
    const blob = vi.fn(async () => new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    const calls = mockApi({
      ...base,
      'GET /my-notes/n1': myNote(),
      'GET /my-notes/n1/pdf': blob,
      'GET /chats': [chat('c1', 'Команда офиса'), chat('c2', 'Игорь из IT', { type: 'private', members_count: 2 })],
      'POST /my-notes/n1/share': { id: 'm1' },
    });
    const url = vi.fn(() => 'blob:pdf');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() }));
    renderApp('/app/my-notes/n1');
    const sheet = await screen.findByRole('article', { name: 'План на день' });
    expect(within(sheet).getByText('отправить отчёт').tagName).toBe('STRONG');

    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() => expect(blob).toHaveBeenCalled());
    expect(calls.find((c) => c.path.startsWith('/my-notes/n1/pdf'))?.path).toBe('/my-notes/n1/pdf?download=1');
    const fetchInit = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([u]) => String(u).includes('/pdf'))![1];
    expect(new Headers(fetchInit.headers).get('Authorization')).toBe('Bearer test-token');

    await userEvent.click(screen.getByRole('button', { name: 'В чат' }));
    const dialog = await screen.findByRole('dialog', { name: 'Отправить заметку' });
    expect(within(dialog).getByRole('button', { name: 'Отправить' })).toBeDisabled();
    await userEvent.click(await within(dialog).findByRole('option', { name: /Команда офиса/ }));
    await userEvent.type(within(dialog).getByLabelText('Подпись'), 'На завтра');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/my-notes/n1/share')?.body).toMatchObject({ chat_id: 'c1', text: 'На завтра', topic_id: null }));
  });

  it('удалённая или чужая заметка — понятный экран', async () => {
    mockApi({ ...base, 'GET /my-notes/n404': apiError(404, 'Заметка не найдена') });
    renderApp('/app/my-notes/n404');
    expect(await screen.findByText('Заметка не найдена')).toBeInTheDocument();
    expect(screen.getByText(/даже администратору/)).toBeInTheDocument();
  });
});

describe('заметка в чате', () => {
  const share = (over: Partial<NoteShareView> = {}): NoteShareView => ({
    id: 's1',
    title: 'Регламент закупок',
    body: 'Сначала **заявка**, потом счёт',
    attachments: [],
    sender_id: 'u-igor',
    sender_name: 'Игорь Лебедев',
    created_at: '2026-10-18T10:00:00.000Z',
    is_owner: false,
    accepted_note_id: null,
    original_note_id: null,
    original_exists: true,
    my_request: null,
    ...over,
  });

  async function openShared(view: NoteShareView, routes: Record<string, unknown> = {}) {
    const { SharedNoteDialog } = await import('../src/features/my-notes/NoteDialogs');
    const calls = mockApi({ 'GET /my-notes/shared/s1': view, ...routes });
    const { QueryClientProvider } = await import('@tanstack/react-query');
    const { MemoryRouter } = await import('react-router-dom');
    const { createQueryClient } = await import('../src/App');
    const { ToastProvider } = await import('../src/ui/Toast');
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <SharedNoteDialog shareId="s1" onClose={() => {}} />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    return calls;
  }

  it('получатель сохраняет к себе и просит свежую версию', async () => {
    const calls = await openShared(share(), {
      'POST /my-notes/shared/s1/accept': myNote({ id: 'n7', title: 'Регламент закупок' }),
      'POST /my-notes/shared/s1/request': { id: 'r1', status: 'pending', result_note_id: null, created_at: TODAY, resolved_at: null, already: false },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Регламент закупок' });
    expect(within(dialog).getByText('заявка').tagName).toBe('STRONG');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить к себе' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/my-notes/shared/s1/accept')).toBe(true));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Запросить свежую версию' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/my-notes/shared/s1/request')).toBe(true));
    expect(await screen.findByText('Попросили автора поделиться свежей версией')).toBeInTheDocument();
  });

  it('уже сохранена — «Открыть у себя»; запрос в ожидании — повторно не просим', async () => {
    await openShared(share({ accepted_note_id: 'n7', my_request: { id: 'r1', status: 'pending', result_note_id: null, created_at: TODAY, resolved_at: null } }));
    const dialog = await screen.findByRole('dialog', { name: 'Регламент закупок' });
    expect(within(dialog).getByRole('button', { name: 'Открыть у себя' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Запросить свежую версию' })).not.toBeInTheDocument();
  });
});

describe('входящие: запрос заметки', () => {
  const request = (over: Partial<Notification> = {}): Notification => ({
    id: 'nt1',
    kind: 'note_request',
    title: 'Анна просит свежую версию «Регламент закупок»',
    body: null,
    goal_id: null,
    task_id: null,
    read_at: null,
    created_at: new Date().toISOString(),
    data: { request_id: 'r1' },
    actor_id: 'u-anna',
    actor_name: 'Анна Королёва',
    request_status: 'pending',
    ...over,
  });
  const view: NoteRequestView = {
    id: 'r1',
    status: 'approved',
    result_note_id: 'n8',
    created_at: TODAY,
    resolved_at: TODAY,
    is_owner: true,
    requester: { id: 'u-anna', name: 'Анна Королёва' },
    owner: { id: 'u-olga', name: 'Ольга Смирнова' },
    shared: { id: 's1', title: 'Регламент закупок', created_at: TODAY },
    note: { id: 'n1', title: 'Регламент закупок', preview: 'Сначала заявка', files_count: 0, updated_at: TODAY, changed_since_share: true },
  };

  it('отвечаем прямо из ленты: «Поделиться» уходит владельцу заметки', async () => {
    const calls = mockApi({ ...base, 'GET /notifications': [request()], 'POST /my-notes/requests/r1/approve': view, 'POST /notifications/read': null });
    renderApp('/app/notifications');
    const row = (await screen.findByText(/просит свежую версию/)).closest('.inbox-row') as HTMLElement;
    expect(row.querySelector('.inbox-ava')).not.toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Поделиться' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/my-notes/requests/r1/approve')).toBe(true));
    expect(await screen.findByText('Свежая версия у Анна')).toBeInTheDocument();
  });

  it('отвеченный запрос — без кнопок, с итогом; «Убрать прочитанные» чистит ленту', async () => {
    const calls = mockApi({ ...base, 'GET /notifications': [request({ request_status: 'declined', read_at: TODAY })], 'DELETE /notifications': null });
    renderApp('/app/notifications');
    expect(await screen.findByText('Вы отказали')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Убрать прочитанные' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/notifications?read=1')).toBe(true));
  });

  it('полная страница — «Показать ещё» просит более ранние', async () => {
    const page = Array.from({ length: 50 }, (_, i) => request({ id: `p${i}`, kind: 'comment', title: `Комментарий ${i}`, data: {}, actor_id: null, actor_name: null, request_status: null, created_at: new Date(Date.now() - i * 60_000).toISOString() }));
    const calls = mockApi({ ...base, 'GET /notifications': (c: { path: string }) => (c.path.includes('before=') ? [request({ id: 'old', title: 'Старое', kind: 'comment', request_status: null })] : page) });
    renderApp('/app/notifications');
    await userEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByText('Старое')).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/notifications?limit=50&before='))).toBe(true);
  });
});

describe('профиль', () => {
  it('смена пароля: проверка до сервера, новый токен — сразу в работу', async () => {
    const calls = mockApi({ ...base, 'GET /account': PROFILE, 'POST /account/password': { token: 'fresh-token' } });
    renderApp('/app/profile');
    const form = await screen.findByRole('form', { name: 'Смена пароля' });
    await userEvent.type(within(form).getByLabelText('Текущий пароль'), 'offix-demo');
    await userEvent.type(within(form).getByLabelText(/^Новый пароль/), '12345678');
    await userEvent.click(within(form).getByRole('button', { name: 'Сменить пароль' }));
    expect(await within(form).findByText(/слишком простой/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/account/password')).toBe(false);

    await userEvent.clear(within(form).getByLabelText(/^Новый пароль/));
    await userEvent.type(within(form).getByLabelText(/^Новый пароль/), 'тихий лес у реки');
    expect(form.querySelector('.pwd-strength')).not.toBeNull();
    await userEvent.type(within(form).getByLabelText('Повторите новый пароль'), 'тихий лес у реки');
    await userEvent.click(within(form).getByRole('button', { name: 'Сменить пароль' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/account/password')?.body).toEqual({ current_password: 'offix-demo', new_password: 'тихий лес у реки' }));
    await waitFor(() => expect(localStorage.getItem('offix.token')).toBe('fresh-token'));
  });

  it('свой QR — ссылка на профиль; выход на остальных устройствах меняет токен', async () => {
    const calls = mockApi({ ...base, 'GET /account': PROFILE, 'POST /account/logout-all': { token: 'kept-token' } });
    renderApp('/app/profile');
    const qr = await screen.findByRole('img', { name: 'QR-код профиля: Ольга Смирнова' });
    expect(qr.querySelectorAll('path').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Выйти на всех устройствах' }));
    const dialog = await screen.findByRole('dialog', { name: 'Выйти на всех устройствах?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Выйти на остальных' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/account/logout-all')?.body).toEqual({ keep_current: true }));
    await waitFor(() => expect(localStorage.getItem('offix.token')).toBe('kept-token'));
  });
});

describe('коллеги', () => {
  const person: PersonCard = {
    id: 'u-igor',
    display_name: 'Игорь Лебедев',
    my_name: null,
    position: 'Инженер',
    email: 'igor@offix.demo',
    avatar_url: null,
    role: 'manager',
    active: true,
    units: [{ id: 'unit1', name: 'IT', is_manager: true }],
    online: false,
    last_seen_at: null,
    is_me: false,
  };

  it('своё имя для коллеги: PUT и подпись «Настоящее имя»', async () => {
    let card = person;
    const calls = mockApi({
      ...base,
      'GET /contacts/u-igor': () => card,
      'GET /contacts/u-igor/groups': [],
      'PUT /contacts/u-igor/name': (c: { body: unknown }) => {
        card = { ...person, my_name: (c.body as { name: string }).name };
        return { user_id: 'u-igor', name: card.my_name };
      },
    });
    renderApp('/app/people/u-igor');
    expect(await screen.findByRole('heading', { level: 1, name: 'Игорь Лебедев' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Изменить контакт' }));
    const dialog = await screen.findByRole('dialog', { name: 'Изменить контакт' });
    await userEvent.type(within(dialog).getByLabelText(/Имя для себя/), 'Игорь из IT');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'Игорь из IT' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Игорь из IT' })).toBeInTheDocument();
    expect(screen.getByText(/Настоящее имя — Игорь Лебедев/)).toBeInTheDocument();
  });

  it('администратор сбрасывает пароль и видит временный один раз', async () => {
    const members: Member[] = [
      { id: 'u-olga', display_name: 'Ольга Смирнова', position: null, email: 'olga@offix.demo', active: true, role: 'admin', units: [] },
      { id: 'u-anna', display_name: 'Анна Королёва', position: null, email: 'anna@offix.demo', active: true, role: 'member', units: [] },
    ];
    const calls = mockApi({ ...base, 'GET /users/me': { ...ME, role: 'admin' }, 'GET /users': members, 'GET /org/units': [], 'POST /users/u-anna/reset-password': { password: 'Ab3d-9fGh-Xy2z' } });
    renderApp('/app/org');
    await userEvent.click(await screen.findByRole('tab', { name: 'Сотрудники' }));
    expect(await screen.findByRole('link', { name: 'Анна Королёва' })).toHaveAttribute('href', '/app/people/u-anna');
    expect(screen.queryByRole('button', { name: 'Сбросить пароль: Ольга Смирнова' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить пароль: Анна Королёва' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Сбросить пароль?' })).getByRole('button', { name: 'Сбросить' }));
    expect(await screen.findByText('Ab3d-9fGh-Xy2z')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/users/u-anna/reset-password')?.body).toEqual({});
  });
});

describe('вход по QR', () => {
  it('сайт показывает код, телефон подтвердил — вход и переход по ?next', async () => {
    const calls = mockApi({
      ...base,
      'POST /auth/qr': { token: QR, secret: 'S'.repeat(43), expires_at: new Date(Date.now() + 90_000).toISOString(), ttl: 90 },
      'POST /auth/qr/poll': { status: 'approved', token: 'qr-token', user: { id: 'u-olga', display_name: 'Ольга Смирнова', role: 'manager' }, company: { id: 'c1', name: 'Демо-университет' } },
      'GET /my-notes': [],
      'GET /my-notes/days': [],
    });
    renderApp('/login?next=/app/my-notes', { token: null });
    await userEvent.click(await screen.findByRole('button', { name: /По QR-коду с телефона/ }));
    await waitFor(() => expect(localStorage.getItem('offix.token')).toBe('qr-token'));
    expect(calls.find((c) => c.path === '/auth/qr/poll')?.body).toEqual({ token: QR, secret: 'S'.repeat(43) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Мои заметки' })).toBeInTheDocument();
  });

  it('отсканировали — подсказка на коде; отклонили — «Новый код»', async () => {
    let answer: unknown = { status: 'scanned', user: { display_name: 'Ольга Смирнова' } };
    mockApi({
      'POST /auth/qr': { token: QR, secret: 'S'.repeat(43), expires_at: new Date(Date.now() + 90_000).toISOString(), ttl: 90 },
      'POST /auth/qr/poll': () => answer,
    });
    renderApp('/login', { token: null });
    await userEvent.click(await screen.findByRole('button', { name: /По QR-коду с телефона/ }));
    expect(await screen.findByRole('img', { name: 'QR-код для входа' })).toBeInTheDocument();
    expect(await screen.findByText('Ольга, подтвердите вход на телефоне')).toBeInTheDocument();
    answer = { status: 'declined' };
    expect(await screen.findByText('Вход отклонён на телефоне', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Новый код' })).toBeInTheDocument();
  });

  it('телефон: устройство и явное «Подтвердить вход»', async () => {
    const info: QrLoginInfo = { status: 'scanned', device: { kind: 'desktop', label: 'Chrome на Windows' }, ip: '10.0.0.7', created_at: TODAY, expires_at: TODAY };
    const calls = mockApi({ ...base, [`GET /account/qr/${QR}`]: info, [`POST /account/qr/${QR}/approve`]: { ...info, status: 'approved' } });
    renderApp(`/qr/${QR}`);
    expect(await screen.findByRole('heading', { name: 'Войти в offix на этом устройстве?' })).toBeInTheDocument();
    expect(screen.getByText('Chrome на Windows')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.7')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/approve'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить вход' }));
    expect(await screen.findByRole('heading', { name: 'Вход подтверждён' })).toBeInTheDocument();
  });

  it('телефон: чужой и устаревший код, без входа — на страницу входа с возвратом', async () => {
    mockApi({ ...base, [`GET /account/qr/${QR}`]: apiError(403, 'Код уже отсканирован') });
    renderApp(`/qr/${QR}`);
    expect(await screen.findByRole('heading', { name: 'Код уже занят' })).toBeInTheDocument();
    cleanup();
    mockApi({ ...base });
    renderApp('/qr/not-a-code');
    expect(await screen.findByRole('heading', { name: 'Это не код входа offix' })).toBeInTheDocument();
    cleanup();
    mockApi({});
    renderApp(`/qr/${QR}`, { token: null });
    expect(await screen.findByRole('button', { name: /По QR-коду с телефона/ })).toBeInTheDocument();
  });

  it('safeNext пускает только свои адреса', () => {
    expect(safeNext('/qr/abc')).toBe('/qr/abc');
    expect(safeNext('//evil.example')).toBe('/app');
    expect(safeNext('https://evil.example')).toBe('/app');
    expect(safeNext('/login?next=/app')).toBe('/app');
    expect(safeNext(null)).toBe('/app');
  });
});

describe('QR-код', () => {
  it('матрица с запасом на знак offix в центре', () => {
    const m = qrMatrix('https://offix.example/app/people/u-1');
    expect(m.size).toBeGreaterThanOrEqual(25);
    render(<QrCode value="https://offix.example/app/people/u-1" size={160} label="QR-код профиля" faded />);
    const img = screen.getByRole('img', { name: 'QR-код профиля' });
    expect(img).toHaveClass('qr', 'is-faded');
    expect(img.getAttribute('width')).toBe('160');
  });
});
