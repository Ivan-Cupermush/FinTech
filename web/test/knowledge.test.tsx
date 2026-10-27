import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeAskResult, KnowledgeDoc, KnowledgeMessage, KnowledgeSession, KnowledgeStatus } from '@offix/core';
import type { Dashboard, Me } from '../src/lib/types';
import { TODAY } from './fixtures';
import { mockUploads } from './fake-xhr';
import { mockApi, renderApp } from './render';

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
const STATUS: KnowledgeStatus = { mode: 'builtin', provider: 'builtin', model: null, ready: true, vector: 'memory', docs: { ready: 2, processing: 0, failed: 1 }, notes: 4, chunks: 30, can_manage: true };
const base = { 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /knowledge/status': STATUS };

const doc = (id: string, over: Partial<KnowledgeDoc> = {}): KnowledgeDoc => ({
  id,
  title: `Документ ${id}`,
  file_name: `${id}.pdf`,
  type: 'pdf',
  size: 2_200_000,
  status: 'ready',
  error: null,
  chunks: 12,
  chars: 9000,
  pages: 4,
  goal_id: null,
  goal_title: null,
  uploaded_by_name: 'Алексей Петров',
  created_at: '2026-10-18T10:00:00.000Z',
  processed_at: '2026-10-18T10:01:00.000Z',
  can_edit: true,
  file: { id: `a-${id}`, kind: 'file', name: `${id}.pdf`, mime: 'application/pdf', size: 2_200_000, width: null, height: null, duration: null, waveform: null, url: `/api/v1/files/a-${id}/raw?e=9999999999&u=u&s=x`, thumb_url: null, uploaded_by: 'u-director', created_at: '2026-10-18T10:00:00.000Z' },
  ...over,
});

const session = (over: Partial<KnowledgeSession> = {}): KnowledgeSession => ({ id: 's1', title: 'Кто согласует командировку?', created_at: '2026-10-19T09:00:00.000Z', updated_at: '2026-10-19T09:00:00.000Z', last_answer: 'Руководитель [1]', questions: 1, ...over });
const q = (id: string, content: string): KnowledgeMessage => ({ id, role: 'user', content, sources: [], mode: null, notice: null, feedback: null, created_at: '2026-10-19T09:00:00.000Z' });
const a = (id: string, over: Partial<KnowledgeMessage> = {}): KnowledgeMessage => ({
  id,
  role: 'assistant',
  content: 'Командировку согласует руководитель подразделения [1].\n\nАвансовый отчёт — за три дня [2].',
  sources: [
    { n: 1, kind: 'doc', id: 'd1', title: 'Регламент командировок', excerpt: 'Командировку согласует руководитель…', goal_title: null, score: 0.6 },
    { n: 2, kind: 'note', id: 'n1', title: 'Памятка бухгалтерии', excerpt: 'Авансовый отчёт сдаётся…', goal_title: 'Сократить время', score: 0.4 },
  ],
  mode: 'extract',
  notice: null,
  feedback: null,
  created_at: '2026-10-19T09:00:01.000Z',
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('база знаний: помощник', () => {
  it('вопрос со строки на шапке открывает помощника и сразу задаётся; ссылки [n] ведут на источники', async () => {
    const result: KnowledgeAskResult = { session: session(), question: q('m1', 'Кто согласует командировку?'), answer: a('m2') };
    const calls = mockApi({ ...base, 'GET /notes': [], 'GET /knowledge/docs': [], 'POST /knowledge/ask': result, 'GET /knowledge/sessions': [session()], 'GET /knowledge/sessions/s1': { session: session(), messages: [result.question, result.answer] } });
    renderApp('/app/notes');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Вопрос помощнику' }), 'Кто согласует командировку?');
    await userEvent.click(screen.getByRole('button', { name: 'Спросить помощника' }));
    const answer = await screen.findByRole('article', { name: 'Ответ помощника' });
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ question: 'Кто согласует командировку?' }));
    expect(within(answer).getByText('Цитаты из базы знаний')).toBeInTheDocument();
    expect(within(answer).getByRole('link', { name: 'Источник 1: Регламент командировок' })).toHaveAttribute('href', '/app/notes/docs/d1');
    expect(within(answer).getByRole('link', { name: 'Источник 2: Памятка бухгалтерии' })).toHaveAttribute('href', '/app/notes/n1');
    const sources = within(answer).getByRole('list', { name: 'Источники' });
    expect(within(sources).getByText('Сократить время')).toBeInTheDocument();
    expect(screen.getByLabelText('Ваш вопрос')).toHaveTextContent('Кто согласует командировку?');
  });

  it('пустой помощник: примеры вопросов задаются по нажатию; история — своя', async () => {
    const result: KnowledgeAskResult = { session: session({ id: 's2', title: 'Как мы считаем время обработки заявки?' }), question: q('m1', 'Как мы считаем время обработки заявки?'), answer: a('m2') };
    const calls = mockApi({ ...base, 'GET /knowledge/sessions': [session()], 'POST /knowledge/ask': result, 'GET /knowledge/sessions/s2': { session: result.session, messages: [result.question, result.answer] } });
    renderApp('/app/notes/ask');
    expect(await screen.findByText('Спросите — найду в базе знаний')).toBeInTheDocument();
    expect(await screen.findByText(/В базе: 4 статьи и 2 документа/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Кто согласует командировку\?/ })).toHaveAttribute('href', '/app/notes/ask/s1');
    await userEvent.click(screen.getByRole('button', { name: 'Как мы считаем время обработки заявки?' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ question: 'Как мы считаем время обработки заявки?' }));
    expect(await screen.findByRole('article', { name: 'Ответ помощника' })).toBeInTheDocument();
  });

  it('диалог: уточнение уходит в тот же диалог, оценка ответа — PUT', async () => {
    const msgs = [q('m1', 'Кто согласует командировку?'), a('m2')];
    const next: KnowledgeAskResult = { session: session({ questions: 2 }), question: q('m3', 'А за границу?'), answer: a('m4', { content: 'В базе знаний пока нет ничего об этом.', sources: [], mode: 'empty' }) };
    const calls = mockApi({
      ...base,
      'GET /knowledge/sessions': [session()],
      'GET /knowledge/sessions/s1': { session: session(), messages: msgs },
      'POST /knowledge/ask': next,
      'PUT /knowledge/messages/m2/feedback': { ...a('m2'), feedback: 'up' },
    });
    renderApp('/app/notes/ask/s1');
    await screen.findByRole('article', { name: 'Ответ помощника' });
    await userEvent.click(screen.getByRole('button', { name: 'Полезный ответ' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ feedback: 'up' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Полезный ответ' })).toHaveAttribute('aria-pressed', 'true'));
    const box = screen.getByRole('textbox', { name: 'Вопрос' });
    await userEvent.type(box, 'А за границу?{Enter}');
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ question: 'А за границу?', session_id: 's1' }));
    expect(await screen.findByText('В базе знаний пока нет ничего об этом.')).toBeInTheDocument();
    // На «нет ответа» оценивать нечего.
    expect(screen.getAllByRole('button', { name: 'Полезный ответ' })).toHaveLength(1);
  });

  it('пустой вопрос не уходит; источник, к которому пропал доступ, — без ссылки', async () => {
    const calls = mockApi({
      ...base,
      'GET /knowledge/sessions': [],
      'GET /knowledge/sessions/s1': { session: session(), messages: [q('m1', 'Где шредер?'), a('m2', { content: 'Во второй переговорной [1].', sources: [{ n: 1, kind: 'doc', id: '', title: 'Источник недоступен', excerpt: '', goal_title: null, score: 0.5 }] })] },
    });
    renderApp('/app/notes/ask/s1');
    const answer = await screen.findByRole('article', { name: 'Ответ помощника' });
    expect(within(answer).getByLabelText('Источник 1 недоступен').tagName).toBe('SPAN');
    expect(within(answer).queryByRole('link')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('textbox', { name: 'Вопрос' }).closest('form')!);
    expect(await screen.findByText('Напишите вопрос')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('пояснение, когда ИИ недоступен, и строка состояния в шапке', async () => {
    mockApi({ ...base, 'GET /knowledge/sessions': [], 'GET /knowledge/sessions/s1': { session: session(), messages: [q('m1', 'Вопрос'), a('m2', { notice: 'Нейросеть сейчас недоступна — ответ собран из фрагментов базы знаний' })] } });
    renderApp('/app/notes/ask/s1');
    expect(await screen.findByRole('note')).toHaveTextContent('Нейросеть сейчас недоступна');
    expect(screen.getByText(/цитатами со ссылками/)).toBeInTheDocument();
  });
});

describe('база знаний: документы', () => {
  it('вкладка «Документы»: статусы, причина ошибки и повтор', async () => {
    const docs = [doc('d1'), doc('d2', { status: 'processing', chunks: 0 }), doc('d3', { status: 'failed', error: 'PDF защищён паролем — снимите защиту и загрузите ещё раз', chunks: 0, type: 'docx' })];
    const calls = mockApi({ ...base, 'GET /notes': [], 'GET /knowledge/docs': docs, 'POST /knowledge/docs/d3/reprocess': { ...docs[2], status: 'pending' } });
    renderApp('/app/notes?tab=docs');
    expect(await screen.findByRole('link', { name: 'Документ d1' })).toHaveAttribute('href', '/app/notes/docs/d1');
    expect(screen.getByText('Готов к вопросам')).toBeInTheDocument();
    expect(screen.getByText('Читаем документ')).toBeInTheDocument();
    expect(screen.getByText(/PDF защищён паролем/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ещё раз' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/knowledge/docs/d3/reprocess')).toBe(true));
    expect(screen.getByRole('tab', { name: /Документы · 3/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('загрузка: тип проверяется до отправки, файл уходит на сервер', async () => {
    const calls = mockApi({ ...base, 'GET /notes': [], 'GET /knowledge/docs': [] });
    const uploads = mockUploads(() => ({ data: doc('d9', { status: 'pending' }) }));
    renderApp('/app/notes?tab=docs');
    const input = await screen.findByLabelText('Файл документа');
    await userEvent.upload(input, [new File(['%PDF'], 'Регламент.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]!.path).toBe('/knowledge/docs');
    expect(uploads[0]!.file?.name).toBe('Регламент.pdf');
    expect(await screen.findByText(/загружен — помощник прочитает его/)).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File(['x'], 'схема.png', { type: 'image/png' })] } });
    expect(await screen.findByText(/«схема.png»: загрузите PDF, DOCX, TXT или MD/)).toBeInTheDocument();
    expect(uploads).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/knowledge/docs').length).toBeGreaterThanOrEqual(2);
  });

  it('без права вести базу знаний загрузки нет', async () => {
    mockApi({ ...base, 'GET /knowledge/status': { ...STATUS, can_manage: false }, 'GET /notes': [], 'GET /knowledge/docs': [] });
    renderApp('/app/notes?tab=docs');
    expect(await screen.findByText('Документов пока нет')).toBeInTheDocument();
    expect(screen.queryByLabelText('Файл документа')).not.toBeInTheDocument();
  });

  it('страница документа: текст по фрагментам, переименование', async () => {
    const calls = mockApi({
      ...base,
      'GET /knowledge/docs/d1/text': { doc: doc('d1', { title: 'Регламент командировок' }), chunks: [{ idx: 0, content: 'Командировку согласует руководитель.' }, { idx: 1, content: 'Суточные — 700 рублей.' }] },
      'PATCH /knowledge/docs/d1': doc('d1', { title: 'Командировки' }),
      'GET /knowledge/docs': [],
    });
    renderApp('/app/notes/docs/d1');
    expect(await screen.findByRole('heading', { name: 'Регламент командировок' })).toBeInTheDocument();
    expect(screen.getByText('Суточные — 700 рублей.')).toBeInTheDocument();
    expect(screen.getByText(/PDF · 4 стр\. · 12 фрагм\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Переименовать' }));
    const field = screen.getByLabelText(/^Название/, { selector: 'input' });
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Введите название')).toBeInTheDocument();
    await userEvent.type(field, 'Командировки');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ title: 'Командировки' }));
  });

  it('необработанный документ: причина и повтор', async () => {
    mockApi({ ...base, 'GET /knowledge/docs/d3/text': { doc: doc('d3', { status: 'failed', error: 'В PDF не нашлось текста — похоже, это скан.' }), chunks: [] } });
    renderApp('/app/notes/docs/d3');
    expect(await screen.findByText('В PDF не нашлось текста — похоже, это скан.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обработать ещё раз' })).toBeInTheDocument();
  });
});
