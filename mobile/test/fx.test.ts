import { describe, expect, it } from 'vitest';
import { glassKind, heroMarkPlacement, hexToRgb, HERO_COLORS } from '../src/lib/fx';

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
