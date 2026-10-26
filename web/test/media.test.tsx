import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, AvatarEntry, ChatDetail, ChatGallery, ChatHistory, ChatMessage, ChatStats, ChatSummary, Discussion, Me, Member, TaskDetail } from '@offix/core';
import { buildDirectory } from '../src/lib/avatars';
import { fileSrc, freshUrl } from '../src/lib/files';
import { mockUploads } from './fake-xhr';
import { lastSocket } from './fake-socket';
import { task as taskFixture } from './fixtures';
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
const USERS = [person('u-anna', 'Анна Королёва', 'Специалист приёмной'), person('u-olga', 'Ольга Смирнова', 'Руководитель офиса')];

const at = (h: number, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
// Подпись ссылки живёт до этого момента — в тестах она «свежая».
const LATER = Math.floor(Date.now() / 1000) + 3600;

const att = (id: string, over: Partial<Attachment> = {}): Attachment => ({
  id,
  kind: 'photo',
  name: `${id}.jpg`,
  mime: 'image/jpeg',
  size: 120_000,
  width: 1600,
  height: 1200,
  duration: null,
  waveform: null,
  url: `/api/v1/files/${id}/raw?e=${LATER}&u=u-dir&s=sig`,
  thumb_url: `/api/v1/files/thumbs/${id.padEnd(32, '0')}.jpg`,
  uploaded_by: 'u-anna',
  created_at: at(9),
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
  read: true,
  attachments: [],
  contact: null,
  listened: false,
  ...over,
});

const TEAM: ChatSummary = {
  id: 'c-team',
  type: 'group',
  is_supergroup: false,
  title: 'Цифровая приёмная',
  peer: null,
  members_count: 3,
  last_message: { id: 'm4', sender_name: 'Анна Королёва', sender_id: 'u-anna', text: '', kind: 'voice', deleted: false, created_at: at(9, 4), media: { kind: 'voice', count: 1, name: 'voice.m4a' } },
  unread: 0,
  pinned: false,
  muted: false,
  muted_until: null,
  created_at: at(8),
  activity_at: at(9, 4),
};
const member = (id: string, display_name: string, role: 'creator' | 'admin' | 'member' = 'member') => ({ id, display_name, position: null, role, permissions: [], online: false, last_seen_at: null });
const DETAIL: ChatDetail = {
  ...TEAM,
  created_by: 'u-dir',
  members: [member('u-dir', 'Алексей Петров', 'creator'), member('u-anna', 'Анна Королёва'), member('u-olga', 'Ольга Смирнова')],
  my_rights: ['change_info', 'delete_messages', 'ban_users', 'invite_users', 'pin_messages', 'add_admins', 'add_users', 'manage_topics'] as ChatDetail['my_rights'],
  can_manage_topics: true,
  topics: [],
  my_last_read_seq: 10,
  others_read_seq: 10,
};

const ALBUM = msg('m1', 1, { kind: 'media', text: 'С планёрки', attachments: [att('a1'), att('a2', { width: 900, height: 1200 }), att('a3', { kind: 'video', name: 'обход.mp4', mime: 'video/mp4', duration: 12 })] });
const FILE = msg('m2', 2, { kind: 'media', text: '', sender_id: 'u-olga', sender_name: 'Ольга Смирнова', attachments: [att('f1', { kind: 'file', name: 'отчёт.pdf', mime: 'application/pdf', size: 2_400_000, width: null, height: null, thumb_url: null })] });
const CONTACT = msg('m3', 3, { kind: 'contact', text: '', contact: { id: 'u-olga', display_name: 'Ольга Смирнова', position: 'Руководитель офиса', avatar_url: null } });
const VOICE = msg('m4', 4, { kind: 'voice', text: '', attachments: [att('v1', { kind: 'voice', name: 'voice.m4a', mime: 'audio/mp4', duration: 7, waveform: '0,10,31,20,5', width: null, height: null, thumb_url: null })] });
const NOTE = msg('m5', 5, { kind: 'video_note', text: '', sender_id: 'u-dir', sender_name: 'Алексей Петров', listened: true, attachments: [att('n1', { kind: 'video_note', name: 'note.mp4', mime: 'video/mp4', duration: 9 })] });

const HISTORY: ChatHistory = { messages: [ALBUM, FILE, CONTACT, VOICE, NOTE], has_before: false, has_after: false, my_last_read_seq: 10, others_read_seq: 10 };

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /users/me': ME,
    'GET /users': USERS,
    'GET /files/avatars': [] as AvatarEntry[],
    'GET /chats': [TEAM],
    'GET /chats/unread': { unread: 0 },
    'GET /chats/c-team': DETAIL,
    'GET /chats/c-team/messages': HISTORY,
    'GET /chats/c-team/pinned': [],
    'GET /chats/c-team/scheduled': [],
    'POST /chats/c-team/read': { last_read_seq: 5, unread: 0 },
    ...extra,
  };
}

