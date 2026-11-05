import { isModuleOn, type CompanyModules, type CompanyRole, type ModuleKey, type SandboxInfo, type SandboxPerson } from '@offix/core';

/**
 * Функции компании в приложении: что показывать в меню и на вкладках.
 * Экраны выключенных разделов закрывает gated() из ui/modules.
 * Чистая логика — тестируется без телефона.
 */

export type MenuKey = 'my-notes' | 'notes' | 'effect' | 'report' | 'sales' | 'company' | 'security' | 'push';

const MENU: { key: MenuKey; module?: ModuleKey; admin?: boolean }[] = [
  { key: 'my-notes', module: 'my_notes' },
  { key: 'notes' },
  { key: 'effect' },
  { key: 'report' },
  { key: 'sales', module: 'sales' },
  { key: 'company', admin: true },
  { key: 'security' },
  { key: 'push' },
];

/**
 * Меню профиля: выключенные разделы пропадают, «Функции компании» — владельцу
 * и администратору. Пока разделы компании не пришли (mods нет), их пунктов
 * нет: выключенные «Продажи» не должны мелькнуть даже на миг.
 */
export function profileMenu(mods: Partial<CompanyModules> | null | undefined, role: CompanyRole | undefined): MenuKey[] {
  const admin = role === 'owner' || role === 'admin';
  return MENU.filter((m) => (!m.admin || admin) && (!m.module || (!!mods && isModuleOn(mods, m.module)))).map((m) => m.key);
}

/** Нижняя панель: вкладки, которые видно, и где «капля» (−1 — открыта скрытая вкладка). */
export function tabSlots(hidden: boolean[], index: number): { visible: number[]; count: number; at: number } {
  const visible = hidden.map((h, i) => (h ? -1 : i)).filter((i) => i >= 0);
  return { visible, count: visible.length, at: visible.indexOf(index) };
}

/** Песочница для жюри на сервере: показывать только живые входы, иначе — обычный экран входа. */
export function sandboxPeople(info: SandboxInfo | null | undefined): SandboxPerson[] {
  return info?.enabled ? info.people : [];
}

/** «Ректор · владелец»; у наблюдателя роль и есть должность — без повтора. */
export function roleLine(position: string, roleLabel: string): string {
  const role = roleLabel.toLowerCase();
  return position.toLowerCase() === role ? position : `${position} · ${role}`;
}
