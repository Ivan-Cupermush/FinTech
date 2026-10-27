/**
 * Палитры живого градиента. Цвета — фирменный синий offix и его соседи
 * по кругу, без случайных оттенков: градиент поддерживает бренд, а не спорит с ним.
 * Те же три цвета идут в CSS-запасной вариант, поэтому без WebGL образ тот же.
 */
export type GradientVariant = 'hero' | 'login' | 'good' | 'bad' | 'wallpaper' | SectionVariant;

/**
 * Шапки рабочих разделов. Та же «ночь» с фирменным синим, но у каждого
 * раздела свой третий цвет и свой разворот волны: разделы узнаются с первого
 * взгляда и при этом остаются одной семьёй.
 */
export const SECTION_VARIANTS = ['goals', 'tasks', 'report', 'knowledge', 'assistant', 'integrations', 'inbox', 'org', 'create', 'chats', 'notes', 'profile', 'sales'] as const;
export type SectionVariant = (typeof SECTION_VARIANTS)[number];

const SECTION_LOOKS: Record<SectionVariant, { colors: [string, string, string]; rotationZ: number; positionX: number; polar: number }> = {
  // Цели — фирменная пара синего и фиолетового, ближе всего к главной.
  goals: { colors: ['#2f4bff', '#0a0d33', '#7a6bff'], rotationZ: 220, positionX: -0.3, polar: 112 },
  // Задачи — синий с бирюзой: про движение и работу.
  tasks: { colors: ['#2a5cff', '#06182a', '#2fc6d8'], rotationZ: 250, positionX: -0.7, polar: 118 },
  // Отчёт — глубокий индиго с холодной сиренью: спокойный, «бумажный» тон.
  report: { colors: ['#3346ff', '#0b0a2b', '#a58bff'], rotationZ: 200, positionX: 0.1, polar: 108 },
  // База знаний — синий с тёплым персиком: место, где читают.
  knowledge: { colors: ['#3a55ff', '#14102e', '#ee8466'], rotationZ: 240, positionX: -0.4, polar: 116 },
  // Помощник базы знаний — синий с электрической орхидеей: здесь думают вместе с ИИ.
  assistant: { colors: ['#3a4cff', '#120a30', '#d26bff'], rotationZ: 215, positionX: -0.35, polar: 111 },
  // Интеграции — синий с электрическим голубым: про связь систем.
  integrations: { colors: ['#2448ff', '#04122b', '#3fb8ff'], rotationZ: 260, positionX: -0.9, polar: 120 },
  // Уведомления — синий с мягкой розовой искрой: внимание без тревоги.
  inbox: { colors: ['#3b4dff', '#140a2a', '#ff7ac0'], rotationZ: 210, positionX: -0.2, polar: 110 },
  // Организация — синий с зелёным: люди и структура.
  org: { colors: ['#2f52ff', '#061c22', '#3fd6a0'], rotationZ: 230, positionX: -0.6, polar: 114 },
  // Новая цель — самый светлый и яркий: начало.
  create: { colors: ['#4a62ff', '#121a5e', '#9d86ff'], rotationZ: 235, positionX: -0.5, polar: 115 },
  // Чаты — синий с тёплым янтарём: живой разговор.
  chats: { colors: ['#3050ff', '#0d0b2c', '#ffb547'], rotationZ: 245, positionX: -0.45, polar: 117 },
  // Мои заметки — синий со свежим лаймом: личный ежедневник, а не архив.
  notes: { colors: ['#3352ff', '#08162a', '#a8e05f'], rotationZ: 225, positionX: -0.55, polar: 113 },
  // Профиль — синий с ледяным серебром: спокойно, про себя и безопасность.
  profile: { colors: ['#2e4cff', '#0a0c2e', '#b9c6ff'], rotationZ: 205, positionX: -0.25, polar: 109 },
  // Продажи — синий с золотом монеты на изумрудной ночи: про деньги и выплаты.
  sales: { colors: ['#2f4bff', '#071c18', '#ffd84a'], rotationZ: 255, positionX: -0.65, polar: 119 },
};

export function isSectionVariant(v: string): v is SectionVariant {
  return (SECTION_VARIANTS as readonly string[]).includes(v);
}

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
  if (isSectionVariant(variant)) {
    const l = SECTION_LOOKS[variant];
    return { ...gradientLook('hero', dark), colors: l.colors, cPolarAngle: l.polar, rotation: [0, 0, l.rotationZ], position: [l.positionX, 0.1, 0] };
  }
  if (variant === 'wallpaper') {
    // Обои чата: в светлой теме — пастель, в тёмной — ночь; пузыри из стекла читаются на обоих.
    return dark
      ? { ...gradientLook('hero', dark), colors: ['#2a44e8', '#07081c', '#c9822c'], brightness: 0.78, uStrength: 2, uSpeed: 0.1, rotation: [0, 0, 250], position: [-0.4, 0.1, 0] }
      : { ...gradientLook('hero', dark), colors: ['#9fb0ff', '#f3f1ec', '#ffcf8f'], brightness: 1.25, uStrength: 2, uSpeed: 0.1, rotation: [0, 0, 250], position: [-0.4, 0.1, 0] };
  }
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
