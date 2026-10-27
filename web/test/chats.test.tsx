import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatDetail, ChatHistory, ChatMessage, ChatPoll, ChatSummary, Me, Member } from '@offix/core';
import { lastSocket } from './fake-socket';
import { mockApi, renderApp, type Call } from './render';

const ME: Me = {
  id: 'u-dir',
  email: 'director@offix.demo',
  display_name: 'Алексей Петров',
  position: 'Директор',
  role: 'owner',
  company_id: 'c1',
  company_name: 'Демо-университет',
  setup_mode: 'structured',
  units: [],
};
const person = (id: string, display_name: string, position: string): Member => ({ id, display_name, position, email: `${id}@offix.demo`, active: true, role: 'member', units: [] });
const USERS = [person('u-anna', 'Анна Королёва', 'Специалист приёмной'), person('u-olga', 'Ольга Смирнова', 'Руководитель офиса'), person('u-igor', 'Игорь Лебедев', 'Аналитик')];

const at = (h: number, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const summary = (id: string, over: Partial<ChatSummary> = {}): ChatSummary => ({
  id,
  type: 'group',
  is_supergroup: false,
  title: `Чат ${id}`,
  peer: null,
  members_count: 4,
  last_message: null,
  unread: 0,
  pinned: false,
  muted: false,
  muted_until: null,
  created_at: at(8),
  activity_at: at(8),
  ...over,
});

const msg = (id: string, seq: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  chat_id: 'c-team',
  seq,
  topic_id: null,
  kind: 'text',
  sender_id: 'u-anna',
  sender_name: 'Анна Королёва',
  text: `Сообщение ${id}`,
  created_at: at(9, seq),
  edited_at: null,
  deleted: false,
  pinned: false,
  client_id: null,
  reply_to: null,
  external_reply: null,
  forwarded_from: null,
  reactions: [],
  poll: null,
  read: false,
  attachments: [],
  contact: null,
  listened: false,
  ...over,
});

const TEAM = summary('c-team', {
  title: 'Цифровая приёмная',
  unread: 2,
  members_count: 3,
  last_message: { id: 'm3', sender_name: 'Анна Королёва', sender_id: 'u-anna', text: 'Очередь разобрана', kind: 'text', deleted: false, created_at: at(9, 3) },
  activity_at: at(9, 3),
});
const OLGA = summary('c-olga', {
  type: 'private',
  title: 'Ольга Смирнова',
  members_count: 2,
  peer: { id: 'u-olga', display_name: 'Ольга Смирнова', position: 'Руководитель офиса', online: false, last_seen_at: at(7) },
  last_message: { id: 'o1', sender_name: 'Алексей Петров', sender_id: 'u-dir', text: 'Созвонимся после обеда', kind: 'text', deleted: false, created_at: at(8, 30) },
  activity_at: at(8, 30),
  pinned: true,
});

const member = (id: string, display_name: string, role: 'creator' | 'admin' | 'member' = 'member') => ({ id, display_name, position: null, role, permissions: [], online: false, last_seen_at: null });
const TEAM_DETAIL: ChatDetail = {
  ...TEAM,
  created_by: 'u-dir',
  members: [member('u-dir', 'Алексей Петров', 'creator'), member('u-anna', 'Анна Королёва'), member('u-olga', 'Ольга Смирнова')],
  my_rights: ['change_info', 'delete_messages', 'ban_users', 'invite_users', 'pin_messages', 'add_admins', 'add_users', 'manage_topics'] as ChatDetail['my_rights'],
  can_manage_topics: true,
  topics: [],
  my_last_read_seq: 1,
  others_read_seq: 3,
};

const POLL: ChatPoll = {
  id: 'p1',
  question: 'Когда созвон по приёмной?',
  anonymous: false,
  multiple: false,
  quiz: false,
  closed: false,
  explanation: null,
  total_voters: 0,
  voted: false,
  options: [
    { id: 'o-a', text: 'Во вторник', votes: 0, voted: false },
    { id: 'o-b', text: 'В среду', votes: 0, voted: false },
  ],
};

const HISTORY: ChatHistory = {
  messages: [
    msg('m1', 1, { sender_id: 'u-dir', sender_name: 'Алексей Петров', text: 'Как очередь?', read: true }),
    msg('m2', 2, { text: 'Разбираем, осталось 12 заявлений' }),
    msg('m3', 3, { text: 'Очередь разобрана' }),
    msg('m4', 4, { kind: 'poll', text: POLL.question, poll: POLL }),
  ],
  has_before: false,
  has_after: false,
  my_last_read_seq: 1,
  others_read_seq: 3,
};

