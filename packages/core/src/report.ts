import { formatDate, formatNumber, formatValue } from './format';
import { kpiProgress, type KpiState } from './kpi';
import { formatHours, kpiMovement, shiftIso, valueAt, type KpiSeries, type Movement, type ProductMetrics } from './metrics';
import type { Risk, Severity } from './risk';
import { isOverdue, type TaskStatus } from './task';
import { UNITS, plural, type UnitId } from './units';

/**
 * Отчёт для руководства: одна страница о том, двигают ли цели показатели,
 * где риск и какое решение нужно сверху. Всё собирается из тех же данных,
 * что Пульс и «Эффект», поэтому отчёт не расходится с продуктом и его не
 * нужно готовить руками. Сборка общая: сайт печатает, приложение делится
 * текстом, а CSV открывается в Excel.
 */

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function isReportPeriod(v: unknown): v is ReportPeriod {
  return (REPORT_PERIODS as readonly unknown[]).includes(v);
}

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = { 7: 'Неделя', 30: 'Месяц', 90: 'Квартал' };

/** blind — рисков в работе нет, но KPI давно не измеряли: «по плану» сказать нельзя. */
export type GoalHealth = 'critical' | 'warning' | 'blind' | 'ok' | 'done';

export const HEALTH_LABELS: Record<GoalHealth, string> = {
  critical: 'Под угрозой',
  warning: 'Есть риски',
  blind: 'Нет замеров',
  ok: 'По плану',
  done: 'Завершена',
};

/** Цвет состояния: красный — угроза, оранжевый — риск, синий — движение, зелёный — готово. */
export const HEALTH_TONES: Record<GoalHealth, 'bad' | 'warn' | 'neutral' | 'accent' | 'good'> = { critical: 'bad', warning: 'warn', blind: 'neutral', ok: 'accent', done: 'good' };

export interface ReportTaskInput {
  id: string;
  status: TaskStatus;
  due_at: string | null;
  done_at: string | null;
}

export interface ReportGoalInput {
  id: string;
  title: string;
  status: 'active' | 'completed' | 'on_hold' | 'draft' | 'cancelled';
  owner_name: string | null;
  due_at: string | null;
  /** Когда цель завершили. Нужна, чтобы показать завершённые за период. */
  completed_at: string | null;
  kpi: (KpiSeries & { name: string; unit: UnitId }) | null;
  risks: readonly Risk[];
  /** Задачи цели и её подцелей. */
  tasks: readonly ReportTaskInput[];
}

export interface ReportInput {
  company: string;
  scope: 'company' | 'visible';
  author: string;
  at: string;
  days: ReportPeriod;
  goals: readonly ReportGoalInput[];
  /** Продуктовые метрики с окном, равным периоду отчёта. */
  metrics: ProductMetrics;
}

export interface ReportKpi {
  name: string;
  unit: UnitId;
  baseline: number;
  target: number;
  direction: KpiSeries['direction'];
  range_min: number | null;
  range_max: number | null;
  /** Значение на начало периода. Замеров до периода не было — исходное значение. */
  start: number;
  current: number | null;
  /** Пройденный путь к цели, %. Может быть меньше 0 и больше 100. */
  progress: number | null;
  state: KpiState;
  movement: Movement;
  /** Изменение прогресса за период, п.п. */
  delta: number | null;
  last_observed_at: string | null;
}

export interface ReportRisk {
  severity: Severity;
  title: string;
  explanation: string;
  suggestion: string;
}

export interface ReportGoal {
  id: string;
  title: string;
  owner: string | null;
  due_at: string | null;
  health: GoalHealth;
  kpi: ReportKpi | null;
  tasks: { done: number; total: number; done_in_period: number; blocked: number; overdue: number };
  /** Самый серьёзный риск — то, о чём руководитель спросит первым. */
  top_risk: ReportRisk | null;
  completed_at: string | null;
}

export interface ReportDecision extends ReportRisk {
  goal_id: string;
  goal_title: string;
}

