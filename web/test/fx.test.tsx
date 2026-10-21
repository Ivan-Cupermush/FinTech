import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Glass } from '../src/ui/fx/Glass';
import { gradientCss, gradientForKpi, gradientLook } from '../src/ui/fx/gradients';
import { kpiBarHeights, markPlacement } from '../src/ui/fx/layout';
import { PilotChart } from '../src/ui/fx/PilotChart';
import { PILOT_BARS } from '../src/features/landing/LandingPage';
import { pulseStats } from '../src/features/pulse/PulsePage';
import { canUseWebGL, fxLevel } from '../src/ui/fx/support';
import { renderApp } from './render';

afterEach(() => cleanup());

describe('уровень эффектов', () => {
  it('без WebGL — статичный CSS, при просьбе о меньшем движении — без анимации', () => {
    expect(fxLevel(false, false)).toBe('static');
    expect(fxLevel(false, true)).toBe('static');
    expect(fxLevel(true, true)).toBe('calm');
    expect(fxLevel(true, false)).toBe('full');
  });
  it('в jsdom WebGL нет — значит, тесты и старые браузеры получают запасной вариант', () => {
    expect(canUseWebGL()).toBe(false);
  });
});

describe('положение 3D-знака', () => {
  it('на широком экране — справа и целиком в кадре', () => {
    const p = markPlacement(1440, 880);
    const viewH = 2 * p.distance * Math.tan(((45 * Math.PI) / 180) / 2);
    const viewW = viewH * (1440 / 880);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x + (2.8 / 2) * p.scale).toBeLessThan(viewW / 2);
  });
  it('на телефоне — по центру над заголовком', () => {
    const p = markPlacement(390, 844);
    expect(p.x).toBe(0);
    expect(p.y).toBeGreaterThan(0);
    const viewH = 2 * p.distance * Math.tan(((45 * Math.PI) / 180) / 2);
    const viewW = viewH * (390 / 844);
    expect(2.8 * p.scale).toBeLessThanOrEqual(viewW * 0.6 + 1e-9);
  });
  it('нулевой размер холста не ломает расчёт', () => {
    const p = markPlacement(0, 0);
    expect(Number.isFinite(p.scale)).toBe(true);
  });
  it('в шапке экрана знак стоит справа и не вылезает за край', () => {
    for (const [w, h] of [[1200, 260], [900, 320], [390, 420]] as const) {
      const p = markPlacement(w, h, 45, 2, 'side');
      const viewH = 2 * p.distance * Math.tan(((45 * Math.PI) / 180) / 2);
      const viewW = viewH * (w / h);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x + (2.8 / 2) * p.scale).toBeLessThanOrEqual(viewW / 2);
      expect(Math.abs(p.y) + (1.7 / 2) * p.scale).toBeLessThanOrEqual(viewH / 2);
      // Не больше трети ширины: текст слева остаётся читаемым.
      expect(2.8 * p.scale).toBeLessThanOrEqual(viewW * 0.3 + 1e-9);
    }
  });
  it('на широкой шапке знак по центру по высоте, на узкой — в верхнем углу', () => {
    expect(markPlacement(1200, 260, 45, 2, 'side').y).toBe(0);
    expect(markPlacement(390, 420, 45, 2, 'side').y).toBeGreaterThan(0);
  });
  it('режим по умолчанию — как на главной', () => {
    expect(markPlacement(1440, 880)).toEqual(markPlacement(1440, 880, 45, 2, 'landing'));
  });
});

describe('высоты столбиков графика', () => {
  it('сохраняют порядок значений и выше всех — наибольшее', () => {
    const h = kpiBarHeights([40, 36.5, 30], 2);
    expect(h[0]).toBeCloseTo(2);
    expect(h[0]!).toBeGreaterThan(h[1]!);
    expect(h[1]!).toBeGreaterThan(h[2]!);
  });
  it('не преувеличивают разницу: самый низкий столбик — заметно больше нуля', () => {
    const h = kpiBarHeights([40, 36.5, 30], 2);
    expect(h[2]!).toBeGreaterThan(0.8);
  });
  it('пропорции не зависят от масштаба', () => {
    const a = kpiBarHeights([40, 36.5, 30], 1);
    const b = kpiBarHeights([40, 36.5, 30], 100);
    a.forEach((v, i) => expect(b[i]!).toBeCloseTo(v * 100));
  });
  it('одинаковые значения — одинаковые столбики, пустой список — пусто', () => {
    expect(kpiBarHeights([5, 5, 5], 2)).toEqual([2, 2, 2]);
    expect(kpiBarHeights([], 2)).toEqual([]);
  });
  it('нули и отрицательные числа не дают столбиков нулевой высоты', () => {
    for (const v of kpiBarHeights([0, 10, -4], 2)) expect(v).toBeGreaterThanOrEqual(0.05);
  });
});

