import { describe, expect, it } from 'vitest';
import { kpiPace, kpiProgress, latestObservation, plannedChange, validateMetric } from '../src/kpi';

const base = { name: 'Среднее время обработки', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease' } as const;

describe('validateMetric', () => {
  it('принимает корректный KPI на уменьшение', () => {
    expect(validateMetric(base)).toEqual({});
  });

  it('требует название', () => {
    expect(validateMetric({ ...base, name: '   ' }).name).toBe('Укажите название KPI');
  });

  it('ограничивает название 100 символами', () => {
    expect(validateMetric({ ...base, name: 'x'.repeat(101) }).name).toMatch(/100/);
    expect(validateMetric({ ...base, name: 'x'.repeat(100) }).name).toBeUndefined();
  });

  it('отклоняет неизвестную единицу', () => {
    expect(validateMetric({ ...base, unit: 'parsecs' }).unit).toBe('Выберите корректную единицу');
  });

  it('отклоняет неизвестное направление', () => {
    expect(validateMetric({ ...base, direction: 'sideways' }).direction).toBeDefined();
  });

  it.each([NaN, Infinity, -Infinity, '40', null, undefined])('отклоняет нечисловое исходное значение %s', (v) => {
    expect(validateMetric({ ...base, baseline: v }).baseline).toBe('Укажите исходное значение');
  });

  it.each([NaN, Infinity, '30', null])('отклоняет нечисловое целевое значение %s', (v) => {
    expect(validateMetric({ ...base, target: v }).target).toBe('Укажите целевое значение');
  });

  it('запрещает отрицательное время обработки', () => {
    expect(validateMetric({ ...base, baseline: -5 }).baseline).toMatch(/отрицательным/);
    expect(validateMetric({ ...base, target: -1 }).target).toMatch(/отрицательным/);
  });

  it('разрешает ноль, если это допустимо единицей', () => {
    expect(validateMetric({ ...base, target: 0 })).toEqual({});
  });

  it('разрешает отрицательную прибыль в рублях', () => {
    expect(validateMetric({ name: 'Прибыль', unit: 'rub', baseline: -100000, target: 50000, direction: 'increase' })).toEqual({});
  });

  it('разрешает отрицательный NPS, но не ниже −100', () => {
    expect(validateMetric({ name: 'NPS', unit: 'points', baseline: -20, target: 10, direction: 'increase' })).toEqual({});
    expect(validateMetric({ name: 'NPS', unit: 'points', baseline: -120, target: 10, direction: 'increase' }).baseline).toBeDefined();
  });

  it('для decrease целевое должно быть меньше исходного', () => {
    expect(validateMetric({ ...base, target: 40 }).target).toMatch(/меньше исходного/);
    expect(validateMetric({ ...base, target: 45 }).target).toMatch(/меньше исходного/);
  });

  it('для increase целевое должно быть больше исходного', () => {
    const m = { name: 'Доля в срок', unit: 'percent', baseline: 60, target: 50, direction: 'increase' } as const;
    expect(validateMetric(m).target).toMatch(/больше исходного/);
    expect(validateMetric({ ...m, target: 90 })).toEqual({});
  });

  it('для maintain нужен диапазон, и цель внутри него', () => {
    const m = { name: 'Загрузка', unit: 'percent', baseline: 70, target: 80, direction: 'maintain' } as const;
    const e = validateMetric(m);
    expect(e.range_min).toBeDefined();
    expect(e.range_max).toBeDefined();
    expect(validateMetric({ ...m, range_min: 75, range_max: 85 })).toEqual({});
    expect(validateMetric({ ...m, range_min: 85, range_max: 75 }).range_max).toBeDefined();
    expect(validateMetric({ ...m, range_min: 50, range_max: 60 }).target).toMatch(/диапазон/);
  });
});

describe('plannedChange', () => {
  it('40 → 30 — это −25 %', () => {
    expect(plannedChange(40, 30)).toBe(-25);
  });
  it('60 → 90 — это +50 %', () => {
    expect(plannedChange(60, 90)).toBe(50);
  });
  it('от нуля процент не определён', () => {
    expect(plannedChange(0, 10)).toBeNull();
  });
  it('считает от модуля отрицательного исходного', () => {
    expect(plannedChange(-100, -50)).toBe(50);
  });
});

describe('kpiProgress', () => {
  it('без измерений — «Нет данных», а не фиктивный прогресс', () => {
    expect(kpiProgress(base, null)).toEqual({ state: 'no_data', raw: null, bar: null });
    expect(kpiProgress(base, undefined).state).toBe('no_data');
    expect(kpiProgress(base, NaN).state).toBe('no_data');
  });

  it('пример из ТЗ: 40 → 30, факт 35 — 50 %', () => {
    expect(kpiProgress(base, 35)).toMatchObject({ state: 'progress', raw: 50, bar: 50 });
  });

  it('ухудшение не исчезает: 45 минут — отрицательный прогресс, полоса 0', () => {
    const p = kpiProgress(base, 45);
    expect(p.state).toBe('regress');
    expect(p.raw).toBe(-50);
    expect(p.bar).toBe(0);
  });

  it('перевыполнение сохраняется в raw, полоса ограничена 100', () => {
    const p = kpiProgress(base, 25);
    expect(p.state).toBe('achieved');
    expect(p.raw).toBe(150);
    expect(p.bar).toBe(100);
  });

  it('факт равен исходному — без изменений', () => {
    expect(kpiProgress(base, 40).state).toBe('stalled');
  });

  it('работает для increase той же формулой', () => {
    const m = { baseline: 60, target: 90, direction: 'increase' } as const;
    expect(kpiProgress(m, 75).raw).toBe(50);
    expect(kpiProgress(m, 90).state).toBe('achieved');
    expect(kpiProgress(m, 50).state).toBe('regress');
  });

  it('maintain — в диапазоне или вне его', () => {
    const m = { baseline: 70, target: 80, direction: 'maintain', range_min: 75, range_max: 85 } as const;
    expect(kpiProgress(m, 80).state).toBe('in_range');
    expect(kpiProgress(m, 90).state).toBe('out_of_range');
  });
});

describe('latestObservation', () => {
  it('берёт самое позднее по времени измерения, а не последнее вставленное', () => {
    const obs = [
      { value: 36, observed_at: '2026-11-10T10:00:00Z' },
      { value: 38, observed_at: '2026-11-01T10:00:00Z' },
    ];
    expect(latestObservation(obs)?.value).toBe(36);
    expect(latestObservation([])).toBeNull();
  });
});

describe('kpiPace', () => {
  it('экстраполирует темп по первым и последним измерениям', () => {
    const pace = kpiPace(base, [
      { value: 40, observed_at: '2026-11-01T00:00:00Z' },
      { value: 35, observed_at: '2026-11-11T00:00:00Z' },
    ]);
    expect(pace?.perDay).toBeCloseTo(5);
    expect(pace?.etaDays).toBeCloseTo(10);
  });
  it('если показатель стоит или ухудшается — срок неизвестен', () => {
    const pace = kpiPace(base, [
      { value: 40, observed_at: '2026-11-01T00:00:00Z' },
      { value: 42, observed_at: '2026-11-11T00:00:00Z' },
    ]);
    expect(pace?.etaDays).toBeNull();
  });
  it('одного измерения мало', () => {
    expect(kpiPace(base, [{ value: 40, observed_at: '2026-11-01T00:00:00Z' }])).toBeNull();
  });
});
