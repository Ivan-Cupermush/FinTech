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

export type GlassTone = 'color' | 'surface';

/** Оттенки стекла: на градиенте — тёмно-синее, на экране — под цвет темы. */
export function glassTint(tone: GlassTone, scheme: 'light' | 'dark') {
  if (tone === 'color') {
    return { border: 'rgba(255,255,255,0.22)', fill: 'rgba(14,18,60,0.42)', liquidTint: 'rgba(20,26,90,0.25)', blurTint: 'systemUltraThinMaterialDark' as const };
  }
  return scheme === 'dark'
    ? { border: 'rgba(255,255,255,0.10)', fill: 'rgba(24,24,32,0.86)', liquidTint: 'rgba(20,20,28,0.35)', blurTint: 'systemChromeMaterialDark' as const }
    : { border: 'rgba(11,11,15,0.08)', fill: 'rgba(255,255,255,0.86)', liquidTint: 'rgba(255,255,255,0.35)', blurTint: 'systemChromeMaterialLight' as const };
}

/**
 * Положение «капли» под активной вкладкой: вкладки делят ширину поровну,
 * капля чуть уже ячейки и стоит по её центру.
 */
export function tabIndicator(index: number, count: number, width: number, inset = 6) {
  const n = Math.max(1, count);
  const i = Math.min(Math.max(0, index), n - 1);
  const cell = Math.max(0, width - inset * 2) / n;
  const w = Math.max(0, cell - 8);
  return { x: inset + cell * i + (cell - w) / 2, w };
}

/** Высота, которую парящая панель вкладок занимает над низом экрана, — столько отступа нужно контенту. */
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_GAP = 10;
export function tabBarSpace(bottomInset: number): number {
  return TAB_BAR_HEIGHT + TAB_BAR_GAP + Math.max(bottomInset, 8) + 16;
}

/**
 * Палитры шапок: «hero» — фирменная ночь с синим (вход, Пульс),
 * «good» / «bad» — та же ночь, но третий цвет говорит о состоянии цели,
 * чтобы шапка цели сразу показывала, идёт ли показатель к цели.
 * Остальные — разделы: у каждого свой третий цвет, те же, что в шапках сайта,
 * чтобы раздел узнавался на любом устройстве.
 */
export const SECTION_VARIANTS = ['inbox', 'knowledge', 'discussion', 'create', 'settings'] as const;
export type SectionVariant = (typeof SECTION_VARIANTS)[number];
export type HeroVariant = 'hero' | 'good' | 'bad' | SectionVariant;

const PALETTES: Record<HeroVariant, readonly [string, string, string]> = {
  hero: HERO_COLORS,
  good: ['#2f4bff', '#071a24', '#2fd39a'],
  bad: ['#3b3bff', '#1a0b22', '#ff5a7a'],
  inbox: ['#3b4dff', '#140a2a', '#ff7ac0'],
  knowledge: ['#3a55ff', '#14102e', '#ee8466'],
  discussion: ['#2a5cff', '#06182a', '#2fc6d8'],
  create: ['#4a62ff', '#121a5e', '#9d86ff'],
  settings: ['#2f52ff', '#061c22', '#3fd6a0'],
};

export function heroColors(variant: HeroVariant): readonly [string, string, string] {
  return PALETTES[variant];
}

/** По состоянию KPI выбираем настроение шапки цели. */
export function heroVariantForKpi(state: string | null | undefined): HeroVariant {
  if (state === 'achieved' || state === 'in_range') return 'good';
  if (state === 'regress' || state === 'out_of_range') return 'bad';
  return 'hero';
}

export type HeroStat = { label: string; value: number; tone?: 'bad' | 'warn' };

/** Цифра на стекле градиента: тревожные — тёплым светлым, чтобы читались на синем. */
export function heroStatColor(tone: HeroStat['tone']): string {
  if (tone === 'bad') return '#ffb3c1';
  if (tone === 'warn') return '#ffd88a';
  return '#ffffff';
}
