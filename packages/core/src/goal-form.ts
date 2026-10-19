import { addDays } from './dates';
import { validateGoal, type GoalType } from './goal';
import type { Direction, FieldErrors } from './kpi';
import type { UnitId } from './units';

/* Логика формы цели — общая для мастера на сайте и в приложении. */

/** Состояние мастера. Числа храним строками — как ввёл человек, с запятой. */
export interface GoalFormState {
  title: string;
  description: string;
  type: GoalType | '';
  kpiName: string;
  unit: UnitId;
  direction: Direction;
  baseline: string;
  target: string;
  rangeMin: string;
  rangeMax: string;
  ownerId: string;
  ownerName: string;
  dueAt: string;
  units: { unit_id: string; name: string; role: 'owner' | 'executor' | 'approver' | 'contributor' }[];
  subgoals: string[];
}

export const emptyForm = (): GoalFormState => ({
  title: '',
  description: '',
  type: '',
  kpiName: '',
  unit: 'minutes',
  direction: 'decrease',
  baseline: '',
  target: '',
  rangeMin: '',
  rangeMax: '',
  ownerId: '',
  ownerName: '',
  dueAt: '',
  units: [],
  subgoals: [],
});

/** «12,5» → 12.5; пусто или мусор → null. */
export function parseNumber(s: string): number | null {
  const t = s.replace(/\s| /g, '').replace(',', '.');
  if (!t) return null;
  if (!/^[-−]?\d*\.?\d+$/.test(t)) return NaN;
  return Number(t.replace('−', '-'));
}

/** KPI считается введённым, если заполнено хоть что-то из его полей. */
export function hasKpi(f: GoalFormState): boolean {
  return !!(f.kpiName.trim() || f.baseline.trim() || f.target.trim());
}

export function toPayload(f: GoalFormState, status: 'draft' | 'active') {
  const baseline = parseNumber(f.baseline);
  const target = parseNumber(f.target);
  return {
    title: f.title.trim(),
    description: f.description.trim() || null,
    type: f.type || undefined,
    owner_id: f.ownerId || null,
    due_at: f.dueAt || null,
    status,
    units: f.units.map(({ unit_id, role }) => ({ unit_id, role })),
    metrics: hasKpi(f)
      ? [
          {
            name: f.kpiName.trim(),
            unit: f.unit,
            baseline: baseline ?? NaN,
            target: target ?? NaN,
            direction: f.direction,
            ...(f.direction === 'maintain' ? { range_min: parseNumber(f.rangeMin) ?? NaN, range_max: parseNumber(f.rangeMax) ?? NaN } : {}),
          },
        ]
      : [],
  };
}

/** Ошибки ядра → поля формы. */
export function formErrors(f: GoalFormState, mode: 'draft' | 'active', today: string): FieldErrors {
  const p = toPayload(f, mode);
  const e = validateGoal(p, mode, today);
  const map: Record<string, string> = {
    'metrics.0.name': 'kpiName',
    'metrics.0.unit': 'unit',
    'metrics.0.baseline': 'baseline',
    'metrics.0.target': 'target',
    'metrics.0.direction': 'direction',
    'metrics.0.range_min': 'rangeMin',
    'metrics.0.range_max': 'rangeMax',
    owner_id: 'ownerId',
    due_at: 'dueAt',
    metrics: 'kpi',
  };
  const out: FieldErrors = {};
  for (const [k, v] of Object.entries(e)) out[map[k] ?? k] = v;
  return out;
}

export const STEP_FIELDS: Record<1 | 2 | 3, string[]> = {
  1: ['title', 'description', 'type', 'kpiName', 'unit', 'direction', 'baseline', 'target', 'rangeMin', 'rangeMax', 'kpi'],
  2: ['ownerId', 'dueAt'],
  3: [],
};

/** Ошибки, мешающие перейти дальше: на шаге — только его поля, и только в режиме черновика. */
export function stepErrors(f: GoalFormState, step: 1 | 2 | 3, today: string): FieldErrors {
  const all = formErrors(f, 'draft', today);
  return Object.fromEntries(Object.entries(all).filter(([k]) => STEP_FIELDS[step].includes(k)));
}

/** Быстрые сроки: конец месяца, квартала, полугодия, года. */
export function duePresets(today: string): { label: string; value: string }[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const monthEnd = (yy: number, mm: number) => {
    const nextY = mm === 12 ? yy + 1 : yy;
    const nextM = mm === 12 ? 1 : mm + 1;
    return addDays(`${nextY}-${String(nextM).padStart(2, '0')}-01`, -1);
  };
  const q = Math.ceil(m / 3) * 3;
  const list = [
    { label: 'Конец месяца', value: monthEnd(y, m) },
    { label: 'Конец квартала', value: monthEnd(y, q) },
    { label: 'Конец года', value: `${y}-12-31` },
  ];
  return list.filter((p, i, arr) => p.value >= today && arr.findIndex((x) => x.value === p.value) === i);
}
