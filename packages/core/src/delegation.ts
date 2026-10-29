import type { CompanyRole, OrgContext } from './access';
import { managedScope, managersOf } from './org';

/**
 * Функции, которые можно передать сотруднику. Как в прошлом проекте: у
 * каждой функции есть значение «по должности», руководитель включает её
 * своему сотруднику или отключает, а включённая функция действует там, где
 * действует тот, кто её включил: администратор — на всю компанию,
 * руководитель — на свои подразделения.
 *
 * Должности прошлого проекта (директор, руководитель отдела) здесь — роли и
 * оргструктура offix: владелец и администратор — «директор», у них всё
 * включено и это не меняется; руководитель узла — «руководитель отдела».
 */
export const DELEGABLE_FUNCTIONS = [
  {
    key: 'kpi_record',
    label: 'Вносить измерения KPI',
    hint: 'Факт по KPI целей — вручную и выгрузкой из 1С или Excel',
    byDefault: 'managers',
  },
  {
    key: 'kpi_assign',
    label: 'Менять KPI целей',
    hint: 'Добавлять показатели, менять исходное и целевое значение',
    byDefault: 'managers',
  },
  {
    key: 'knowledge_manage',
    label: 'Вести базу знаний',
    hint: 'Править и удалять любые статьи базы знаний, не только свои',
    byDefault: 'admins',
  },
  {
    key: 'sales_reports',
    label: 'Загружать отчёты о продажах',
    hint: 'Отчёт о продажах из 1С, списки ключевых клиентов, сопоставление менеджеров',
    byDefault: 'managers',
  },
  {
    key: 'sales_files',
    label: 'Загружать файлы KPI',
    hint: 'Файл KPI сотрудника: план, факт, бонусы и выплаты за месяц',
    byDefault: 'managers',
  },
  {
    key: 'sales_assign',
    label: 'Ставить план продаж',
    hint: 'План сотрудника на месяц и правила расчёта выплат',
    byDefault: 'managers',
  },
] as const satisfies readonly { key: string; label: string; hint: string; byDefault: 'managers' | 'admins' }[];

export type DelegableFunction = (typeof DELEGABLE_FUNCTIONS)[number]['key'];
export const DELEGABLE_KEYS = DELEGABLE_FUNCTIONS.map((f) => f.key) as DelegableFunction[];

export function functionInfo(key: DelegableFunction) {
  return DELEGABLE_FUNCTIONS.find((f) => f.key === key)!;
}

/** Где действует функция: вся компания или перечисленные подразделения. */
export interface FunctionScope {
  all: boolean;
  units: ReadonlySet<string>;
}

export interface FunctionGrant {
  user_id: string;
  fn: DelegableFunction;
  allowed: boolean;
  granted_by: string | null;
}

export interface DelegationContext extends OrgContext {
  roles: ReadonlyMap<string, CompanyRole>;
  grants: readonly FunctionGrant[];
}

const ALL: FunctionScope = { all: true, units: new Set() };
const isAdminRole = (r: CompanyRole | undefined) => r === 'owner' || r === 'admin';

/** Подразделения, которыми человек руководит, с вложенными; null — никем не руководит. */
export function teamScope(ctx: OrgContext, userId: string): Set<string> | null {
  const s = managedScope(ctx.units, ctx.memberships, userId);
  return s.size ? s : null;
}

function grantOf(ctx: DelegationContext, userId: string, fn: DelegableFunction) {
  return ctx.grants.find((g) => g.user_id === userId && g.fn === fn) ?? null;
}

/** Есть ли функция «по должности»: у руководителя узла — для функций руководителей. */
export function defaultEnabled(ctx: DelegationContext, userId: string, fn: DelegableFunction): boolean {
  const role = ctx.roles.get(userId);
  if (isAdminRole(role)) return true;
  if (role === 'observer') return false;
  return functionInfo(fn).byDefault === 'managers' && teamScope(ctx, userId) != null;
}