function chatRoutes(extra: Record<string, unknown> = {}) {
  return {
    'GET /users/me': ME,
    'GET /users': USERS,
    'GET /chats': [TEAM, OLGA],
    'GET /chats/unread': { unread: 2 },
    'GET /chats/c-team': TEAM_DETAIL,
    'GET /chats/c-team/messages': HISTORY,
    'GET /chats/c-team/pinned': [],
    'GET /chats/c-team/scheduled': [],
    'POST /chats/c-team/read': { last_read_seq: 4, unread: 0 },
    ...extra,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('список чатов', () => {
  it('закреплённый сверху, непрочитанные со счётчиком, в меню — значок «Чаты»', async () => {
    mockApi(chatRoutes());
    renderApp('/app/chats');
    const list = await screen.findByRole('list', { name: 'Чаты' });
    const rows = await within(list).findAllByRole('link');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Ольга Смирнова', 'Цифровая приёмная, 2 непрочитанных']);
    expect(within(rows[1]!).getByText(/Очередь разобрана/)).toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', { name: 'Навигация' });
    const nav = within(sidebar).getByRole('link', { name: /Чаты/ });
    await waitFor(() => expect(nav).toHaveTextContent('2'));
    expect(screen.getByRole('region', { name: 'Чат не выбран' })).toBeInTheDocument();
  });

  it('поиск: фильтрует чаты и ищет по сообщениям', async () => {
    const hit = { ...msg('m3', 3, { text: 'Очередь разобрана' }), chat_title: 'Цифровая приёмная', chat_type: 'group', topic_name: null };
    const calls = mockApi(chatRoutes({ 'GET /chats/search': [hit] }));
    renderApp('/app/chats');
    const list = await screen.findByRole('list', { name: 'Чаты' });
    await within(list).findByRole('link', { name: /Ольга/ });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск по чатам' }), 'очередь');
    await waitFor(() => expect(within(list).queryByRole('link', { name: /Ольга/ })).toBeNull());
    const hits = await screen.findByRole('region', { name: 'Найдено в сообщениях' });
    await within(hits).findByText('Цифровая приёмная');
    expect(calls.some((c) => c.path === `/chats/search?q=${encodeURIComponent('очередь')}`)).toBe(true);
  });

  it('новый личный чат: выбрать коллегу — и сразу в переписку', async () => {
    const calls = mockApi(
      chatRoutes({
        'POST /chats/direct': summary('c-igor', { type: 'private', title: 'Игорь Лебедев' }),
        'GET /chats/c-igor': { ...TEAM_DETAIL, ...summary('c-igor', { type: 'private', title: 'Игорь Лебедев' }), members: [], my_rights: ['pin_messages'], can_manage_topics: false },
        'GET /chats/c-igor/messages': { ...HISTORY, messages: [] },
        'GET /chats/c-igor/pinned': [],
        'GET /chats/c-igor/scheduled': [],
      }),
    );
    renderApp('/app/chats');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Новый чат' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Новый чат' });
    await userEvent.click(await within(dialog).findByRole('option', { name: /Игорь Лебедев/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/chats/direct')?.body).toEqual({ user_id: 'u-igor' }));
    expect(await screen.findByRole('button', { name: 'Игорь Лебедев: информация о чате' })).toBeInTheDocument();
  });

  it('новая группа: название обязательно, участники — отметками', async () => {
    const calls = mockApi(chatRoutes({ 'POST /chats': summary('c-new', { title: 'Приёмная кампания' }) }));
    renderApp('/app/chats');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Новый чат' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Новый чат' });
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Группа' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать группу' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Назовите группу');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/chats')).toBe(false);
    await userEvent.type(within(dialog).getByLabelText(/Название группы/), 'Приёмная кампания');
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Анна Королёва/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Ольга Смирнова/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать группу' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/chats')?.body).toEqual({ name: 'Приёмная кампания', member_ids: ['u-anna', 'u-olga'], supergroup: false }));
  });
});

