import { describe, expect, it } from 'vitest';
import {
  DELEGABLE_KEYS,
  MODULE_KEYS,
  MODULE_PRESETS,
  MODULES,
  companyModules,
  disabledModules,
  hiddenFunctions,
  isModuleKey,
  isModuleOn,
  matchingPreset,
  moduleInfo,
  moduleOffMessage,
  modulesDiff,
  describeModulesChange,
} from '../src';

describe('функции компании', () => {
  it('у каждого раздела есть название, описание и что пропадёт вместе с ним', () => {
    expect(MODULES.map((m) => m.key)).toEqual([...MODULE_KEYS]);
    for (const m of MODULES) {
      expect(m.title.length).toBeGreaterThan(2);
      expect(m.description.length).toBeGreaterThan(20);
      expect(m.impact.length).toBeGreaterThan(0);
      for (const fn of m.functions) expect(DELEGABLE_KEYS).toContain(fn);
    }
  });

  it('по умолчанию включено всё, в базе хранятся только выключенные', () => {
    expect(Object.values(companyModules([])).every(Boolean)).toBe(true);
    expect(companyModules(null).sales).toBe(true);
    const mods = companyModules(['sales', 'integrations']);
    expect(mods).toMatchObject({ sales: false, integrations: false, chats: true, knowledge_ai: true, my_notes: true });
    expect(disabledModules(mods)).toEqual(['sales', 'integrations']);
  });

  it('неизвестный ключ из базы ничего не ломает', () => {
    const mods = companyModules(['sales', 'teleport']);
    expect(Object.keys(mods)).toEqual([...MODULE_KEYS]);
    expect(isModuleKey('teleport')).toBe(false);
    expect(isModuleKey('chats')).toBe(true);
  });

  it('старый ответ сервера без поля modules — раздел считаем включённым', () => {
    expect(isModuleOn(undefined, 'sales')).toBe(true);
    expect(isModuleOn({}, 'chats')).toBe(true);
    expect(isModuleOn({ chats: false }, 'chats')).toBe(false);
  });

  it('без продаж прячутся функции продаж у сотрудников', () => {
    expect([...hiddenFunctions(companyModules(['sales']))].sort()).toEqual(['sales_assign', 'sales_files', 'sales_reports']);
    expect(hiddenFunctions(companyModules([])).size).toBe(0);
  });

  it('готовые наборы: университет без продаж, компания со всем', () => {
    const uni = MODULE_PRESETS.find((p) => p.key === 'university')!;
    expect(uni.modules.sales).toBe(false);
    expect(disabledModules(uni.modules)).toEqual(['sales']);
    expect(matchingPreset(companyModules(['sales']))).toBe('university');
    expect(matchingPreset(companyModules([]))).toBe('company');
    expect(matchingPreset(companyModules(['chats']))).toBeNull();
  });

  it('ошибка называет раздел и подсказывает, кто его включит', () => {
    expect(moduleOffMessage('sales')).toContain('«Продажи и выплаты»');
    expect(moduleOffMessage('sales')).toContain('администратор');
    expect(moduleInfo('knowledge_ai').title).toBe('ИИ-помощник базы знаний');
  });

  it('журнал видит только то, что поменялось', () => {
    expect(modulesDiff(companyModules([]), companyModules(['sales']))).toEqual({ sales: { from: true, to: false } });
    expect(modulesDiff(companyModules(['chats']), companyModules(['chats']))).toEqual({});
  });
});

describe('журнал функций компании', () => {
  it('одной строкой: что выключили и что включили', () => {
    expect(describeModulesChange({ new_values: { sales: false } })).toBe('Выключил: Продажи и выплаты');
    expect(describeModulesChange({ new_values: { chats: true, integrations: false } })).toBe('Выключил: Интеграции; включил: Чаты');
    expect(describeModulesChange({ new_values: { sales: false, preset: 'university' } })).toBe('Набор «Университет» — выключил: Продажи и выплаты');
  });
});