export interface Report {
  at: string;
  from: string;
  days: ReportPeriod;
  company: string;
  scope: 'company' | 'visible';
  author: string;
  headline: {
    goals: number;
    health: Record<GoalHealth, number>;
    north_star: number | null;
    improved: number;
    with_kpi: number;
    tasks_done: number;
    on_time: number | null;
    blocker_median_hours: number | null;
    open_blockers: number;
  };
  /** Главное за период: три-четыре фразы, которые можно прочитать вслух на планёрке. */
  summary: string[];
  goals: ReportGoal[];
  /** Где нужно решение руководства: критические риски, затем предупреждения. */
  decisions: ReportDecision[];
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const HEALTH_ORDER: Record<GoalHealth, number> = { critical: 0, warning: 1, blind: 2, ok: 3, done: 4 };
const DECISIONS_LIMIT = 5;

const quote = (s: string) => `«${s}»`;
const goalsWord = (n: number) => plural(n, ['цель', 'цели', 'целей']);
const inPeriod = (iso: string | null, from: string, at: string) => !!iso && iso > from && iso <= at;

function healthOf(g: ReportGoalInput): GoalHealth {
  if (g.status === 'completed') return 'done';
  if (g.risks.some((r) => r.severity === 'critical')) return 'critical';
  if (g.risks.some((r) => r.severity === 'warning')) return 'warning';
  if (g.risks.some((r) => r.kind === 'no_measurement')) return 'blind';
  return 'ok';
}

function reportKpi(kpi: NonNullable<ReportGoalInput['kpi']>, from: string, at: string): ReportKpi {
  const current = valueAt(kpi.observations, at);
  const p = kpiProgress(kpi, current);
  const { movement, delta } = kpiMovement(kpi, from, at);
  let last: string | null = null;
  for (const o of kpi.observations) if (o.observed_at <= at && (!last || o.observed_at > last)) last = o.observed_at;
  return {
    name: kpi.name,
    unit: kpi.unit,
    baseline: kpi.baseline,
    target: kpi.target,
    direction: kpi.direction,
    range_min: kpi.range_min ?? null,
    range_max: kpi.range_max ?? null,
    start: valueAt(kpi.observations, from) ?? kpi.baseline,
    current,
    progress: p.raw === null ? null : Math.round(p.raw),
    state: p.state,
    movement,
    delta: delta === null ? null : Math.round(delta * 10) / 10,
    last_observed_at: last,
  };
}

const toRisk = (r: Risk): ReportRisk => ({ severity: r.severity, title: r.title, explanation: r.explanation, suggestion: r.suggestion });

/**
 * Собрать отчёт. В него попадают цели верхнего уровня, которые сейчас в работе
 * или на паузе, и цели, завершённые за период. Подцели не выносятся отдельной
 * строкой: их задачи и риски уже учтены в родительской цели.
 */
export function buildReport(input: ReportInput): Report {
  const { at, days } = input;
  const from = shiftIso(at, -days);
  const today = at.slice(0, 10);

  const picked = input.goals.filter((g) => g.status === 'active' || g.status === 'on_hold' || (g.status === 'completed' && inPeriod(g.completed_at, from, at)));

  const goals: ReportGoal[] = picked.map((g) => {
    const counted = g.tasks.filter((t) => t.status !== 'cancelled');
    const risks = [...g.risks].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    const top = risks[0] ?? null;
    return {
      id: g.id,
      title: g.title,
      owner: g.owner_name,
      due_at: g.due_at,
      health: healthOf(g),
      kpi: g.kpi ? reportKpi(g.kpi, from, at) : null,
      tasks: {
        done: counted.filter((t) => t.status === 'done').length,
        total: counted.length,
        done_in_period: counted.filter((t) => t.status === 'done' && inPeriod(t.done_at, from, at)).length,
        blocked: counted.filter((t) => t.status === 'blocked').length,
        overdue: counted.filter((t) => isOverdue(t, today)).length,
      },
      top_risk: g.status === 'completed' || !top ? null : toRisk(top),
      completed_at: g.status === 'completed' ? g.completed_at : null,
    };
  });
  goals.sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || a.title.localeCompare(b.title, 'ru'));

