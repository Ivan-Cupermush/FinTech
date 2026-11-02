import { describe, expect, it } from 'vitest';
import { cardTilt, lastDelta, movementTone, RISK_GRADE, RISK_PALETTE, RISK_PULSE_MS, RISK_TONES, riskLevelOf, riskTone, sparkPath } from '../src/radar';

describe('riskTone: цвет карточки из модели рисков', () => {
  it('критичный риск — гранат, предупреждение — янтарь, независимо от KPI', () => {
    expect(riskTone({ risk_level: 'critical', kpi: 'achieved' })).toBe('critical');
    expect(riskTone({ risk_level: 'warning', kpi: 'progress' })).toBe('warning');
  });

  it('без рисков: KPI движется или в цели — мята', () => {
    for (const kpi of ['progress', 'achieved', 'in_range'] as const) expect(riskTone({ risk_level: 'ok', kpi })).toBe('safe');
  });

  it('без рисков, но KPI уходит от цели — янтарь', () => {
    expect(riskTone({ risk_level: 'ok', kpi: 'regress' })).toBe('warning');
    expect(riskTone({ risk_level: 'ok', kpi: 'out_of_range' })).toBe('warning');
  });

  it('нет замеров, KPI стоит или не задан — фирменный синий «рано судить»', () => {
    expect(riskTone({ risk_level: 'ok', kpi: 'no_data' })).toBe('steady');
    expect(riskTone({ risk_level: 'ok', kpi: 'stalled' })).toBe('steady');
    expect(riskTone({ risk_level: 'ok', kpi: null })).toBe('steady');
  });

  it('черновик не красим тревогой', () => {
    expect(riskTone({ status: 'draft', risk_level: 'critical' })).toBe('steady');
  });

  it('без уровня (старый сервер) — по счётчикам блокировок и просрочек', () => {
    expect(riskTone({ blocked: 1, kpi: 'progress' })).toBe('critical');
    expect(riskTone({ overdue: 2, kpi: 'progress' })).toBe('warning');
    expect(riskTone({ blocked: 0, overdue: 0, kpi: 'progress' })).toBe('safe');
  });

  it('riskLevelOf сворачивает риски так же, как Пульс', () => {
    expect(riskLevelOf([])).toBe('ok');
    expect(riskLevelOf([{ severity: 'info' }])).toBe('ok');
    expect(riskLevelOf([{ severity: 'info' }, { severity: 'warning' }])).toBe('warning');
    expect(riskLevelOf([{ severity: 'warning' }, { severity: 'critical' }])).toBe('critical');
  });
});

describe('палитра Risk Radar', () => {
  it('у каждого тона своя буква и полная палитра в hex', () => {
    expect(RISK_TONES.map((t) => RISK_GRADE[t]).join('')).toBe('ABCD');
    for (const t of RISK_TONES) {
      const p = RISK_PALETTE[t];
      for (const c of [p.from, p.to, p.deep, p.core]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.glow).toMatch(/^rgba\(/);
    }
  });

  it('цвета концепта: мята, янтарь, гранат; синий — фирменный', () => {
    expect(RISK_PALETTE.safe.from).toBe('#3ee6b0');
    expect(RISK_PALETTE.warning.from).toBe('#ffb547');
    expect(RISK_PALETTE.critical.from).toBe('#ff3b5c');
    expect(RISK_PALETTE.steady.from).toBe('#2f4bff');
  });

  it('пульс — 72 удара в минуту', () => {
    expect(RISK_PULSE_MS).toBe(833);
  });
});

describe('cardTilt', () => {
  it('в центре — ровно, блик посередине', () => {
    expect(cardTilt(0.5, 0.5)).toEqual({ rx: 0, ry: 0, gx: 50, gy: 50 });
  });
  it('угол — максимум 8°, блик напротив', () => {
    const t = cardTilt(1, 0);
    expect(t).toEqual({ rx: 8, ry: 8, gx: 0, gy: 100 });
    expect(cardTilt(0, 1, 4)).toEqual({ rx: -4, ry: -4, gx: 100, gy: 0 });
  });
  it('за краем карточки — не больше максимума', () => {
    expect(cardTilt(3, -2).ry).toBe(8);
    expect(cardTilt(3, -2).rx).toBe(8);
  });
});

describe('sparkPath и lastDelta', () => {
  it('меньше двух точек — ровная линия', () => {
    expect(sparkPath([], 100, 20)).toBe('M0 10 L100 10');
    expect(sparkPath([5], 100, 20)).toBe('M0 10 L100 10');
  });
  it('минимум — внизу, максимум — вверху, от края до края', () => {
    const d = sparkPath([10, 20, 15], 100, 20, 2);
    expect(d.startsWith('M0 18 ')).toBe(true);
    expect(d).toContain(' 50 2');
    expect(d.endsWith(' 100 10')).toBe(true);
  });
  it('одинаковые значения — посередине', () => {
    expect(sparkPath([3, 3, 3], 60, 10)).toBe('M0 5 C15 5 15 5 30 5 C45 5 45 5 60 5');
  });
  it('изменение к прошлому замеру', () => {
    expect(lastDelta([40, 38, 36.5])).toBeCloseTo(-1.5);
    expect(lastDelta([1])).toBeNull();
  });
});

describe('movementTone', () => {
  it('Эффект в тонах Risk Radar', () => {
    expect(movementTone('improved')).toBe('safe');
    expect(movementTone('flat')).toBe('steady');
    expect(movementTone('stale')).toBe('warning');
    expect(movementTone('worse')).toBe('critical');
  });
});