describe('переписка', () => {
  const sent = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === '/chats/c-team/messages');

  it('лента: имена, разделитель «Новые», галочки прочтения, отметка о прочтении', async () => {
    const calls = mockApi(chatRoutes());
    renderApp('/app/chats/c-team');
    const feed = await screen.findByRole('log', { name: 'Сообщения' });
    await within(feed).findByText('Очередь разобрана');
    expect(within(feed).getByText('Новые сообщения')).toBeInTheDocument();
    expect(within(feed).getByLabelText('Прочитано')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Цифровая приёмная: информация о чате' })).toHaveTextContent('3 участников');
    await waitFor(() => expect(calls.find((c) => c.path === '/chats/c-team/read')?.body).toEqual({ seq: 4, topic_id: null }));
  });

  it('отправка: сообщение видно сразу, потом заменяется ответом сервера по client_id', async () => {
    let release: () => void = () => undefined;
    const calls = mockApi(
      chatRoutes({
        'POST /chats/c-team/messages': (c: Call) =>
          new Promise((r) => {
            release = () => r(new Response(JSON.stringify({ data: msg('m5', 5, { sender_id: 'u-dir', sender_name: 'Алексей Петров', text: 'Отлично, спасибо', client_id: (c.body as { client_id: string }).client_id }) }), { status: 200 }));
          }),
      }),
    );
    renderApp('/app/chats/c-team');
    const box = await screen.findByRole('textbox', { name: 'Сообщение' });
    await userEvent.type(box, 'Отлично, спасибо{Enter}');
    const feed = screen.getByRole('log', { name: 'Сообщения' });
    await within(feed).findByText('Отлично, спасибо');
    expect(within(feed).getByLabelText('Отправляется')).toBeInTheDocument();
    expect(box).toHaveValue('');
    const body = sent(calls)[0]!.body as { text: string; client_id: string };
    expect(body.text).toBe('Отлично, спасибо');
    expect(body.client_id).toMatch(/.{8,}/);
    await act(async () => release());
    await waitFor(() => expect(feed.querySelector('#m-m5')).not.toBeNull());
    expect(within(feed).getAllByText('Отлично, спасибо')).toHaveLength(1);
    expect(within(feed).queryByLabelText('Отправляется')).toBeNull();
  });

  it('ответ на сообщение уходит с reply_to_id; черновик живёт в localStorage', async () => {
    const calls = mockApi(chatRoutes({ 'POST /chats/c-team/messages': (c: Call) => msg('m5', 5, { sender_id: 'u-dir', text: 'Принято', client_id: (c.body as { client_id: string }).client_id }) }));
    renderApp('/app/chats/c-team');
    const feed = await screen.findByRole('log', { name: 'Сообщения' });
    const target = (await within(feed).findByText('Очередь разобрана')).closest('.msg') as HTMLElement;
    const box = screen.getByRole('textbox', { name: 'Сообщение' });
    await userEvent.type(box, 'Прин');
    await waitFor(() => expect(localStorage.getItem('offix.chat-draft.c-team.main')).toBe('Прин'));
    await userEvent.click(within(target).getByRole('button', { name: 'Ответить' }));
    expect(screen.getByText('Ответ · Анна Королёва')).toBeInTheDocument();
    expect(box).toHaveValue('Прин');
    await userEvent.type(box, 'ято{Enter}');
    await waitFor(() => expect(sent(calls)[0]?.body).toMatchObject({ text: 'Принято', reply_to_id: 'm3' }));
    expect(localStorage.getItem('offix.chat-draft.c-team.main')).toBeNull();
  });

  it('реакция: выбрать в палитре — на пузыре появляется счётчик', async () => {
    const calls = mockApi(chatRoutes({ 'PUT /messages/m3/reaction': [{ emoji: '👍', count: 1, mine: true, people: ['Алексей Петров'], user_ids: ['u-dir'] }] }));
    renderApp('/app/chats/c-team');
    const feed = await screen.findByRole('log', { name: 'Сообщения' });
    const target = (await within(feed).findByText('Очередь разобрана')).closest('.msg') as HTMLElement;
    await userEvent.click(within(target).getByRole('button', { name: 'Поставить реакцию' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Реакция 👍' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ emoji: '👍' }));
    expect(await within(target).findByRole('button', { name: /👍\s*1/ })).toBeInTheDocument();
  });

  it('опрос: голос одним касанием, дальше — результаты', async () => {
    const voted: ChatPoll = { ...POLL, voted: true, total_voters: 1, options: [{ ...POLL.options[0]!, votes: 1, voted: true }, POLL.options[1]!] };
    const calls = mockApi(chatRoutes({ 'POST /messages/m4/vote': voted }));
    renderApp('/app/chats/c-team');
    const poll = await screen.findByRole('radiogroup', { name: POLL.question });
    await userEvent.click(within(poll).getByRole('radio', { name: 'Во вторник' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/messages/m4/vote')?.body).toEqual({ option_ids: ['o-a'] }));
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отозвать голос' })).toBeInTheDocument();
  });

  it('сокет: новое сообщение, «печатает» и прочтение собеседником приходят без перезапроса', async () => {
    mockApi(chatRoutes());
    renderApp('/app/chats/c-team');
    const feed = await screen.findByRole('log', { name: 'Сообщения' });
    await within(feed).findByText('Очередь разобрана');
    const s = lastSocket();
    expect(s.token).toBe('test-token');
    act(() => s.receive('connect'));
    act(() => s.receive('typing', { chat_id: 'c-team', topic_id: null, user_id: 'u-olga', name: 'Ольга Смирнова' }));
    const head = screen.getByRole('button', { name: 'Цифровая приёмная: информация о чате' });
    expect(await within(head).findByText(/Ольга печатает/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Чаты' })).getByText(/Ольга печатает/)).toBeInTheDocument();
    act(() => s.receive('new_message', { chat_id: 'c-team', message: msg('m5', 5, { sender_id: 'u-olga', sender_name: 'Ольга Смирнова', text: 'Готовлю отчёт' }) }));
    expect(await within(feed).findByText('Готовлю отчёт')).toBeInTheDocument();
    await waitFor(() => expect(within(head).queryByText(/Ольга печатает/)).toBeNull());
    act(() => s.receive('message_edited', { chat_id: 'c-team', id: 'm5', text: 'Готовлю отчёт к пятнице', edited_at: at(9, 6) }));
    expect(await within(feed).findByText('Готовлю отчёт к пятнице')).toBeInTheDocument();
    act(() => s.receive('message_deleted', { chat_id: 'c-team', ids: ['m2'] }));
    await waitFor(() => expect(within(feed).queryByText('Разбираем, осталось 12 заявлений')).toBeNull());
  });

  it('«печатает» уходит в сокет не чаще раза в три секунды', async () => {
    mockApi(chatRoutes());
    renderApp('/app/chats/c-team');
    const box = await screen.findByRole('textbox', { name: 'Сообщение' });
    const s = lastSocket();
    act(() => s.receive('connect'));
    await userEvent.type(box, 'Добрый день');
    expect(s.sent.filter((x) => x.event === 'typing')).toEqual([{ event: 'typing', payload: { chat_id: 'c-team', topic_id: null } }]);
  });

  it('неизвестный чат — понятная заглушка, а не пустой экран', async () => {
    mockApi(chatRoutes());
    renderApp('/app/chats/c-gone');
    expect(await screen.findByText(/Чат не найден/)).toBeInTheDocument();
  });
});

describe('личные заметки и свои имена в чате', () => {
  const NOTE_MSG = msg('m5', 5, { kind: 'note', text: 'Держите регламент', note: { id: 's1', title: 'Регламент закупок', excerpt: 'Сначала заявка, потом счёт', files_count: 1, sender_id: 'u-anna' } });
  const SHARE = { id: 's1', title: 'Регламент закупок', body: 'Сначала **заявка**', attachments: [], sender_id: 'u-anna', sender_name: 'Анна Королёва', created_at: at(9, 5), is_owner: false, accepted_note_id: null, original_note_id: null, original_exists: true, my_request: null };

  it('карточка заметки в ленте открывает снимок; автор подписан моим именем', async () => {
    mockApi(
      chatRoutes({
        'GET /chats/c-team/messages': { ...HISTORY, messages: [...HISTORY.messages, NOTE_MSG] },
        'GET /contacts/names': [{ user_id: 'u-anna', name: 'Аня из приёмной' }],
        'GET /my-notes/shared/s1': SHARE,
      }),
    );
    renderApp('/app/chats/c-team');
    const card = await screen.findByRole('button', { name: 'Заметка «Регламент закупок» — открыть' });
    expect(card).toHaveTextContent('Сначала заявка, потом счёт');
    expect((await screen.findAllByText('Аня из приёмной')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Анна Королёва')).toBeNull();
    expect(screen.getByText('Держите регламент')).toBeInTheDocument();
    await userEvent.click(card);
    const dialog = await screen.findByRole('dialog', { name: 'Регламент закупок' });
    expect(within(dialog).getByRole('button', { name: 'Сохранить к себе' })).toBeInTheDocument();
  });

  it('«Вложения → Заметка» — выбор из моих заметок и отправка в чат', async () => {
    const calls: Call[] = mockApi(
      chatRoutes({
        'GET /my-notes': [{ id: 'n1', title: 'План на день', excerpt: 'Позвонить', note_date: '2026-10-19', is_favorite: false, files_count: 0, updated_at: at(8) }],
        'POST /my-notes/n1/share': NOTE_MSG,
      }),
    );
    renderApp('/app/chats/c-team');
    await screen.findByText('Очередь разобрана');
    await userEvent.click(screen.getByRole('button', { name: 'Вложения' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Заметка' }));
    const dialog = await screen.findByRole('dialog', { name: 'Отправить заметку' });
    await userEvent.click(await within(dialog).findByRole('option', { name: /План на день/ }));
    await waitFor(() => expect(calls.find((c) => c.path === '/my-notes/n1/share')?.body).toMatchObject({ chat_id: 'c-team', topic_id: null }));
  });
});
