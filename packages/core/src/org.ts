/**
 * Оргструктура: единая модель узлов (дивизион / департамент / отдел / команда)
 * с родительской связью. Сотрудник может состоять в нескольких узлах.
 */
export const UNIT_TYPES = ['division', 'department', 'team'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  division: 'Направление',
  department: 'Подразделение',
  team: 'Команда',
};

const RANK: Record<UnitType, number> = { division: 0, department: 1, team: 2 };

export interface OrgUnit {
  id: string;
  parent_unit_id: string | null;
  name: string;
  unit_type: UnitType;
  status?: 'active' | 'archived';
}

export interface Membership {
  user_id: string;
  unit_id: string;
  is_manager: boolean;
  is_primary?: boolean;
}

export interface TreeNode<T> {
  item: T;
  children: TreeNode<T>[];
}

export function buildTree<T extends OrgUnit>(units: readonly T[]): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>(units.map((u) => [u.id, { item: u, children: [] }]));
  const roots: TreeNode<T>[] = [];
  for (const u of units) {
    const node = nodes.get(u.id)!;
    const parent = u.parent_unit_id ? nodes.get(u.parent_unit_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: TreeNode<T>[]) => {
    list.sort((a, b) => RANK[a.item.unit_type] - RANK[b.item.unit_type] || a.item.name.localeCompare(b.item.name, 'ru'));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export function ancestors(units: readonly OrgUnit[], id: string): string[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id)?.parent_unit_id ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = byId.get(cur)?.parent_unit_id ?? null;
  }
  return out;
}

export function descendants(units: readonly OrgUnit[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const u of units) {
    if (!u.parent_unit_id) continue;
    children.set(u.parent_unit_id, [...(children.get(u.parent_unit_id) ?? []), u.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    stack.push(...(children.get(cur) ?? []));
  }
  return out;
}

/**
 * Можно ли поставить узел `id` под `newParent`. Составной внешний ключ в БД
 * защищает от родителя из другой компании, но не от цикла из нескольких
 * узлов — его проверяем здесь.
 */
export function checkReparent(units: readonly OrgUnit[], id: string, newParent: string | null): string | null {
  if (newParent === null) return null;
  if (newParent === id) return 'Подразделение не может входить само в себя';
  if (descendants(units, id).includes(newParent)) return 'Нельзя перенести подразделение внутрь его же дочернего узла';
  const unit = units.find((u) => u.id === id);
  const parent = units.find((u) => u.id === newParent);
  if (!parent) return 'Родительское подразделение не найдено';
  if (unit) return checkNesting(parent.unit_type, unit.unit_type);
  return null;
}

/** Команда — самый мелкий узел: внутри неё не бывает отделов и направлений. */
export function checkNesting(parentType: UnitType, childType: UnitType): string | null {
  if (parentType === 'team' && childType !== 'team') return 'Внутри команды можно создать только подкоманду';
  if (RANK[childType] < RANK[parentType]) return `${UNIT_TYPE_LABELS[childType]} не может входить в узел «${UNIT_TYPE_LABELS[parentType]}»`;
  return null;
}

/** Узлы, которыми человек руководит, вместе со всеми вложенными. */
export function managedScope(units: readonly OrgUnit[], memberships: readonly Membership[], userId: string): Set<string> {
  const scope = new Set<string>();
  for (const m of memberships) {
    if (m.user_id !== userId || !m.is_manager) continue;
    scope.add(m.unit_id);
    for (const d of descendants(units, m.unit_id)) scope.add(d);
  }
  return scope;
}

export function memberUnits(memberships: readonly Membership[], userId: string): Set<string> {
  return new Set(memberships.filter((m) => m.user_id === userId).map((m) => m.unit_id));
}

/** Руководители человека: менеджеры его узлов и узлов выше по дереву. */
export function managersOf(units: readonly OrgUnit[], memberships: readonly Membership[], userId: string): Set<string> {
  const mine = [...memberUnits(memberships, userId)];
  const chain = new Set<string>();
  for (const u of mine) {
    chain.add(u);
    for (const a of ancestors(units, u)) chain.add(a);
  }
  const out = new Set<string>();
  for (const m of memberships) if (m.is_manager && chain.has(m.unit_id) && m.user_id !== userId) out.add(m.user_id);
  return out;
}
