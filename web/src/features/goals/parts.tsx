import { CalendarDays, CircleAlert, CornerDownRight, ListChecks } from 'lucide-react';
import { Link } from 'react-router-dom';
import { diffDays, formatDate, GOAL_TYPE_LABELS, plural, type Risk } from '@offix/core';
import type { Metric, UserBrief } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { KpiTrack } from '../../ui/KpiTrack';
import { Pill } from '../../ui/Pill';

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

/** Карточка цели в списках: главный KPI крупно, ход работ — тонкой полосой. */
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
    status?: string;
  };
  today: string;
}) {
  const m = goal.primary_metric;
  const pct = goal.task_progress.total ? Math.round((goal.task_progress.done / goal.task_progress.total) * 100) : 0;
  return (
    <Link to={`/app/goals/${goal.id}`} className="card card-hover stack" style={{ '--gap': '16px' } as React.CSSProperties}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ '--gap': '6px', minWidth: 0 } as React.CSSProperties}>
          <div className="row wrap" style={{ gap: 6 }}>
            <Pill tone="neutral" plain>
              {GOAL_TYPE_LABELS[goal.type]}
            </Pill>
            {goal.status === 'draft' && <Pill plain>Черновик</Pill>}
            {goal.risk_level === 'critical' && <Pill tone="bad">Под угрозой</Pill>}
            {goal.risk_level === 'warning' && <Pill tone="warn">Есть риски</Pill>}
            {!!goal.blocked && goal.risk_level === undefined && <Pill tone="bad">{goal.blocked} блок.</Pill>}
          </div>
          <h3 style={{ fontSize: 17 }}>{goal.title}</h3>
        </div>
        {goal.owner && <Avatar name={goal.owner.display_name} size={30} title={`Владелец: ${goal.owner.display_name}`} />}
      </div>
      {m ? (
        <KpiTrack baseline={m.baseline} target={m.target} current={m.current_value} unit={m.unit} progress={m.progress} name={m.name} size="lg" showLegend={false} />
      ) : (
        <div className="row faint" style={{ gap: 8, fontSize: 14 }}>
          <CircleAlert size={16} /> KPI не задан — цель пока не измерима
        </div>
      )}
      {m && <div className="faint" style={{ fontSize: 13, marginTop: -8 }}>{m.name}</div>}
      <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
        <div className="spread wrap" style={{ fontSize: 13, rowGap: 6 }}>
          <span className="row faint" style={{ gap: 6 }}>
            <ListChecks size={14} /> {goal.task_progress.total ? `Задачи ${goal.task_progress.done} из ${goal.task_progress.total}` : 'Задач пока нет'}
          </span>
          <DueLabel due={goal.due_at} today={today} />
        </div>
        <div className="bar" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
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
