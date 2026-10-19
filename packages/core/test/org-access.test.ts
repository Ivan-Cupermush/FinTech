import { describe, expect, it } from 'vitest';
import { canActivateGoal, canBeGoalOwner, canCreateGoal, canEditGoal, canReadAudit, canRecordObservation, canViewGoal, type Actor, type GoalAccessView } from '../src/access';
import { ancestors, buildTree, checkNesting, checkReparent, descendants, managedScope, managersOf, type Membership, type OrgUnit } from '../src/org';

const units: OrgUnit[] = [
  { id: 'ops', parent_unit_id: null, name: 'Операционный отдел', unit_type: 'department' },
  { id: 'ops-intake', parent_unit_id: 'ops', name: 'Приём заявок', unit_type: 'team' },
  { id: 'it', parent_unit_id: null, name: 'IT', unit_type: 'department' },
  { id: 'it-auto', parent_unit_id: 'it', name: 'Автоматизация', unit_type: 'team' },
  { id: 'fin', parent_unit_id: null, name: 'Финансы', unit_type: 'department' },
];
const memberships: Membership[] = [
  { user_id: 'olga', unit_id: 'ops', is_manager: true },
  { user_id: 'anna', unit_id: 'ops-intake', is_manager: false },
  { user_id: 'dima', unit_id: 'it-auto', is_manager: false },
  { user_id: 'dima', unit_id: 'ops-intake', is_manager: false },
  { user_id: 'igor', unit_id: 'it', is_manager: true },
  { user_id: 'fedor', unit_id: 'fin', is_manager: true },
];
const org = { units, memberships };
const goal: GoalAccessView = { id: 'g', type: 'operational', owner_id: 'olga', created_by: 'olga', unit_ids: ['ops', 'it-auto'], participant_ids: [] };
const actor = (id: string, role: Actor['role']): Actor => ({ id, role });

describe('оргдерево', () => {
  it('строит дерево и сортирует', () => {
    const tree = buildTree(units);
    expect(tree.map((n) => n.item.name)).toEqual(['Операционный отдел', 'Финансы', 'IT']);
    expect(tree[0]!.children[0]!.item.id).toBe('ops-intake');
  });
  it('предки и потомки', () => {
    expect(ancestors(units, 'ops-intake')).toEqual(['ops']);
    expect(descendants(units, 'it')).toEqual(['it-auto']);
  });
  it('запрещает цикл при переносе', () => {
    expect(checkReparent(units, 'ops', 'ops-intake')).toMatch(/дочернего/);
    expect(checkReparent(units, 'ops', 'ops')).toMatch(/само в себя/);
    expect(checkReparent(units, 'it-auto', 'ops')).toBeNull();
    expect(checkReparent(units, 'ops', null)).toBeNull();
    expect(checkReparent(units, 'ops', 'nope')).toMatch(/не найдено/);
  });
  it('внутри команды — только подкоманды', () => {
    expect(checkNesting('team', 'department')).toMatch(/подкоманду/);
    expect(checkNesting('team', 'team')).toBeNull();
    expect(checkNesting('department', 'division')).toBeDefined();
    expect(checkNesting('division', 'department')).toBeNull();
  });
  it('зона руководителя включает вложенные узлы', () => {
    expect([...managedScope(units, memberships, 'olga')].sort()).toEqual(['ops', 'ops-intake']);
  });
  it('руководители сотрудника по всем его командам', () => {
    expect([...managersOf(units, memberships, 'dima')].sort()).toEqual(['igor', 'olga']);
  });
});

describe('права на цели', () => {
  it('создавать операционные цели может руководитель, сотрудник — только личные', () => {
    expect(canCreateGoal(actor('olga', 'manager'), 'operational')).toBe(true);
    expect(canCreateGoal(actor('anna', 'member'), 'operational')).toBe(false);
    expect(canCreateGoal(actor('anna', 'member'), 'personal')).toBe(true);
    expect(canCreateGoal(actor('x', 'observer'), 'personal')).toBe(false);
  });

  it('видят цель: участвующие подразделения, их руководители, админ', () => {
    expect(canViewGoal(actor('anna', 'member'), goal, org)).toBe(true);
    expect(canViewGoal(actor('dima', 'member'), goal, org)).toBe(true);
    expect(canViewGoal(actor('igor', 'manager'), goal, org)).toBe(true);
    expect(canViewGoal(actor('root', 'admin'), goal, org)).toBe(true);
  });

  it('руководитель финансов не видит чужую цель — новый отдел не расширяет права', () => {
    expect(canViewGoal(actor('fedor', 'manager'), goal, org)).toBe(false);
  });

  it('явный участник цели видит её, но не может менять KPI', () => {
    const g = { ...goal, participant_ids: ['fedor'] };
    expect(canViewGoal(actor('fedor', 'manager'), g, org)).toBe(true);
    expect(canEditGoal(actor('fedor', 'manager'), g, 'metrics', org)).toBe(false);
  });

  it('наблюдатель видит, но ничего не меняет', () => {
    expect(canViewGoal(actor('obs', 'observer'), goal, org)).toBe(true);
    expect(canEditGoal(actor('obs', 'observer'), goal, 'description', org)).toBe(false);
    expect(canRecordObservation(actor('obs', 'observer'), goal, org)).toBe(false);
  });

  it('личную цель видят владелец и его руководители, а не вся команда', () => {
    const personal: GoalAccessView = { id: 'p', type: 'personal', owner_id: 'anna', created_by: 'anna', unit_ids: [], participant_ids: [] };
    expect(canViewGoal(actor('olga', 'manager'), personal, org)).toBe(true);
    expect(canViewGoal(actor('dima', 'member'), personal, org)).toBe(false);
    expect(canViewGoal(actor('obs', 'observer'), personal, org)).toBe(false);
  });

  it('владелец-сотрудник правит описание, но не KPI и не владельца', () => {
    const g = { ...goal, owner_id: 'anna' };
    expect(canEditGoal(actor('anna', 'member'), g, 'description', org)).toBe(true);
    expect(canEditGoal(actor('anna', 'member'), g, 'metrics', org)).toBe(false);
    expect(canEditGoal(actor('anna', 'member'), g, 'owner_id', org)).toBe(false);
    expect(canRecordObservation(actor('anna', 'member'), g, org)).toBe(true);
  });

  it('руководитель участвующего подразделения управляет целью', () => {
    expect(canEditGoal(actor('igor', 'manager'), { ...goal, unit_ids: ['it-auto'] }, 'due_at', org)).toBe(true);
    expect(canActivateGoal(actor('olga', 'manager'), goal, org)).toBe(true);
    expect(canActivateGoal(actor('anna', 'member'), goal, org)).toBe(false);
  });

  it('аудит читают админ и владелец цели', () => {
    expect(canReadAudit(actor('olga', 'manager'), goal, org)).toBe(true);
    expect(canReadAudit(actor('anna', 'member'), goal, org)).toBe(false);
  });

  it('кандидат во владельцы', () => {
    expect(canBeGoalOwner(null)).toMatch(/не найден/);
    expect(canBeGoalOwner({ active: false, role: 'member' })).toMatch(/отключён/);
    expect(canBeGoalOwner({ active: true, role: 'observer' })).toMatch(/Наблюдатель/);
    expect(canBeGoalOwner({ active: true, role: 'member' })).toBeNull();
  });
});
