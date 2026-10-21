import { describe, expect, it } from 'vitest';
import { glassKind, glassTint, heroColors, heroStatColor, SECTION_VARIANTS, heroMarkPlacement, heroVariantForKpi, hexToRgb, HERO_COLORS, tabBarSpace, tabIndicator } from '../src/lib/fx';

describe('hexToRgb', () => {
  it('переводит цвет в доли единицы для шейдера', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    const [r, g, b] = hexToRgb('#2f4bff');
    expect(r).toBeCloseTo(47 / 255);
    expect(g).toBeCloseTo(75 / 255);
    expect(b).toBe(1);
  });
  it('на кривой цвет падает сразу, а не рисует чёрное', () => {
    expect(() => hexToRgb('blue')).toThrow();
  });
  it('палитра героя совпадает с сайтом и вся валидна', () => {
    expect(HERO_COLORS).toEqual(['#2f4bff', '#090b2a', '#8a72ff']);
    for (const c of HERO_COLORS) expect(hexToRgb(c)).toHaveLength(3);
  });
});

describe('heroMarkPlacement', () => {
  it('знак целиком в кадре и прижат вправо', () => {
    for (const [w, h] of [
      [390, 300],
      [430, 320],
      [768, 360],
    ] as const) {
      const p = heroMarkPlacement(w, h);
      const viewH = 2 * 5 * Math.tan((45 * Math.PI) / 360);
      const viewW = viewH * (w / h);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x + 1.4 * p.scale).toBeLessThanOrEqual(viewW / 2);
      expect(1.7 * p.scale).toBeLessThanOrEqual(viewH * 0.55 + 1e-9);
    }
  });
  it('нулевой размер до первого измерения не ломает расчёт', () => {
    expect(Number.isFinite(heroMarkPlacement(0, 0).scale)).toBe(true);
  });
});

describe('glassKind', () => {
  it('Liquid Glass только там, где его даёт система', () => {
    expect(glassKind('ios', true)).toBe('liquid');
    expect(glassKind('ios', false)).toBe('blur');
    expect(glassKind('android', false)).toBe('tint');
    expect(glassKind('web', true)).toBe('tint');
  });
});

describe('tabIndicator', () => {
  it('капля стоит по центру своей вкладки и не вылезает за панель', () => {
    const width = 358;
    for (let i = 0; i < 4; i++) {
      const t = tabIndicator(i, 4, width);
      const cell = (width - 12) / 4;
      expect(t.x + t.w / 2).toBeCloseTo(6 + cell * i + cell / 2);
      expect(t.x).toBeGreaterThanOrEqual(6);
      expect(t.x + t.w).toBeLessThanOrEqual(width - 6);
    }
  });
  it('индекс за пределами — прижимается к краю, нулевая ширина не ломает', () => {
    expect(tabIndicator(9, 4, 358)).toEqual(tabIndicator(3, 4, 358));
    expect(tabIndicator(-1, 4, 358)).toEqual(tabIndicator(0, 4, 358));
    expect(tabIndicator(0, 4, 0).w).toBe(0);
  });
});

describe('tabBarSpace', () => {
  it('контенту хватает места под парящей панелью и над «чёлкой» снизу', () => {
    expect(tabBarSpace(34)).toBeGreaterThan(64 + 34);
    expect(tabBarSpace(0)).toBeGreaterThan(64);
  });
});

describe('glassTint', () => {
  it('на градиенте — всегда тёмное стекло, на экране — под тему', () => {
    expect(glassTint('color', 'light')).toEqual(glassTint('color', 'dark'));
    expect(glassTint('surface', 'light').blurTint).toMatch(/Light$/);
    expect(glassTint('surface', 'dark').blurTint).toMatch(/Dark$/);
  });
});

describe('heroVariantForKpi', () => {
  it('шапка цели окрашивается по состоянию показателя', () => {
    expect(heroVariantForKpi('achieved')).toBe('good');
    expect(heroVariantForKpi('in_range')).toBe('good');
    expect(heroVariantForKpi('regress')).toBe('bad');
    expect(heroVariantForKpi('out_of_range')).toBe('bad');
    expect(heroVariantForKpi('progressing')).toBe('hero');
    expect(heroVariantForKpi(undefined)).toBe('hero');
    for (const v of ['hero', 'good', 'bad'] as const) for (const c of heroColors(v)) expect(hexToRgb(c)).toHaveLength(3);
  });
});

describe('шапки разделов', () => {
  it('у каждого раздела своя валидная палитра, и все разные', () => {
    const seen = new Set<string>();
    for (const v of SECTION_VARIANTS) {
      const c = heroColors(v);
      expect(c).toHaveLength(3);
      for (const x of c) expect(hexToRgb(x)).toHaveLength(3);
      seen.add(c.join());
    }
    expect(seen.size).toBe(SECTION_VARIANTS.length);
    expect(seen.has(HERO_COLORS.join())).toBe(false);
  });
  it('тревожная цифра на стекле — тёплая и светлая, обычная — белая', () => {
    expect(heroStatColor(undefined)).toBe('#ffffff');
    for (const tone of ['bad', 'warn'] as const) {
      const [r, g, b] = hexToRgb(heroStatColor(tone));
      expect(r).toBeGreaterThan(0.9);
      expect((r + g + b) / 3).toBeGreaterThan(0.7);
    }
  });
});
