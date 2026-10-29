import { describe, expect, it } from 'vitest';
import {
  canChangeFunctions,
  defaultEnabled,
  functionDetails,
  functionDisabled,
  functionScope,
  functionWhereText,
  hasFunction,
  planFunctionChange,
  scopeCovers,
  type CompanyRole,
  type DelegationContext,
  type FunctionGrant,
} from '../src';

/**
 * Университет: ректорат → учебный офис (Ольга руководит, Анна — сотрудник) и
 * IT (Игорь руководит, Дмитрий — сотрудник). Директор — владелец, Сергей —
 * аналитик в ректорате, Вера — наблюдатель.
 */
const units = [
  { id: 'rect', parent_unit_id: null, name: 'Ректорат', unit_type: 'division' as const },
  { id: 'office', parent_unit_id: 'rect', name: 'Учебный офис', unit_type: 'department' as const },
  { id: 'it', parent_unit_id: 'rect', name: 'IT', unit_type: 'department' as const },
];
const memberships = [
  { user_id: 'olga', unit_id: 'office', is_manager: true },
  { user_id: 'anna', unit_id: 'office', is_manager: false },
  { user_id: 'igor', unit_id: 'it', is_manager: true },
  { user_id: 'dima', unit_id: 'it', is_manager: false },
  { user_id: 'sergey', unit_id: 'rect', is_manager: false },
];
const roles = new Map<string, CompanyRole>([
  ['dir', 'owner'],
  ['olga', 'manager'],
  ['igor', 'manager'],
  ['anna', 'member'],
  ['dima', 'member'],
  ['sergey', 'member'],
  ['vera', 'observer'],
]);
const ctx = (grants: FunctionGrant[] = []): DelegationContext => ({ units, memberships, roles, grants });

describe('функции по должности', () => {
  it('у администраторов всё и на всю компанию', () => {
    expect(functionScope(ctx(), 'dir', 'knowledge_manage')).toEqual({ all: true, units: new Set() });
  });

  it('у руководителя узла — функции руководителей в его подразделении', () => {
    const s = functionScope(ctx(), 'olga', 'kpi_record');
    expect(s?.all).toBe(false);
    expect([...s!.units]).toEqual(['office']);
    expect(hasFunction(ctx(), 'olga', 'knowledge_manage')).toBe(false);
  });

  it('у сотрудника и наблюдателя по умолчанию нет', () => {
    expect(defaultEnabled(ctx(), 'anna', 'kpi_record')).toBe(false);
    expect(hasFunction(ctx(), 'vera', 'kpi_record')).toBe(false);
  });
});

describe('передача функции', () => {
  it('включил руководитель — действует в его подразделениях', () => {
    const c = ctx([{ user_id: 'anna', fn: 'kpi_record', allowed: true, granted_by: 'olga' }]);
    const s = functionScope(c, 'anna', 'kpi_record');
    expect(scopeCovers(s, ['office'])).toBe(true);
    expect(scopeCovers(s, ['it'])).toBe(false);
  });

  it('включил администратор — на всю компанию', () => {
    const c = ctx([{ user_id: 'sergey', fn: 'kpi_record', allowed: true, granted_by: 'dir' }]);
    expect(scopeCovers(functionScope(c, 'sergey', 'kpi_record'), ['it'])).toBe(true);
  });

  it('тот, кто включил, удалён — только свои подразделения, а не вся компания', () => {
    const c = ctx([{ user_id: 'olga', fn: 'knowledge_manage', allowed: true, granted_by: null }]);
    const s = functionScope(c, 'olga', 'knowledge_manage');
    expect(s?.all).toBe(false);
    expect([...s!.units]).toEqual(['office']);
  });

  it('отключили — функции нет даже по должности', () => {
    const c = ctx([{ user_id: 'igor', fn: 'kpi_assign', allowed: false, granted_by: 'dir' }]);
    expect(hasFunction(c, 'igor', 'kpi_assign')).toBe(false);
    expect(functionDisabled(c, 'igor', 'kpi_assign')).toBe(true);
    expect(functionDisabled(c, 'igor', 'kpi_record')).toBe(false);
  });

  it('совпадает с должностью — храним «по умолчанию»', () => {
    expect(planFunctionChange(ctx(), 'dir', 'olga', 'kpi_record', true)).toEqual({ value: null });
    expect(planFunctionChange(ctx(), 'dir', 'olga', 'kpi_record', false)).toEqual({ value: false });
    expect(planFunctionChange(ctx(), 'dir', 'anna', 'kpi_record', true)).toEqual({ value: true });
  });

  it('включить можно только то, что есть у самого руководителя', () => {
    expect(planFunctionChange(ctx(), 'olga', 'anna', 'knowledge_manage', true)).toEqual({ error: 'Нельзя включить функцию, которой нет у вас: «Вести базу знаний»' });
    expect(planFunctionChange(ctx(), 'olga', 'anna', 'kpi_record', true)).toEqual({ value: true });
    // Выключить то, что и так выключено по должности, — это «по умолчанию».
    expect(planFunctionChange(ctx(), 'olga', 'anna', 'knowledge_manage', false)).toEqual({ value: null });
  });
});

describe('кто меняет функции', () => {
  it('администратор — любому, руководитель — своим, остальные — никому', () => {
    expect(canChangeFunctions(ctx(), 'dir', 'anna')).toBeNull();
    expect(canChangeFunctions(ctx(), 'olga', 'anna')).toBeNull();
    expect(canChangeFunctions(ctx(), 'olga', 'dima')).toBe('Менять функции можно только своим подчинённым');
    expect(canChangeFunctions(ctx(), 'anna', 'sergey')).toBe('Менять функции можно только своим подчинённым');
  });

  it('себе, администраторам и наблюдателям — нельзя', () => {
    expect(canChangeFunctions(ctx(), 'olga', 'olga')).toBe('Свои функции включает руководитель');
    expect(canChangeFunctions(ctx(), 'olga', 'dir')).toContain('все функции включены');
    expect(canChangeFunctions(ctx(), 'dir', 'vera')).toContain('Наблюдатель только смотрит');
    expect(canChangeFunctions(ctx(), 'dir', 'nobody')).toBe('Сотрудник не найден');
  });
});

describe('экран функций', () => {
  it('по умолчанию, явно и итог с подписью', () => {
    const c = ctx([
      { user_id: 'anna', fn: 'kpi_record', allowed: true, granted_by: 'dir' },
      { user_id: 'anna', fn: 'knowledge_manage', allowed: false, granted_by: 'dir' },
    ]);
    const d = functionDetails(c, 'anna');
    expect(d.map((x) => [x.key, x.enabled, x.override, x.where])).toEqual([
      ['kpi_record', true, true, 'company'],
      ['kpi_assign', false, null, null],
      ['knowledge_manage', false, false, null],
      ['sales_reports', false, null, null],
      ['sales_files', false, null, null],
      ['sales_assign', false, null, null],
    ]);
    expect(functionWhereText(d[0]!)).toBe('Включено руководителем · по всей компании');
    expect(functionWhereText(d[1]!)).toBe('Выключено');
    expect(functionWhereText(d[2]!)).toBe('Отключено руководителем');
    expect(functionWhereText(functionDetails(c, 'olga')[0]!)).toBe('По должности · в подразделениях руководителя');
    expect(functionWhereText(functionDetails(c, 'dir')[0]!)).toBe('Всегда включено у администраторов');
  });
});
