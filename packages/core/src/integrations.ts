import { observationDay, parseLooseDate, parseLooseNumber } from './import';
import { checkUnitRange, type UnitId } from './units';

/**
 * Интеграции: замеры KPI приходят сами из учётных систем вуза.
 *
 *  - 1С:Предприятие — через стандартный OData-интерфейс публикации базы.
 *    Берём записи документа или регистра, из них дату и число, за день
 *    считаем одно значение (среднее, сумму или последнее).
 *  - Moodle — через веб-сервисы: доля слушателей курса, завершивших его.
 *
 * Правило то же, что у импорта из таблиц: за день у KPI один замер, повторная
 * синхронизация ничего не задваивает. Здесь только чистая логика: проверка
 * настроек и превращение ответа системы в замеры. Сеть — на сервере.
 */

export const INTEGRATION_KINDS = ['onec', 'moodle'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const INTEGRATION_KIND_LABELS: Record<IntegrationKind, { title: string; hint: string }> = {
  onec: { title: '1С:Предприятие', hint: 'Документы и регистры через OData: сроки, суммы, количество' },
  moodle: { title: 'Moodle', hint: 'Доля слушателей, завершивших курс' },
};

/** Как свести несколько записей 1С за один день в один замер. */
export const ONEC_AGGREGATES = ['avg', 'sum', 'count', 'last'] as const;
export type OneCAggregate = (typeof ONEC_AGGREGATES)[number];

export const ONEC_AGGREGATE_LABELS: Record<OneCAggregate, string> = {
  avg: 'Среднее за день',
  sum: 'Сумма за день',
  count: 'Количество записей за день',
  last: 'Последнее значение дня',
};

export const MOODLE_METRICS = ['completion_share'] as const;
export type MoodleMetric = (typeof MOODLE_METRICS)[number];

export const MOODLE_METRIC_LABELS: Record<MoodleMetric, string> = {
  completion_share: 'Доля завершивших курс, %',
};

export interface OneCConfig {
  /** Адрес публикации базы, например https://1c.univ.ru/univ. */
  base_url: string;
  /** Набор сущностей OData: Document_ДоговорКонтрагента, AccumulationRegister_… */
  entity: string;
  date_field: string;
  /** Поле с числом. Для aggregate = count не нужно. */
  value_field: string;
  /** Дополнительное условие OData, например Posted eq true. */
  filter: string;
  aggregate: OneCAggregate;
}

export interface MoodleConfig {
  /** Адрес Moodle, например https://lms.univ.ru. */
  base_url: string;
  course_id: number;
  metric: MoodleMetric;
}

export type IntegrationConfig = OneCConfig | MoodleConfig;

/** Как часто синхронизировать, часов. */
export const SYNC_INTERVALS = [1, 6, 24, 168] as const;
export const SYNC_INTERVAL_LABELS: Record<(typeof SYNC_INTERVALS)[number], string> = {
  1: 'Каждый час',
  6: 'Каждые 6 часов',
  24: 'Раз в день',
  168: 'Раз в неделю',
};

/**
 * Адрес системы: только https. Исключение — http на этом же компьютере для
 * проверки и демо: пароли по открытой сети не отправляем.
 */
export function checkIntegrationUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'Укажите адрес';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)?.[1]?.toLowerCase();
  if (!scheme) return 'Не похоже на адрес: начните с https://';
  const m = URL_RE.exec(s);
  if (scheme !== 'https' && scheme !== 'http') return 'Нужен защищённый адрес https://';
  if (!m) return 'Не похоже на адрес: начните с https://';
  const [, , authority = '', , query, hash] = m;
  if (authority.includes('@')) return 'Логин и пароль укажите в отдельных полях, а не в адресе';
  if (query || hash) return 'Укажите адрес без параметров после «?» и «#»';
  const host = authority.replace(/:\d{1,5}$/, '').toLowerCase();
  if (!HOST_RE.test(host)) return 'Не похоже на адрес: начните с https://';
  if (scheme === 'https') return null;
  if (LOCAL_HOSTS.has(host)) return null;
  return 'Нужен защищённый адрес https://';
}

/** схема://хост[:порт]/путь?запрос#якорь — без зависимости от URL, ядро работает и в приложении. */
const URL_RE = /^(https?):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
/** Имя хоста (и кириллические домены) или IPv6 в скобках. */
const HOST_RE = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)*$|^\[[0-9a-f:]+\]$/u;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Имя сущности или поля OData: буквы (и кириллица), цифры, подчёркивание. */
const ODATA_NAME = /^[\p{L}_][\p{L}\p{N}_]{0,99}$/u;
/** В условии нет управляющих символов и переводов строк. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Адрес без завершающего «/», чтобы пути склеивались одинаково. */
export const normalizeBaseUrl = (s: string) => s.trim().replace(/\/+$/, '');