const sentBodies = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === '/chats/c-team/messages').map((c) => c.body as Record<string, unknown>);

async function openFeed(extra: Record<string, unknown> = {}) {
  const calls = mockApi(routes(extra));
  renderApp('/app/chats/c-team');
  const feed = await screen.findByRole('log', { name: 'Сообщения' });
  await within(feed).findByText('С планёрки');
  return { calls, feed };
}

const file = (name: string, type: string, size = 2048) => new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  // В jsdom нет воспроизведения: play/pause только меняют состояние и шлют события.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true });
    this.dispatchEvent(new Event('pause'));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('медиа в ленте', () => {
  it('альбом, файл, контакт, голосовое и кружочек — каждый в своём виде', async () => {
    const { feed } = await openFeed();
    const album = feed.querySelector('#m-m1')!;
    expect(within(album as HTMLElement).getAllByRole('button', { name: /из 3 — открыть/ })).toHaveLength(3);
    expect(within(album as HTMLElement).getByText('0:12')).toBeInTheDocument();
    // Превью — по публичному имени, не по подписанной ссылке.
    expect(album.querySelector('img')?.getAttribute('src')).toBe(`/api/v1/files/thumbs/${'a1'.padEnd(32, '0')}.jpg`);
    const fileMsg = feed.querySelector('#m-m2') as HTMLElement;
    expect(within(fileMsg).getByRole('button', { name: 'Скачать отчёт.pdf' })).toBeInTheDocument();
    expect(within(fileMsg).getByText('2,3 МБ · PDF')).toBeInTheDocument();
    const contact = feed.querySelector('#m-m3') as HTMLElement;
    expect(within(contact).getByText('Руководитель офиса')).toBeInTheDocument();
    const voice = feed.querySelector('#m-m4') as HTMLElement;
    expect(within(voice).getByRole('button', { name: 'Слушать голосовое' })).toBeInTheDocument();
    expect(within(voice).getByText('0:07')).toBeInTheDocument();
    expect(within(voice).getByLabelText('Не прослушано')).toBeInTheDocument();
    const note = feed.querySelector('#m-m5') as HTMLElement;
    expect(within(note).getByRole('button', { name: 'Смотреть видеосообщение' })).toBeInTheDocument();
    expect(note.querySelector('.bubble')).toHaveClass('is-round');
    // В списке чатов — подпись вложения.
    expect(await screen.findByText('Анна: 🎤 Голосовое сообщение')).toBeInTheDocument();
  });

  it('лента остаётся внизу, когда сжимается позже (закреп, превью); прокрученную вверх не трогает', async () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    const { feed } = await openFeed();
    // В jsdom у ленты нет размеров — задаём их сами.
    const box = { scrollHeight: 2000, clientHeight: 700, scrollTop: 1300 };
    Object.defineProperty(feed, 'scrollHeight', { get: () => box.scrollHeight, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { get: () => box.clientHeight, configurable: true });
    Object.defineProperty(feed, 'scrollTop', { get: () => box.scrollTop, set: (v: number) => (box.scrollTop = Math.min(v, box.scrollHeight - box.clientHeight)), configurable: true });
    fireEvent.scroll(feed);
    const resize = () => act(() => observers.forEach((cb) => cb()));
    // Закреп появился над лентой: она стала ниже на 64 px — конец всё равно виден.
    box.clientHeight = 636;
    resize();
    expect(box.scrollTop).toBe(2000 - 636);
    // Догрузилось превью — лента выросла, держимся конца.
    box.scrollHeight = 2240;
    resize();
    expect(box.scrollTop).toBe(2240 - 636);
    // Читаем старое: прокрутили вверх — размеры меняются, место чтения не прыгает.
    box.scrollTop = 400;
    fireEvent.scroll(feed);
    box.scrollHeight = 2400;
    resize();
    expect(box.scrollTop).toBe(400);
  });

  it('просмотр во весь экран: листается по всем фото ленты, Esc закрывает', async () => {
    const shot = msg('m8', 8, { kind: 'media', text: 'Вид сверху', sender_id: 'u-olga', sender_name: 'Ольга Смирнова', attachments: [att('p8')] });
    const { feed } = await openFeed({ 'GET /chats/c-team/messages': { ...HISTORY, messages: [...HISTORY.messages, shot] } });
    await userEvent.click(within(feed.querySelector('#m-m1') as HTMLElement).getByRole('button', { name: 'Фото 2 из 3 — открыть' }));
    const viewer = await screen.findByRole('dialog', { name: 'Просмотр фото' });
    // Кружочек в просмотр не попадает: только фото и видео.
    expect(within(viewer).getByText('2 из 4')).toBeInTheDocument();
    expect(within(viewer).getByText('Анна Королёва')).toBeInTheDocument();
    await userEvent.click(within(viewer).getByRole('button', { name: 'Следующее' }));
    expect(within(screen.getByRole('dialog', { name: 'Просмотр видео' })).getByText('3 из 4')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    const last = screen.getByRole('dialog', { name: 'Просмотр фото' });
    expect(within(last).getByText('4 из 4')).toBeInTheDocument();
    expect(within(last).getByText('Ольга Смирнова')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(within(screen.getByRole('dialog', { name: 'Просмотр фото' })).getByText('4 из 4')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Просмотр/ })).toBeNull());
  });

  it('голосовое: первое прослушивание отмечается на сервере один раз', async () => {
    const { calls, feed } = await openFeed({ 'POST /messages/m4/listen': null });
    const voice = feed.querySelector('#m-m4') as HTMLElement;
    await userEvent.click(within(voice).getByRole('button', { name: 'Слушать голосовое' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/messages/m4/listen')).toHaveLength(1));
    expect(within(voice).queryByLabelText('Не прослушано')).toBeNull();
    expect(within(voice).getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
    expect(within(voice).getByRole('button', { name: 'Скорость 1×' })).toBeInTheDocument();
    await userEvent.click(within(voice).getByRole('button', { name: 'Скорость 1×' }));
    expect(localStorage.getItem('offix.voice-rate')).toBe('1.5');
    await userEvent.click(within(voice).getByRole('button', { name: 'Пауза' }));
    await userEvent.click(within(voice).getByRole('button', { name: 'Слушать голосовое' }));
    expect(calls.filter((c) => c.path === '/messages/m4/listen')).toHaveLength(1);
  });

  it('«прослушано» приходит событием: автор видит, что его кружочек посмотрели', async () => {
    const own = msg('m6', 6, { kind: 'voice', text: '', sender_id: 'u-dir', sender_name: 'Алексей Петров', listened: false, attachments: [att('v2', { kind: 'voice', mime: 'audio/mp4', duration: 3, width: null, height: null })] });
    mockApi(routes({ 'GET /chats/c-team/messages': { ...HISTORY, messages: [...HISTORY.messages, own] } }));
    renderApp('/app/chats/c-team');
    const feed = await screen.findByRole('log', { name: 'Сообщения' });
    await within(feed).findByText('С планёрки');
    const s = lastSocket();
    act(() => s.receive('message_listened', { chat_id: 'c-team', message_id: 'm6', user_id: 'u-anna', sender_id: 'u-dir' }));
    // Чужое прослушивание чужого сообщения меня не касается.
    act(() => s.receive('message_listened', { chat_id: 'c-team', message_id: 'm4', user_id: 'u-olga', sender_id: 'u-anna' }));
    expect(within(feed.querySelector('#m-m4') as HTMLElement).getByLabelText('Не прослушано')).toBeInTheDocument();
  });

  it('контакт: «Написать» открывает личный чат', async () => {
    const { calls, feed } = await openFeed({
      'POST /chats/direct': { ...TEAM, id: 'c-olga', type: 'private', title: 'Ольга Смирнова' },
      'GET /chats/c-olga': { ...DETAIL, id: 'c-olga', type: 'private', title: 'Ольга Смирнова' },
      'GET /chats/c-olga/messages': { ...HISTORY, messages: [] },
      'GET /chats/c-olga/pinned': [],
      'GET /chats/c-olga/scheduled': [],
    });
    await userEvent.click(within(feed.querySelector('#m-m3') as HTMLElement).getByRole('button', { name: /Написать/ }));
    await waitFor(() => expect(calls.find((c) => c.path === '/chats/direct')?.body).toEqual({ user_id: 'u-olga' }));
    expect(await screen.findByRole('button', { name: 'Ольга Смирнова: информация о чате' })).toBeInTheDocument();
  });

  it('медиа можно переслать, служебное и опрос — нет', async () => {
    const { feed } = await openFeed();
    fireEvent.contextMenu(feed.querySelector('#m-m1 .bubble')!);
    const menu = await screen.findByRole('menu', { name: 'Действия с сообщением' });
    expect(within(menu).getByRole('menuitem', { name: 'Переслать' })).toBeInTheDocument();
  });

  it('цитата голосового и закреп показывают подпись вложения', async () => {
    const reply = msg('m7', 7, { sender_id: 'u-dir', sender_name: 'Алексей Петров', text: 'Послушал', reply_to: { id: 'm4', sender_name: 'Анна Королёва', text: '', kind: 'voice', deleted: false, media: { kind: 'voice', count: 1, name: 'voice.m4a' } } });
    mockApi(routes({ 'GET /chats/c-team/messages': { ...HISTORY, messages: [...HISTORY.messages, reply] }, 'GET /chats/c-team/pinned': [ALBUM] }));
    renderApp('/app/chats/c-team');
    const feed = await screen.findByRole('log', { name: 'Сообщения' });
    await within(feed).findByText('Послушал');
    const quote = within(feed.querySelector('#m-m7') as HTMLElement).getByRole('button', { name: /Анна Королёва/ });
    expect(quote).toHaveTextContent('🎤 Голосовое сообщение');
    expect(await screen.findByText('🖼 3 медиа, С планёрки')).toBeInTheDocument();
  });
});

describe('отправка файлов', () => {
  const uploaded = (u: { file: File | null; fields: Record<string, string> }, n: number) => ({
    data: att(`up${n}`, { name: u.file?.name ?? 'file', kind: u.file?.type.startsWith('image/') && u.fields.as_file !== '1' ? 'photo' : 'file', uploaded_by: 'u-dir' }),
  });

  it('фото альбомом: загрузка сразу, подпись, сообщение с attachment_ids', async () => {
    const uploads = mockUploads(uploaded);
    const { calls } = await openFeed({ 'POST /chats/c-team/messages': (c: Call) => msg('m9', 9, { kind: 'media', sender_id: 'u-dir', text: (c.body as { text: string }).text, attachments: [att('up1'), att('up2')], client_id: (c.body as { client_id: string }).client_id }) });
    const input = screen.getByLabelText('Фото или видео');
    await userEvent.upload(input, [file('доска.jpg', 'image/jpeg'), file('стенд.png', 'image/png')]);
    const dialog = await screen.findByRole('dialog', { name: 'Отправить 2 медиафайла' });
    await waitFor(() => expect(uploads).toHaveLength(2));
    expect(uploads[0]!.path).toBe('/files');
    expect(uploads[0]!.headers.Authorization).toBe('Bearer test-token');
    expect(uploads[0]!.fields.as_file).toBeUndefined();
    await userEvent.type(within(dialog).getByLabelText('Подпись'), 'Два варианта стенда');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Отправить' })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(sentBodies(calls)).toHaveLength(1));
    expect(sentBodies(calls)[0]).toMatchObject({ text: 'Два варианта стенда', attachment_ids: ['up1', 'up2'] });
    expect(screen.queryByRole('dialog', { name: /Отправить/ })).toBeNull();
  });

  it('«как файл» перезагружает фото без сжатия; убранный файл удаляется с сервера', async () => {
    const uploads = mockUploads(uploaded);
    const { calls } = await openFeed({ 'DELETE /files/up1': null, 'DELETE /files/up2': null, 'DELETE /files/up3': null });
    await userEvent.upload(screen.getByLabelText('Фото или видео'), [file('доска.jpg', 'image/jpeg'), file('план.png', 'image/png')]);
    const dialog = await screen.findByRole('dialog', { name: /Отправить/ });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Отправить' })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Отправить как файл/ }));
    await waitFor(() => expect(uploads.filter((u) => u.fields.as_file === '1')).toHaveLength(2));
    // Прежние черновики не нужны.
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path).sort()).toEqual(['/files/up1', '/files/up2']));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Убрать план.png' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(3));
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);
  });

  it('запрещённый тип не загружается; ошибка сервера видна у файла', async () => {
    const uploads = mockUploads(() => ({ status: 413, error: { message: 'Файл больше 200 МБ' } }));
    await openFeed();
    await userEvent.upload(screen.getByLabelText('Файлы'), [file('setup.exe', 'application/x-msdownload'), file('архив.zip', 'application/zip')]);
    const dialog = await screen.findByRole('dialog', { name: /Отправить 2 файла/ });
    expect(within(dialog).getByText('Такой тип файла отправить нельзя')).toBeInTheDocument();
    expect(await within(dialog).findByText('Файл больше 200 МБ')).toBeInTheDocument();
    expect(uploads).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: /Загрузка|Отправить/ })).toBeDisabled();
  });

  it('больше десяти — несколькими сообщениями, подпись у последнего', async () => {
    mockUploads(uploaded);
    let n = 0;
    const { calls } = await openFeed({ 'POST /chats/c-team/messages': (c: Call) => msg(`s${++n}`, 20 + n, { kind: 'media', sender_id: 'u-dir', client_id: (c.body as { client_id: string }).client_id }) });
    await userEvent.upload(
      screen.getByLabelText('Фото или видео'),
      Array.from({ length: 12 }, (_, i) => file(`p${i}.jpg`, 'image/jpeg')),
    );
    const dialog = await screen.findByRole('dialog', { name: /12 медиафайлов/ });
    expect(within(dialog).getByText(/до 10 файлов/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Отправить' })).toBeEnabled(), { timeout: 3000 });
    await userEvent.type(within(dialog).getByLabelText('Подпись'), 'Все снимки');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(sentBodies(calls)).toHaveLength(2));
    expect((sentBodies(calls)[0]!.attachment_ids as string[]).length).toBe(10);
    expect(sentBodies(calls)[0]!.text).toBe('');
    expect(sentBodies(calls)[1]).toMatchObject({ text: 'Все снимки' });
    expect((sentBodies(calls)[1]!.attachment_ids as string[]).length).toBe(2);
  });

  it('картинка из буфера и перетаскивание открывают отправку', async () => {
    mockUploads(uploaded);
    await openFeed();
    const box = screen.getByRole('textbox', { name: 'Сообщение' });
    fireEvent.paste(box, { clipboardData: { files: [file('скрин.png', 'image/png')], getData: () => '' } });
    expect(await screen.findByRole('dialog', { name: 'Отправить 1 медиафайл' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    const view = document.querySelector('.chat-view')!;
    const dt = { types: ['Files'], files: [file('акт.pdf', 'application/pdf')] };
    fireEvent.dragEnter(view, { dataTransfer: dt });
    expect(screen.getByText('Отпустите, чтобы отправить')).toBeInTheDocument();
    fireEvent.drop(view, { dataTransfer: dt });
    expect(await screen.findByRole('dialog', { name: 'Отправить 1 файл' })).toBeInTheDocument();
    expect(screen.queryByText('Отпустите, чтобы отправить')).toBeNull();
  });

  it('контакт из меню «+» уходит карточкой', async () => {
    const { calls } = await openFeed({ 'POST /chats/c-team/messages': (c: Call) => msg('m9', 9, { kind: 'contact', sender_id: 'u-dir', text: '', client_id: (c.body as { client_id: string }).client_id }) });
    await userEvent.click(screen.getByRole('button', { name: 'Вложения' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Контакт' }));
    const dialog = await screen.findByRole('dialog', { name: 'Отправить контакт' });
    await userEvent.click(await within(dialog).findByRole('option', { name: /Анна Королёва/ }));
    await waitFor(() => expect(sentBodies(calls)[0]).toMatchObject({ text: '', contact_user_id: 'u-anna' }));
  });

  it('подпись альбома можно стереть совсем', async () => {
    const mine = { ...ALBUM, sender_id: 'u-dir', sender_name: 'Алексей Петров', created_at: new Date().toISOString() };
    const { calls } = await openFeed({ 'GET /chats/c-team/messages': { ...HISTORY, messages: [mine] }, 'PATCH /messages/m1': { ...mine, text: '' } });
    fireEvent.contextMenu(document.querySelector('#m-m1 .bubble')!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Изменить' }));
    expect(screen.getByText('Изменение подписи')).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Сообщение' });
    await userEvent.clear(box);
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ text: '' }));
  });
});

describe('галерея и сводка чата', () => {
  it('вкладки медиа, файлов, голосовых и ссылок; сводка с участниками', async () => {
    const gallery = (tab: string): ChatGallery => ({
      items:
        tab === 'links'
          ? [{ message_id: 'm8', seq: 8, sender_id: 'u-anna', sender_name: 'Анна Королёва', created_at: at(9), attachment: null, link: { url: 'https://gosuslugi.ru/help', host: 'gosuslugi.ru', text: 'Инструкция' } }]
          : tab === 'files'
            ? [{ message_id: 'm2', seq: 2, sender_id: 'u-olga', sender_name: 'Ольга Смирнова', created_at: at(9), attachment: FILE.attachments[0]!, link: null }]
            : ALBUM.attachments.map((a) => ({ message_id: 'm1', seq: 1, sender_id: 'u-anna', sender_name: 'Анна Королёва', created_at: at(9), attachment: a, link: null })),
      next_before: null,
    });
    const stats: ChatStats = { messages: 42, photos: 2, videos: 1, files: 1, voice: 1, video_notes: 1, links: 1, bytes: 3_500_000, first_message_at: '2026-09-01T09:00:00Z', top_senders: [{ id: 'u-anna', display_name: 'Анна Королёва', messages: 20 }] };
    const calls = mockApi(routes({ 'GET /chats/c-team/media': (c: Call) => gallery(new URLSearchParams(c.path.split('?')[1]).get('tab') ?? 'media'), 'GET /chats/c-team/stats': stats }));
    renderApp('/app/chats/c-team');
    await screen.findByRole('log', { name: 'Сообщения' });
    await userEvent.click(screen.getByRole('button', { name: 'Информация' }));
    const panel = await screen.findByRole('region', { name: 'Медиа и файлы' });
    expect(await within(panel).findByText('42')).toBeInTheDocument();
    expect(within(panel).getByText('Файлы занимают 3,3 МБ · переписка с 1 сентября 2026 г.')).toBeInTheDocument();
    expect(await within(panel).findAllByRole('button', { name: /от Анна Королёва/ })).toHaveLength(3);
    await userEvent.click(within(panel).getByRole('tab', { name: 'Файлы' }));
    expect(await within(panel).findByRole('button', { name: 'Скачать отчёт.pdf' })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('tab', { name: 'Ссылки' }));
    expect(await within(panel).findByRole('link', { name: /gosuslugi\.ru/ })).toHaveAttribute('href', 'https://gosuslugi.ru/help');
    expect(calls.some((c) => c.path.startsWith('/chats/c-team/media?tab=links'))).toBe(true);
    await userEvent.click(within(panel).getByRole('tab', { name: 'Медиа' }));
    await userEvent.click((await within(panel).findAllByRole('button', { name: /от Анна Королёва/ }))[0]!);
    expect(await screen.findByRole('dialog', { name: 'Просмотр фото' })).toBeInTheDocument();
  });
});

describe('фото профиля', () => {
  it('аватар — фото по id, по имени — только у однозначного; загрузка из профиля', async () => {
    const uploads = mockUploads(() => ({ status: 200, data: { avatar_url: '/api/v1/files/avatars/aa.jpg' } }));
    const avatars: AvatarEntry[] = [{ id: 'u-anna', display_name: 'Анна Королёва', avatar_url: '/api/v1/files/avatars/anna.jpg' }];
    const { calls } = await openFeed({ 'GET /files/avatars': () => avatars });
    await waitFor(() => expect(document.querySelector('.msg-ava img')?.getAttribute('src')).toBe('/api/v1/files/avatars/anna.jpg'));
    await userEvent.click(screen.getByRole('button', { name: 'Фото профиля' }));
    const dialog = await screen.findByRole('dialog', { name: 'Фото профиля' });
    await userEvent.upload(within(dialog).getByLabelText('Файл фото'), file('я.jpg', 'image/jpeg'));
    await waitFor(() => expect(uploads[0]?.path).toBe('/files/avatar'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Фото профиля' })).toBeNull());
    expect(calls.filter((c) => c.path === '/files/avatars').length).toBeGreaterThan(1);
  });

  it('справочник: тёзки по имени не угадываются', () => {
    const dir = buildDirectory([
      { id: 'u1', display_name: 'Анна Смирнова', avatar_url: '/api/v1/files/avatars/1.jpg' },
      { id: 'u2', display_name: 'анна смирнова', avatar_url: '/api/v1/files/avatars/2.jpg' },
      { id: 'u3', display_name: 'Олег Ким', avatar_url: '/api/v1/files/avatars/3.jpg' },
    ]);
    expect(dir.byId.get('u2')).toBe('/api/v1/files/avatars/2.jpg');
    expect(dir.byName.has('анна смирнова')).toBe(false);
    expect(dir.byName.get('олег ким')).toBe('/api/v1/files/avatars/3.jpg');
  });
});

describe('ссылки на файлы', () => {
  it('устаревшая подписанная ссылка обновляется запросом, свежая — нет', async () => {
    const id = 'aaaaaaaa-0000-4000-8000-000000000001';
    const calls = mockApi({ [`GET /files/${id}`]: att(id, { url: `/api/v1/files/${id}/raw?e=${LATER}&u=u-dir&s=new` }) });
    const old = att(id, { url: `/api/v1/files/${id}/raw?e=1000&u=u-dir&s=old` });
    expect(await freshUrl(old)).toContain('s=new');
    expect(await freshUrl(old)).toContain('s=new');
    expect(calls).toHaveLength(1);
    expect(await freshUrl(att('x2'))).toContain('s=sig');
    expect(fileSrc('/api/v1/files/thumbs/a.jpg')).toBe('/api/v1/files/thumbs/a.jpg');
    expect(fileSrc('blob:x')).toBe('blob:x');
  });
});

describe('файлы задачи и комментария', () => {
  const taskDetail = (files: Attachment[]): TaskDetail => ({ ...taskFixture('t1', { title: 'Подготовить стенд' }), history: [], dependencies: [], participants: [], files }) as unknown as TaskDetail;
  const dash = { today: '2026-10-19', goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
  const discussion: Discussion = { comments: [], unread: 0, last_read_at: null, can_comment: true, people: [] };

  it('файлы прикрепляются к задаче и убираются', async () => {
    mockUploads((u, n) => ({ data: att(`t${n}`, { kind: 'file', name: u.file!.name, uploaded_by: 'u-dir', thumb_url: null }) }));
    const pdf = att('tf', { kind: 'file', name: 'ТЗ.pdf', mime: 'application/pdf', thumb_url: null, uploaded_by: 'u-dir' });
    const calls = mockApi({
      'GET /users/me': ME,
      'GET /dashboard': dash,
      'GET /files/avatars': [],
      'GET /tasks?mine=1': [taskFixture('t1', { title: 'Подготовить стенд' })],
      'GET /tasks/t1': taskDetail([att('tp', { name: 'макет.jpg', uploaded_by: 'u-anna' })]),
      'POST /tasks/t1/files': [att('tp', { name: 'макет.jpg', uploaded_by: 'u-anna' }), pdf],
      'DELETE /tasks/t1/files/tf': null,
      'GET /discussions/task/t1': discussion,
      'GET /discussions/task/t1/summary': { total: 0, unread: 0 },
    });
    renderApp('/app/tasks');
    await userEvent.click(await screen.findByText('Подготовить стенд'));
    const files = await screen.findByRole('region', { name: 'Файлы задачи' });
    expect(within(files).getByRole('button', { name: 'Фото макет.jpg — открыть' })).toBeInTheDocument();
    await userEvent.upload(within(files).getByLabelText('Прикрепить: выбор файлов'), file('ТЗ.pdf', 'application/pdf'));
    await waitFor(() => expect(calls.find((c) => c.path === '/tasks/t1/files')?.body).toEqual({ attachment_ids: ['t1'] }));
    expect(await within(files).findByRole('button', { name: 'Скачать ТЗ.pdf' })).toBeInTheDocument();
    await userEvent.click(within(files).getByRole('button', { name: 'Убрать ТЗ.pdf' }));
    await waitFor(() => expect(within(files).queryByRole('button', { name: 'Скачать ТЗ.pdf' })).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/tasks/t1/files/tf')).toBe(true);
  });

  it('комментарий можно отправить одним файлом, без текста', async () => {
    mockUploads((u) => ({ data: att('cf', { kind: 'file', name: u.file!.name, uploaded_by: 'u-dir', thumb_url: null }) }));
    const calls = mockApi({
      'GET /users/me': ME,
      'GET /dashboard': dash,
      'GET /files/avatars': [],
      'GET /tasks?mine=1': [taskFixture('t1', { title: 'Подготовить стенд' })],
      'GET /tasks/t1': taskDetail([]),
      'GET /discussions/task/t1': discussion,
      'GET /discussions/task/t1/summary': { total: 0, unread: 0 },
      'POST /discussions/task/t1': {},
    });
    renderApp('/app/tasks');
    await userEvent.click(await screen.findByText('Подготовить стенд'));
    const region = await screen.findByRole('region', { name: 'Обсуждение' });
    const send = within(region).getByRole('button', { name: 'Отправить' });
    expect(send).toBeDisabled();
    await userEvent.upload(within(region).getByLabelText('Прикрепить файл: выбор файлов'), file('скан.pdf', 'application/pdf'));
    expect(await within(region).findByRole('button', { name: 'Скачать скан.pdf' })).toBeInTheDocument();
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/discussions/task/t1')?.body).toEqual({ body: '', parent_id: null, attachment_ids: ['cf'] }));
  });
});
