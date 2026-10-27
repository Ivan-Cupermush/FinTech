import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { Target } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteSummary } from '@offix/core';
import { goalsHeroStats, inboxHeroStats, integrationsHeroStats, knowledgeHeroStats, notesHeroStats, orgHeroStats, reportHeroStats, tasksHeroStats } from '../src/lib/hero-stats';
import type { Dashboard, Me } from '../src/lib/types';
import { gradientCss, gradientLook, SECTION_VARIANTS } from '../src/ui/fx/gradients';
import { glyphPlacement, markPlacement } from '../src/ui/fx/layout';
import { PageHero } from '../src/ui/fx/PageHero';
import { TODAY } from './fixtures';
import { mockApi, renderApp } from './render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const values = (s: { value: unknown }[]) => s.map((x) => x.value);
const tones = (s: { tone?: string }[]) => s.map((x) => x.tone);

describe('цифры в шапках разделов', () => {
  it('цели: в работе, под угрозой (по целям, а не по рискам) и черновики', () => {
    const s = goalsHeroStats(
      [{ status: 'active' }, { status: 'active' }, { status: 'draft' }, { status: 'completed' }],
      [
        { severity: 'critical', goal_id: 'g1' },
        { severity: 'critical', goal_id: 'g1' },
        { severity: 'warning', goal_id: 'g2' },
      ],
    );
    expect(values(s)).toEqual([2, 1, 1]);
    expect(tones(s)).toEqual([undefined, 'bad', undefined]);
  });
  it('задачи: просроченная заблокированная считается блокером, а не просрочкой', () => {
    const s = tasksHeroStats(
      [
        { id: 'a', status: 'in_progress', due_at: '2026-10-30' },
        { id: 'b', status: 'blocked', due_at: '2026-10-01' },
        { id: 'c', status: 'todo', due_at: '2026-10-01' },
        { id: 'd', status: 'done', due_at: '2026-10-01' },
      ],
      TODAY,
    );
    expect(values(s)).toEqual([1, 1, 1]);
    expect(tones(s)).toEqual([undefined, 'bad', 'warn']);
  });
  it('ноль никогда не подсвечивается', () => {
    for (const s of [tasksHeroStats([], TODAY), goalsHeroStats([]), integrationsHeroStats([]), inboxHeroStats([]), reportHeroStats({ goals: 0, health: {}, tasks_done: 0 })]) expect(s.every((x) => !x.tone)).toBe(true);
  });
  it('база знаний: всего, общих и обновлённых за неделю', () => {
    const s = notesHeroStats(
      [
        { goal_id: null, updated_at: '2026-10-18T10:00:00Z' },
        { goal_id: 'g1', updated_at: '2026-10-12T10:00:00Z' },
        { goal_id: 'g1', updated_at: '2026-09-01T10:00:00Z' },
      ],
      TODAY,
    );
    expect(values(s)).toEqual([3, 1, 2]);
    // Главная базы знаний: статьи, прочитанные документы (пока не загрузились — прочерк), свежие правки.
    expect(values(knowledgeHeroStats([{ updated_at: '2026-10-18T10:00:00Z' }], 4, TODAY))).toEqual([1, 4, 1]);
    expect(values(knowledgeHeroStats([], undefined, TODAY))).toEqual([0, '—', 0]);
  });
  it('интеграции, входящие, организация и отчёт', () => {
    expect(values(integrationsHeroStats([{ state: 'ok' }, { state: 'error' }, { state: 'never' }]))).toEqual([3, 1, 1]);
    const inbox = inboxHeroStats([
      { kind: 'task_blocked', read_at: null },
      { kind: 'task_blocked', read_at: '2026-10-18' },
      { kind: 'comment', read_at: null },
    ]);
    expect(values(inbox)).toEqual([2, 1, 1]);
    expect(values(orgHeroStats([{ active: true }, { active: false }, { active: true }], [{}, {}]))).toEqual([2, 2]);
    const r = reportHeroStats({ goals: 4, health: { critical: 2, on_track: 2 }, tasks_done: 7 });
    expect(values(r)).toEqual([4, 2, 7]);
    expect(r[1]!.tone).toBe('bad');
  });
});

