import { COMPANY_ROLE_LABELS, COMPANY_ROLES, type CompanyRole } from './access';
import type { OrgUnit, UnitType } from './org';
import { toCsv } from './report';
import { plural } from './units';

/**
 * Импорт сотрудников и структуры из Excel или CSV: пилот начинается с того,
 * что в offix появляется вся организация, а не один владелец. Здесь — чистая
 * логика: какие колонки что значат, что получится из каждой строки и какие
 * подразделения придётся создать. Сервер проверяет то же самое ещё раз
 * (почта уникальна во всей системе, это видно только ему).
 */

/** Больше за раз не берём: на сервере в 1 CPU каждый пароль — это bcrypt. */
export const PEOPLE_IMPORT_MAX_ROWS = 300;
/** Глубина пути «Институт / Кафедра / Лаборатория». */
export const PEOPLE_IMPORT_MAX_DEPTH = 6;

export type PeopleField = 'last_name' | 'first_name' | 'middle_name' | 'name' | 'email' | 'position' | 'unit' | 'manager' | 'role';

export const PEOPLE_FIELD_LABELS: Record<PeopleField, string> = {
  name: 'ФИО целиком',
  last_name: 'Фамилия',
  first_name: 'Имя',
  middle_name: 'Отчество',
  email: 'Почта',
  position: 'Должность',
  unit: 'Подразделение',
  manager: 'Руководитель подразделения',
  role: 'Роль в offix',
};

/** Колонка таблицы → поле; -1 — не используется. */
export type PeopleMapping = Record<PeopleField, number>;

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}@]+/gu, ' ').trim();

