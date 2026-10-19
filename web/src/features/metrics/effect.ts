import { effectSteps, type EffectTarget } from '@offix/core';
import type { MetricsReport } from '../../lib/types';

/** Маршрут сайта для шага «Что поднимет цифры». */
export function targetPath(t: EffectTarget): string {
  if (t.kind === 'goal') return `/app/goals/${t.id}`;
  if (t.kind === 'blocked_tasks') return '/app/tasks?scope=all';
  return '/app/goals';
}

export const effectActions = (r: MetricsReport, today: string) => effectSteps(r, today).map((s) => ({ ...s, to: targetPath(s.target) }));
