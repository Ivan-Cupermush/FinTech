import { describe, expect, it } from 'vitest';
import { companyModules, type SandboxInfo } from '@offix/core';
import { profileMenu, roleLine, sandboxPeople, tabSlots } from '../src/lib/modules';

const UNI = companyModules(['sales']);

describe('функции компании в приложении', () => {
  it('меню профиля: без продаж — без «Продаж», «Функции компании» — только администратору', () => {
    expect(profileMenu(UNI, 'owner')).toEqual(['my-notes', 'notes', 'effect', 'report', 'company', 'push']);
    expect(profileMenu(companyModules([]), 'member')).toEqual(['my-notes', 'notes', 'effect', 'report', 'sales', 'push']);
    expect(profileMenu(companyModules(['my_notes', 'sales']), 'admin')).toEqual(['notes', 'effect', 'report', 'company', 'push']);
  });

  it('нижняя панель без скрытой вкладки: «капля» встаёт на видимую', () => {
    // Пульс, Цели, Задачи, Чаты (скрыта), Входящие.
    const hidden = [false, false, false, true, false];
    expect(tabSlots(hidden, 4)).toEqual({ visible: [0, 1, 2, 4], count: 4, at: 3 });
    expect(tabSlots(hidden, 0).at).toBe(0);
    expect(tabSlots(hidden, 3).at).toBe(-1);
    expect(tabSlots([false, false], 1)).toEqual({ visible: [0, 1], count: 2, at: 1 });
  });

  it('песочница на входе: только когда включена', () => {
    const info: SandboxInfo = { enabled: true, company_name: 'Университет', people: [{ login: 'rector', password: 'rector', display_name: 'Алексей Звездин', position: 'Ректор', role: 'owner', blurb: '' }] };
    expect(sandboxPeople(info)).toHaveLength(1);
    expect(sandboxPeople({ ...info, enabled: false })).toEqual([]);
    expect(sandboxPeople(undefined)).toEqual([]);
    expect(roleLine('Ректор', 'Владелец')).toBe('Ректор · владелец');
    expect(roleLine('Наблюдатель', 'Наблюдатель')).toBe('Наблюдатель');
  });
});
