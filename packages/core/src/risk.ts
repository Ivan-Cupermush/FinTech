import { diffDays } from './dates';
import { formatDate } from './format';
import { kpiProgress, type MetricInput } from './kpi';
import { criticalPath, downstream, expectedFinish, proposeShifts, type Dependency, type ShiftProposal } from './schedule';
import { BLOCKER_LABELS, isOverdue, taskProgress, type BlockerReason, type TaskLike } from './task';
import { plural } from './units';

export type RiskKind = 'blocked' | 'overdue' | 'dependency_delay' | 'goal_deadline' | 'kpi_not_moving' | 'no_measurement';
export type Severity = 'critical' | 'warning' | 'info';

export interface Risk {
  id: string;
  kind: RiskKind;
  severity: Severity;
  title: string;
  /** Почему система так решила — никаких «просто красных» задач. */
  explanation: string;
  /** Что предлагаем сделать. Решение — за руководителем. */
  suggestion: string;
  task_ids: string[];
  proposals?: ShiftProposal[];
}

export interface RiskTask extends TaskLike {
  title: string;
  blocked_reason?: BlockerReason | null;
  blocked_note?: string | null;
  blocked_since?: string | null;
  assignee_name?: string | null;
}

export interface RiskMetric extends Pick<MetricInput, 'name' | 'baseline' | 'target' | 'direction' | 'range_min' | 'range_max'> {
  id: string;
  current_value: number | null;
  last_observed_at: string | null;
}

