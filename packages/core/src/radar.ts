import type { Movement } from './metrics';
import type { KpiState } from './kpi';

/**
 * Risk Radar: цвет «жидкости» в карточке цели. Цвет берётся из модели рисков
 * (analyzeRisks → risk_level), а не придумывается заново: одна цель на Пульсе,
 * в списке целей и на своей странице всегда одного цвета.
 *
 *  A safe     — мята → бирюза: рисков нет, KPI движется или уже в цели;
 *  B steady   — фирменный синий → фиолетовый: рисков нет, но и судить рано
 *               (нет замеров, KPI не задан, черновик);
 *  C warning  — янтарь → мандарин: есть риски или KPI идёт не туда;
 *  D critical — гранат → малина и пульс 72 уд/мин: цель под угрозой.
 */
export type RiskTone = 'safe' | 'steady' | 'warning' | 'critical';
export type RiskLevel = 'critical' | 'warning' | 'ok';

export const RISK_TONES: readonly RiskTone[] = ['safe', 'steady', 'warning', 'critical'];

export const RISK_GRADE: Record<RiskTone, 'A' | 'B' | 'C' | 'D'> = { safe: 'A', steady: 'B', warning: 'C', critical: 'D' };

export const RISK_TONE_LABELS: Record<RiskTone, string> = {
  safe: 'В норме',
  steady: 'Рано судить',
  warning: 'Есть риски',
  critical: 'Под угрозой',
};

export interface RiskPalette {
  /** Два цвета жидкости: основной и второй, к которому она перетекает. */
  from: string;
  to: string;
  /** Третий, тёмный: глубина жидкости внизу карточки. */
  deep: string;
  /** Цветная тень и свечение — тот же тон с прозрачностью. */
  glow: string;
  /** Ядро — светлый пузырь, всплывающий в жидкости. */
  core: string;
}

/** Цвета концепта Risk Radar; синий и фиолетовый — фирменные цвета offix. */
export const RISK_PALETTE: Record<RiskTone, RiskPalette> = {
  safe: { from: '#3ee6b0', to: '#2fb8d9', deep: '#1f6fd6', glow: 'rgba(47, 184, 217, 0.42)', core: '#c9fff0' },
  steady: { from: '#2f4bff', to: '#8a72ff', deep: '#14177a', glow: 'rgba(76, 86, 255, 0.40)', core: '#d9d2ff' },
  warning: { from: '#ffb547', to: '#ff8a4c', deep: '#e0563a', glow: 'rgba(255, 138, 76, 0.42)', core: '#fff1c9' },
  critical: { from: '#ff3b5c', to: '#d6246e', deep: '#7a1f8f', glow: 'rgba(214, 36, 110, 0.46)', core: '#ffd1de' },
};

/** Пульс критичной карточки: 72 удара в минуту. */
export const RISK_PULSE_MS = Math.round(60_000 / 72);

export interface RiskToneInput {
  /** Уровень из модели рисков (Пульс, список целей). */
  risk_level?: RiskLevel | null;
  /** Счётчики из списка целей, если уровня нет (старый сервер). */
  blocked?: number;
  overdue?: number;
  /** Состояние главного KPI; null — KPI не задан. */
  kpi?: KpiState | null;
  /** Черновик ещё не идёт — его не красим тревогой. */
  status?: string;
}

/** Какой «жидкостью» залить карточку цели. */
export function riskTone(i: RiskToneInput): RiskTone {
  if (i.status === 'draft') return 'steady';
  const level: RiskLevel = i.risk_level ?? (i.blocked ? 'critical' : i.overdue ? 'warning' : 'ok');
  if (level === 'critical') return 'critical';
  if (level === 'warning') return 'warning';
  // Рисков по срокам нет, но KPI уходит от цели — это тоже повод насторожиться.
  if (i.kpi === 'regress' || i.kpi === 'out_of_range') return 'warning';
  if (i.kpi === 'achieved' || i.kpi === 'in_range' || i.kpi === 'progress') return 'safe';
  return 'steady';
}

/** Уровень риска цели по её рискам — та же свёртка, что на Пульсе. */
export function riskLevelOf(risks: readonly { severity: 'critical' | 'warning' | 'info' }[]): RiskLevel {
  return risks.some((r) => r.severity === 'critical') ? 'critical' : risks.some((r) => r.severity === 'warning') ? 'warning' : 'ok';
}

/**
 * Наклон карточки к указателю: до `max` градусов, блик — всегда напротив
 * наклона. px, py — положение указателя в долях карточки (0…1).
 */
export function cardTilt(px: number, py: number, max = 8): { rx: number; ry: number; gx: number; gy: number } {
  const cx = Math.min(1, Math.max(0, px)) - 0.5;
  const cy = Math.min(1, Math.max(0, py)) - 0.5;
  const round = (v: number) => Math.round(v * 100) / 100 || 0;
  return {
    // Указатель сверху — верхний край уходит от нас (rotateX > 0).
    rx: round(-cy * 2 * max),
    ry: round(cx * 2 * max),
    gx: round((0.5 - cx) * 100),
    gy: round((0.5 - cy) * 100),
  };
}

/**
 * Спарклайн: гладкая линия по замерам для SVG шириной w и высотой h.
 * Меньше двух точек — ровная линия посередине (данных для тренда нет).
 */
export function sparkPath(values: readonly number[], w: number, h: number, pad = 2): string {
  const f = (v: number) => Math.round(v * 10) / 10;
  if (values.length < 2) return `M0 ${f(h / 2)} L${f(w)} ${f(h / 2)}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, max === min ? h / 2 : pad + (1 - (v - min) / span) * (h - pad * 2)] as const);
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2;
    d += ` C${f(mx)} ${f(y0)} ${f(mx)} ${f(y1)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}

/** Изменение к прошлому замеру: null, если сравнивать не с чем. */
export function lastDelta(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  return values[values.length - 1]! - values[values.length - 2]!;
}

/** Эффект: как цель сдвинула KPI за период — в те же тона, что и риски. */
export function movementTone(m: Movement): RiskTone {
  return m === 'improved' ? 'safe' : m === 'worse' ? 'critical' : m === 'stale' ? 'warning' : 'steady';
}
