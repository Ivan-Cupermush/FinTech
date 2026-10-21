/**
 * Чистая логика эффектов приложения: палитра живого градиента и
 * положение 3D-знака. Без React Native — чтобы проверять тестами.
 *
 * Палитра та же, что у ShaderGradient на сайте: фирменный синий, ночь и фиолетовый.
 */
export const HERO_COLORS = ['#2f4bff', '#090b2a', '#8a72ff'] as const;

/** '#rrggbb' → [r, g, b] в долях единицы — так цвета уходят в шейдер. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Неверный цвет: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Где стоит знак «o›» в шапке экрана входа: по горизонтали справа,
 * по размеру — не шире 56% кадра и не выше 55% его высоты.
 * Знак в своих единицах шириной 2.8 и высотой 1.7; камера с углом 45° на расстоянии 5.
 */
export function heroMarkPlacement(width: number, height: number, fovDeg = 45, distance = 5) {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const viewH = 2 * distance * Math.tan((fovDeg * Math.PI) / 360);
  const viewW = viewH * aspect;
  const scale = Math.min((viewW * 0.56) / 2.8, (viewH * 0.55) / 1.7);
  return { x: viewW / 2 - (2.8 * scale) / 2 - viewW * 0.06, y: viewH * 0.12, scale };
}

export type GlassKind = 'liquid' | 'blur' | 'tint';

/**
 * Какое стекло рисовать: настоящее Liquid Glass там, где его даёт система (iOS 26+),
 * размытие на остальных iOS, полупрозрачную подложку на Android и в вебе.
 */
export function glassKind(os: string, liquidAvailable: boolean): GlassKind {
  if (os === 'ios') return liquidAvailable ? 'liquid' : 'blur';
  return 'tint';
}
