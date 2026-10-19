import { describe, expect, it } from 'vitest';
import { activationChecklist, canTransition, isValidIsoDate, titleHint, validateGoal } from '../src/goal';

const today = '2026-10-19';
const full = {
  title: 'Сократить время обработки заявки',
  description: 'Без ухудшения качества',
  type: 'operational',
  owner_id: 'u1',
  due_at: '2026-12-31',
  metrics: [{ name: 'Среднее время обработки', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease' }],
};

describe('validateGoal', () => {
  it('полная цель проходит активную проверку', () => {
    expect(validateGoal(full, 'active', today)).toEqual({});
  });

  it('пустое название — ошибка и для черновика', () => {
    expect(validateGoal({ ...full, title: '  ' }, 'draft', today).title).toBe('Введите название цели');
  });

  it('название длиннее 200 символов отклоняется', () => {
    expect(validateGoal({ ...full, title: 'а'.repeat(201) }, 'draft', today).title).toMatch(/200/);
  });

  it('описание длиннее 5000 символов отклоняется', () => {
    expect(validateGoal({ ...full, description: 'а'.repeat(5001) }, 'draft', today).description).toBe('Описание слишком длинное');
  });

  it('неизвестный тип цели', () => {
    expect(validateGoal({ ...full, type: 'magic' }, 'draft', today).type).toBe('Неизвестный тип цели');
  });

  it('черновик можно сохранить без владельца, срока и KPI', () => {
    expect(validateGoal({ title: 'Сократить время', type: 'operational' }, 'draft', today)).toEqual({});
  });

  it('активная цель требует владельца, срок и KPI', () => {
    const e = validateGoal({ title: 'Сократить время', type: 'operational' }, 'active', today);
    expect(e.owner_id).toBeDefined();
    expect(e.due_at).toBeDefined();
    expect(e.metrics).toMatch(/KPI/);
  });

  it('срок в прошлом запрещён', () => {
    expect(validateGoal({ ...full, due_at: '2026-10-18' }, 'active', today).due_at).toBe('Срок должен быть не раньше текущей даты');
  });

  it('срок «сегодня» допустим', () => {
    expect(validateGoal({ ...full, due_at: today }, 'active', today).due_at).toBeUndefined();
  });

  it('некорректная дата', () => {
    expect(validateGoal({ ...full, due_at: '2026-02-30' }, 'draft', today).due_at).toMatch(/формате/);
  });

  it('ошибки KPI получают префикс поля', () => {
    const e = validateGoal({ ...full, metrics: [{ ...full.metrics[0], target: 50 }] }, 'active', today);
    expect(e['metrics.0.target']).toMatch(/меньше исходного/);
  });

  it('KPI проверяется и в черновике, если он заполнен', () => {
    const e = validateGoal({ ...full, metrics: [{ name: '', unit: 'minutes', baseline: 1, target: 0, direction: 'decrease' }] }, 'draft', today);
    expect(e['metrics.0.name']).toBeDefined();
  });
});

describe('переходы статуса', () => {
  it('черновик → в работу', () => expect(canTransition('draft', 'active')).toBe(true));
  it('активную нельзя снова активировать', () => expect(canTransition('active', 'active')).toBe(false));
  it('отменённую нельзя вернуть', () => expect(canTransition('cancelled', 'active')).toBe(false));
  it('завершённую можно переоткрыть', () => expect(canTransition('completed', 'active')).toBe(true));
  it('черновик нельзя сразу завершить', () => expect(canTransition('draft', 'completed')).toBe(false));
});

describe('isValidIsoDate', () => {
  it.each(['2026-12-31', '2028-02-29'])('%s — корректна', (d) => expect(isValidIsoDate(d)).toBe(true));
  it.each(['2026-13-01', '2027-02-29', '31.12.2026', '', 42])('%s — некорректна', (d) => expect(isValidIsoDate(d)).toBe(false));
});

describe('activationChecklist', () => {
  it('показывает, чего не хватает черновику', () => {
    const list = activationChecklist({ title: 'X', type: 'operational', owner_id: null, due_at: null, metrics: [] });
    expect(list.filter((i) => !i.done).map((i) => i.key)).toEqual(['owner', 'due', 'kpi']);
  });
});

describe('titleHint', () => {
  it('подсказывает, если название похоже на задачу', () => {
    expect(titleHint('Провести анализ процессов')).toMatch(/задачу/);
  });
  it('молчит для результата', () => {
    expect(titleHint('Сократить время обработки заявки')).toBeNull();
  });
});
