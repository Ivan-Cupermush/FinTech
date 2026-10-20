import { describe, expect, it } from 'vitest';
import {
  checkIntegrationUrl,
  integrationState,
  maskSecret,
  moodleCompletionPoint,
  moodleUrl,
  nextSyncAt,
  oneCPoints,
  oneCRecords,
  oneCUrl,
  parseOneCDate,
  planSync,
  redactSecret,
  validateIntegrationConfig,
  validateMoodleConfig,
  validateOneCConfig,
  type OneCConfig,
} from '../src';

const NOW = new Date('2026-10-19T12:00:00Z');

/** Путь и параметры адреса — без URL, у ядра нет типов окружения. */
function parse(url: string) {
  const [base, qs = ''] = url.split('?');
  const path = base!.replace(/^https?:\/\/[^/]+/, '');
  const params = Object.fromEntries(qs.split('&').filter(Boolean).map((p) => p.split('=').map(decodeURIComponent) as [string, string]));
  return { path, params, qs };
}

const onec: OneCConfig = {
  base_url: 'https://1c.univ.ru/univ',
  entity: 'Document_ДоговорКонтрагента',
  date_field: 'Date',
  value_field: 'СрокСогласования',
  filter: '',
  aggregate: 'avg',
};

describe('адрес системы', () => {
  it('https подходит, http — только на этом компьютере', () => {
    expect(checkIntegrationUrl('https://1c.univ.ru/univ')).toBeNull();
    expect(checkIntegrationUrl('http://localhost:8080/univ')).toBeNull();
    expect(checkIntegrationUrl('http://127.0.0.1/univ')).toBeNull();
    expect(checkIntegrationUrl('https://1с.вуз.рф:8443/база')).toBeNull();
    expect(checkIntegrationUrl('https:///univ')).toMatch(/Не похоже/);
    expect(checkIntegrationUrl('http://1c.univ.ru/univ')).toBe('Нужен защищённый адрес https://');
  });
  it('пусто, мусор, чужие протоколы', () => {
    expect(checkIntegrationUrl('  ')).toBe('Укажите адрес');
    expect(checkIntegrationUrl('1c.univ.ru')).toMatch(/https/);
    expect(checkIntegrationUrl('ftp://1c.univ.ru')).toBe('Нужен защищённый адрес https://');
    expect(checkIntegrationUrl('javascript:alert(1)')).toBe('Нужен защищённый адрес https://');
  });
  it('логин в адресе и параметры не принимаем', () => {
    expect(checkIntegrationUrl('https://admin:pass@1c.univ.ru')).toMatch(/отдельных полях/);
    expect(checkIntegrationUrl('https://lms.univ.ru/?wstoken=abc')).toMatch(/без параметров/);
  });
});

describe('настройки 1С', () => {
  it('корректные — с адресом без «/» в конце', () => {
    const r = validateOneCConfig({ ...onec, base_url: 'https://1c.univ.ru/univ///', entity: ' Document_ДоговорКонтрагента ' });
    expect(r.errors).toEqual({});
    expect(r.config).toEqual(onec);
  });
  it('по умолчанию — среднее за день', () => {
    expect(validateOneCConfig({ ...onec, aggregate: 'median' }).config?.aggregate).toBe('avg');
  });
  it('пустые поля — ошибка у каждого', () => {
    expect(validateOneCConfig({}).errors).toEqual({
      base_url: 'Укажите адрес',
      entity: 'Укажите документ или регистр',
      date_field: 'Укажите поле с датой',
      value_field: 'Укажите поле с числом',
    });
  });
  it('имена — как в OData, без пробелов, точек и кавычек', () => {
    const r = validateOneCConfig({ ...onec, entity: "Document'; drop", date_field: 'Дата Документа', value_field: 'a/b' });
    expect(Object.keys(r.errors).sort()).toEqual(['date_field', 'entity', 'value_field']);
    expect(r.config).toBeNull();
  });
  it('для количества поле с числом не нужно', () => {
    expect(validateOneCConfig({ ...onec, aggregate: 'count', value_field: '' }).errors).toEqual({});
  });
  it('условие — в одну строку и не длиннее 500 символов', () => {
    expect(validateOneCConfig({ ...onec, filter: 'Posted eq true' }).config?.filter).toBe('Posted eq true');
    expect(validateOneCConfig({ ...onec, filter: 'a\nb' }).errors.filter).toBe('Условие пишется в одну строку');
    expect(validateOneCConfig({ ...onec, filter: 'x'.repeat(501) }).errors.filter).toBe('Не длиннее 500 символов');
  });
});

