import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { CHECKPOINTS_MAX, CHECKPOINT_STATE_LABELS, checkpointProgress, checkpointState, formatDate, validateCheckpoint, type Checkpoint } from '@offix/core';
import { ApiError } from '../../lib/api';
import type { TaskDetail } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { PeopleList } from '../chats/dialogs';
import { tasksApi, useTaskAction } from './data';

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось, попробуйте ещё раз');

/**
 * Контрольные точки: промежуточные сроки внутри задачи. Ставит автор или
 * руководитель; отмечает «пройдена» тот, кто принимает работу, — автор,
 * согласующий или наблюдатель (в просьбе — сам исполнитель).
 */
export function CheckpointsSection({ task, today }: { task: TaskDetail; today: string }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(task.due_at && task.due_at >= today ? today : (task.due_at ?? today));
  const [touched, setTouched] = useState(false);
  const add = useTaskAction((v: { title: string; due_at: string }) => tasksApi.addCheckpoint(task.id, v));
  const mark = useTaskAction((v: { cid: string; status: Checkpoint['status'] }) => tasksApi.markCheckpoint(task.id, v.cid, v.status));
  const remove = useTaskAction((cid: string) => tasksApi.removeCheckpoint(task.id, cid));
  // В закрытой задаче точки уже не ставят и не убирают.
  const edit = !!task.permissions?.edit && !task.archived && task.status !== 'done' && task.status !== 'cancelled';
  const canMark = !!task.permissions?.mark && !task.archived;
  const list = [...task.checkpoints].sort((a, b) => a.due_at.localeCompare(b.due_at));
  const progress = checkpointProgress(list);
  const errors = validateCheckpoint({ title, due_at: due }, task.due_at);
  if (!list.length && !edit) return null;

  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    add.mutate(
      { title: title.trim(), due_at: due },
      {
        onSuccess: () => {
          setTitle('');
          setTouched(false);
          toast(task.assignee ? `${task.assignee.display_name} увидит точку во «Входящих»` : 'Точка добавлена');
        },
        onError: (e) => toast(errText(e), 'error'),
      },
    );
  };

  return (
    <div>
      <div className="spread" style={{ marginBottom: 6 }}>
        <div className="eyebrow">Контрольные точки</div>
        {list.length > 0 && (
          <span className="faint num" style={{ fontSize: 12.5 }}>
            {progress.done} из {progress.total}
          </span>
        )}
      </div>
      {list.length > 0 && (
        <ul className="cp-list">
          {list.map((c) => {
            const state = checkpointState(c, today);
            const done = c.status === 'done';
            return (
              <li key={c.id} className={`cp-item is-${state}`}>
                <button
                  type="button"
                  className="cp-mark"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={done ? `Снять отметку: ${c.title}` : `Отметить пройденной: ${c.title}`}
                  disabled={!canMark || mark.isPending}
                  onClick={() => mark.mutate({ cid: c.id, status: done ? 'pending' : 'done' }, { onError: (e) => toast(errText(e), 'error') })}
                >
                  {done ? <Check size={14} /> : c.status === 'missed' ? <X size={14} /> : null}
                </button>
                <span className="grow stack" style={{ '--gap': '1px', minWidth: 0 } as React.CSSProperties}>
                  <span className="cp-title clip">{c.title}</span>
                  {done && c.done_by_name && <span className="faint" style={{ fontSize: 12 }}>Отметил(а) {c.done_by_name}</span>}
                </span>
                <span className={`cp-when is-${state} num`}>
                  {state === 'late' || state === 'missed' || state === 'soon' ? `${CHECKPOINT_STATE_LABELS[state]} · ` : ''}
                  {formatDate(c.due_at, { short: true, today })}
                </span>
                {canMark && state === 'late' && (
                  <Button variant="ghost" size="sm" onClick={() => mark.mutate({ cid: c.id, status: 'missed' }, { onError: (e) => toast(errText(e), 'error') })}>
                    Сорвана
                  </Button>
                )}
                {edit && (
                  <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={`Убрать точку «${c.title}»`} onClick={() => remove.mutate(c.id, { onError: (e) => toast(errText(e), 'error') })} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {edit && list.length < CHECKPOINTS_MAX && (
        <>
          <div className="cp-add">
            <input className="input" aria-label="Новая контрольная точка" placeholder="Что будет готово" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            <input className="input" type="date" aria-label="Срок точки" value={due} max={task.due_at ?? undefined} onChange={(e) => setDue(e.target.value)} />
            <Button icon={<Plus size={15} />} loading={add.isPending} onClick={submit}>
              Добавить
            </Button>
          </div>
          {touched && Object.values(errors)[0] && (
            <div className="field-error" role="alert" style={{ marginTop: 6 }}>
              {Object.values(errors)[0]}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Наблюдатели рядом с согласующим: видят ход работы и отмечают точки, но не меняют статус. */
export function WatchersSection({ task }: { task: TaskDetail }) {
  const [editing, setEditing] = useState(false);
  const watchers = task.participants.filter((p) => p.role === 'watcher');
  const edit = !!task.permissions?.edit && !task.archived;
  if (task.kind === 'request' || (!watchers.length && !edit)) return null;
  return (
    <div>
      <div className="spread" style={{ marginBottom: 6 }}>
        <div className="eyebrow">Наблюдатели</div>
        {edit && (
          <Button variant="ghost" size="sm" icon={watchers.length ? <Pencil size={14} /> : <Plus size={14} />} aria-label={watchers.length ? 'Изменить наблюдателей' : 'Добавить наблюдателей'} onClick={() => setEditing(true)}>
            {watchers.length ? 'Изменить' : 'Добавить'}
          </Button>
        )}
      </div>
      {watchers.length ? (
        <div className="row wrap" style={{ gap: 8 }}>
          {watchers.map((w) => (
            <span key={w.user_id} className="row" style={{ gap: 6, fontSize: 14 }}>
              <Avatar name={w.display_name} size={22} id={w.user_id} /> {w.display_name}
            </span>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 13.5, margin: 0 }}>
          Добавьте тех, кому важно видеть ход работы: они получат уведомления и смогут отмечать контрольные точки.
        </p>
      )}
      {editing && <WatchersDialog task={task} initial={watchers.map((w) => w.user_id)} onClose={() => setEditing(false)} />}
    </div>
  );
}

function WatchersDialog({ task, initial, onClose }: { task: TaskDetail; initial: string[]; onClose: () => void }) {
  const [ids, setIds] = useState(initial);
  const toast = useToast();
  const save = useTaskAction((v: string[]) => tasksApi.watchers(task.id, v));
  const exclude = [task.assignee?.id].filter((x): x is string => !!x);
  return (
    <Dialog
      title="Наблюдатели"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() =>
              save.mutate(ids, {
                onSuccess: () => {
                  toast(ids.length ? 'Наблюдатели сохранены' : 'Наблюдателей больше нет');
                  onClose();
                },
                onError: (e) => toast(errText(e), 'error'),
              })
            }
          >
            Сохранить
          </Button>
        </>
      }
    >
      <PeopleList selected={ids} exclude={exclude} excludeNote="исполнитель" onToggle={(id) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))} />
    </Dialog>
  );
}