/** Что обычно пишут в шапке. Порядок важен: «ФИО руководителя» не должна стать ФИО. */
const HEADER_HINTS: [PeopleField, RegExp][] = [
  ['manager', /^(руковод|рук |рук$|начальник|глава|manager|head|is manager|заведующ)/],
  ['email', /(почт|e ?mail|email|mail|логин|login)/],
  ['last_name', /^фамил|^last ?name|^surname/],
  ['first_name', /^имя$|^first ?name|^given/],
  ['middle_name', /^отчеств|^middle/],
  ['name', /(фио|сотрудник|работник|^имя|full ?name|^name$|^person|преподавател)/],
  ['position', /(должн|позиц|position|title|job)/],
  ['unit', /(подраздел|отдел|кафедр|департ|служб|структур|институт|факультет|филиал|направлен|команд|unit|department|team|division)/],
  ['role', /(роль|role|права|доступ)/],
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (s: string) => EMAIL_RE.test(s.trim());

const emptyMapping = (): PeopleMapping => ({ last_name: -1, first_name: -1, middle_name: -1, name: -1, email: -1, position: -1, unit: -1, manager: -1, role: -1 });

/**
 * Догадка о колонках: сначала по шапке, затем по содержимому — колонка, где
 * в основном почты, становится «Почтой», а первая текстовая — ФИО.
 */
export function guessPeopleColumns(columns: readonly string[], rows: readonly (readonly string[])[], hasHeader = true): PeopleMapping {
  const m = emptyMapping();
  const used = new Set<number>();
  if (hasHeader) {
    for (const [field, re] of HEADER_HINTS) {
      const i = columns.findIndex((c, k) => !used.has(k) && re.test(norm(c)));
      if (i >= 0) {
        m[field] = i;
        used.add(i);
      }
    }
  }
  const width = columns.length;
  const share = (col: number, test: (s: string) => boolean) => {
    const filled = rows.map((r) => r[col] ?? '').filter((s) => s.trim());
    return filled.length ? filled.filter(test).length / filled.length : 0;
  };
  if (m.email < 0) {
    for (let i = 0; i < width; i++) if (!used.has(i) && share(i, isEmail) >= 0.6) {
      m.email = i;
      used.add(i);
      break;
    }
  }
  if (m.name < 0 && m.last_name < 0) {
    for (let i = 0; i < width; i++)
      if (!used.has(i) && share(i, (s) => /\p{L}/u.test(s) && !isEmail(s)) >= 0.6) {
        m.name = i;
        used.add(i);
        break;
      }
  }
  return m;
}

/** «Да», «+», «1», «руководитель» — руководитель подразделения. */
export function parseYes(raw: string | undefined): boolean {
  const s = norm(raw ?? '');
  return /^(да|д|yes|y|true|1|руководитель|рук|начальник|заведующий|head|manager|x|х|v)$/.test(s) || (raw ?? '').trim() === '+' || (raw ?? '').trim() === '✓';
}

const ROLE_WORDS: [CompanyRole, RegExp][] = [
  ['admin', /^(администратор|админ|admin|administrator)$/],
  ['manager', /^(руководитель|менеджер|manager)$/],
  ['observer', /^(наблюдатель|observer|гость|guest)$/],
  ['member', /^(сотрудник|участник|member|employee|работник)$/],
  ['owner', /^(владелец|owner)$/],
];

/** Роль из ячейки; пусто — null (тогда роль выводится), непонятно — undefined. */
export function parseRole(raw: string | undefined): CompanyRole | null | undefined {
  const s = norm(raw ?? '');
  if (!s) return null;
  for (const [role, re] of ROLE_WORDS) if (re.test(s)) return role;
  return undefined;
}

/** «Институт экономики / Кафедра финансов» → ['Институт экономики', 'Кафедра финансов']. */
export function splitUnitPath(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/\s*(?:\/|>|→|\\|»|\|)\s*/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const unitKey = (path: readonly string[]) => path.map((p) => norm(p)).join(' / ');

export type PeopleRowStatus = 'new' | 'exists' | 'error';

export interface PeopleRow {
  /** Номер строки в файле (с 1, с учётом шапки). */
  line: number;
  name: string;
  email: string;
  position: string | null;
  unit_path: string[];
  is_manager: boolean;
  role: CompanyRole;
  status: PeopleRowStatus;
  /** Почему строка не годится или что с ней будет. */
  note: string | null;
}

export interface NewUnit {
  path: string[];
  name: string;
  unit_type: UnitType;
  /** Родитель — уже существующее подразделение (id) или новое (по пути). */
  parent_id: string | null;
  parent_path: string[] | null;
}

export interface PeoplePlan {
  rows: PeopleRow[];
  units: NewUnit[];
  counts: { new: number; exists: number; error: number; units: number; managers: number };
  /** Строк больше лимита — лишние не берём. */
  truncated: boolean;
}

export interface PeoplePlanContext {
  /** Почты, которые уже есть в этой компании (в любом регистре). */
  companyEmails: readonly string[];
  /** Почты, занятые в других организациях: знает только сервер. */
  takenEmails?: readonly string[];
  /** Существующие подразделения компании (архивные не берём). */
  units: readonly OrgUnit[];
  /** Роль того, кто импортирует: владельца назначает только владелец. */
  actorRole: CompanyRole;
}

/**
 * Существующие подразделения по пути из имён: «Институт / Кафедра». Узел
 * можно назвать и одним именем, если такое имя в компании одно.
 */
export function unitIndex(units: readonly OrgUnit[]): Map<string, OrgUnit> {
  const live = units.filter((u) => u.status !== 'archived');
  const byId = new Map(live.map((u) => [u.id, u]));
  const out = new Map<string, OrgUnit>();
  const shortCount = new Map<string, number>();
  for (const u of live) shortCount.set(unitKey([u.name]), (shortCount.get(unitKey([u.name])) ?? 0) + 1);
  for (const u of live) {
    const path: string[] = [];
    let cur: OrgUnit | undefined = u;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.unshift(cur.name);
      cur = cur.parent_unit_id ? byId.get(cur.parent_unit_id) : undefined;
    }
    out.set(unitKey(path), u);
  }
  for (const u of live) {
    const short = unitKey([u.name]);
    if (shortCount.get(short) === 1 && !out.has(short)) out.set(short, u);
  }
  return out;
}

/**
 * План импорта: что будет с каждой строкой и какие подразделения появятся.
 * Ничего не меняет — сервер выполняет этот же план после подтверждения.
 */
export function planPeopleImport(rows: readonly (readonly string[])[], lines: readonly number[], mapping: PeopleMapping, ctx: PeoplePlanContext): PeoplePlan {
  const cell = (r: readonly string[], f: PeopleField) => (mapping[f] >= 0 ? (r[mapping[f]] ?? '').replace(/\s+/g, ' ').trim() : '');
  const inCompany = new Set(ctx.companyEmails.map((e) => e.trim().toLowerCase()));
  const taken = new Set((ctx.takenEmails ?? []).map((e) => e.trim().toLowerCase()));
  const existing = unitIndex(ctx.units);
  const seenEmails = new Map<string, number>();
  const newUnits = new Map<string, NewUnit>();
  const truncated = rows.length > PEOPLE_IMPORT_MAX_ROWS;

  const resolveUnit = (path: string[]): string | null => {
    // Существующий узел целиком или по одному имени — ничего не создаём.
    if (existing.has(unitKey(path))) return null;
    let parentId: string | null = null;
    let parentPath: string[] | null = null;
    for (let depth = 1; depth <= path.length; depth++) {
      const sub = path.slice(0, depth);
      const key = unitKey(sub);
      const found = existing.get(key);
      if (found) {
        parentId = found.id;
        parentPath = null;
        continue;
      }
      if (!newUnits.has(key)) {
        const parentType = parentId ? ctx.units.find((u) => u.id === parentId)?.unit_type : null;
        newUnits.set(key, {
          path: sub,
          name: sub[sub.length - 1]!,
          // Под командой — только команда; иначе всё новое — подразделения,
          // а верхний уровень с вложенными узлами станет направлением ниже.
          unit_type: parentType === 'team' ? 'team' : 'department',
          parent_id: parentId,
          parent_path: parentPath,
        });
      }
      parentId = null;
      parentPath = sub;
    }
    return unitKey(path);
  };

  const out: PeopleRow[] = rows.slice(0, PEOPLE_IMPORT_MAX_ROWS).map((r, i) => {
    const fio = [cell(r, 'last_name'), cell(r, 'first_name'), cell(r, 'middle_name')].filter(Boolean).join(' ');
    const name = cell(r, 'name') || fio;
    const email = cell(r, 'email').toLowerCase();
    const position = cell(r, 'position') || null;
    const unit_path = splitUnitPath(cell(r, 'unit'));
    const is_manager = parseYes(cell(r, 'manager'));
    const parsedRole = parseRole(cell(r, 'role'));
    const role: CompanyRole = parsedRole ?? (is_manager ? 'manager' : 'member');
    const row: PeopleRow = { line: lines[i] ?? i + 1, name, email, position, unit_path, is_manager, role, status: 'new', note: null };
    const fail = (note: string): PeopleRow => ({ ...row, status: 'error', note });

    if (!name) return fail('Нет имени');
    if (name.length > 1000) return fail('Слишком длинное имя');
    if (!email) return fail('Нет почты — по ней сотрудник входит');
    if (!isEmail(email) || email.length > 254) return fail(`Почта «${email}» выглядит неверно`);
    if (parsedRole === undefined) return fail(`Роль «${cell(r, 'role')}» не знаем: ${COMPANY_ROLES.filter((x) => x !== 'owner').map((x) => COMPANY_ROLE_LABELS[x].toLowerCase()).join(', ')}`);
    if (role === 'owner' && ctx.actorRole !== 'owner') return fail('Назначить владельца может только владелец');
    if (role === 'owner') return fail('Владелец в компании один — назначьте его в «Организации»');
    if (position && position.length > 120) return fail('Должность длиннее 120 символов');
    if (unit_path.length > PEOPLE_IMPORT_MAX_DEPTH) return fail(`Подразделение глубже ${PEOPLE_IMPORT_MAX_DEPTH} уровней`);
    if (unit_path.some((p) => p.length > 150)) return fail('Название подразделения длиннее 150 символов');
    if (is_manager && !unit_path.length) return fail('Руководитель чего? Укажите подразделение');
    const first = seenEmails.get(email);
    if (first !== undefined) return fail(`Почта уже была в строке ${first}`);
    seenEmails.set(email, row.line);
    if (inCompany.has(email)) return { ...row, status: 'exists', note: 'Уже в компании — пропустим' };
    if (taken.has(email)) return fail('Почта занята в другой организации offix');
    if (unit_path.length) resolveUnit(unit_path);
    return row;
  });

  // Узел, у которого есть новые дети, — направление, если сам на верхнем уровне.
  const units = [...newUnits.values()];
  for (const u of units) {
    const hasKids = units.some((c) => c.parent_path && unitKey(c.parent_path) === unitKey(u.path));
    if (hasKids && !u.parent_id && !u.parent_path) u.unit_type = 'division';
  }
  // Подразделения, нужные только строкам с ошибками, не создаём.
  const wanted = new Set<string>();
  for (const r of out) if (r.status === 'new') for (let d = 1; d <= r.unit_path.length; d++) wanted.add(unitKey(r.unit_path.slice(0, d)));
  const finalUnits = units.filter((u) => wanted.has(unitKey(u.path)));

  return {
    rows: out,
    units: finalUnits,
    counts: {
      new: out.filter((r) => r.status === 'new').length,
      exists: out.filter((r) => r.status === 'exists').length,
      error: out.filter((r) => r.status === 'error').length,
      units: finalUnits.length,
      managers: out.filter((r) => r.status === 'new' && r.is_manager).length,
    },
    truncated,
  };
}

/** Ключ пути подразделения для сервера: сопоставить строку с созданным узлом. */
export const unitPathKey = unitKey;

/** Итог плана одной строкой: «Добавим 42 сотрудника и 7 подразделений, 2 строки с ошибками». */
export function peoplePlanSummary(p: PeoplePlan): string {
  const parts = [`Добавим ${p.counts.new} ${plural(p.counts.new, ['сотрудника', 'сотрудника', 'сотрудников'])}`];
  if (p.counts.units) parts[0] += ` и ${p.counts.units} ${plural(p.counts.units, ['подразделение', 'подразделения', 'подразделений'])}`;
  if (p.counts.exists) parts.push(`${p.counts.exists} уже в компании`);
  if (p.counts.error) parts.push(`${p.counts.error} ${plural(p.counts.error, ['строка', 'строки', 'строк'])} с ошибками`);
  return parts.join(', ');
}

/** Образец файла для скачивания: шапка и три строки. */
export function peopleTemplateCsv(): string {
  return toCsv([
    ['ФИО', 'Почта', 'Должность', 'Подразделение', 'Руководитель', 'Роль'],
    ['Звездин Алексей Петрович', 'rector@university.ru', 'Ректор', '', '', 'Администратор'],
    ['Кольцова Мария Игоревна', 'koltsova@university.ru', 'Директор института', 'Институт экономики', 'да', ''],
    ['Петров Иван Сергеевич', 'petrov@university.ru', 'Доцент', 'Институт экономики / Кафедра финансов', '', ''],
  ]);
}

export interface ImportedCredential {
  name: string;
  email: string;
  password: string;
}

/** Временные пароли — один раз, файлом для Excel. В offix они хранятся только хешем. */
export function credentialsCsv(list: readonly ImportedCredential[], site: string): string {
  return toCsv([['ФИО', 'Почта (логин)', 'Временный пароль', 'Где войти'], ...list.map((c) => [c.name, c.email, c.password, site])]);
}

/**
 * На сервер — только нужные колонки и не больше лимита строк: таблица из
 * учётной системы бывает в 40 колонок, а запросу хватает шести.
 */
export function compactPeopleRows(rows: readonly (readonly string[])[], lines: readonly number[], mapping: PeopleMapping): { rows: string[][]; lines: number[]; mapping: PeopleMapping } {
  const cols = [...new Set(Object.values(mapping).filter((c) => c >= 0))].sort((a, b) => a - b);
  const remap = new Map(cols.map((c, i) => [c, i]));
  const next = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v >= 0 ? remap.get(v)! : -1])) as PeopleMapping;
  const n = Math.min(rows.length, PEOPLE_IMPORT_MAX_ROWS);
  return {
    rows: rows.slice(0, n).map((r) => cols.map((c) => (r[c] ?? '').slice(0, 2000))),
    lines: lines.slice(0, n),
    mapping: next,
  };
}
