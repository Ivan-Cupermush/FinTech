import { ancestors, managedScope, managersOf, memberUnits, type Membership, type OrgUnit } from './org';

/**
 * Три независимых слоя прав (ТЗ 1.4):
 *  1. роль в компании;
 *  2. принадлежность к оргструктуре (кем руководит, где состоит);
 *  3. права на конкретный ресурс (участник цели, согласующий).
 * Структура и права связаны, но не тождественны: участие в совместной цели с
 * IT открывает задачи цели, но не делает руководителем IT.
 */
export const COMPANY_ROLES = ['owner', 'admin', 'manager', 'member', 'observer'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  manager: 'Руководитель',
  member: 'Сотрудник',
  observer: 'Наблюдатель',
};

export const COMPANY_ROLE_HINTS: Record<CompanyRole, string> = {
  owner: 'Всё, включая удаление компании и передачу владения',
  admin: 'Структура, сотрудники, роли и все цели',
  manager: 'Цели и задачи своих подразделений',
  member: 'Свои задачи, цели своих команд, личные цели',
  observer: 'Только просмотр сводной картины без изменений',
};

export interface Actor {
  id: string;
  role: CompanyRole;
}

export interface GoalAccessView {
  id: string;
  type: string;
  owner_id: string | null;
  created_by: string;
  /** Подразделения, участвующие в цели. */
  unit_ids: readonly string[];
  /** Явно добавленные участники (третий слой). */
  participant_ids: readonly string[];
}

export interface OrgContext {
  units: readonly OrgUnit[];
  memberships: readonly Membership[];
}

const isAdmin = (a: Actor) => a.role === 'owner' || a.role === 'admin';

export function canCreateGoal(a: Actor, type: string): boolean {
  if (isAdmin(a) || a.role === 'manager') return true;
  if (a.role === 'member') return type === 'personal';
  return false;
}

/** Руководит ли actor человеком userId (по оргдереву). */
export function isManagerOf(a: Actor, userId: string, org: OrgContext): boolean {
  return managersOf(org.units, org.memberships, userId).has(a.id);
}

export function canViewGoal(a: Actor, g: GoalAccessView, org: OrgContext): boolean {
  if (isAdmin(a)) return true;
  if (g.owner_id === a.id || g.created_by === a.id || g.participant_ids.includes(a.id)) return true;
  if (g.type === 'personal') {
    return !!g.owner_id && isManagerOf(a, g.owner_id, org);
  }
  if (a.role === 'observer') return true;
  const managed = managedScope(org.units, org.memberships, a.id);
  // Цели подразделения касаются и его команд: сотрудник команды видит цели отдела.
  const member = new Set<string>();
  for (const u of memberUnits(org.memberships, a.id)) {
    member.add(u);
    for (const up of ancestors(org.units, u)) member.add(up);
  }
  return g.unit_ids.some((u) => managed.has(u) || member.has(u));
}

export type GoalField = 'title' | 'description' | 'type' | 'owner_id' | 'due_at' | 'metrics' | 'parent_goal_id';

/**
 * Право менять поле. Описание может править владелец цели; владельца, срок
 * и KPI — только руководитель с правами управления (создатель цели или
 * руководитель участвующего подразделения), иначе цель можно «тихо» упростить.
 */
export function canEditGoal(a: Actor, g: GoalAccessView, field: GoalField, org: OrgContext): boolean {
  if (isAdmin(a)) return true;
  if (a.role === 'observer') return false;
  const managesUnit = (() => {
    const managed = managedScope(org.units, org.memberships, a.id);
    return g.unit_ids.some((u) => managed.has(u));
  })();
  const isCreator = g.created_by === a.id;
  if (a.role === 'manager' && (isCreator || managesUnit)) return true;
  if (g.owner_id === a.id) {
    if (field === 'title' || field === 'description') return true;
    if (g.type === 'personal' && a.role === 'member') return isCreator && field !== 'owner_id';
    return a.role === 'manager';
  }
  if (g.type === 'personal' && g.owner_id && isManagerOf(a, g.owner_id, org)) return true;
  return false;
}

export function canActivateGoal(a: Actor, g: GoalAccessView, org: OrgContext): boolean {
  return canEditGoal(a, g, 'metrics', org);
}

/** Измерения KPI вносит владелец цели или тот, кто вправе менять KPI. */
export function canRecordObservation(a: Actor, g: GoalAccessView, org: OrgContext): boolean {
  if (a.role === 'observer') return false;
  return g.owner_id === a.id || canEditGoal(a, g, 'metrics', org);
}

export function canReadAudit(a: Actor, g: GoalAccessView, org: OrgContext): boolean {
  if (isAdmin(a)) return true;
  return g.owner_id === a.id || (a.role === 'manager' && canEditGoal(a, g, 'metrics', org));
}

export function canManageOrg(a: Actor): boolean {
  return isAdmin(a);
}

/** Владельцем цели можно назначить активного сотрудника, который сможет её видеть. */
export function canBeGoalOwner(candidate: { active: boolean; role: CompanyRole } | null): string | null {
  if (!candidate) return 'Нельзя назначить выбранного владельца: сотрудник не найден';
  if (!candidate.active) return 'Нельзя назначить выбранного владельца: сотрудник отключён';
  if (candidate.role === 'observer') return 'Наблюдатель не может быть владельцем цели';
  return null;
}
