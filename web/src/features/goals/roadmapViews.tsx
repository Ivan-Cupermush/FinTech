import { ChevronDown, ChevronRight, Clock, Hourglass, Timer } from 'lucide-react';
import { useState } from 'react';
import { BLOCKER_LABELS, formatDate, formatDuration, type BlockerReason } from '@offix/core';
import type { Roadmap } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { Empty } from '../../ui/Misc';
import { TaskRow } from '../tasks/parts';
import { buildScale, collectProposals, groupRoadmap } from './roadmapLayout';

/** Дерево: подцели раскрываются, критический путь помечен. */
export function RoadmapTree({ roadmap, onTask }: { roadmap: Roadmap; onTask: (id: string) => void }) {
  const groups = groupRoadmap(roadmap);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const critical = new Set(roadmap.critical_path);
  const today = roadmap.timeline.today;
  if (!groups.length)
    return (
      <div className="card">
        <Empty title="Плана пока нет">Разбейте цель на подцели и задачи — offix покажет критический путь и риски по срокам.</Empty>
      </div>
    );
  return (
    <div className="tree">
      {groups.map((g, i) => {
        const open = !closed.has(g.id);
        return (
          <section key={g.id} className="tree-group">
            <button
              type="button"
              className="tree-head"
              aria-expanded={open}
              onClick={() =>
                setClosed((s) => {
                  const n = new Set(s);
                  if (n.has(g.id)) n.delete(g.id);
                  else n.add(g.id);
                  return n;
                })
              }
            >
              <span className="tree-index num">{g.kind === 'direct' ? '·' : i + 1}</span>
              <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                <span style={{ fontWeight: 620 }}>{g.title}</span>
                <span className="faint" style={{ fontSize: 12.5 }}>
                  {[g.owner, g.due_at && `до ${formatDate(g.due_at, { short: true, today })}`, `${g.done} из ${g.total} задач`].filter(Boolean).join(' · ')}
                </span>
              </span>
              {g.owner && <Avatar name={g.owner} size={26} />}
              {open ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
            </button>
            {open && (
              <div className="tree-body">
                {g.tasks.length ? (
                  <div className="list">
                    {g.tasks.map((t) => (
                      <div key={t.id} className="row" style={{ gap: 0 }}>
                        <div className="grow">
                          <TaskRow task={t} today={today} onOpen={onTask} />
                        </div>
                        {critical.has(t.id) && t.status !== 'done' && (
                          <span className="critical-mark" title="Задержка этой задачи сдвигает срок цели">
                            крит. путь
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="faint" style={{ padding: '4px 8px 12px', fontSize: 14 }}>
                    Задач пока нет.
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Таймлайн: бары задач, «сегодня», срок цели и пунктиром — предложенный перенос. */
export function RoadmapTimeline({ roadmap, onTask }: { roadmap: Roadmap; onTask: (id: string) => void }) {
  const groups = groupRoadmap(roadmap);
  const proposals = collectProposals(roadmap);
  const critical = new Set(roadmap.critical_path);
  const extra = [...proposals.values()].map((p) => p.to_due);
  const scale = buildScale(roadmap.timeline.from, roadmap.timeline.to, roadmap.timeline.today, extra);
  const goalDue = roadmap.goal.due_at;
  const dated = groups.some((g) => g.tasks.some((t) => t.due_at));
  if (!dated)
    return (
      <div className="card">
        <Empty icon={<Clock size={22} />} title="Нет сроков — нечего показать на шкале">
          Укажите даты начала и окончания задач, чтобы увидеть план во времени и задержки по зависимостям.
        </Empty>
      </div>
    );
  return (
    <div>
      <div className="timeline" role="region" aria-label="Таймлайн задач">
        <div className="tl-grid">
          <div className="tl-scale">
            <div className="tl-label-col" />
            <div className="tl-track">
              {scale.months.map((m) => (
                <span key={m.label + m.left} style={{ position: 'absolute', left: `${m.left}%`, top: 10, paddingLeft: 6, borderLeft: '1px solid var(--line)' }}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.id}>
              <div className="tl-row group">
                <div className="tl-label">{g.title}</div>
                <div className="tl-track" />
              </div>
              {g.tasks.map((t) => {
                const due = t.due_at;
                const start = t.start_at ?? due;
                const p = proposals.get(t.id);
                return (
                  <div key={t.id} className="tl-row">
                    <button type="button" className="tl-label" onClick={() => onTask(t.id)} title={t.title}>
                      {t.title}
                    </button>
                    <div className="tl-track">
                      {start && due && (
                        <button
                          type="button"
                          className={`tl-bar ${t.status} ${critical.has(t.id) && t.status !== 'done' ? 'critical' : ''}`}
                          style={{ left: `${scale.pos(start)}%`, width: `${scale.width(start, due)}%` }}
                          onClick={() => onTask(t.id)}
                          aria-label={`${t.title}: ${formatDate(start, { short: true })} — ${formatDate(due, { short: true })}`}
                        />
                      )}
                      {p && <div className="tl-ghost" style={{ left: `${scale.pos(p.to_start)}%`, width: `${scale.width(p.to_start, p.to_due)}%` }} title={`Предложено: ${formatDate(p.to_start, { short: true })} — ${formatDate(p.to_due, { short: true })}`} />}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 240, right: 0, pointerEvents: 'none' }}>
            <div className="tl-today" style={{ left: `${scale.pos(roadmap.timeline.today)}%` }} />
            {goalDue && <div className="tl-due" style={{ left: `${scale.pos(goalDue)}%` }} title={`Срок цели: ${formatDate(goalDue)}`} />}
          </div>
        </div>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--surface-3)' }} />Не начата</span>
        <span><i style={{ background: 'var(--accent)' }} />В работе</span>
        <span><i style={{ background: 'var(--info)' }} />На проверке</span>
        <span><i style={{ background: 'var(--bad)' }} />Заблокирована</span>
        <span><i style={{ background: 'var(--good)' }} />Готово</span>
        <span><i style={{ background: 'var(--warn-soft)', border: '1.5px dashed var(--warn)' }} />Предложенный перенос</span>
        <span><i style={{ border: '2px dashed var(--ink-3)', background: 'none' }} />Срок цели</span>
      </div>
    </div>
  );
}

const LOSS_LABEL = (key: string) => (key === 'review' ? 'Ожидание проверки' : BLOCKER_LABELS[key as BlockerReason] ?? key);

/** «Где теряется время»: из истории статусов, а не из ощущений. */
export function RoadmapAnalytics({ roadmap }: { roadmap: Roadmap }) {
  const a = roadmap.analytics;
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <div className="grid-2">
      <section className="card stack">
        <h3>Ход процесса</h3>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-value">{a.medianLeadHours === null ? '—' : formatDuration(a.medianLeadHours)}</div>
            <div className="stat-label row" style={{ gap: 4 }}>
              <Timer size={12} /> Медиана выполнения
            </div>
          </div>
          <div className="stat">
            <div className="stat-value">{pct(a.waitShare)}</div>
            <div className="stat-label row" style={{ gap: 4 }}>
              <Hourglass size={12} /> Доля ожидания
            </div>
          </div>
          <div className="stat">
            <div className="stat-value">{pct(a.on_time_share)}</div>
            <div className="stat-label">Задач в срок</div>
          </div>
        </div>
        <p className="faint" style={{ fontSize: 13 }}>
          Завершено задач: {a.finished}. Считаем по истории статусов: сколько задача была в работе, на проверке и в блокировке.
        </p>
      </section>
      <section className="card stack">
        <h3>Где теряется время</h3>
        {a.bottlenecks.length ? (
          <div>
            {a.bottlenecks.map((b) => (
              <div key={b.key} className="loss-row">
                <span>{LOSS_LABEL(b.key)}</span>
                <span className="loss-bar" aria-hidden>
                  <span style={{ width: `${b.share}%` }} />
                </span>
                <span className="num faint" style={{ textAlign: 'right' }}>
                  {b.share}%
                </span>
              </div>
            ))}
            <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>
              Всего ожидания: {formatDuration(a.bottlenecks.reduce((s, b) => s + b.hours, 0))}. Начните с самой длинной полосы.
            </p>
          </div>
        ) : (
          <p className="faint">Блокировок и ожиданий пока не было.</p>
        )}
      </section>
    </div>
  );
}
