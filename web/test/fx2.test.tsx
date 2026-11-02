import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dashboard, Me } from '../src/lib/types';
import { GoalTile, deltaTone } from '../src/features/goals/parts';
import { heroVariant } from '../src/features/goals/GoalPage';
import { pearlAngle } from '../src/ui/Button';
import { makeParticles, stepParticle, burstPoint } from '../src/ui/fx/burst';
import { Odometer, odometerTurns } from '../src/ui/fx/Odometer';
import { metric, roadmap, task, TODAY } from './fixtures';
import { mockApi, renderApp } from './render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const ME: Me = { id: 'u-olga', email: 'olga@offix.demo', display_name: 'Ольга Смирнова', position: null, role: 'manager', company_id: 'c1', company_name: 'Демо', setup_mode: 'structured', units: [] };
const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
const base = { 'GET /users/me': ME, 'GET /dashboard': DASH };

/** Просьба о меньшем движении — через matchMedia. */
function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
}

describe('одометр', () => {
  it('число целиком — в тексте для диктора, разряды — без текста в DOM', () => {
    render(<Odometer value="1 326 500" />);
    expect(screen.getByText('1 326 500')).toHaveClass('visually-hidden');
    const vis = document.querySelector('.odo-vis')!;
    expect(vis).toHaveAttribute('aria-hidden');
    expect(vis.textContent).toBe('');
    expect(vis.querySelectorAll('.odo-d')).toHaveLength(7);
    expect(vis.querySelectorAll('.odo-c')).toHaveLength(2);
  });
  it('младшие разряды делают лишние обороты, старшие — нет', () => {
    expect([0, 1, 2, 5].map(odometerTurns)).toEqual([2, 1, 0, 0]);
  });
  it('без IntersectionObserver встаёт на итоговые цифры', async () => {
    render(<Odometer value="36,5" />);
    await act(async () => {});
    const strips = [...document.querySelectorAll<HTMLElement>('.odo-strip')].map((s) => s.style.getPropertyValue('--n'));
    // 3 — старший разряд без оборотов, 6 — средний (+10), 5 — младший (+20).
    expect(strips).toEqual(['3', '16', '25']);
  });
  it('при просьбе о меньшем движении — просто число', () => {
    reducedMotion(true);
    render(<Odometer value="75" />);
    expect(screen.getByText('75')).toHaveClass('num');
    expect(document.querySelector('.odo')).toBeNull();
  });
});

describe('перламутровая кнопка и всплеск', () => {
  it('угол перелива следует за указателем', () => {
    expect(pearlAngle(50, 0, 100, 40)).toBe(0);
    expect(pearlAngle(100, 20, 100, 40)).toBe(90);
    expect(pearlAngle(50, 40, 100, 40)).toBe(180);
    expect(pearlAngle(0, 20, 100, 40)).toBe(270);
  });
  it('32 частицы из точки касания, веер в основном вверх', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ps = makeParticles(100, 200, ['#fff'], rand);
    expect(ps).toHaveLength(32);
    expect(ps.every((p) => p.x === 100 && p.y === 200)).toBe(true);
    expect(ps.filter((p) => p.vy < 0).length).toBeGreaterThan(24);
    for (const p of ps) {
      const v = Math.hypot(p.vx, p.vy);
      expect(v).toBeGreaterThanOrEqual(280 - 1e-6);
      expect(v).toBeLessThanOrEqual(520 + 1e-6);
      expect(p.life).toBeLessThanOrEqual(900);
    }
  });
  it('сопротивление гасит 60 % скорости за 200 мс, гравитация тянет вниз', () => {
    const p = { x: 0, y: 0, vx: 100, vy: 0, life: 900, size: 3, shape: 'dot' as const, rot: 0, color: '#fff' };
    const after = stepParticle(p, 0.2);
    expect(after.vx).toBeCloseTo(40);
    expect(after.vy).toBeGreaterThan(0);
    expect(after.x).toBeCloseTo(20);
  });
  it('с клавиатуры всплеск из центра кнопки', () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 40 }) as DOMRect;
    expect(burstPoint({ clientX: 0, clientY: 0, currentTarget: el })).toEqual({ x: 60, y: 40 });
    expect(burstPoint({ clientX: 5, clientY: 7, currentTarget: el })).toEqual({ x: 5, y: 7 });
  });
});