  const decisions: ReportDecision[] = picked
    .filter((g) => g.status !== 'completed')
    .flatMap((g) => g.risks.filter((r) => r.severity !== 'info').map((r) => ({ ...toRisk(r), goal_id: g.id, goal_title: g.title })))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, DECISIONS_LIMIT);

  // Одна задача может быть в нескольких целях — считаем её один раз.
  const doneIds = new Set(picked.flatMap((g) => g.tasks.filter((t) => t.status === 'done' && inPeriod(t.done_at, from, at)).map((t) => t.id)));
  const health: Record<GoalHealth, number> = { critical: 0, warning: 0, blind: 0, ok: 0, done: 0 };
  for (const g of goals) health[g.health]++;
  const m = input.metrics;

  const headline: Report['headline'] = {
    goals: goals.length,
    health,
    north_star: m.north_star.value,
    improved: m.north_star.counts.improved,
    with_kpi: m.north_star.total,
    tasks_done: doneIds.size,
    on_time: m.on_time.value,
    blocker_median_hours: m.blockers.median_hours,
    open_blockers: m.blockers.open,
  };

  const report: Report = { at, from, days, company: input.company, scope: input.scope, author: input.author, headline, summary: [], goals, decisions };
  report.summary = reportSummary(report);
  return report;
}

/** «19 сентября — 19 октября 2026». */
export function reportPeriodText(r: Pick<Report, 'from' | 'at'>): string {
  // Год у начала периода пишем, только если он отличается от года конца.
  return `${formatDate(r.from, { today: r.at })} — ${formatDate(r.at, { today: '0000' })}`;
}

function reportSummary(r: Report): string[] {
  const h = r.headline;
  const out: string[] = [];
  if (h.with_kpi && h.improved) {
    out.push(`${h.improved} из ${h.with_kpi} ${plural(h.with_kpi, ['цели', 'целей', 'целей'])} с KPI ${h.improved === 1 ? 'сдвинула' : 'сдвинули'} показатель к цели.`);
  } else if (h.with_kpi) {
    out.push(`Ни одна из ${h.with_kpi} ${plural(h.with_kpi, ['цели', 'целей', 'целей'])} с KPI не сдвинула показатель к цели.`);
  } else if (h.goals) {
    out.push('У целей в работе нет KPI с замерами, поэтому эффект пока не оценить.');
  }
  const atRisk = r.goals.filter((g) => g.health === 'critical');
  if (atRisk.length) {
    const g = atRisk[0]!;
    const more = atRisk.length > 1 ? ` и ещё ${atRisk.length - 1}` : '';
    out.push(`Под угрозой ${atRisk.length} ${goalsWord(atRisk.length)}: ${quote(g.title)}${more}. ${g.top_risk ? g.top_risk.title + '.' : ''}`.trim());
  } else if (h.health.warning) {
    out.push(`Критических рисков нет, у ${h.health.warning} ${plural(h.health.warning, ['цели', 'целей', 'целей'])} есть предупреждения.`);
  } else if (h.goals && !h.health.blind) {
    out.push('Критических рисков нет, цели идут по плану.');
  }
  if (h.health.blind) {
    out.push(`У ${h.health.blind} ${plural(h.health.blind, ['цели', 'целей', 'целей'])} нет свежих замеров KPI, прогресс неизвестен.`);
  }
  if (h.tasks_done) {
    out.push(`${plural(h.tasks_done, ['Закрыта', 'Закрыто', 'Закрыто'])} ${h.tasks_done} ${plural(h.tasks_done, ['задача', 'задачи', 'задач'])}${h.on_time !== null ? `, ${h.on_time} % в срок` : ''}.`);
  } else if (h.goals) {
    out.push('За период не закрыто ни одной задачи.');
  }
  const done = r.goals.filter((g) => g.health === 'done');
  if (done.length) out.push(`${done.length === 1 ? 'Завершена цель' : 'Завершены цели'} ${done.map((g) => quote(g.title)).join(', ')}.`);
  return out;
}

/** «40 → 36,5 мин, цель 30» или «В диапазоне 95–100 %». */
export function kpiLine(k: ReportKpi): string {
  const short = UNITS[k.unit].short;
  const n = (v: number) => formatNumber(v, UNITS[k.unit].decimals);
  if (k.direction === 'maintain') {
    const range = `${n(k.range_min ?? k.target)}–${n(k.range_max ?? k.target)} ${short}`;
    return k.current === null ? `нет замеров, держим ${range}` : `${formatValue(k.current, k.unit)}, держим ${range}`;
  }
  if (k.current === null) return `нет замеров, цель ${formatValue(k.target, k.unit)}`;
  return `${n(k.baseline)} → ${formatValue(k.current, k.unit)}, цель ${n(k.target)}`;
}