export interface ConfigCheck<T> {
  config: T | null;
  errors: Record<string, string>;
}

export function validateOneCConfig(v: Partial<Record<keyof OneCConfig, unknown>>): ConfigCheck<OneCConfig> {
  const errors: Record<string, string> = {};
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  const base = str(v.base_url);
  const urlError = checkIntegrationUrl(base);
  if (urlError) errors.base_url = urlError;
  const aggregate = (ONEC_AGGREGATES as readonly unknown[]).includes(v.aggregate) ? (v.aggregate as OneCAggregate) : 'avg';
  const entity = str(v.entity);
  if (!entity) errors.entity = 'Укажите документ или регистр';
  else if (!ODATA_NAME.test(entity)) errors.entity = 'Только буквы, цифры и «_», как в OData: Document_Договор';
  const dateField = str(v.date_field);
  if (!dateField) errors.date_field = 'Укажите поле с датой';
  else if (!ODATA_NAME.test(dateField)) errors.date_field = 'Только буквы, цифры и «_»';
  const valueField = str(v.value_field);
  if (aggregate !== 'count') {
    if (!valueField) errors.value_field = 'Укажите поле с числом';
    else if (!ODATA_NAME.test(valueField)) errors.value_field = 'Только буквы, цифры и «_»';
  } else if (valueField && !ODATA_NAME.test(valueField)) errors.value_field = 'Только буквы, цифры и «_»';
  const filter = str(v.filter);
  if (filter.length > 500) errors.filter = 'Не длиннее 500 символов';
  else if (CONTROL.test(filter)) errors.filter = 'Условие пишется в одну строку';
  if (Object.keys(errors).length) return { config: null, errors };
  return { config: { base_url: normalizeBaseUrl(base), entity, date_field: dateField, value_field: valueField, filter, aggregate }, errors };
}

export function validateMoodleConfig(v: Partial<Record<keyof MoodleConfig, unknown>>): ConfigCheck<MoodleConfig> {
  const errors: Record<string, string> = {};
  const base = typeof v.base_url === 'string' ? v.base_url.trim() : '';
  const urlError = checkIntegrationUrl(base);
  if (urlError) errors.base_url = urlError;
  const course = typeof v.course_id === 'number' ? v.course_id : Number(typeof v.course_id === 'string' ? v.course_id.trim() : NaN);
  if (!Number.isInteger(course) || course < 1) errors.course_id = 'Номер курса — целое число из адреса курса: course/view.php?id=101';
  const metric = (MOODLE_METRICS as readonly unknown[]).includes(v.metric) ? (v.metric as MoodleMetric) : 'completion_share';
  if (Object.keys(errors).length) return { config: null, errors };
  return { config: { base_url: normalizeBaseUrl(base), course_id: course, metric }, errors };
}

export function validateIntegrationConfig(kind: IntegrationKind, v: unknown): ConfigCheck<IntegrationConfig> {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return kind === 'onec' ? validateOneCConfig(o) : validateMoodleConfig(o);
}

/**
 * Пароль и токен назад не отдаём, даже частично: хвост пароля 1С сужает
 * перебор. Показываем только, что секрет задан.
 */
export const SECRET_MASK = '••••••••';
export function maskSecret(secret: string | null | undefined): string | null {
  return secret ? SECRET_MASK : null;
}

/** Точка замера из системы: момент и значение. */
export interface SyncPoint {
  at: string;
  value: number;
}

/** Дата в ответе 1С: ISO без зоны (время базы, Москва) или старое /Date(мс)/. */
export function parseOneCDate(raw: unknown): { day: string; at: string } | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return fromMs(raw);
  if (typeof raw !== 'string') return null;
  const legacy = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(raw.trim());
  if (legacy) return fromMs(Number(legacy[1]));
  const d = parseLooseDate(raw);
  return d ? { day: d.day, at: d.at } : null;
}

function fromMs(ms: number) {
  const at = new Date(ms).toISOString();
  return { day: observationDay(at), at };
}

/** Записи из ответа OData: v4 и v3 JSON отдают { value: […] }, старый verbose — { d: { results: […] } }. */
export function oneCRecords(json: unknown): Record<string, unknown>[] | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { value?: unknown; d?: { results?: unknown } | unknown[] };
  if (Array.isArray(o.value)) return o.value.filter(isRecord);
  if (o.d && typeof o.d === 'object') {
    const d = o.d as { results?: unknown };
    if (Array.isArray(d.results)) return d.results.filter(isRecord);
    if (Array.isArray(o.d)) return (o.d as unknown[]).filter(isRecord);
  }
  return null;
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export interface OneCParse {
  points: SyncPoint[];
  /** Сколько записей пришло. */
  records: number;
  /** Записи без даты или числа: показываем, сколько их, а не теряем молча. */
  invalid: number;
}

