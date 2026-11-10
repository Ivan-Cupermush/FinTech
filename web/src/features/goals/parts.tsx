import { CalendarDays, CircleAlert, CornerDownRight, ListChecks } from 'lucide-react';
import { Link } from 'react-router-dom';
import { diffDays, formatDate, formatNumber, GOAL_TYPE_LABELS, lastDelta, plural, RISK_GRADE, RISK_TONE_LABELS, riskTone, UNITS, type Risk } from '@offix/core';
import type { Metric, UserBrief } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { Odometer } from '../../ui/fx/Odometer';
import { RiskBadge, RiskCard } from '../../ui/fx/RiskCard';

export function DueLabel({ due, today }: { due: string | null; today: string }) {
  if (!due) return <span className="faint">Без срока</span>;
  const left = diffDays(today, due);
  const text = left < 0 ? `просрочено на ${-left} ${plural(-left, ['день', 'дня', 'дней'])}` : left === 0 ? 'сегодня' : `через ${left} ${plural(left, ['день', 'дня', 'дней'])}`;
  return (
    <span className="row faint" style={{ gap: 6, fontSize: 13 }}>
      <CalendarDays size={14} aria-hidden />
      <span>
        до {formatDate(due, { today })} · <span style={{ color: left < 0 ? 'var(--bad)' : undefined }}>{text}</span>
      </span>
    </span>
  );
}

/** Изменение к прошлому замеру с учётом направления KPI: «−1,5 мин» хорошо, если цель — уменьшить. */
export function deltaTone(delta: number, direction: Metric['direction']): 'good' | 'bad' | 'flat' {
  if (!delta || direction === 'maintain') return 'flat';
  return (direction === 'decrease' ? delta < 0 : delta > 0) ? 'good' : 'bad';
}

/**
 * Карточка цели в списках — Risk Radar: жидкость цвета риска, главный KPI
 * крупно одометром, линия последних замеров и ход работ тонкой полосой.
 */
export function GoalTile({
  goal,
  today,
}: {
  goal: {
    id: string;
    title: string;
    type: keyof typeof GOAL_TYPE_LABELS;
    due_at: string | null;
    owner?: UserBrief | null;
    primary_metric: Metric | null;
    task_progress: { done: number; total: number };
    risk_level?: 'critical' | 'warning' | 'ok';
    blocked?: number;
    overdue?: number;
    status?: string;
  };
  today: string;
}) {
  const m = goal.primary_metric;
  const pct = goal.task_progress.total ? Math.round((goal.task_progress.done / goal.task_progress.total) * 100) : 0;
  const tone = riskTone({ risk_level: goal.risk_level, blocked: goal.blocked, overdue: goal.overdue, kpi: m?.progress.state ?? null, status: goal.status });
  const unit = m ? UNITS[m.unit] : null;
  const f = (v: number) => formatNumber(v, unit?.decimals ?? 0);
  const value = m?.current_value != null ? f(m.current_value) : null;
  const trend = m?.trend ?? [];
  const delta = lastDelta(trend);
  const left = goal.due_at ? diffDays(today, goal.due_at) : null;
  return (
    <RiskCard to={`/app/goals/${goal.id}`} tone={tone} spark={m ? trend : undefined} className="goal-tile" aria-label={`${goal.title}: ${RISK_TONE_LABELS[tone].toLowerCase()}`}>
      <div className="spread" style={{ alignItems: 'flex-start', gap: 10 }}>
        <span className="rr-eyebrow clip">
          {GOAL_TYPE_LABELS[goal.type]}
          {goal.status === 'draft' ? ' · черновик' : ''}
        </span>
        <RiskBadge grade={RISK_GRADE[tone]} label={RISK_TONE_LABELS[tone]} />
      </div>
      <h3 className="rr-title">{goal.title}</h3>
      {m ? (
        <>
          <div className={`rr-num ${value === null ? 'rr-num-empty' : value.length > 7 ? 'rr-num-long' : ''}`}>
            {value === null ? 'Нет замеров' : <Odometer value={value} />}
            {value !== null && <span className="unit">{unit!.short}</span>}
          </div>
          <div className="rr-sub">
            <span>
              {m.name} · цель <b className="num">{f(m.target)}</b>
            </span>
            {m.progress.raw !== null && <span className="num">{Math.round(m.progress.raw)}&nbsp;% пути</span>}
            {delta !== null && delta !== 0 && (
              <span className="rr-delta num" title="К прошлому замеру">
                {deltaTone(delta, m.direction) === 'bad' ? '▼' : '▲'} {delta > 0 ? '+' : '−'}
                {f(Math.abs(delta))}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="rr-num rr-num-empty">
          <CircleAlert size={22} aria-hidden /> KPI не задан
        </div>
      )}
      <div className="rr-foot">
        <div className="rr-foot-row">
          <span>
            <ListChecks size={14} aria-hidden /> {goal.task_progress.total ? `Задачи ${goal.task_progress.done} из ${goal.task_progress.total}` : 'Задач пока нет'}
          </span>
          <span>
            <CalendarDays size={14} aria-hidden />
            {goal.due_at ? `до ${formatDate(goal.due_at, { today, short: true })}${left !== null && left < 0 ? ` · просрочено` : ''}` : 'без срока'}
            {goal.owner && <Avatar name={goal.owner.display_name} size={22} title={`Владелец: ${goal.owner.display_name}`} />}
          </span>
        </div>
        <div className="rr-bar" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    </RiskCard>
  );
}

export function RiskList({ risks, showGoal, onTask, action }: { risks: (Risk & { goal_id?: string; goal_title?: string })[]; showGoal?: boolean; onTask?: (id: string) => void; action?: (r: Risk) => React.ReactNode }) {
  return (
    <div>
      {risks.map((r) => (
        <div key={`${r.goal_id ?? ''}${r.id}`} className={`risk ${r.severity}`}>
          <div className="risk-rail" aria-hidden />
          <div className="stack" style={{ '--gap': '2px' } as React.CSSProperties}>
            {showGoal && r.goal_id && (
              <Link to={`/app/goals/${r.goal_id}`} className="faint" style={{ fontSize: 12.5 }}>
                {r.goal_title}
              </Link>
            )}
            {onTask && r.task_ids[0] ? (
              <button type="button" className="risk-title" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => onTask(r.task_ids[0]!)}>
                {r.title}
              </button>
            ) : (
              <div className="risk-title">{r.title}</div>
            )}
            <div className="risk-why">{r.explanation}</div>
            <div className="risk-next">
              <CornerDownRight size={14} aria-hidden />
              <span>{r.suggestion}</span>
            </div>
            {action?.(r)}
          </div>
        </div>
      ))}
    </div>
  );
}
