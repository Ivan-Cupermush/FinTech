import type { DelegableFunction } from './delegation';

/**
 * Функции компании: крупные разделы, которые владелец или администратор
 * включает под свою организацию. Университету не нужны продажи и выплаты,
 * маленькой команде — интеграции с 1С и Moodle.
 *
 * В базе хранится список выключенных разделов, а не включённых: новый
 * раздел, который появится в offix позже, у всех компаний сразу включён.
 *
 * Цели, задачи, оргструктура, «Эффект» и отчёт — ядро продукта, их не
 * выключить: на них держится всё остальное.
 */

export const MODULE_KEYS = ['sales', 'chats', 'knowledge_ai', 'my_notes', 'integrations'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleInfo {
  key: ModuleKey;
  title: string;
  /** Что даёт раздел — одной фразой для карточки. */
  description: string;
  /** Что пропадёт вместе с разделом, кроме самого пункта меню. */
  impact: string[];
  /** Функции сотрудников, которые без раздела не имеют смысла и прячутся. */
  functions: DelegableFunction[];
}

export const MODULES: readonly ModuleInfo[] = [
  {
    key: 'sales',
    title: 'Продажи и выплаты',
    description: 'Планы продаж, ежедневные отчёты менеджеров, рейтинг и расчёт премий по KPI.',
    impact: ['Раздел «Продажи» и карточки сотрудников с выплатами', 'Функции «Отчёты о продажах», «Файлы продаж», «Назначение планов»'],
    functions: ['sales_reports', 'sales_files', 'sales_assign'],
  },
  {
    key: 'chats',
    title: 'Чаты',
    description: 'Мессенджер команды: личные и групповые чаты, голосовые, опросы, отложенные сообщения.',
    impact: ['Вкладка «Чаты» и счётчик непрочитанных', 'Отправка заметок и пересылка в чат'],
    functions: [],
  },
  {
    key: 'knowledge_ai',
    title: 'ИИ-помощник базы знаний',
    description: 'Загрузка документов PDF и DOCX и ответы на вопросы со ссылками на источники.',
    impact: ['Вкладка «Документы» и «Спросить» в базе знаний', 'Статьи базы знаний остаются'],
    functions: [],
  },
  {
    key: 'my_notes',
    title: 'Мои заметки',
    description: 'Личный ежедневник сотрудника: заметки по дням, избранное, файлы, PDF.',
    impact: ['Раздел «Мои заметки» у всех сотрудников'],
    functions: [],
  },
  {
    key: 'integrations',
    title: 'Интеграции',
    description: 'Подключение 1С и Moodle: показатели обновляются сами по расписанию.',
    impact: ['Раздел «Интеграции» у администраторов', 'Синхронизация по расписанию останавливается, настройки сохраняются'],
    functions: [],
  },
];

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

export const moduleInfo = (key: ModuleKey): ModuleInfo => BY_KEY.get(key)!;

export const isModuleKey = (v: unknown): v is ModuleKey => typeof v === 'string' && BY_KEY.has(v as ModuleKey);

/** Включённые разделы компании: всё, кроме выключенных. Неизвестные ключи из базы пропускаем. */
export type CompanyModules = Record<ModuleKey, boolean>;

export function companyModules(disabled: readonly string[] | null | undefined): CompanyModules {
  const off = new Set(disabled ?? []);
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, !off.has(k)])) as CompanyModules;
}

/** Обратно в то, что хранится в базе: отсортированный список выключенных. */
export function disabledModules(mods: Partial<CompanyModules>): ModuleKey[] {
  return MODULE_KEYS.filter((k) => mods[k] === false);
}

/** Пустой или старый ответ сервера — считаем, что включено всё. */
export const isModuleOn = (mods: Partial<CompanyModules> | null | undefined, key: ModuleKey): boolean => mods?.[key] !== false;

/** Функции сотрудников, которые прячутся вместе с выключенными разделами. */
export function hiddenFunctions(mods: Partial<CompanyModules> | null | undefined): Set<DelegableFunction> {
  return new Set(MODULES.filter((m) => !isModuleOn(mods, m.key)).flatMap((m) => m.functions));
}

export type ModulePresetKey = 'university' | 'company';

export interface ModulePreset {
  key: ModulePresetKey;
  title: string;
  description: string;
  modules: CompanyModules;
}

export const MODULE_PRESETS: readonly ModulePreset[] = [
  {
    key: 'university',
    title: 'Университет',
    description: 'Цели, задачи и показатели подразделений без продаж и премий.',
    modules: companyModules(['sales']),
  },
  {
    key: 'company',
    title: 'Компания',
    description: 'Всё включено: продажи и выплаты по KPI, чаты, ИИ, интеграции.',
    modules: companyModules([]),
  },
];

/** Какой набор сейчас совпадает с готовым — чтобы подсветить его. */
export function matchingPreset(mods: CompanyModules): ModulePresetKey | null {
  return MODULE_PRESETS.find((p) => MODULE_KEYS.every((k) => p.modules[k] === mods[k]))?.key ?? null;
}

/** Текст ошибки, когда открывают выключенный раздел. */
export const moduleOffMessage = (key: ModuleKey) => `Раздел «${moduleInfo(key).title}» выключен в вашей компании. Включить его может владелец или администратор в «Функциях компании»`;

/** Что поменялось — для журнала: { sales: { from: true, to: false } }. */
export function modulesDiff(before: CompanyModules, after: CompanyModules): Partial<Record<ModuleKey, { from: boolean; to: boolean }>> {
  const out: Partial<Record<ModuleKey, { from: boolean; to: boolean }>> = {};
  for (const k of MODULE_KEYS) if (before[k] !== after[k]) out[k] = { from: before[k], to: after[k] };
  return out;
}

/** Ответ GET /company/modules. */
export interface CompanyModulesView {
  modules: CompanyModules;
  can_change: boolean;
}

/** Запись журнала «кто и когда менял функции». */
export interface ModulesHistoryEntry {
  id: number;
  created_at: string;
  actor_name: string | null;
  old_values: Partial<Record<ModuleKey, boolean>>;
  new_values: Partial<Record<ModuleKey, boolean>> & { preset?: ModulePresetKey };
}

/** «Выключил: Продажи и выплаты; включил: Чаты» — строка журнала. */
export function describeModulesChange(e: Pick<ModulesHistoryEntry, 'new_values'>): string {
  const on: string[] = [];
  const off: string[] = [];
  for (const k of MODULE_KEYS) {
    const v = e.new_values[k];
    if (v === true) on.push(moduleInfo(k).title);
    if (v === false) off.push(moduleInfo(k).title);
  }
  const parts = [off.length ? `выключил: ${off.join(', ')}` : '', on.length ? `включил: ${on.join(', ')}` : ''].filter(Boolean);
  const preset = e.new_values.preset ? MODULE_PRESETS.find((p) => p.key === e.new_values.preset)?.title : null;
  const text = parts.join('; ') || 'без изменений';
  return preset ? `Набор «${preset}» — ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
}
