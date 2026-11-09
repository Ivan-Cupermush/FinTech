import { describe, expect, it } from 'vitest';
import {
  compactPeopleRows,
  credentialsCsv,
  guessPeopleColumns,
  parseRole,
  parseTable,
  parseYes,
  peoplePlanSummary,
  peopleTemplateCsv,
  planPeopleImport,
  PEOPLE_IMPORT_MAX_ROWS,
  splitUnitPath,
  type OrgUnit,
  type PeoplePlanContext,
} from '../src';

const UNITS: OrgUnit[] = [
  { id: 'u-inst', parent_unit_id: null, name: 'Институт экономики', unit_type: 'division' },
  { id: 'u-fin', parent_unit_id: 'u-inst', name: 'Кафедра финансов', unit_type: 'department' },
  { id: 'u-it', parent_unit_id: null, name: 'IT-отдел', unit_type: 'team' },
  { id: 'u-old', parent_unit_id: null, name: 'Архивный отдел', unit_type: 'department', status: 'archived' },
];
const ctx = (over: Partial<PeoplePlanContext> = {}): PeoplePlanContext => ({ companyEmails: ['rector@uni.ru'], units: UNITS, actorRole: 'admin', ...over });

const plan = (text: string, over: Partial<PeoplePlanContext> = {}) => {
  const t = parseTable(text);
  return planPeopleImport(t.rows, t.lines, guessPeopleColumns(t.columns, t.rows, t.hasHeader), ctx(over));
};

describe('колонки файла с сотрудниками', () => {
  it('шапка по-русски и по-английски', () => {
    expect(guessPeopleColumns(['ФИО', 'Эл. почта', 'Должность', 'Кафедра', 'Руководитель?', 'Роль'], [])).toMatchObject({ name: 0, email: 1, position: 2, unit: 3, manager: 4, role: 5 });
    expect(guessPeopleColumns(['Full name', 'E-mail', 'Job title', 'Department'], [])).toMatchObject({ name: 0, email: 1, position: 2, unit: 3, manager: -1 });
  });
  it('фамилия, имя и отчество в разных колонках', () => {
    expect(guessPeopleColumns(['Фамилия', 'Имя', 'Отчество', 'Почта'], [])).toMatchObject({ last_name: 0, first_name: 1, middle_name: 2, email: 3, name: -1 });
  });
  it('«ФИО руководителя» — не ФИО сотрудника', () => {
    const m = guessPeopleColumns(['Руководитель (ФИО)', 'Сотрудник', 'Почта'], []);
    expect(m.manager).toBe(0);
    expect(m.name).toBe(1);
  });
  it('без шапки — почту и имя узнаём по содержимому', () => {
    const rows = [
      ['12', 'Иванов Иван', 'ivanov@uni.ru'],
      ['13', 'Петрова Анна', 'petrova@uni.ru'],
    ];
    expect(guessPeopleColumns(['Колонка 1', 'Колонка 2', 'Колонка 3'], rows, false)).toMatchObject({ name: 1, email: 2 });
  });
});

describe('ячейки', () => {
  it('«да» и роль', () => {
    for (const y of ['да', 'Да', '+', '1', 'yes', 'руководитель', 'X']) expect(parseYes(y)).toBe(true);
    for (const n of ['', 'нет', '0', '-']) expect(parseYes(n)).toBe(false);
    expect(parseRole('Администратор')).toBe('admin');
    expect(parseRole('наблюдатель')).toBe('observer');
    expect(parseRole('')).toBeNull();
    expect(parseRole('бухгалтер')).toBeUndefined();
  });
  it('путь подразделения: «/», «>», «→» и лишние пробелы', () => {
    expect(splitUnitPath(' Институт экономики /  Кафедра  финансов ')).toEqual(['Институт экономики', 'Кафедра финансов']);
    expect(splitUnitPath('А > Б → В')).toEqual(['А', 'Б', 'В']);
    expect(splitUnitPath('')).toEqual([]);
  });
});

