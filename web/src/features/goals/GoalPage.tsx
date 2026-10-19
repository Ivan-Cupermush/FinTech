import { ArrowLeft, Check, CirclePause, CirclePlay, Flag, MessageSquare, Pencil, Plus, Rocket, Send, Sheet, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDate, GOAL_TYPE_LABELS, KPI_STATE_LABELS, type Risk } from '@offix/core';
import { api, ApiError } from '../../lib/api';
import { useInvalidateWork, useRoadmap } from '../../lib/queries';
import { useQuery } from '@tanstack/react-query';
import type { GoalCard, Roadmap } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { KpiTrack } from '../../ui/KpiTrack';
import { Dialog, Empty, Segmented, Skeleton } from '../../ui/Misc';
import { GoalStatusPill, Pill } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';
import { TaskPanel } from '../tasks/TaskPanel';
import { AddKpiDialog, AddTaskDialog, EditGoalDialog, ObservationDialog } from './goalDialogs';
import { ImportDialog } from './ImportDialog';
import { DueLabel, RiskList } from './parts';
import { RoadmapAnalytics, RoadmapTimeline, RoadmapTree } from './roadmapViews';
import './goals.css';

type View = 'tree' | 'timeline' | 'analytics' | 'discussion';
type DialogKind = 'observe' | 'import' | 'edit' | 'kpi' | 'task' | 'cancel' | null;

