import { Ban, Check, CircleDot, Eye, Flag, Link2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { BLOCKER_LABELS, BLOCKER_REASONS, canTransitionTask, formatDate, isOverdue, TASK_ROLE_LABELS, TASK_STATUS_LABELS, todayIso, type BlockerReason, type TaskRole, type TaskStatus } from '@offix/core';
import { ApiError } from '../../lib/api';
import { useTask, useTaskStatus } from '../../lib/queries';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Panel, Skeleton } from '../../ui/Misc';
import { TaskStatusPill } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';
import { Discussion } from '../discussion/Discussion';

const ACTIONS: { to: TaskStatus; label: string; icon: React.ReactNode; variant: 'primary' | 'secondary' | 'danger' }[] = [
  { to: 'in_progress', label: 'Взять в работу', icon: <CircleDot size={16} />, variant: 'primary' },
  { to: 'review', label: 'На приёмку', icon: <Eye size={16} />, variant: 'secondary' },
  { to: 'done', label: 'Выполнено', icon: <Check size={16} />, variant: 'primary' },
  { to: 'blocked', label: 'Что-то мешает', icon: <Ban size={16} />, variant: 'danger' },
];

export function BlockDialog({ onClose, onSubmit, busy, error }: { onClose: () => void; onSubmit: (v: { reason: BlockerReason; note: string; next: string }) => void; busy: boolean; error?: string | null }) {
  const [reason, setReason] = useState<BlockerReason | null>(null);
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [touched, setTouched] = useState(false);
  return (
    <Dialog
      title="Что мешает?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              setTouched(true);
              if (reason) onSubmit({ reason, note, next });
            }}
          >
            Сообщить
          </Button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 14 }}>
        Руководитель увидит причину и поймёт, чем помочь, — а не просто красную задачу.
      </p>
      <div className="choice-grid" role="radiogroup" aria-label="Причина">
        {BLOCKER_REASONS.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className="choice" onClick={() => setReason(r)}>
            <span className="choice-title" style={{ fontSize: 14 }}>
              {BLOCKER_LABELS[r]}
            </span>
          </button>
        ))}
      </div>
      {touched && !reason && <div className="field-error">Выберите причину</div>}
      <Field label="Подробности" hint="Кого или чего ждём">
        {(p) => <input className="input" {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Например, нет доступа к справочнику" />}
      </Field>
      <Field label="Следующий шаг" hint="Что нужно сделать, чтобы снять блокировку">
        {(p) => <input className="input" {...p} value={next} onChange={(e) => setNext(e.target.value)} maxLength={500} placeholder="Например, запросить выгрузку у учебного офиса" />}
      </Field>
      {error && <div className="field-error">{error}</div>}
    </Dialog>
  );
}

