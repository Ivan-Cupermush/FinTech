import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectActions, targetPath } from '../src/features/metrics/effect';
import type { Dashboard, Me, MetricsReport } from '../src/lib/types';
import { Sparkline } from '../src/ui/Sparkline';
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

const weeks = Array.from({ length: 8 }, (_, i) => `2026-${i < 3 ? '08' : '09'}-0${(i % 9) + 1}T12:00:00.000Z`);

function report(over: Partial<MetricsReport> = {}): MetricsReport {
  return {
    at: '2026-10-19T12:00:00.000Z',
    window_days: 30,
    scope: 'company',
    north_star: {
      value: 67,
      counts: { improved: 2, flat: 0, worse: 0, stale: 1 },
      total: 3,
      without_kpi: 0,
      items: [
        { id: 'g3', title: 'Ускорить адаптацию', movement: 'stale', delta: null },
        { id: 'g1', title: 'Сократить время обработки заявки', movement: 'improved', delta: 35 },
        { id: 'g2', title: 'Сократить срок договоров', movement: 'improved', delta: 28.6 },
      ],
    },
    freshness: { value: 67, fresh: 2, total: 3, max_age_days: 14, stale: [{ id: 'g3', title: 'Ускорить адаптацию', last_observed_at: null }] },
    launch: { value: 71, launched: 5, total: 7, within_days: 7, median_days: 2.6 },
    blockers: { median_hours: 60, resolved: 2, open: 1, oldest_open_hours: 98 },
    on_time: { value: 67, on_time: 2, total: 3 },
    series: {
      at: weeks,
      north_star: [null, null, null, 0, 33, 67, 67, 67],
      freshness: [null, null, null, 33, 67, 67, 67, 67],
      blocker_hours: [null, null, null, null, 48, 48, 60, 60],
      on_time: [null, null, null, null, 100, 100, 67, 67],
    },
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('шаги на сайте', () => {
  it('каждый шаг ведёт на свой экран', () => {
    expect(targetPath({ kind: 'goal', id: 'g1' })).toBe('/app/goals/g1');
    expect(targetPath({ kind: 'blocked_tasks' })).toBe('/app/tasks?scope=all');
    expect(targetPath({ kind: 'goals' })).toBe('/app/goals');
    expect(effectActions(report(), TODAY).map((a) => a.to)).toEqual(['/app/tasks?scope=all', '/app/goals/g3']);
  });
});

describe('Sparkline', () => {
  it('пропуски рвут линию на отрезки', () => {
    const { container } = render(<Sparkline values={[10, 20, null, 30, 40]} label="ряд" />);
    expect(container.querySelectorAll('.spark-line')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'ряд' })).toBeInTheDocument();
  });
  it('без данных — штриховка вместо графика', () => {
    const { container } = render(<Sparkline values={[null, null]} label="пусто" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.spark-empty')).not.toBeNull();
  });
});

describe('экран «Эффект»', () => {
  it('Северная звезда, цели, плитки и шаги', async () => {
    mockApi({ 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /metrics': report() });
    renderApp('/app/metrics');
    expect(await screen.findByRole('heading', { name: 'Эффект' })).toBeInTheDocument();
    expect(await screen.findByText('2 из 3 активных целей с KPI сдвинули показатель к цели за 30 дней')).toBeInTheDocument();
    expect(screen.getByText('Вся компания · 30 дней')).toBeInTheDocument();

    const goals = screen.getByRole('heading', { name: 'Цели за 30 дней' }).closest('section')!;
    const rows = within(goals).getAllByRole('link');
    expect(rows[0]).toHaveTextContent('Ускорить адаптацию');
    expect(rows[0]).toHaveTextContent('Нет свежих замеров');
    expect(rows[1]!.textContent).toContain('+35 п.п.');
    expect(rows[1]).toHaveAttribute('href', '/app/goals/g1');

    const blockers = screen.getByRole('region', { name: 'Снятие блокера' });
    expect(within(blockers).getByText('2,5 дня')).toBeInTheDocument();
    expect(within(blockers).getByText('медиана по 2 блокерам · 1 открыто')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Запуск целей' })).getByText('5 из 7 запущены в первые 7 дней · медиана 2,6 дня')).toBeInTheDocument();

    const steps = screen.getByRole('heading', { name: /Что поднимет цифры/ }).closest('section')!;
    expect(within(steps).getByRole('link', { name: /Внести замер/ })).toHaveAttribute('href', '/app/goals/g3');
    expect(within(steps).getByRole('link', { name: /К задачам/ })).toHaveAttribute('href', '/app/tasks?scope=all');
  });

  it('«Как считаем» раскрывает определение метрики', async () => {
    mockApi({ 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /metrics': report() });
    renderApp('/app/metrics');
    const tile = await screen.findByRole('region', { name: 'Свежесть замеров' });
    await userEvent.click(within(tile).getByText('Как считаем'));
    expect(within(tile).getByText(/последний замер не старше двух недель/)).toBeVisible();
  });

  it('руководитель видит пометку о своей зоне', async () => {
    mockApi({ 'GET /users/me': { ...ME, role: 'manager' }, 'GET /dashboard': DASH, 'GET /metrics': report({ scope: 'visible' }) });
    renderApp('/app/metrics');
    expect(await screen.findByText('Цели вашей зоны · 30 дней')).toBeInTheDocument();
  });

  it('пустая компания — приглашение создать цель, а не нули', async () => {
    const empty = report({
      north_star: { value: null, counts: { improved: 0, flat: 0, worse: 0, stale: 0 }, total: 0, without_kpi: 0, items: [] },
      launch: { value: null, launched: 0, total: 0, within_days: 7, median_days: null },
    });
    mockApi({ 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /metrics': empty });
    renderApp('/app/metrics');
    expect(await screen.findByText('Эффект появится с первой целью')).toBeInTheDocument();
    expect(screen.queryByText('Северная звезда')).toBeNull();
  });

  it('ошибка загрузки — понятное сообщение и повтор', async () => {
    mockApi({ 'GET /users/me': ME, 'GET /dashboard': DASH });
    renderApp('/app/metrics');
    expect(await screen.findByText('Не удалось посчитать метрики')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

describe('«Эффект» в навигации и на Пульсе', () => {
  it('в сайдбаре есть, в нижних вкладках телефона — нет', async () => {
    mockApi({ 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /metrics': report() });
    renderApp('/app');
    const sidebar = await screen.findByRole('complementary', { name: 'Навигация' });
    const tabbar = screen.getByRole('navigation', { name: 'Навигация' });
    expect(within(sidebar).getByRole('link', { name: /Эффект/ })).toHaveAttribute('href', '/app/metrics');
    expect(within(tabbar).getAllByRole('link')).toHaveLength(6);
    expect(within(tabbar).getByRole('link', { name: /Чаты/ })).toHaveAttribute('href', '/app/chats');
    expect(within(tabbar).queryByRole('link', { name: /Эффект/ })).toBeNull();
  });

  it('сводка на Пульсе ведёт на экран эффекта', async () => {
    mockApi({ 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /metrics': report() });
    renderApp('/app');
    const strip = await screen.findByRole('link', { name: 'Эффект: 67 % целей сдвинули KPI за 30 дней' });
    expect(strip).toHaveAttribute('href', '/app/metrics');
    expect(within(strip).getByText('2,5 дня')).toBeInTheDocument();
  });
});
