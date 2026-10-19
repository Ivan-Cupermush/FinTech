import { describe, expect, it } from 'vitest';
import { effectSteps as effectActions, formatDelta, formatPercent, northStarCaption, trendText, type MetricsReport } from '../src';

const TODAY = '2026-10-19';

const weeks = Array.from({ length: 8 }, (_, i) => `2026-${i < 3 ? '08' : '09'}-0${(i % 9) + 1}T12:00:00.000Z`);

function report(over: Partial<MetricsReport> = {}): MetricsReport {
  return {
    at: '2026-10-19T12:00:00.000Z',
    window_days: 30,
    scope: 'company',
    north_star: {
      value: 67,
      counts: { improved: 2, flat: 0, worse: 0, stale: 1 },
      total: 3,
      without_kpi: 0,
      items: [
        { id: 'g3', title: 'Ускорить адаптацию', movement: 'stale', delta: null },
        { id: 'g1', title: 'Сократить время обработки заявки', movement: 'improved', delta: 35 },
        { id: 'g2', title: 'Сократить срок договоров', movement: 'improved', delta: 28.6 },
      ],
    },
    freshness: { value: 67, fresh: 2, total: 3, max_age_days: 14, stale: [{ id: 'g3', title: 'Ускорить адаптацию', last_observed_at: null }] },
    launch: { value: 71, launched: 5, total: 7, within_days: 7, median_days: 2.6 },
    blockers: { median_hours: 60, resolved: 2, open: 1, oldest_open_hours: 98 },
    on_time: { value: 67, on_time: 2, total: 3 },
    series: {
      at: weeks,
      north_star: [null, null, null, 0, 33, 67, 67, 67],
      freshness: [null, null, null, 33, 67, 67, 67, 67],
      blocker_hours: [null, null, null, null, 48, 48, 60, 60],
      on_time: [null, null, null, null, 100, 100, 67, 67],
    },
    ...over,
  };
}

describe('логика экрана «Эффект»', () => {
  it('formatDelta: знак, округление, неразрывный пробел', () => {
    expect(formatDelta(35)).toBe('+35 п.п.');
    expect(formatDelta(-12.4)).toBe('−12 п.п.');
    expect(formatDelta(0.2)).toBe('0 п.п.');
    expect(formatDelta(null)).toBe('');
  });

  it('шаги: сначала ухудшения и блокеры, затем замеры и цели без KPI', () => {
    const r = report({
      north_star: { ...report().north_star, without_kpi: 2, items: [{ id: 'gw', title: 'Хуже', movement: 'worse', delta: -10 }] },
    });
    const a = effectActions(r, TODAY);
    expect(a.map((x) => x.key)).toEqual(['worse-gw', 'blockers', 'stale-g3', 'no-kpi']);
    expect(a[1]!.title).toBe('1 задача заблокирована, самый старый блокер — 4,1 дня');
    expect(a[2]).toMatchObject({ title: '«Ускорить адаптацию»: замеров ещё не было', cta: 'Внести замер', target: { kind: 'goal', id: 'g3' } });
    expect(a[3]!.title).toBe('2 активные цели без KPI');
  });

  it('шагов не больше лимита', () => {
    const stale = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, title: `Цель ${i}`, last_observed_at: '2026-09-01T09:00:00.000Z' }));
    const a = effectActions(report({ freshness: { ...report().freshness, stale } }), TODAY);
    expect(a).toHaveLength(5);
    expect(a[1]!.title).toBe('«Цель 0»: последний замер 1 сентября');
  });

  it('всё хорошо — шагов нет', () => {
    const r = report({ blockers: { median_hours: 10, resolved: 1, open: 0, oldest_open_hours: null }, freshness: { ...report().freshness, stale: [] } });
    expect(effectActions(r, TODAY)).toEqual([]);
  });

  it('тренд: проценты в п.п., блокеры — быстрее или медленнее', () => {
    expect(trendText({ delta: 67, steps: 4 })).toBe('+67 п.п. за 4 недели');
    expect(trendText({ delta: -12, steps: 8 }, 'hours')).toBe('быстрее на 12 ч за 8 недель');
    expect(trendText({ delta: 12, steps: 1 }, 'hours')).toBe('медленнее на 12 ч за 1 неделю');
    expect(trendText({ delta: 0.2, steps: 2 }, 'hours')).toBe('без изменений за 2 недели');
    expect(trendText(null)).toBeNull();
  });
});

describe('подписи', () => {
  it('проценты и подпись Северной звезды', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(67)).toBe('67\u00a0%');
    expect(northStarCaption(report())).toBe('2 из 3 активных целей с KPI сдвинули показатель к цели за 30 дней');
    const one = report({ north_star: { ...report().north_star, total: 1, counts: { improved: 1, flat: 0, worse: 0, stale: 0 } } });
    expect(northStarCaption(one)).toBe('1 из 1 активной цели с KPI сдвинула показатель к цели за 30 дней');
    expect(northStarCaption(report({ north_star: { ...report().north_star, total: 0 } }))).toMatch(/оценивать пока нечего/);
  });
});