export interface RiskInput {
  goal: { status: string; due_at: string | null };
  tasks: readonly RiskTask[];
  edges: readonly Dependency[];
  metrics: readonly RiskMetric[];
  today: string;
  /** Через сколько дней без измерений KPI считаем «слепым». */
  staleAfterDays?: number;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

const days = (n: number) => `${n} ${plural(n, ['день', 'дня', 'дней'])}`;

/** Четыре сценария реакции на проблемы (ТЗ 2.5) + «нет измерений». */
export function analyzeRisks(input: RiskInput): Risk[] {
  const { goal, tasks, edges, metrics, today } = input;
  const stale = input.staleAfterDays ?? 14;
  const risks: Risk[] = [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const critical = new Set(criticalPath(tasks, edges));
  const name = (id: string) => `«${byId.get(id)?.title ?? 'задача'}»`;

  // В. Заблокированные задачи.
  for (const t of tasks) {
    if (t.status !== 'blocked') continue;
    const since = t.blocked_since?.slice(0, 10) ?? today;
    const long = diffDays(since, today);
    const waiting = downstream(edges, t.id).filter((id) => byId.has(id));
    const reason = t.blocked_reason ? BLOCKER_LABELS[t.blocked_reason] : 'Причина не указана';
    const parts = [`${reason}${t.blocked_note ? `: ${t.blocked_note}` : ''}.`, `Заблокирована ${long > 0 ? days(long) : 'сегодня'}.`];
    if (waiting.length) parts.push(`${waiting.length === 1 ? 'Ждёт' : 'Ждут'} ${waiting.length} ${plural(waiting.length, ['задача', 'задачи', 'задач'])}.`);
    risks.push({
      id: `blocked:${t.id}`,
      kind: 'blocked',
      severity: critical.has(t.id) || long >= 3 ? 'critical' : 'warning',
      title: `${name(t.id)} заблокирована`,
      explanation: parts.join(' '),
      suggestion: t.assignee_name ? `Снимите причину блокировки вместе с исполнителем (${t.assignee_name}) или назначьте следующий шаг` : 'Назначьте ответственного за снятие блокировки',
      task_ids: [t.id, ...waiting],
    });
  }

  // Просроченные задачи.
  for (const t of tasks) {
    if (t.status === 'blocked' || !isOverdue(t, today)) continue;
    const late = diffDays(t.due_at!, today);
    risks.push({
      id: `overdue:${t.id}`,
      kind: 'overdue',
      severity: critical.has(t.id) ? 'critical' : 'warning',
      title: `${name(t.id)} просрочена на ${days(late)}`,
      explanation: `Срок был ${formatDate(t.due_at, { today })}.${critical.has(t.id) ? ' Задача на критическом пути — её задержка сдвигает всю цель.' : ''}`,
      suggestion: 'Уточните у исполнителя новый реалистичный срок',
      task_ids: [t.id],
    });
  }

  // А. Задержка сдвигает зависимые задачи.
  let proposals: ShiftProposal[] = [];
  try {
    proposals = proposeShifts(tasks, edges, today);
  } catch {
    proposals = [];
  }
  if (proposals.length) {
    const roots = [...new Set(proposals.flatMap((p) => p.because))].filter((id) => !proposals.some((p) => p.task_id === id));
    risks.push({
      id: `dependency:${roots.join(',') || proposals[0]!.task_id}`,
      kind: 'dependency_delay',
      severity: 'warning',
      title: `Задержка затрагивает ${proposals.length} ${plural(proposals.length, ['задачу', 'задачи', 'задач'])}`,
      explanation: `${roots.map(name).join(', ') || 'Предыдущие задачи'} не успевают к сроку, поэтому зависимые задачи не могут начаться по плану.`,
      suggestion: 'Посмотрите предложенный перенос сроков и подтвердите его — сами сроки система не меняет',
      task_ids: proposals.map((p) => p.task_id),
      proposals,
    });
  }

  // Б. Риск срыва срока цели.
  if (goal.due_at && goal.status === 'active') {
    const finishes = tasks
      .map((t) => {
        const prop = proposals.find((p) => p.task_id === t.id);
        return { id: t.id, finish: prop?.to_due ?? expectedFinish(t, today) };
      })
      .filter((x): x is { id: string; finish: string } => !!x.finish && x.finish > goal.due_at!);
    if (finishes.length) {
      const worst = finishes.reduce((a, b) => (a.finish > b.finish ? a : b));
      risks.push({
        id: 'goal_deadline',
        kind: 'goal_deadline',
        severity: 'critical',
        title: 'Цель может не успеть к сроку',
        explanation: `При текущем ходе работ ${name(worst.id)} завершится ${formatDate(worst.finish, { today })} — на ${days(diffDays(goal.due_at, worst.finish))} позже срока цели.`,
        suggestion: 'Пересоберите план: перераспределите задачи, уберите лишние шаги или согласуйте новый срок',
        task_ids: finishes.map((f) => f.id),
      });
    }
  }

  // Г. Задачи выполнены, а KPI не меняется.
  const tp = taskProgress(tasks);
  if (tp.total > 0 && tp.done === tp.total) {
    for (const m of metrics) {
      const p = kpiProgress(m, m.current_value);
      if (p.state === 'achieved' || p.state === 'in_range') continue;
      risks.push({
        id: `kpi_not_moving:${m.id}`,
        kind: 'kpi_not_moving',
        severity: 'warning',
        title: `Работы завершены, а «${m.name}» не достиг цели`,
        explanation:
          p.state === 'no_data'
            ? 'Все задачи закрыты, но фактических измерений KPI нет — неизвестно, сработал ли план.'
            : `Все задачи закрыты, KPI прошёл ${Math.round(p.raw ?? 0)} % пути.`,
        suggestion: 'Проверьте гипотезу и качество внедрения, добавьте измерение или новые шаги',
        task_ids: [],
      });
    }
  }

  // Нет свежих измерений.
  if (goal.status === 'active') {
    for (const m of metrics) {
      const last = m.last_observed_at?.slice(0, 10);
      const age = last ? diffDays(last, today) : null;
      if (age === null || age > stale) {
        risks.push({
          id: `no_measurement:${m.id}`,
          kind: 'no_measurement',
          severity: 'info',
          title: `Нет свежих измерений «${m.name}»`,
          explanation: age === null ? 'Показатель ещё ни разу не измеряли — прогресс цели неизвестен.' : `Последнее измерение — ${days(age)} назад.`,
          suggestion: 'Внесите текущее значение показателя',
          task_ids: [],
        });
      }
    }
  }

  return risks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
