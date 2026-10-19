import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReport, productMetrics, shiftIso, type ReportGoalInput, type Risk } from '@offix/core';
import type { Dashboard, Me, Report } from '../src/lib/types';
import { TODAY } from './fixtures';
import { mockApi, renderApp } from './render';

const ME: Me = {
  id: 'u-dir',
  email: 'director@offix.demo',
  display_name: 'Алексей Петров',
  position: 'Проректор',
  role: 'owner',
  company_id: 'c1',
  company_name: 'Демо-университет',
  setup_mode: 'structured',
  units: [],
};
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };

const NOW = '2026-10-19T12:00:00.000Z';
const ago = (d: number) => shiftIso(NOW, -d);
const blocker: Risk = { id: 'b', kind: 'blocked', severity: 'critical', title: '«Автозаполнение» заблокирована', explanation: 'Нет доступа к справочнику.', suggestion: 'Снимите причину блокировки', task_ids: [] };
const overdue: Risk = { id: 'o', kind: 'overdue', severity: 'warning', title: '«Проверка» просрочена на 3 дня', explanation: 'Срок был 16 октября.', suggestion: 'Уточните срок', task_ids: [] };
const blind: Risk = { id: 'n', kind: 'no_measurement', severity: 'info', title: 'Нет свежих измерений «Время»', explanation: '', suggestion: 'Внесите текущее значение показателя', task_ids: [] };

