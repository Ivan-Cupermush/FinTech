import { describe, expect, it } from 'vitest';
import { duePresets, emptyForm, formErrors, hasKpi, parseNumber, stepErrors, toPayload, type GoalFormState } from '../src/features/goals/goalForm';

const TODAY = '2026-10-19';
const filled = (over: Partial<GoalFormState> = {}): GoalFormState => ({
  ...emptyForm(),
  title: 'Сократить время согласования заявки',
  type: 'strategic',
  kpiName: 'Время согласования',
  baseline: '40',
  target: '30',
  ownerId: '00000000-0000-4000-8000-000000000001',
  ownerName: 'Ольга',
  dueAt: '2026-12-31',
  ...over,
});

describe('parseNumber', () => {
  it('понимает запятую, пробелы и минус', () => {
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('1 200')).toBe(1200);
    expect(parseNumber('1 200,75')).toBe(1200.75);
    expect(parseNumber('−3')).toBe(-3);
    expect(parseNumber('-0,5')).toBe(-0.5);
  });
  it('пустая строка — null, мусор — NaN', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('   ')).toBeNull();
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('1,2,3')).toBeNaN();
    expect(parseNumber('10%')).toBeNaN();
  });
});

describe('hasKpi / toPayload', () => {
  it('KPI считается начатым по любому из полей', () => {
    expect(hasKpi(emptyForm())).toBe(false);
    expect(hasKpi({ ...emptyForm(), baseline: '4' })).toBe(true);
    expect(hasKpi({ ...emptyForm(), kpiName: ' x ' })).toBe(true);
  });
  it('собирает тело запроса: обрезает пробелы, пустое описание — null', () => {
    const p = toPayload(filled({ title: '  Цель  ', description: '   ' }), 'active');
    expect(p.title).toBe('Цель');
    expect(p.description).toBeNull();
    expect(p.status).toBe('active');
    expect(p.metrics).toEqual([{ name: 'Время согласования', unit: 'minutes', baseline: 40, target: 30, direction: 'decrease' }]);
  });
  it('без KPI — пустой массив метрик, без владельца и срока — null', () => {
    const p = toPayload({ ...emptyForm(), title: 'Черновик' }, 'draft');
    expect(p.metrics).toEqual([]);
    expect(p.owner_id).toBeNull();
    expect(p.due_at).toBeNull();
    expect(p.type).toBeUndefined();
  });
  it('для «удерживать» добавляет диапазон', () => {
    const p = toPayload(filled({ direction: 'maintain', baseline: '90', target: '92', rangeMin: '88', rangeMax: '95' }), 'active');
    expect(p.metrics[0]).toMatchObject({ direction: 'maintain', range_min: 88, range_max: 95 });
  });
  it('роли подразделений переносятся без названий', () => {
    const p = toPayload(filled({ units: [{ unit_id: 'u1', name: 'IT', role: 'executor' }] }), 'draft');
    expect(p.units).toEqual([{ unit_id: 'u1', role: 'executor' }]);
  });
});

describe('formErrors', () => {
  it('полностью заполненная цель проходит и как черновик, и как активная', () => {
    expect(formErrors(filled(), 'draft', TODAY)).toEqual({});
    expect(formErrors(filled(), 'active', TODAY)).toEqual({});
  });
  it('ошибки KPI переводятся в имена полей формы', () => {
    const e = formErrors(filled({ target: '50' }), 'draft', TODAY);
    expect(e.target).toMatch(/меньше/);
    expect(Object.keys(e).every((k) => !k.startsWith('metrics.'))).toBe(true);
  });
  it('черновику достаточно названия и типа: владелец, срок и KPI потом', () => {
    expect(formErrors({ ...emptyForm(), title: 'Черновик', type: 'operational' }, 'draft', TODAY)).toEqual({});
  });
  it('активной цели нужны владелец, срок и KPI', () => {
    const e = formErrors({ ...emptyForm(), title: 'Цель', type: 'strategic' }, 'active', TODAY);
    expect(e.ownerId).toBeTruthy();
    expect(e.dueAt).toBeTruthy();
    expect(e.kpi).toBeTruthy();
  });
  it('срок в прошлом не принимается для активной цели', () => {
    expect(formErrors(filled({ dueAt: '2026-01-01' }), 'active', TODAY).dueAt).toBeTruthy();
  });
  it('нечисловое значение — ошибка поля', () => {
    expect(formErrors(filled({ baseline: 'сорок' }), 'draft', TODAY).baseline).toBeTruthy();
  });
});

describe('stepErrors', () => {
  it('на шаге 1 — только поля результата', () => {
    const e = stepErrors({ ...emptyForm(), dueAt: '2020-01-01' }, 1, TODAY);
    expect(e.title).toBeTruthy();
    expect(e.dueAt).toBeUndefined();
  });
  it('на шаге 3 ничего не блокирует переход', () => {
    expect(stepErrors(emptyForm(), 3, TODAY)).toEqual({});
  });
});

describe('duePresets', () => {
  it('конец месяца, квартала и года — без повторов и не в прошлом', () => {
    expect(duePresets('2026-10-19')).toEqual([
      { label: 'Конец месяца', value: '2026-10-31' },
      { label: 'Конец квартала', value: '2026-12-31' },
    ]);
  });
  it('февраль високосного года', () => {
    expect(duePresets('2028-02-10')[0]!.value).toBe('2028-02-29');
  });
  it('в последний день года остаётся один вариант', () => {
    expect(duePresets('2026-12-31')).toEqual([{ label: 'Конец месяца', value: '2026-12-31' }]);
  });
});