/** Рабочее пространство цели: результат сверху, путь к нему ниже. */
export function GoalPage() {
  const { id = '' } = useParams();
  const q = useRoadmap(id);
  const [view, setView] = useState<View>('tree');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  if (q.isLoading)
    return (
      <div className="page stack">
        <Skeleton h={14} w={120} />
        <Skeleton h={34} w="60%" />
        <Skeleton h={80} />
        <Skeleton h={240} />
      </div>
    );
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="page">
        <div className="card">
          <Empty title={notFound ? 'Цель не найдена' : 'Не удалось загрузить цель'} action={<Link className="btn btn-secondary" to="/app/goals">К списку целей</Link>}>
            {notFound ? 'Возможно, её удалили или у вас нет к ней доступа.' : (q.error as Error | null)?.message}
          </Empty>
        </div>
      </div>
    );
  }

  const r = q.data;
  const g = r.goal;
  const primary = g.metrics.find((m) => m.is_primary) ?? g.metrics[0] ?? null;

  return (
    <div className="page">
      <Link to={g.parent_goal_id ? `/app/goals/${g.parent_goal_id}` : '/app/goals'} className="row faint" style={{ gap: 6, fontSize: 14, marginBottom: 16, width: 'fit-content' }}>
        <ArrowLeft size={15} /> {g.parent_goal_id ? 'К родительской цели' : 'Все цели'}
      </Link>

      <header className="goal-hero">
        <div className="stack" style={{ '--gap': '12px', minWidth: 0 } as React.CSSProperties}>
          <div className="row wrap" style={{ gap: 6 }}>
            <GoalStatusPill status={g.status} />
            <Pill plain>{GOAL_TYPE_LABELS[g.type]}</Pill>
            {g.units.map((u) => (
              <Pill key={u.id} plain>
                {u.name}
              </Pill>
            ))}
          </div>
          <h1>{g.title}</h1>
          {g.description && <p className="muted" style={{ maxWidth: 680 }}>{g.description}</p>}
          <div className="row wrap" style={{ gap: 16 }}>
            {g.owner ? (
              <span className="row" style={{ gap: 8, fontSize: 14 }}>
                <Avatar name={g.owner.display_name} size={24} /> {g.owner.display_name}
                <span className="faint">· владелец</span>
              </span>
            ) : (
              <span className="faint" style={{ fontSize: 14 }}>Владелец не назначен</span>
            )}
            <DueLabel due={g.due_at} today={r.timeline.today} />
          </div>
          <GoalActions goal={g} onDialog={setDialog} />
        </div>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          {primary ? (
            <>
              <div className="eyebrow">{primary.name}</div>
              <KpiTrack baseline={primary.baseline} target={primary.target} current={primary.current_value} unit={primary.unit} progress={primary.progress} name={primary.name} size="xl" />
              <div className="spread" style={{ fontSize: 13, flexWrap: 'wrap', gap: 8 }}>
                <span className="faint">
                  {primary.last_observed_at ? `Замер ${formatDate(primary.last_observed_at.slice(0, 10), { today: r.timeline.today })} · ${KPI_STATE_LABELS[primary.progress.state]}` : 'Фактических замеров ещё не было'}
                </span>
                {g.permissions.record && g.status !== 'draft' && (
                  <span className="row wrap" style={{ gap: 6 }}>
                    <Button size="sm" variant="ghost" icon={<Sheet size={14} />} onClick={() => setDialog('import')}>
                      Импорт из таблицы
                    </Button>
                    <Button size="sm" variant="accent" onClick={() => setDialog('observe')}>
                      Внести значение
                    </Button>
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="card card-tight stack" style={{ '--gap': '8px' } as React.CSSProperties}>
              <b>KPI не задан</b>
              <span className="faint" style={{ fontSize: 14 }}>Без показателя цель нельзя запустить: непонятно, что считать результатом.</span>
              {g.permissions.edit && (
                <Button size="sm" variant="accent" icon={<Plus size={14} />} onClick={() => setDialog('kpi')}>
                  Добавить KPI
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      {g.status === 'draft' && <ActivationCard goal={g} onFix={setDialog} />}

      {r.risks.length > 0 && g.status === 'active' && (
        <section className="card" style={{ marginBottom: 20 }} aria-labelledby="risks-h">
          <div className="section-title">
            <h3 id="risks-h">Риски по цели</h3>
            <span className="faint num" style={{ fontSize: 13 }}>
              {r.risks.length}
            </span>
          </div>
          <RiskList risks={r.risks} onTask={setTaskId} action={(risk) => (risk.proposals?.length && g.permissions.manage ? <RescheduleAction goalId={g.id} risk={risk} roadmap={r} /> : null)} />
        </section>
      )}

      <div className="spread wrap" style={{ marginBottom: 16 }}>
        <Segmented
          label="Вид дорожной карты"
          value={view}
          onChange={setView}
          options={[
            { value: 'tree', label: 'Карта' },
            { value: 'timeline', label: 'Таймлайн' },
            { value: 'analytics', label: 'Аналитика' },
            { value: 'discussion', label: 'Обсуждение' },
          ]}
        />
        {g.permissions.edit && (view === 'tree' || view === 'timeline') && (
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setDialog('task')}>
            Задача
          </Button>
        )}
      </div>

      {view === 'tree' && <RoadmapTree roadmap={r} onTask={setTaskId} />}
      {view === 'timeline' && <RoadmapTimeline roadmap={r} onTask={setTaskId} />}
      {view === 'analytics' && <RoadmapAnalytics roadmap={r} />}
      {view === 'discussion' && <Comments goalId={g.id} />}

      {taskId && <TaskPanel id={taskId} onClose={() => setTaskId(null)} />}
      {dialog === 'observe' && primary && <ObservationDialog goalId={g.id} metric={primary} onClose={() => setDialog(null)} />}
      {dialog === 'import' && primary && <ImportDialog goalId={g.id} metrics={g.metrics} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <EditGoalDialog goal={g} onClose={() => setDialog(null)} />}
      {dialog === 'kpi' && <AddKpiDialog goalId={g.id} onClose={() => setDialog(null)} />}
      {dialog === 'task' && <AddTaskDialog roadmap={r} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelDialog goal={g} onClose={() => setDialog(null)} />}
    </div>
  );
}

function useGoalStatus(goalId: string) {
  const invalidate = useInvalidateWork();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const run = async (status: string, okText: string) => {
    setPending(status);
    try {
      await api(status === 'active' ? `/goals/${goalId}/activate` : `/goals/${goalId}/status`, { body: status === 'active' ? {} : { status } });
      await invalidate();
      toast(okText);
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    } finally {
      setPending(null);
    }
  };
  return { run, pending };
}

/** Действия зависят от статуса: в каждом статусе — только осмысленные переходы. */
function GoalActions({ goal, onDialog }: { goal: GoalCard; onDialog: (d: DialogKind) => void }) {
  const { run, pending } = useGoalStatus(goal.id);
  const p = goal.permissions;
  if (!p.edit && !p.manage) return null;
  return (
    <div className="row wrap" style={{ gap: 8 }}>
      {p.edit && (
        <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => onDialog('edit')}>
          Изменить
        </Button>
      )}
      {p.manage && goal.status === 'active' && (
        <>
          <Button size="sm" variant="ghost" icon={<CirclePause size={14} />} loading={pending === 'on_hold'} onClick={() => run('on_hold', 'Цель приостановлена')}>
            Приостановить
          </Button>
          <Button size="sm" variant="ghost" icon={<Flag size={14} />} loading={pending === 'completed'} onClick={() => run('completed', 'Цель завершена')}>
            Завершить
          </Button>
        </>
      )}
      {p.manage && goal.status === 'on_hold' && (
        <Button size="sm" variant="ghost" icon={<CirclePlay size={14} />} loading={pending === 'active'} onClick={() => run('active', 'Цель снова в работе')}>
          Возобновить
        </Button>
      )}
      {p.manage && goal.status === 'completed' && (
        <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} loading={pending === 'active'} onClick={() => run('active', 'Цель возвращена в работу')}>
          Вернуть в работу
        </Button>
      )}
      {p.manage && goal.status !== 'cancelled' && goal.status !== 'completed' && (
        <Button size="sm" variant="ghost" onClick={() => onDialog('cancel')} style={{ color: 'var(--bad)' }}>
          Отменить цель
        </Button>
      )}
    </div>
  );
}

/** Черновик: что осталось до запуска и кнопка, которая доступна только когда всё готово. */
function ActivationCard({ goal, onFix }: { goal: GoalCard; onFix: (d: DialogKind) => void }) {
  const { run, pending } = useGoalStatus(goal.id);
  const ready = goal.checklist.every((c) => c.done);
  const fixFor = (key: string): DialogKind => (key === 'metric' || key === 'kpi' ? 'kpi' : 'edit');
  return (
    <section className="card" style={{ marginBottom: 20 }} aria-labelledby="act-h">
      <div className="spread wrap" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <h3 id="act-h">{ready ? 'Цель готова к запуску' : 'Чтобы запустить цель'}</h3>
          <ul className="checklist">
            {goal.checklist.map((c) => (
              <li key={c.key} className={`check ${c.done ? 'done' : ''}`}>
                <span className="check-dot" aria-hidden>
                  {c.done && <Check size={12} />}
                </span>
                <span>{c.label}</span>
                {!c.done && goal.permissions.edit && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFix(fixFor(c.key))}>
                    Заполнить
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
        {goal.permissions.activate && (
          <Button variant="primary" icon={<Rocket size={16} />} disabled={!ready} loading={pending === 'active'} onClick={() => run('active', 'Цель запущена — участники получили уведомления')}>
            Запустить цель
          </Button>
        )}
      </div>
    </section>
  );
}

function CancelDialog({ goal, onClose }: { goal: GoalCard; onClose: () => void }) {
  const { run, pending } = useGoalStatus(goal.id);
  const navigate = useNavigate();
  return (
    <Dialog
      title="Отменить цель?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Не отменять
          </Button>
          <Button
            variant="danger"
            loading={pending === 'cancelled'}
            onClick={async () => {
              if (await run('cancelled', 'Цель отменена')) navigate('/app/goals');
            }}
          >
            Отменить цель
          </Button>
        </>
      }
    >
      <p className="muted">
        «{goal.title}» исчезнет из Пульса и списков в работе. История и замеры сохранятся в журнале, но вернуть отменённую цель нельзя — придётся создать новую.
      </p>
    </Dialog>
  );
}

/** Перенос сроков применяется только после явного подтверждения руководителя. */
function RescheduleAction({ goalId, risk, roadmap }: { goalId: string; risk: Risk; roadmap: Roadmap }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateWork();
  const toast = useToast();
  const titleOf = (id: string) => roadmap.tasks.find((t) => t.id === id)?.title ?? 'Задача';
  const proposals = risk.proposals ?? [];
  const apply = async () => {
    setSaving(true);
    try {
      await api(`/goals/${goalId}/reschedule`, { body: { changes: proposals.map((p) => ({ task_id: p.task_id, start_at: p.to_start, due_at: p.to_due })) } });
      await invalidate();
      toast('Сроки перенесены, исполнители получили уведомления');
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div style={{ marginTop: 8 }}>
        <Button size="sm" onClick={() => setOpen(true)}>
          Посмотреть перенос сроков
        </Button>
      </div>
      {open && (
        <Dialog
          title="Перенести сроки"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Оставить как есть
              </Button>
              <Button variant="primary" loading={saving} onClick={apply}>
                Применить перенос
              </Button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 14 }}>
            Система предлагает сдвинуть зависимые задачи, сохранив их длительность. Ничего не изменится, пока вы не подтвердите.
          </p>
          <div className="list">
            {proposals.map((p) => (
              <div key={p.task_id} className="list-row" style={{ cursor: 'default' }}>
                <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                  <span style={{ fontWeight: 560 }}>{titleOf(p.task_id)}</span>
                  <span className="faint" style={{ fontSize: 12.5 }}>
                    из-за: {p.because.map(titleOf).join(', ')}
                  </span>
                </span>
                <span className="num" style={{ fontSize: 13.5, textAlign: 'right' }}>
                  <s className="faint">{formatDate(p.from_due, { short: true })}</s> → <b>{formatDate(p.to_due, { short: true })}</b>
                  <div className="faint">+{p.shift_days} дн.</div>
                </span>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}

interface CommentRow {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string;
}

function Comments({ goalId }: { goalId: string }) {
  const q = useQuery({ queryKey: ['comments', goalId], queryFn: () => api<CommentRow[]>(`/goals/${goalId}/comments`) });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api(`/goals/${goalId}/comments`, { body: { body: text } });
      setText('');
      await q.refetch();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="card stack" style={{ maxWidth: 760 }}>
      {q.data?.length ? (
        <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
          {q.data.map((c) => (
            <div key={c.id} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
              <Avatar name={c.author_name} size={30} />
              <div className="stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                <span style={{ fontSize: 13.5 }}>
                  <b>{c.author_name}</b> <span className="faint">{formatDate(c.created_at.slice(0, 10), { short: true })}</span>
                </span>
                <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !q.isLoading && <Empty icon={<MessageSquare size={22} />} title="Обсуждения пока нет">Вопросы по цели лучше задавать здесь, а не в мессенджере: контекст останется рядом с целью.</Empty>
      )}
      <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
        <textarea
          className="textarea grow"
          rows={2}
          aria-label="Комментарий"
          placeholder="Написать комментарий…"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <Button variant="primary" icon={<Send size={15} />} loading={sending} disabled={!text.trim()} onClick={send} aria-label="Отправить" />
      </div>
    </section>
  );
}