function report(goals?: ReportGoalInput[], days: 7 | 30 | 90 = 30): Report {
  const list: ReportGoalInput[] = goals ?? [
    {
      id: 'g1',
      title: 'Сократить время обработки заявки',
      status: 'active',
      owner_name: 'Ольга Смирнова',
      due_at: '2026-12-31',
      completed_at: null,
      kpi: { name: 'Среднее время', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease', observations: [{ value: 36.5, observed_at: ago(3) }] },
      risks: [blocker, overdue],
      tasks: [
        { id: 't1', status: 'done', due_at: '2026-10-20', done_at: ago(2) },
        { id: 't2', status: 'blocked', due_at: '2026-11-01', done_at: null },
      ],
    },
    { id: 'g2', title: 'Ускорить адаптацию', status: 'active', owner_name: 'Елена Фёдорова', due_at: '2027-03-18', completed_at: null, kpi: null, risks: [blind], tasks: [] },
  ];
  const histories = list.map((g) => ({ id: g.id, title: g.title, created_at: ago(60), activated_at: ago(59), closed_at: null, kpi: g.kpi }));
  return buildReport({
    company: 'Демо-университет',
    scope: 'company',
    author: 'Алексей Петров',
    at: NOW,
    days,
    goals: list,
    metrics: productMetrics({ goals: histories, events: [], tasks: list.flatMap((g) => g.tasks) }, NOW, { windowDays: days, weeks: 1 }),
  });
}

const base = { 'GET /users/me': ME, 'GET /dashboard': DASH };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('отчёт для руководства', () => {
  it('лист: шапка, главное, цифры, решения и цели', async () => {
    mockApi({ ...base, 'GET /report': report() });
    renderApp('/app/report');
    const sheet = await screen.findByRole('article', { name: 'Отчёт за 19 сентября — 19 октября 2026' });
    expect(within(sheet).getByText('Демо-университет')).toBeInTheDocument();
    expect(within(sheet).getByText(/Сформирован 19 октября 2026 · Алексей Петров/)).toBeInTheDocument();
    expect(within(sheet).getByText('1 из 1 цели с KPI сдвинула показатель к цели.')).toBeInTheDocument();

    const decisions = within(sheet).getByRole('heading', { name: 'Нужно решение' }).closest('section')!;
    const items = within(decisions).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveClass('critical');
    expect(items[0]).toHaveTextContent('«Автозаполнение» заблокирована');
    expect(items[0]).toHaveTextContent('→ Снимите причину блокировки');

    const goals = within(sheet).getByRole('heading', { name: 'Цели' }).closest('section')!;
    const links = within(goals).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Сократить время обработки заявки', 'Ускорить адаптацию']);
    expect(links[0]).toHaveAttribute('href', '/app/goals/g1');
    expect(within(goals).getByText('Под угрозой')).toBeInTheDocument();
    expect(within(goals).getByText('Нет замеров')).toBeInTheDocument();
    expect(within(goals).getByText('Без KPI: эффект не измерить')).toBeInTheDocument();
  });

  it('риск из «Нужно решение» в строке цели не повторяется, справочный — показан', async () => {
    mockApi({ ...base, 'GET /report': report() });
    renderApp('/app/report');
    await screen.findByRole('article');
    expect(screen.getAllByText('«Автозаполнение» заблокирована')).toHaveLength(1);
    expect(screen.getByText('Нет свежих измерений «Время».')).toBeInTheDocument();
  });

  it('период меняется сегментом и попадает в адрес запроса', async () => {
    const calls = mockApi({ ...base, 'GET /report': (c: { path: string }) => report(undefined, c.path.includes('days=90') ? 90 : 30) });
    renderApp('/app/report');
    await screen.findByRole('article');
    expect(calls.some((c) => c.path === '/report?days=30')).toBe(true);
    await userEvent.click(screen.getByRole('tab', { name: 'Квартал' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/report?days=90')).toBe(true));
    expect(screen.getByRole('tab', { name: 'Квартал' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/Вся организация · квартал/)).toBeInTheDocument();
  });

  it('неделя открывается по ссылке с ?days=7', async () => {
    const calls = mockApi({ ...base, 'GET /report': report(undefined, 7) });
    renderApp('/app/report?days=7');
    await screen.findByRole('article');
    expect(calls.some((c) => c.path === '/report?days=7')).toBe(true);
    expect(screen.getByRole('tab', { name: 'Неделя' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Excel: скачивается CSV с датой в имени', async () => {
    mockApi({ ...base, 'GET /report': report() });
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (blobs.push(b), 'blob:x')), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('offix-otchet-2026-10-19.csv');
    });
    renderApp('/app/report');
    await screen.findByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    expect(click).toHaveBeenCalledOnce();
    expect(blobs[0]!.type).toBe('text/csv;charset=utf-8');
    const text = await blobs[0]!.text();
    expect(text).toContain('Цель;Владелец;Срок;Состояние');
    expect(text).toContain('Сократить время обработки заявки;Ольга Смирнова;2026-12-31;Под угрозой');
  });

  it('Текст: копируется отчёт для мессенджера', async () => {
    mockApi({ ...base, 'GET /report': report() });
    const user = userEvent.setup();
    renderApp('/app/report');
    await screen.findByRole('article');
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Текст' }));
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]![0]).toMatch(/^Отчёт offix · Демо-университет\n19 сентября — 19 октября 2026/);
    expect(await screen.findByText(/Текст отчёта скопирован/)).toBeInTheDocument();
  });

  it('PDF — печать листа, имя файла из заголовка страницы', async () => {
    mockApi({ ...base, 'GET /report': report() });
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderApp('/app/report');
    await screen.findByRole('article');
    expect(document.title).toBe('offix-otchet-2026-10-19');
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('целей нет — понятная пустая страница, без нулей', async () => {
    mockApi({ ...base, 'GET /report': report([]) });
    renderApp('/app/report');
    expect(await screen.findByText('За период нет целей в работе')).toBeInTheDocument();
    expect(screen.queryByText('Главное')).toBeNull();
  });

  it('ошибка — сообщение и повтор, кнопки выгрузки недоступны', async () => {
    mockApi(base);
    renderApp('/app/report');
    expect(await screen.findByText('Не удалось собрать отчёт')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();
  });

  it('в сайдбаре есть «Отчёт», с экрана «Эффект» — ссылка на него', async () => {
    mockApi({ ...base, 'GET /report': report() });
    renderApp('/app/report');
    const sidebar = await screen.findByRole('complementary', { name: 'Навигация' });
    expect(within(sidebar).getByRole('link', { name: /Отчёт/ })).toHaveAttribute('href', '/app/report');
    expect(within(screen.getByRole('navigation', { name: 'Навигация' })).getAllByRole('link')).toHaveLength(5);
  });
});