describe('градиенты', () => {
  it('в палитре только фирменный синий и его соседи', () => {
    for (const v of ['hero', 'login'] as const)
      for (const dark of [false, true]) {
        const look = gradientLook(v, dark);
        expect(look.colors).toHaveLength(3);
        for (const c of look.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
  });
  it('шапка цели окрашивается по состоянию KPI', () => {
    expect(gradientForKpi('achieved')).toBe('good');
    expect(gradientForKpi('in_range')).toBe('good');
    expect(gradientForKpi('regress')).toBe('bad');
    expect(gradientForKpi('out_of_range')).toBe('bad');
    for (const s of ['progress', 'stalled', 'no_data', null, undefined]) expect(gradientForKpi(s)).toBe('hero');
  });
  it('«хорошая» и «плохая» шапки отличаются от обычной и держат фирменный синий', () => {
    for (const dark of [false, true]) {
      const hero = gradientLook('hero', dark).colors;
      const good = gradientLook('good', dark).colors;
      const bad = gradientLook('bad', dark).colors;
      expect(good).not.toEqual(hero);
      expect(bad).not.toEqual(hero);
      expect(good).not.toEqual(bad);
      for (const c of [...good, ...bad]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('CSS-запасной вариант собран из тех же трёх цветов', () => {
    const look = gradientLook('hero', false);
    const css = gradientCss(look);
    for (const c of look.colors) expect(css).toContain(c);
  });
});

describe('жидкое стекло', () => {
  it('показывает содержимое и оставляет его доступным', () => {
    render(
      <Glass>
        <button type="button">Войти</button>
      </Glass>,
    );
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(document.querySelector('.glass-slot .glass')).not.toBeNull();
  });
});

describe('главная', () => {
  it('первый экран без WebGL рисует CSS-градиент и плоский знак', () => {
    renderApp('/');
    const stage = document.querySelector('.l-stage')!;
    expect(stage.getAttribute('data-fx')).toBe('static');
    expect(stage.querySelector('.fx-css')).not.toBeNull();
    expect(stage.querySelector('.fx-gl')).toBeNull();
    expect(stage.querySelector('.fx-flat-mark')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Цели, которыедвигают цифры.');
  });

  it('в подвале благодарим авторов визуальных библиотек и ведём на лицензии', () => {
    renderApp('/');
    const foot = screen.getByRole('contentinfo');
    for (const name of ['React Three Fiber', 'liquid-glass-react', 'ShaderGradient', 'three.js']) {
      expect(within(foot).getByRole('link', { name })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/github\.com\//));
    }
    expect(within(foot).getByRole('link', { name: 'Лицензии и благодарности' })).toHaveAttribute('href', '/licenses');
  });
});

describe('страница лицензий', () => {
  it('для каждой библиотеки раскрывается полный текст с копирайтом', async () => {
    renderApp('/licenses');
    expect(screen.getByRole('heading', { name: 'Лицензии и благодарности' })).toBeInTheDocument();
    await userEvent.click(screen.getByText('liquid-glass-react', { selector: '.lic-name' }));
    expect(screen.getByText(/Copyright 2025 MAX ROVENSKY/)).toBeVisible();
    expect(screen.getByText(/Copyright \(c\) ruucm, stone-skipper/, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Expo', { selector: '.lic-name' })).toBeNull();
  });
});

describe('3D-график пилота', () => {
  it('без WebGL показывает плоские столбики и подписи значений', () => {
    render(<PilotChart bars={PILOT_BARS} unit="мин" caption="Время согласования" />);
    const fig = screen.getByRole('figure');
    expect(fig).toHaveAccessibleName('Время согласования: было 40 мин, сейчас 36,5 мин, цель 30 мин');
    const bars = fig.querySelectorAll<HTMLElement>('.pilot-flat span');
    expect(bars).toHaveLength(3);
    expect(bars[2]).toHaveClass('is-target');
    const heights = [...bars].map((b) => parseFloat(b.style.height));
    expect(heights[0]).toBeGreaterThan(heights[1]!);
    expect(heights[1]).toBeGreaterThan(heights[2]!);
    expect(fig).toHaveTextContent('36,5');
    expect(fig.querySelector('canvas')).toBeNull();
  });
  it('на главной стоит в блоке пилота с числами из демо', () => {
    renderApp('/');
    const pilot = document.getElementById('pilot')!;
    expect(within(pilot).getByRole('figure')).toHaveAccessibleName(/было 40 мин, сейчас 36,5 мин, цель 30 мин/);
    expect(PILOT_BARS.filter((b) => b.target)).toHaveLength(1);
  });
});

describe('счётчики в шапке Пульса', () => {
  it('считает только критичные риски, просьбы о помощи и мои задачи', () => {
    const r = (severity: string) => ({ severity }) as never;
    const stats = pulseStats({ risks: [r('critical'), r('warning'), r('critical')], help_needed: [{} as never], my_tasks: [] });
    expect(stats).toEqual([
      { label: 'под угрозой', value: 2 },
      { label: 'ждут помощи', value: 1 },
      { label: 'мои задачи', value: 0 },
    ]);
  });
});
