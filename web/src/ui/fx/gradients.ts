/**
 * Палитры живого градиента. Цвета — фирменный синий offix и его соседи
 * по кругу, без случайных оттенков: градиент поддерживает бренд, а не спорит с ним.
 * Те же три цвета идут в CSS-запасной вариант, поэтому без WebGL образ тот же.
 */
export type GradientVariant = 'hero' | 'login' | 'good' | 'bad';

export interface GradientLook {
  colors: [string, string, string];
  type: 'plane' | 'waterPlane' | 'sphere';
  uSpeed: number;
  uStrength: number;
  uDensity: number;
  uFrequency: number;
  brightness: number;
  cDistance: number;
  cPolarAngle: number;
  cAzimuthAngle: number;
  rotation: [number, number, number];
  position: [number, number, number];
}

export function gradientLook(variant: GradientVariant, dark: boolean): GradientLook {
  if (variant === 'good' || variant === 'bad') {
    // Шапка цели: та же ночь, но третий цвет говорит, идёт ли показатель к цели.
    return { ...gradientLook('hero', dark), colors: variant === 'good' ? ['#2f4bff', '#071a24', '#2fd39a'] : ['#3b3bff', '#1a0b22', '#ff5a7a'] };
  }
  if (variant === 'login') {
    // Тот же «ночной» градиент, что на главной, но развёрнутый иначе — узнаётся, а не повторяется.
    return {
      colors: ['#3b5bff', '#161c66', '#8a72ff'],
      type: 'waterPlane',
      uSpeed: 0.16,
      uStrength: 2.4,
      uDensity: 1.1,
      uFrequency: 5.5,
      brightness: 1.05,
      cDistance: 3.9,
      cPolarAngle: 115,
      cAzimuthAngle: 180,
      rotation: [0, 0, 235],
      position: [-0.5, 0.1, 0],
    };
  }
  // Первый экран одинаков в обеих темах: глубокая ночь с фирменным синим — так его запоминают.
  return {
    colors: ['#2f4bff', '#090b2a', '#8a72ff'],
    type: 'waterPlane',
    uSpeed: 0.16,
    uStrength: 2.4,
    uDensity: 1.1,
    uFrequency: 5.5,
    brightness: 0.92,
    cDistance: 3.9,
    cPolarAngle: 115,
    cAzimuthAngle: 180,
    rotation: [0, 0, 235],
    position: [-0.5, 0.1, 0],
  };
}

/** CSS-версия того же градиента: для первого кадра, без WebGL и при печати. */
export function gradientCss(look: GradientLook): string {
  const [a, b, c] = look.colors;
  return [
    `radial-gradient(120% 90% at 18% 20%, ${a} 0%, transparent 60%)`,
    `radial-gradient(90% 80% at 85% 30%, ${c} 0%, transparent 65%)`,
    `radial-gradient(100% 90% at 60% 100%, ${b} 0%, transparent 70%)`,
    `linear-gradient(135deg, ${a}, ${b})`,
  ].join(', ');
}

/** Настроение шапки цели по состоянию KPI. */
export function gradientForKpi(state: string | null | undefined): GradientVariant {
  if (state === 'achieved' || state === 'in_range') return 'good';
  if (state === 'regress' || state === 'out_of_range') return 'bad';
  return 'hero';
}