/** Где человек может применять функцию; null — функции у него нет. */
export function functionScope(ctx: DelegationContext, userId: string, fn: DelegableFunction): FunctionScope | null {
  const role = ctx.roles.get(userId);
  if (isAdminRole(role)) return ALL;
  if (!role || role === 'observer') return null;
  const own = teamScope(ctx, userId);
  const g = grantOf(ctx, userId, fn);
  if (!g) return defaultEnabled(ctx, userId, fn) ? { all: false, units: own ?? new Set() } : null;
  if (!g.allowed) return null;
  // Включил администратор — на всю компанию, руководитель — на его подразделения.
  // Кто включил, неизвестно (его удалили) — только свои подразделения:
  // права на всю компанию сами собой не появляются.
  if (!g.granted_by) return { all: false, units: own ?? new Set() };
  if (isAdminRole(ctx.roles.get(g.granted_by))) return ALL;
  const granter = teamScope(ctx, g.granted_by);
  return { all: false, units: new Set([...(own ?? []), ...(granter ?? [])]) };
}

export function hasFunction(ctx: DelegationContext, userId: string, fn: DelegableFunction): boolean {
  return functionScope(ctx, userId, fn) != null;
}

/** Функцию выключили явно — тогда и права «по роли» на это действие нет. */
export function functionDisabled(ctx: DelegationContext, userId: string, fn: DelegableFunction): boolean {
  if (isAdminRole(ctx.roles.get(userId))) return false;
  return grantOf(ctx, userId, fn)?.allowed === false;
}

/** Покрывает ли область подразделения ресурса (цели, задачи). */
export function scopeCovers(scope: FunctionScope | null, unitIds: readonly string[]): boolean {
  if (!scope) return false;
  return scope.all || unitIds.some((u) => scope.units.has(u));
}

/**
 * Кто может менять функции сотрудника: администратор — любому, руководитель —
 * своим подчинённым по оргструктуре. null — можно, иначе причина отказа.
 */
export function canChangeFunctions(ctx: DelegationContext, actorId: string, targetId: string): string | null {
  if (actorId === targetId) return 'Свои функции включает руководитель';
  const target = ctx.roles.get(targetId);
  if (!target) return 'Сотрудник не найден';
  if (isAdminRole(target)) return 'У владельца и администраторов все функции включены';
  if (target === 'observer') return 'Наблюдатель только смотрит — функции ему не включают';
  const actor = ctx.roles.get(actorId);
  if (isAdminRole(actor)) return null;
  if (actor === 'observer' || !managersOf(ctx.units, ctx.memberships, targetId).has(actorId)) return 'Менять функции можно только своим подчинённым';
  return null;
}

/**
 * Изменение одной функции. Совпадает с «по должности» — храним «по
 * умолчанию» (null): при переводе на другую должность функция поменяется
 * сама. Включить можно только то, что есть у самого руководителя.
 */
export function planFunctionChange(ctx: DelegationContext, actorId: string, targetId: string, fn: DelegableFunction, raw: boolean | null): { value: boolean | null } | { error: string } {
  const value = raw === defaultEnabled(ctx, targetId, fn) ? null : raw;
  if (value === true && !hasFunction(ctx, actorId, fn)) return { error: `Нельзя включить функцию, которой нет у вас: «${functionInfo(fn).label}»` };
  return { value };
}

export interface FunctionDetail {
  key: DelegableFunction;
  label: string;
  hint: string;
  /** Есть ли «по должности». */
  default: boolean;
  /** Явно включено (true), выключено (false) или по должности (null). */
  override: boolean | null;
  enabled: boolean;
  /** Где действует: вся компания или подразделения. */
  where: 'company' | 'units' | null;
  /** Администраторам не меняют. */
  locked: boolean;
}

export function functionDetails(ctx: DelegationContext, userId: string): FunctionDetail[] {
  const locked = isAdminRole(ctx.roles.get(userId));
  return DELEGABLE_FUNCTIONS.map((f) => {
    const scope = functionScope(ctx, userId, f.key);
    const g = grantOf(ctx, userId, f.key);
    return {
      key: f.key,
      label: f.label,
      hint: f.hint,
      default: defaultEnabled(ctx, userId, f.key),
      override: locked ? null : (g?.allowed ?? null),
      enabled: !!scope,
      where: scope ? (scope.all ? 'company' : 'units') : null,
      locked,
    };
  });
}

export function functionWhereText(d: Pick<FunctionDetail, 'enabled' | 'where' | 'override' | 'default' | 'locked'>): string {
  if (d.locked) return 'Всегда включено у администраторов';
  if (!d.enabled) return d.override === false ? 'Отключено руководителем' : 'Выключено';
  const where = d.where === 'company' ? 'по всей компании' : 'в подразделениях руководителя';
  return d.override === true ? `Включено руководителем · ${where}` : `По должности · ${where}`;
}