describe('настройки Moodle', () => {
  it('номер курса — целое число, строкой тоже можно', () => {
    expect(validateMoodleConfig({ base_url: 'https://lms.univ.ru/', course_id: '42' }).config).toEqual({ base_url: 'https://lms.univ.ru', course_id: 42, metric: 'completion_share' });
  });
  it('без номера курса и с дробным — ошибка', () => {
    expect(validateMoodleConfig({ base_url: 'https://lms.univ.ru' }).errors.course_id).toMatch(/course\/view\.php/);
    expect(validateMoodleConfig({ base_url: 'https://lms.univ.ru', course_id: 1.5 }).errors.course_id).toBeDefined();
    expect(validateMoodleConfig({ base_url: 'https://lms.univ.ru', course_id: 0 }).errors.course_id).toBeDefined();
  });
  it('validateIntegrationConfig выбирает проверку по виду', () => {
    expect(validateIntegrationConfig('moodle', { base_url: 'https://lms.univ.ru', course_id: 7 }).config).toMatchObject({ course_id: 7 });
    expect(validateIntegrationConfig('onec', null).errors.entity).toBeDefined();
  });
});

describe('секреты', () => {
  it('маска: последние 4 символа только у длинного', () => {
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret('')).toBeNull();
    expect(maskSecret('short')).toBe('••••');
    expect(maskSecret('a1b2c3d4e5f6g7h8')).toBe('••••g7h8');
  });
  it('токен вырезается из текста ошибки', () => {
    expect(redactSecret('GET https://lms/webservice/rest/server.php?wstoken=abc123&wsfunction=x failed', null)).toBe(
      'GET https://lms/webservice/rest/server.php?wstoken=••••&wsfunction=x failed',
    );
    expect(redactSecret('Ошибка входа: пароль s3cr3t-pass неверен', 's3cr3t-pass')).toBe('Ошибка входа: пароль •••• неверен');
  });
});

describe('ответ 1С', () => {
  it('даты: ISO без зоны — время базы (Москва), старый формат /Date(мс)/', () => {
    expect(parseOneCDate('2026-10-12T00:00:00')).toEqual({ day: '2026-10-12', at: '2026-10-11T21:00:00.000Z' });
    expect(parseOneCDate('/Date(1760000000000)/')).toEqual({ day: '2025-10-09', at: '2025-10-09T08:53:20.000Z' });
    expect(parseOneCDate('/Date(1760000000000+0300)/')?.at).toBe('2025-10-09T08:53:20.000Z');
    expect(parseOneCDate('0001-01-01T00:00:00')).toBeNull();
    expect(parseOneCDate(null)).toBeNull();
  });
  it('записи из OData v3/v4 и verbose', () => {
    expect(oneCRecords({ value: [{ a: 1 }, 'x', null] })).toEqual([{ a: 1 }]);
    expect(oneCRecords({ d: { results: [{ a: 2 }] } })).toEqual([{ a: 2 }]);
    expect(oneCRecords({ 'odata.error': { message: 'x' } })).toBeNull();
    expect(oneCRecords('<html>')).toBeNull();
  });
  it('несколько договоров за день → среднее, момент — последняя запись дня', () => {
    const r = oneCPoints(
      [
        { Date: '2026-10-12T10:00:00', СрокСогласования: 10 },
        { Date: '2026-10-12T15:30:00', СрокСогласования: '8,5' },
        { Date: '2026-10-13T09:00:00', СрокСогласования: 7 },
      ],
      onec,
    );
    expect(r).toEqual({
      records: 3,
      invalid: 0,
      points: [
        { at: '2026-10-12T12:30:00.000Z', value: 9.25 },
        { at: '2026-10-13T06:00:00.000Z', value: 7 },
      ],
    });
  });
  it('сумма, количество и последнее значение', () => {
    const rows = [
      { Date: '2026-10-12T10:00:00', V: 3 },
      { Date: '2026-10-12T09:00:00', V: 5 },
    ];
    const cfg = { date_field: 'Date', value_field: 'V' };
    expect(oneCPoints(rows, { ...cfg, aggregate: 'sum' }).points[0]!.value).toBe(8);
    expect(oneCPoints(rows, { ...cfg, aggregate: 'count' }).points[0]!.value).toBe(2);
    expect(oneCPoints(rows, { ...cfg, aggregate: 'last' }).points[0]!.value).toBe(3);
  });
  it('записи без даты или числа считаются, но не попадают в замеры', () => {
    const r = oneCPoints([{ Date: 'вчера', СрокСогласования: 1 }, { Date: '2026-10-12', СрокСогласования: 'н/д' }, { Date: '2026-10-12', СрокСогласования: 4 }], onec);
    expect(r.invalid).toBe(2);
    expect(r.points).toHaveLength(1);
  });
  it('дни идут по порядку, длинные дроби округляются до 4 знаков', () => {
    const r = oneCPoints(
      [
        { Date: '2026-10-14', V: 1 },
        { Date: '2026-10-12', V: 1 },
        { Date: '2026-10-12', V: 2 },
        { Date: '2026-10-12', V: 2 },
      ],
      { date_field: 'Date', value_field: 'V', aggregate: 'avg' },
    );
    expect(r.points.map((p) => p.value)).toEqual([1.6667, 1]);
  });
});

