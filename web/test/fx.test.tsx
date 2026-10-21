import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Glass } from '../src/ui/fx/Glass';
import { gradientCss, gradientLook } from '../src/ui/fx/gradients';
import { markPlacement } from '../src/ui/fx/layout';
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