/**
 * Записи 1С → замеры по дням. За день — одно значение по выбранному правилу,
 * момент замера — самая поздняя запись дня.
 */
export function oneCPoints(records: Record<string, unknown>[], cfg: Pick<OneCConfig, 'date_field' | 'value_field' | 'aggregate'>): OneCParse {
  const days = new Map<string, { at: string; values: number[]; last: { at: string; value: number } | null; count: number }>();
  let invalid = 0;
  for (const r of records) {
    const date = parseOneCDate(r[cfg.date_field]);
    if (!date) {
      invalid++;
      continue;
    }
    let value = 0;
    if (cfg.aggregate !== 'count') {
      const raw = r[cfg.value_field];
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseLooseNumber(raw) : null;
      if (n === null || !Number.isFinite(n)) {
        invalid++;
        continue;
      }
      value = n;
    }
    const day = days.get(date.day) ?? { at: date.at, values: [], last: null, count: 0 };
    day.values.push(value);
    day.count++;
    if (date.at >= day.at) day.at = date.at;
    if (!day.last || date.at >= day.last.at) day.last = { at: date.at, value };
    days.set(date.day, day);
  }
  const points: SyncPoint[] = [];
  for (const [, d] of [...days].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sum = d.values.reduce((s, x) => s + x, 0);
    const value = cfg.aggregate === 'sum' ? sum : cfg.aggregate === 'count' ? d.count : cfg.aggregate === 'last' ? d.last!.value : sum / d.values.length;
    points.push({ at: d.at, value: round(value) });
  }
  return { points, records: records.length, invalid };
}

/** NUMERIC(18, 4) в базе: лишние знаки не храним. */
const round = (x: number) => Math.round(x * 10_000) / 10_000;

export interface MoodleCompletion {
  /** Записанные на курс слушатели (без преподавателей). */
  enrolled: number;
  completed: number;
}

/** Статусы завершения по слушателям → доля завершивших, %. Пустой курс — замера нет. */
export function moodleCompletionPoint(c: MoodleCompletion, now: Date): SyncPoint | null {
  if (c.enrolled <= 0) return null;
  const share = Math.min(100, (Math.max(0, c.completed) / c.enrolled) * 100);
  return { at: now.toISOString(), value: Math.round(share * 10) / 10 };
}

export interface SyncPlan {
  /** Что записать: один замер за день, только новые дни. */
  observations: SyncPoint[];
  /** За эти дни замер уже есть. */
  duplicates: number;
  /** Не подошли: из будущего или вне допустимого диапазона единицы. */
  rejected: { day: string; reason: string }[];
}

/** Какие точки записать в KPI. Те же правила, что у ручного замера и импорта. */
export function planSync(points: SyncPoint[], opts: { unit: UnitId; now: Date; existingDays?: Iterable<string> }): SyncPlan {
  const existing = new Set(opts.existingDays ?? []);
  const nowMs = opts.now.getTime();
  const plan: SyncPlan = { observations: [], duplicates: 0, rejected: [] };
  for (const p of points) {
    const day = observationDay(p.at);
    if (Date.parse(p.at) > nowMs + 60_000) {
      plan.rejected.push({ day, reason: 'Дата из будущего' });
      continue;
    }
    const range = checkUnitRange(opts.unit, p.value);
    if (range) {
      plan.rejected.push({ day, reason: range });
      continue;
    }
    if (existing.has(day)) {
      plan.duplicates++;
      continue;
    }
    existing.add(day);
    plan.observations.push(p);
  }
  return plan;
}

export type IntegrationState = 'ok' | 'error' | 'never' | 'paused';

export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  ok: 'Работает',
  error: 'Ошибка',
  never: 'Ещё не синхронизировалась',
  paused: 'Выключена',
};

/** Состояние подключения для списка: выключено, не запускалось, последняя попытка удачна или нет. */
export function integrationState(i: { enabled: boolean; last_sync_at: string | null; last_error: string | null }): IntegrationState {
  if (!i.enabled) return 'paused';
  if (i.last_error) return 'error';
  if (!i.last_sync_at) return 'never';
  return 'ok';
}