describe('план импорта', () => {
  const FILE = [
    'ФИО\tПочта\tДолжность\tПодразделение\tРуководитель\tРоль',
    'Кольцова Мария\tKoltsova@Uni.ru\tДиректор\tИнститут экономики\tда\t',
    'Петров Иван\tpetrov@uni.ru\tДоцент\tИнститут экономики / Кафедра финансов\t\t',
    'Сидоров Олег\tsidorov@uni.ru\tЗав. лабораторией\tИнститут экономики / Кафедра финансов / Лаборатория ИИ\tда\t',
    'Новая Анна\tnovaya@uni.ru\tДекан\tФакультет права / Кафедра гражданского права\t\t',
    'Ректор\trector@uni.ru\tРектор\t\t\t',
    'Без почты\t\tИнженер\t\t\t',
    'Дубль\tpetrov@uni.ru\t\t\t\t',
    'Плохая почта\tpetrov(at)uni.ru\t\t\t\t',
    'Странная роль\tstrange@uni.ru\t\t\t\tбухгалтер',
    'Девопс\tdevops@uni.ru\t\tIT-отдел / Инфраструктура\t\t',
  ].join('\n');

  it('строки: новые, уже в компании и с понятными ошибками', () => {
    const p = plan(FILE);
    const by = (name: string) => p.rows.find((r) => r.name === name)!;
    expect(by('Кольцова Мария')).toMatchObject({ status: 'new', email: 'koltsova@uni.ru', is_manager: true, role: 'manager', unit_path: ['Институт экономики'] });
    expect(by('Петров Иван')).toMatchObject({ status: 'new', role: 'member' });
    expect(by('Ректор')).toMatchObject({ status: 'exists' });
    expect(by('Без почты').note).toMatch(/Нет почты/);
    expect(by('Дубль').note).toBe('Почта уже была в строке 3');
    expect(by('Плохая почта').note).toMatch(/выглядит неверно/);
    expect(by('Странная роль').note).toMatch(/Роль «бухгалтер» не знаем/);
    expect(p.counts).toMatchObject({ new: 5, exists: 1, error: 4 });
    expect(p.rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('подразделения: существующие находятся по пути, новые создаются по уровням', () => {
    const p = plan(FILE);
    const paths = p.units.map((u) => u.path.join(' / '));
    expect(paths).toEqual(['Институт экономики / Кафедра финансов / Лаборатория ИИ', 'Факультет права', 'Факультет права / Кафедра гражданского права', 'IT-отдел / Инфраструктура']);
    const lab = p.units[0]!;
    expect(lab).toMatchObject({ parent_id: 'u-fin', parent_path: null, unit_type: 'department' });
    // Новый верхний уровень со вложенным узлом — направление.
    expect(p.units[1]).toMatchObject({ unit_type: 'division', parent_id: null, parent_path: null });
    expect(p.units[2]).toMatchObject({ unit_type: 'department', parent_id: null, parent_path: ['Факультет права'] });
    // Внутри команды — только команда.
    expect(p.units[3]).toMatchObject({ unit_type: 'team', parent_id: 'u-it' });
  });

  it('узел можно назвать одним именем, если оно в компании одно; архивные не считаются', () => {
    const p = plan('ФИО;Почта;Отдел\nА Б;a@uni.ru;Кафедра финансов\nВ Г;v@uni.ru;Архивный отдел');
    expect(p.units.map((u) => u.name)).toEqual(['Архивный отдел']);
  });

  it('ФИО из трёх колонок; руководитель без подразделения — ошибка', () => {
    const p = plan('Фамилия;Имя;Отчество;Почта;Руководитель\nИванов;Иван;Иванович;i@uni.ru;\nПетров;Пётр;;p@uni.ru;да');
    expect(p.rows[0]).toMatchObject({ name: 'Иванов Иван Иванович', status: 'new' });
    expect(p.rows[1]!.note).toMatch(/Руководитель чего/);
  });

  it('владельца импортом не назначить; почта из другой организации — ошибка', () => {
    const p = plan('ФИО;Почта;Роль\nА;a@uni.ru;владелец\nБ;b@other.ru;', { takenEmails: ['B@other.ru'] });
    expect(p.rows[0]!.note).toMatch(/только владелец/);
    expect(p.rows[1]!.note).toMatch(/занята в другой организации/);
    const own = plan('ФИО;Почта;Роль\nА;a@uni.ru;владелец', { actorRole: 'owner' });
    expect(own.rows[0]!.note).toMatch(/Владелец в компании один/);
  });

  it('подразделения только для строк с ошибками не создаём', () => {
    const p = plan('ФИО;Почта;Отдел\nА;плохо;Новый отдел');
    expect(p.units).toEqual([]);
  });

  it('лимит строк', () => {
    const rows = Array.from({ length: PEOPLE_IMPORT_MAX_ROWS + 5 }, (_, i) => [`Сотрудник ${i}`, `s${i}@uni.ru`]);
    const p = planPeopleImport(rows, rows.map((_, i) => i + 2), guessPeopleColumns(['ФИО', 'Почта'], rows), ctx());
    expect(p.truncated).toBe(true);
    expect(p.rows).toHaveLength(PEOPLE_IMPORT_MAX_ROWS);
  });

  it('итог одной строкой', () => {
    expect(peoplePlanSummary(plan(FILE))).toBe('Добавим 5 сотрудников и 4 подразделения, 1 уже в компании, 4 строки с ошибками');
    expect(peoplePlanSummary(plan('ФИО;Почта\nА;a@uni.ru'))).toBe('Добавим 1 сотрудника');
  });
});

describe('файлы', () => {
  it('образец разбирается нашим же импортом без ошибок', () => {
    const p = plan(peopleTemplateCsv(), { companyEmails: [] });
    expect(p.counts).toMatchObject({ new: 3, error: 0 });
    expect(p.rows[0]!.role).toBe('admin');
  });
  it('пароли — CSV для Excel с защитой от формул', () => {
    const csv = credentialsCsv([{ name: '=HYPERLINK("x")', email: 'a@uni.ru', password: 'Xy-12' }], 'https://offix.example.ru');
    expect(csv.startsWith('﻿ФИО;Почта (логин);Временный пароль;Где войти')).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('Xy-12');
  });
});

describe('отправка на сервер', () => {
  it('только нужные колонки, номера колонок пересчитаны, план тот же', () => {
    const rows = [['x', 'Иванов Иван', 'мусор', 'i@uni.ru', 'y', 'Кафедра финансов']];
    const m = { ...guessPeopleColumns(['id', 'ФИО', 'Комментарий', 'Почта', 'Табельный', 'Подразделение'], rows) };
    const c = compactPeopleRows(rows, [2], m);
    expect(c.rows).toEqual([['Иванов Иван', 'i@uni.ru', 'Кафедра финансов']]);
    expect(c.mapping).toMatchObject({ name: 0, email: 1, unit: 2, position: -1 });
    expect(planPeopleImport(c.rows, c.lines, c.mapping, ctx()).rows[0]).toEqual(planPeopleImport(rows, [2], m, ctx()).rows[0]);
  });
});