function progressLine(k: ReportKpi): string | null {
  if (k.direction === 'maintain' || k.progress === null) return null;
  const delta = k.delta === null ? '' : `, ${k.delta > 0 ? '+' : k.delta < 0 ? '−' : '±'}${formatNumber(Math.abs(k.delta), 1)} п.п. за период`;
  return `${k.progress} % пути${delta}`;
}

/**
 * Текст отчёта для мессенджера или письма: без разметки, читается с телефона.
 * Сначала главное, затем решения, затем цели по одной строке.
 */
export function reportText(r: Report): string {
  const lines: string[] = [];
  lines.push(`Отчёт offix · ${r.company}`);
  lines.push(`${reportPeriodText(r)}${r.scope === 'visible' ? ' · цели вашей зоны' : ''}`);
  lines.push('');
  if (r.summary.length) {
    lines.push('Главное');
    for (const s of r.summary) lines.push(`• ${s}`);
    lines.push('');
  }
  if (r.decisions.length) {
    lines.push('Нужно решение');
    r.decisions.forEach((d, i) => lines.push(`${i + 1}. ${d.goal_title}: ${d.title}. ${d.suggestion}.`));
    lines.push('');
  }
  if (r.goals.length) {
    lines.push('Цели');
    for (const g of r.goals) {
      const parts = [HEALTH_LABELS[g.health]];
      if (g.kpi) {
        parts.push(`${g.kpi.name}: ${kpiLine(g.kpi)}`);
        const p = progressLine(g.kpi);
        if (p) parts.push(p);
      } else parts.push('без KPI');
      lines.push(`• ${g.title} — ${parts.join(' · ')}`);
    }
    lines.push('');
  }
  const h = r.headline;
  const facts = [`задач закрыто ${h.tasks_done}`];
  if (h.on_time !== null) facts.push(`в срок ${h.on_time} %`);
  if (h.blocker_median_hours !== null) facts.push(`блокер снимают за ${formatHours(h.blocker_median_hours)}`);
  if (h.open_blockers) facts.push(`открытых блокеров ${h.open_blockers}`);
  lines.push(`Работа: ${facts.join(', ')}.`);
  return lines.join('\n').replace(/ /g, ' ');
}

// ——— CSV для Excel ———

type Cell = string | number | null;

/** Число в русской записи без разрядов, чтобы Excel узнал его как число. */
const csvNumber = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

function csvCell(c: Cell): string {
  if (c === null) return '';
  if (typeof c === 'number') return Number.isFinite(c) ? csvNumber(c) : '';
  // Текст, начинающийся с = + - @, Excel принял бы за формулу.
  const safe = /^[=+\-@\t\r]/.test(c) ? `'${c}` : c;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const REPORT_CSV_COLUMNS = [
  'Цель',
  'Владелец',
  'Срок',
  'Состояние',
  'KPI',
  'Единица',
  'Исходное',
  'На начало периода',
  'Сейчас',
  'Цель KPI',
  'Пройдено пути, %',
  'Изменение за период, п.п.',
  'Задач закрыто',
  'Задач всего',
  'Закрыто за период',
  'Заблокировано',
  'Просрочено',
  'Главный риск',
  'Что сделать',
] as const;

/**
 * CSV для Excel: разделитель «;», запятая в дробях, BOM для кириллицы,
 * строки через CRLF. Одна строка — одна цель.
 */
export function reportCsv(r: Report): string {
  const rows: Cell[][] = [[...REPORT_CSV_COLUMNS]];
  for (const g of r.goals) {
    const k = g.kpi;
    rows.push([
      g.title,
      g.owner,
      g.due_at,
      HEALTH_LABELS[g.health],
      k?.name ?? null,
      k ? UNITS[k.unit].short : null,
      k?.baseline ?? null,
      k?.start ?? null,
      k?.current ?? null,
      k ? k.target : null,
      k?.progress ?? null,
      k?.delta ?? null,
      g.tasks.done,
      g.tasks.total,
      g.tasks.done_in_period,
      g.tasks.blocked,
      g.tasks.overdue,
      g.top_risk?.title ?? null,
      g.top_risk?.suggestion ?? null,
    ]);
  }
  return `﻿${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

/** offix-otchet-2026-10-19.csv */
export function reportFileName(r: Pick<Report, 'at'>, ext: 'csv' | 'txt' | 'pdf'): string {
  return `offix-otchet-${r.at.slice(0, 10)}.${ext}`;
}