export function TaskPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useTask(id);
  const status = useTaskStatus();
  const toast = useToast();
  const [blocking, setBlocking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = q.data;
  const today = todayIso();

  const change = (to: TaskStatus, extra: { blocked_reason?: string; blocked_note?: string; next_step?: string } = {}) =>
    status.mutate(
      { id, status: to, ...extra },
      {
        onSuccess: () => {
          setBlocking(false);
          setErr(null);
          toast(to === 'blocked' ? 'Руководитель увидит блокировку' : `Статус: ${TASK_STATUS_LABELS[to].toLowerCase()}`);
        },
        onError: (e) => {
          const msg = e instanceof ApiError ? Object.values(e.fields)[0] ?? e.message : 'Не удалось изменить статус';
          if (to === 'blocked') setErr(msg);
          else toast(msg, 'error');
        },
      },
    );

  return (
    <Panel title={t?.title ?? 'Задача'} subtitle="Задача" onClose={onClose}>
      {!t ? (
        <div className="stack">
          <Skeleton h={18} w="50%" />
          <Skeleton h={60} />
        </div>
      ) : (
        <div className="stack" style={{ '--gap': '22px' } as React.CSSProperties}>
          <div className="row wrap" style={{ gap: 8 }}>
            <TaskStatusPill status={t.status} overdue={isOverdue(t, today)} />
            {t.due_at && <span className="faint" style={{ fontSize: 13.5 }}>Срок {formatDate(t.due_at, { today })}</span>}
          </div>

          {t.blocker && (
            <div className="card card-tight" style={{ background: 'var(--bad-soft)', borderColor: 'transparent' }}>
              <div style={{ fontWeight: 620, color: 'var(--bad)' }}>{BLOCKER_LABELS[t.blocker.reason]}</div>
              {t.blocker.note && <div style={{ marginTop: 2 }}>{t.blocker.note}</div>}
              {t.blocker.next_step && (
                <div className="row" style={{ gap: 6, marginTop: 8, fontSize: 13.5 }}>
                  <Flag size={14} /> Следующий шаг: {t.blocker.next_step}
                </div>
              )}
              <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
                с {formatDate(t.blocker.since, { today })}
              </div>
            </div>
          )}

          {t.permissions?.status && t.status !== 'cancelled' && (
            <div className="row wrap" style={{ gap: 8 }}>
              {t.status === 'blocked' ? (
                <Button variant="primary" icon={<RotateCcw size={16} />} loading={status.isPending} onClick={() => change('in_progress')}>
                  Блокировка снята
                </Button>
              ) : (
                ACTIONS.filter((a) => canTransitionTask(t.status, a.to)).map((a) => (
                  <Button key={a.to} variant={a.variant} icon={a.icon} loading={status.isPending && status.variables?.status === a.to} onClick={() => (a.to === 'blocked' ? setBlocking(true) : change(a.to))}>
                    {a.label}
                  </Button>
                ))
              )}
            </div>
          )}

          <dl className="stack" style={{ '--gap': '12px', margin: 0 } as React.CSSProperties}>
            {[
              ['Исполнитель', t.assignee ? <span className="row" style={{ gap: 8 }}><Avatar name={t.assignee.display_name} size={22} />{t.assignee.display_name}</span> : '—'],
              ['Команда', t.team?.name ?? '—'],
              ['Подразделение', t.unit?.name ?? '—'],
              ['Период', t.start_at || t.due_at ? `${t.start_at ? formatDate(t.start_at, { short: true, today }) : '…'} — ${t.due_at ? formatDate(t.due_at, { short: true, today }) : '…'}` : '—'],
            ].map(([k, v]) => (
              <div key={k as string} className="spread" style={{ fontSize: 14 }}>
                <dt className="faint">{k}</dt>
                <dd style={{ margin: 0, textAlign: 'right' }}>{v}</dd>
              </div>
            ))}
          </dl>

          {t.definition_of_done && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Критерий готовности</div>
              <p>{t.definition_of_done}</p>
            </div>
          )}

          {t.participants.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Участники</div>
              {t.participants.map((p) => (
                <div key={p.user_id + p.role} className="row" style={{ gap: 8, padding: '4px 0', fontSize: 14 }}>
                  <Avatar name={p.display_name} size={22} /> {p.display_name}
                  <span className="faint">· {TASK_ROLE_LABELS[p.role as TaskRole] ?? p.role}</span>
                </div>
              ))}
            </div>
          )}

          {t.dependencies.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Связи</div>
              {t.dependencies.map((d) => (
                <div key={d.id + d.direction} className="row" style={{ gap: 8, padding: '6px 0', fontSize: 14 }}>
                  <Link2 size={14} className="faint" />
                  <span className="faint" style={{ minWidth: 92 }}>{d.direction === 'before' ? 'Ждёт' : 'Задерживает'}</span>
                  <span className="grow clip">{d.title}</span>
                  <TaskStatusPill status={d.status} overdue={isOverdue(d, today)} />
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Обсуждение</div>
            <Discussion type="task" id={t.id} compact />
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>История</div>
            <ol className="stack" style={{ '--gap': '10px', listStyle: 'none', padding: 0, margin: 0 } as React.CSSProperties}>
              {[...t.history].reverse().map((h, i) => (
                <li key={i} className="row" style={{ gap: 10, fontSize: 13.5, alignItems: 'flex-start' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, marginTop: 6, background: h.status === 'blocked' ? 'var(--bad)' : h.status === 'done' ? 'var(--good)' : 'var(--line-strong)', flex: 'none' }} />
                  <span className="grow">
                    {TASK_STATUS_LABELS[h.status]}
                    {h.blocked_reason ? ` — ${BLOCKER_LABELS[h.blocked_reason].toLowerCase()}` : ''}
                    {h.note ? `: ${h.note}` : ''}
                    <span className="faint"> · {h.actor_name ?? 'система'}</span>
                  </span>
                  <span className="faint num">{formatDate(h.at, { short: true, today })}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {blocking && <BlockDialog busy={status.isPending} error={err} onClose={() => setBlocking(false)} onSubmit={(v) => change('blocked', { blocked_reason: v.reason, blocked_note: v.note || undefined, next_step: v.next || undefined })} />}
    </Panel>
  );
}
