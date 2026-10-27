import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { CHECKPOINTS_MAX, requestDuePresets, todayIso, validateRequest } from '@offix/core';
import { ApiError } from '../../lib/api';
import { useMe, useUsers } from '../../lib/queries';
import type { Task } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { PeopleList } from '../chats/dialogs';
import { tasksApi, useTaskAction } from './data';

/**
 * Просьба коллеге из любого отдела: кого просим, о чём и к какому дню.
 * Без цели и приёмки — исполнитель сам отмечает «Выполнено», а вы благодарите.
 */
export function RequestDialog({ onClose, onCreated, to }: { onClose: () => void; onCreated?: (t: Task) => void; to?: string }) {
  const me = useMe();
  const users = useUsers();
  const toast = useToast();
  const today = todayIso();
  const [assignee, setAssignee] = useState<string | null>(to ?? null);
  const [picking, setPicking] = useState(!to);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [due, setDue] = useState('');
  const [cps, setCps] = useState<{ title: string; due_at: string }[]>([]);
  const [touched, setTouched] = useState(false);
  const [server, setServer] = useState<Record<string, string>>({});
  const create = useTaskAction(tasksApi.create);
  const person = users.data?.find((u) => u.id === assignee);
  const errors = { ...validateRequest({ title, assignee_id: assignee, due_at: due || null, checkpoints: cps }, me.data?.id ?? '', today), ...server };
  const shown = (k: string) => (touched ? errors[k] : undefined);

  const submit = () => {
    setTouched(true);
    if (Object.keys(validateRequest({ title, assignee_id: assignee, due_at: due || null, checkpoints: cps }, me.data?.id ?? '', today)).length) return;
    create.mutate(
      { kind: 'request', title: title.trim(), description: details.trim() || null, assignee_id: assignee, due_at: due || null, checkpoints: cps.map((c) => ({ title: c.title.trim(), due_at: c.due_at })) },
      {
        onSuccess: (t) => {
          toast(`Просьба отправлена — ${person?.display_name ?? 'коллега'} увидит её во «Входящих»`);
          onCreated?.(t);
          onClose();
        },
        onError: (e) => {
          if (e instanceof ApiError && Object.keys(e.fields).length) setServer(e.fields);
          else toast(e instanceof ApiError ? e.message : 'Не удалось отправить просьбу', 'error');
        },
      },
    );
  };

  return (
    <Dialog
      title="Новая просьба"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            Отправить просьбу
          </Button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>
        Попросите коллегу из любого отдела. Он отметит «Выполнено», а вы сможете поблагодарить.
      </p>
      <div className="field">
        <div className="field-label">Кого просите</div>
        {person && !picking ? (
          <div className="row" style={{ gap: 10 }}>
            <Avatar name={person.display_name} size={32} id={person.id} />
            <span className="grow stack" style={{ '--gap': '0px', minWidth: 0 } as React.CSSProperties}>
              <span className="clip" style={{ fontWeight: 600 }}>
                {person.display_name}
              </span>
              {person.position && <span className="clip faint" style={{ fontSize: 13 }}>{person.position}</span>}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
              Изменить
            </Button>
          </div>
        ) : (
          <PeopleList
            single
            selected={assignee ? [assignee] : []}
            onToggle={(id) => {
              setAssignee(id);
              setPicking(false);
              setServer(({ assignee_id: _, ...rest }) => rest);
            }}
          />
        )}
        {shown('assignee_id') && <div className="field-error" role="alert">{errors.assignee_id}</div>}
      </div>
      <Field label="О чём просите" required error={shown('title')} counter={{ value: title.length, max: 200 }}>
        {(p) => <input className="input" {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, подписать приказ о практике" />}
      </Field>
      <Field label="Подробности" hint="Что именно нужно и где взять данные">
        {(p) => <textarea className="input" {...p} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={5000} />}
      </Field>
      <Field label="К какому дню" hint="Можно без срока" error={shown('due_at')}>
        {(p) => (
          <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <div className="req-presets" role="group" aria-label="Быстрый выбор срока">
              {requestDuePresets(today).map((o) => (
                <button key={o.label} type="button" className="req-preset" aria-pressed={due === o.value} onClick={() => setDue(due === o.value ? '' : o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
            <input className="input" type="date" {...p} min={today} value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        )}
      </Field>
      <div className="field">
        <div className="spread">
          <div className="field-label">Контрольные точки</div>
          {cps.length < CHECKPOINTS_MAX && (
            <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setCps((l) => [...l, { title: '', due_at: due || today }])}>
              Добавить
            </Button>
          )}
        </div>
        {!cps.length && <div className="field-hint">Промежуточные сроки: например, «черновик — к среде».</div>}
        {cps.map((c, i) => (
          <div key={i}>
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow" aria-label={`Контрольная точка ${i + 1}`} value={c.title} placeholder="Что должно быть готово" onChange={(e) => setCps((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <input className="input" type="date" style={{ width: 150 }} aria-label={`Срок точки ${i + 1}`} value={c.due_at} onChange={(e) => setCps((l) => l.map((x, j) => (j === i ? { ...x, due_at: e.target.value } : x)))} />
              <Button variant="ghost" size="sm" icon={<Trash2 size={15} />} aria-label={`Убрать точку ${i + 1}`} onClick={() => setCps((l) => l.filter((_, j) => j !== i))} />
            </div>
            {shown(`checkpoints.${i}`) && (
              <div className="field-error" role="alert">
                <X size={14} aria-hidden /> {errors[`checkpoints.${i}`]}
              </div>
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