describe('Risk Radar: карточка цели', () => {
  const tile = (over: Partial<Parameters<typeof GoalTile>[0]['goal']> = {}) =>
    render(
      <MemoryRouter>
        <GoalTile today={TODAY} goal={{ id: 'g1', title: 'Сократить время заявки', type: 'operational', due_at: '2026-12-31', primary_metric: metric({ trend: [40, 38, 36.5] }), task_progress: { done: 1, total: 4 }, ...over }} />
      </MemoryRouter>,
    );

  it('цвет и метка — из модели рисков: критичная — гранат «D · Под угрозой» с пульсом', () => {
    tile({ risk_level: 'critical' });
    const card = screen.getByRole('link', { name: 'Сократить время заявки: под угрозой' });
    expect(card).toHaveClass('rr', 'rr-critical');
    expect(card).toHaveAttribute('href', '/app/goals/g1');
    expect(card.style.getPropertyValue('--rr-from')).toBe('#ff3b5c');
    expect(within(card).getByText('Под угрозой')).toBeInTheDocument();
    expect(within(card).getByText('D')).toBeInTheDocument();
    expect(card.querySelector('.rr-pulse')).not.toBeNull();
  });

  it('без рисков и KPI движется — мята «A · В норме», без пульса', () => {
    tile({ risk_level: 'ok' });
    const card = screen.getByRole('link', { name: /в норме/ });
    expect(card).toHaveClass('rr-safe');
    expect(card.querySelector('.rr-pulse')).toBeNull();
  });

  it('главный KPI крупно, цель и путь, изменение к прошлому замеру по направлению KPI', () => {
    tile({ risk_level: 'warning' });
    const card = screen.getByRole('link');
    expect(within(card).getByText('36,5')).toBeInTheDocument();
    expect(within(card).getByText('мин')).toBeInTheDocument();
    // Время уменьшилось на 1,5 — для цели «уменьшить» это хорошо: стрелка вверх.
    expect(within(card).getByTitle('К прошлому замеру')).toHaveTextContent('▲ −1,5');
    expect(card.querySelector('.rr-spark path')).not.toBeNull();
    expect(within(card).getByText('Задачи 1 из 4')).toBeInTheDocument();
  });

  it('нет замеров, нет KPI, черновик', () => {
    tile({ primary_metric: metric({ current_value: null, progress: { state: 'no_data', raw: null, bar: null } }) });
    expect(screen.getByText('Нет замеров')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveClass('rr-steady');
    cleanup();
    tile({ primary_metric: null, status: 'draft', risk_level: undefined });
    expect(screen.getByText('KPI не задан')).toBeInTheDocument();
    expect(screen.getByText(/черновик/)).toBeInTheDocument();
  });

  it('направление изменения', () => {
    expect(deltaTone(-2, 'decrease')).toBe('good');
    expect(deltaTone(2, 'decrease')).toBe('bad');
    expect(deltaTone(2, 'increase')).toBe('good');
    expect(deltaTone(2, 'maintain')).toBe('flat');
    expect(deltaTone(0, 'increase')).toBe('flat');
  });

  it('шапка цели в цвет риска', () => {
    expect(heroVariant('critical', 'progress')).toBe('bad');
    expect(heroVariant('safe', 'progress')).toBe('good');
    expect(heroVariant('warning', 'regress')).toBe('bad');
    expect(heroVariant('steady', 'no_data')).toBe('hero');
  });
});

describe('капиллярная карта цели', () => {
  it('открывается по умолчанию: узлы задач и цели, критический путь, «Сегодня»', async () => {
    mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap() });
    renderApp('/app/goals/g1');
    const map = await screen.findByRole('region', { name: 'Капиллярная карта цели' });
    expect(screen.getByRole('tab', { name: 'Карта' })).toHaveAttribute('aria-selected', 'true');
    const nodes = within(map).getAllByRole('button', { pressed: false });
    // Три задачи (отменённая не рисуется) и сама цель.
    expect(nodes).toHaveLength(4);
    expect(within(map).getByRole('button', { name: /^Задача «Подключить API»: блок · .*, критический путь$/ })).toHaveClass('cap-node', 'blocked', 'critical');
    expect(within(map).getByRole('button', { name: /^Цель «/ })).toHaveClass('goal');
    expect(map.querySelectorAll('.cap-link.critical').length).toBeGreaterThanOrEqual(2);
    expect(map.querySelector('.cap-link.broken')).not.toBeNull();
    expect(within(map).getByText('Сегодня')).toBeInTheDocument();
  });

  it('клик по узлу — ударная волна и панель задачи; «Открыть задачу» — панель задачи; Esc закрывает', async () => {
    mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap(), 'GET /tasks/t3': { ...task('t3', { title: 'Обучить сотрудников' }), history: [], dependencies: [], participants: [], files: [] }, 'GET /discussions/task/t3': { comments: [], unread: 0 } });
    renderApp('/app/goals/g1');
    const map = await screen.findByRole('region', { name: 'Капиллярная карта цели' });
    const node = within(map).getByRole('button', { name: /^Задача «Обучить сотрудников»/ });
    await userEvent.click(node);
    expect(node).toHaveAttribute('aria-pressed', 'true');
    expect(map.querySelector('.cap-shock')).not.toBeNull();
    const panel = within(map).getByRole('region', { name: 'Задача «Обучить сотрудников»' });
    expect(within(panel).getByText(/критический путь/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(within(map).queryByRole('region', { name: /Задача/ })).toBeNull();
    await userEvent.click(node);
    await userEvent.click(within(map).getByRole('button', { name: 'Открыть задачу' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('у цели без задач карта не рисуется — показывается список', async () => {
    mockApi({ ...base, 'GET /goals/g1/roadmap': roadmap({ tasks: [], edges: [], critical_path: [], direct_task_ids: [], subgoals: [] }) });
    renderApp('/app/goals/g1');
    await screen.findByRole('tab', { name: 'Карта' });
    expect(screen.queryByRole('region', { name: 'Капиллярная карта цели' })).toBeNull();
  });

  it('карточка цели на Пульсе — Risk Radar с одометром', async () => {
    mockApi({ ...base, 'GET /dashboard': { ...DASH, goals: [{ id: 'g1', title: 'Цель', type: 'strategic', due_at: null, primary_metric: metric(), progress: 35, task_progress: { done: 0, total: 0 }, risk_level: 'warning' }] }, 'GET /metrics': null });
    renderApp('/app');
    const card = await screen.findByRole('link', { name: 'Цель: есть риски' });
    expect(card).toHaveClass('rr-warning');
    expect(card.querySelector('.odo')).not.toBeNull();
  });
});