/** Когда следующая синхронизация по расписанию. Выключенная — никогда. */
export function nextSyncAt(i: { enabled: boolean; last_sync_at: string | null; interval_hours: number }, now: Date): string | null {
  if (!i.enabled) return null;
  if (!i.last_sync_at) return now.toISOString();
  return new Date(Date.parse(i.last_sync_at) + i.interval_hours * 3_600_000).toISOString();
}

/** Момент в формате литерала 1С: местное (московское) время без зоны. */
function oneCDateTime(iso: string): string {
  return new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 19);
}

/**
 * Запрос к OData публикации 1С: <база>/odata/standard.odata/<сущность>.
 * Берём только нужные поля и записи с прошлой синхронизации, с запасом в
 * сутки: документы, проведённые задним числом, тоже попадут. Дни, за которые
 * замер уже есть, при записи пропускаются.
 */
export function oneCUrl(cfg: OneCConfig, since: string | null): string {
  const fields = [cfg.date_field, ...(cfg.aggregate === 'count' || !cfg.value_field ? [] : [cfg.value_field])];
  const conditions: string[] = [];
  if (since) conditions.push(`${cfg.date_field} ge datetime'${oneCDateTime(new Date(Date.parse(since) - 86_400_000).toISOString())}'`);
  if (cfg.filter) conditions.push(`(${cfg.filter})`);
  const params: [string, string][] = [
    ['$format', 'json'],
    ['$select', [...new Set(fields)].join(',')],
    ['$orderby', cfg.date_field],
  ];
  if (conditions.length) params.push(['$filter', conditions.join(' and ')]);
  return `${cfg.base_url}/odata/standard.odata/${encodeURIComponent(cfg.entity)}?${query(params)}`;
}

const query = (params: [string, string][]) => params.map(([k, v]) => `${encodeURIComponent(k).replace(/^%24/, '$')}=${encodeURIComponent(v)}`).join('&');

/** Вызов веб-сервиса Moodle (REST, ответ в JSON). Токен — в адресе, так устроен Moodle. */
export function moodleUrl(cfg: Pick<MoodleConfig, 'base_url'>, token: string, wsfunction: string, extra: Record<string, string | number> = {}): string {
  const params: [string, string][] = [
    ['wstoken', token],
    ['wsfunction', wsfunction],
    ['moodlewsrestformat', 'json'],
    ...Object.entries(extra).map(([k, v]): [string, string] => [k, String(v)]),
  ];
  return `${cfg.base_url}/webservice/rest/server.php?${query(params)}`;
}

/** Убрать токен из текста ошибки или адреса, прежде чем его сохранить или показать. */
export function redactSecret(text: string, secret: string | null | undefined): string {
  let out = text.replace(/wstoken=[^&\s]+/g, 'wstoken=••••');
  if (secret && secret.length >= 4) out = out.split(secret).join('••••');
  return out;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Момент синхронизации по Москве: «сегодня в 14:00», «вчера в 9:05», «14 окт в 10:00», «завтра в 12:00». */
export function syncMomentText(iso: string, now: Date): string {
  const moscow = (t: number) => new Date(t + 3 * 3_600_000);
  const at = moscow(Date.parse(iso));
  const day = at.toISOString().slice(0, 10);
  const today = moscow(now.getTime()).toISOString().slice(0, 10);
  const shift = (n: number) => moscow(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const time = `${at.getUTCHours()}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
  const label = day === today ? 'сегодня' : day === shift(-1) ? 'вчера' : day === shift(1) ? 'завтра' : `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}${day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${day.slice(0, 4)}`}`;
  return `${label} в ${time}`;
}

/** Ответы API интеграций. */
export interface IntegrationRun {
  id: string;
  trigger: 'manual' | 'schedule';
  status: 'running' | 'ok' | 'error';
  started_at: string;
  finished_at: string | null;
  fetched: number;
  imported: number;
  skipped: number;
  /** Для error — причина сбоя, для ok — предупреждение об отклонённых днях. */
  error: string | null;
}

export interface Integration {
  id: string;
  kind: IntegrationKind;
  name: string;
  goal: { id: string; title: string };
  metric: { id: string; name: string; unit: UnitId };
  config: IntegrationConfig;
  username: string | null;
  secret_mask: string | null;
  enabled: boolean;
  interval_hours: (typeof SYNC_INTERVALS)[number];
  state: IntegrationState;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  next_sync_at: string | null;
  created_at: string;
  last_run?: IntegrationRun | null;
}

export interface IntegrationTarget {
  metric_id: string;
  metric_name: string;
  unit: UnitId;
  goal_id: string;
  goal_title: string;
}

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
  records: number;
  invalid: number;
  points: SyncPoint[];
}