describe('запрос к 1С', () => {
  it('только нужные поля, по порядку дат', () => {
    const u = parse(oneCUrl(onec, null));
    expect(u.path).toBe(`/univ/odata/standard.odata/${encodeURIComponent('Document_ДоговорКонтрагента')}`);
    expect(u.params).toEqual({ $format: 'json', $select: 'Date,СрокСогласования', $orderby: 'Date' });
  });
  it('после первой синхронизации — с прошлого раза минус день, плюс своё условие', () => {
    const u = parse(oneCUrl({ ...onec, filter: 'Posted eq true' }, '2026-10-18T12:00:00Z'));
    expect(u.params.$filter).toBe("Date ge datetime'2026-10-17T15:00:00' and (Posted eq true)");
    expect(u.qs).toContain('%20');
    expect(u.qs).not.toContain('+');
  });
  it('для количества поле значения не запрашиваем', () => {
    expect(parse(oneCUrl({ ...onec, aggregate: 'count' }, null)).params.$select).toBe('Date');
  });
});

describe('Moodle', () => {
  it('адрес веб-сервиса с форматом JSON', () => {
    const u = parse(moodleUrl({ base_url: 'https://lms.univ.ru' }, 'tok', 'core_enrol_get_enrolled_users', { courseid: 42 }));
    expect(u.path).toBe('/webservice/rest/server.php');
    expect(u.params).toEqual({ wstoken: 'tok', wsfunction: 'core_enrol_get_enrolled_users', moodlewsrestformat: 'json', courseid: '42' });
  });
  it('доля завершивших — с одним знаком', () => {
    expect(moodleCompletionPoint({ enrolled: 3, completed: 2 }, NOW)).toEqual({ at: NOW.toISOString(), value: 66.7 });
    expect(moodleCompletionPoint({ enrolled: 0, completed: 0 }, NOW)).toBeNull();
    expect(moodleCompletionPoint({ enrolled: 2, completed: 5 }, NOW)!.value).toBe(100);
  });
});

describe('planSync', () => {
  const at = (day: string) => `${day}T09:00:00.000Z`;
  it('один замер за день, уже имеющиеся дни пропускаются', () => {
    const p = planSync(
      [
        { at: at('2026-10-12'), value: 9 },
        { at: at('2026-10-13'), value: 8 },
      ],
      { unit: 'days', now: NOW, existingDays: ['2026-10-12'] },
    );
    expect(p).toEqual({ observations: [{ at: at('2026-10-13'), value: 8 }], duplicates: 1, rejected: [] });
  });
  it('будущее и значения вне единицы — отклоняются с причиной', () => {
    const p = planSync(
      [
        { at: at('2026-10-25'), value: 1 },
        { at: at('2026-10-14'), value: -3 },
      ],
      { unit: 'days', now: NOW },
    );
    expect(p.observations).toEqual([]);
    expect(p.rejected).toEqual([
      { day: '2026-10-25', reason: 'Дата из будущего' },
      { day: '2026-10-14', reason: 'Значение в единицах «Дни» не может быть отрицательным' },
    ]);
  });
  it('повтор дня внутри одной пачки — один замер', () => {
    const p = planSync(
      [
        { at: '2026-10-12T06:00:00Z', value: 1 },
        { at: '2026-10-12T10:00:00Z', value: 2 },
      ],
      { unit: 'count', now: NOW },
    );
    expect(p.observations).toHaveLength(1);
    expect(p.duplicates).toBe(1);
  });
});

describe('состояние и расписание', () => {
  it('выключена, не запускалась, ошибка, работает', () => {
    expect(integrationState({ enabled: false, last_sync_at: null, last_error: 'x' })).toBe('paused');
    expect(integrationState({ enabled: true, last_sync_at: null, last_error: null })).toBe('never');
    expect(integrationState({ enabled: true, last_sync_at: '2026-10-19T10:00:00Z', last_error: '401' })).toBe('error');
    expect(integrationState({ enabled: true, last_sync_at: '2026-10-19T10:00:00Z', last_error: null })).toBe('ok');
  });
  it('следующая синхронизация — через интервал после прошлой, первая — сразу', () => {
    expect(nextSyncAt({ enabled: true, last_sync_at: '2026-10-19T10:00:00.000Z', interval_hours: 24 }, NOW)).toBe('2026-10-20T10:00:00.000Z');
    expect(nextSyncAt({ enabled: true, last_sync_at: null, interval_hours: 24 }, NOW)).toBe(NOW.toISOString());
    expect(nextSyncAt({ enabled: false, last_sync_at: null, interval_hours: 24 }, NOW)).toBeNull();
  });
});