describe('знак раздела в шапке', () => {
  const view = (w: number, h: number) => {
    const viewH = 2 * 2 * Math.tan(((45 * Math.PI) / 180) / 2);
    return { viewH, viewW: viewH * (w / h) };
  };
  it('на телефоне — в верхнем правом углу, целиком в кадре и не шире трети', () => {
    for (const [w, h] of [[358, 300], [390, 260], [600, 280]] as const) {
      const p = glyphPlacement(w, h, true);
      const { viewW, viewH } = view(w, h);
      expect(p.x).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThan(0);
      expect(p.x + (2.2 / 2) * p.scale).toBeLessThanOrEqual(viewW / 2);
      expect(p.y + (1.9 / 2) * p.scale).toBeLessThanOrEqual(viewH / 2);
      expect(2.2 * p.scale).toBeLessThanOrEqual(viewW * 0.3);
    }
  });
  it('на широком экране — как знак Пульса сбоку', () => {
    expect(glyphPlacement(1100, 260, false)).toEqual(markPlacement(1100, 260, 45, 2, 'side'));
  });
  it('нулевой размер до первого измерения не ломает расчёт', () => {
    expect(Number.isFinite(glyphPlacement(0, 0, true).scale)).toBe(true);
  });
});

describe('палитры разделов', () => {
  it('у каждого раздела свои три цвета, в светлой и тёмной теме', () => {
    for (const dark of [false, true]) {
      const seen = new Set<string>();
      for (const v of SECTION_VARIANTS) {
        const look = gradientLook(v, dark);
        expect(look.colors).toHaveLength(3);
        for (const c of look.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
        expect(gradientCss(look)).toContain(look.colors[0]);
        seen.add(look.colors.join());
      }
      expect(seen.size).toBe(SECTION_VARIANTS.length);
      expect(seen.has(gradientLook('hero', dark).colors.join())).toBe(false);
    }
  });
});

describe('шапка раздела', () => {
  const stats = [
    { label: 'в работе', value: 3 },
    { label: 'под угрозой', value: 1, tone: 'bad' as const },
  ];
  it('без WebGL — CSS-градиент и плоский знак; заголовок называет раздел', () => {
    const { container } = render(<PageHero variant="goals" icon={Target} eyebrow="Раздел" title="Цели" subtitle="Что меняем" stats={stats} />);
    const hero = screen.getByRole('region', { name: 'Цели' });
    expect(hero).toHaveAttribute('data-fx', 'static');
    expect(hero).toHaveAttribute('data-section', 'goals');
    expect(hero).toHaveClass('page-hero', 'on-color');
    expect(container.querySelector('.fx-flat-glyph')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Цели' })).toBeInTheDocument();
    const tiles = container.querySelectorAll('.app-hero-stat-body');
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toHaveAttribute('data-tone', 'bad');
    expect(within(tiles[1] as HTMLElement).getByText('под угрозой')).toBeInTheDocument();
  });
  it('компактная — без плиток, но с «назад» и действиями', () => {
    const { container } = render(<PageHero variant="knowledge" icon={Target} compact title="Заметка" stats={stats} back={<a href="/x">Назад</a>} actions={<button type="button">Изменить</button>} />);
    expect(container.querySelector('.page-hero')).toHaveClass('is-compact');
    expect(container.querySelectorAll('.app-hero-stat')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Назад' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeInTheDocument();
  });
});

describe('шапки на экранах', () => {
  const ME: Me = { id: 'u1', email: 'olga@offix.demo', display_name: 'Ольга Смирнова', position: null, role: 'manager', company_id: 'c1', company_name: 'Демо', setup_mode: 'structured', units: [] };
  const DASH: Dashboard = { today: TODAY, goals: [], risks: [], my_tasks: [], help_needed: [], unread_notifications: 0, drafts: [] };
  const note = (id: string, goal_id: string | null): NoteSummary => ({ id, title: `Заметка ${id}`, excerpt: '', goal_id, goal_title: goal_id ? 'Цель' : null, author_name: 'Ольга', updated_at: new Date().toISOString() });

  it('база знаний: шапка с цифрами по всей базе', async () => {
    mockApi({ 'GET /users/me': ME, 'GET /dashboard': DASH, 'GET /notes': [note('n1', null), note('n2', 'g1')], 'GET /knowledge/docs': [{ id: 'd1', status: 'ready' }, { id: 'd2', status: 'failed' }] });
    const { container } = renderApp('/app/notes');
    const hero = await screen.findByRole('region', { name: 'База знаний' });
    expect(hero).toHaveAttribute('data-section', 'knowledge');
    await within(hero).findByText('документов');
    await waitFor(() => expect([...container.querySelectorAll('.app-hero-stat-body .num')].map((n) => n.textContent)).toEqual(['2', '1', '2']));
  });

  it('уведомления: шапка раздела с непрочитанными', async () => {
    mockApi({
      'GET /users/me': ME,
      'GET /dashboard': DASH,
      'GET /notifications': [{ id: 'x', kind: 'task_blocked', title: 'Блокер', body: null, goal_id: null, task_id: 't1', read_at: null, created_at: '2026-10-19T08:00:00Z' }],
    });
    renderApp('/app/notifications');
    const hero = await screen.findByRole('region', { name: 'Уведомления' });
    expect(await within(hero).findByText('блокеры')).toBeInTheDocument();
  });
});
