import { useState } from 'react';
import {
  checkUnitRange,
  DIRECTION_LABELS,
  DIRECTIONS,
  formatValue,
  LIMITS,
  todayIso,
  UNIT_IDS,
  UNITS,
  validateMetric,
  type Direction,
  type FieldErrors,
  type UnitId,
} from '@offix/core';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useInvalidateWork, useRecordObservation } from '../../lib/queries';
import type { GoalCard, Metric, Roadmap } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Segmented } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { OwnerPicker } from './GoalCreatePage';
import { parseNumber } from './goalForm';

const fieldsOf = (e: unknown): FieldErrors => (e instanceof ApiError ? e.fields : {});

/** Внести факт: одно число и необязательный комментарий. Прогресс пересчитывается сразу. */
export function ObservationDialog({ goalId, metric, onClose }: { goalId: string; metric: Metric; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const record = useRecordObservation(goalId);
  const toast = useToast();
  const unit = UNITS[metric.unit];
  const submit = async () => {
    const v = parseNumber(value);
    if (v === null || Number.isNaN(v)) return setError('Введите число');
    const range = checkUnitRange(metric.unit, v);
    if (range) return setError(range);
    try {
      await record.mutateAsync({ metricId: metric.id, value: v, note: note.trim() || undefined });
      toast('Значение сохранено, прогресс пересчитан');
      onClose();
    } catch (e) {
      setError(fieldsOf(e).value ?? (e as Error).message);
    }
  };
  return (
    <Dialog
      title="Внести фактическое значение"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={record.isPending} onClick={submit}>
            Сохранить
          </Button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 14 }}>
        {metric.name}. Было {formatValue(metric.baseline, metric.unit)}, цель {formatValue(metric.target, metric.unit)}, последнее значение — {formatValue(metric.current_value, metric.unit)}.
      </p>
      <Field label={`Значение, ${unit.short}`} required error={error}>
        {(p) => (
          <input
            className="input input-num"
            {...p}
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            style={{ maxWidth: 200 }}
          />
        )}
      </Field>
      <Field label="Откуда цифра" hint="Например: «замер по 120 заявкам за неделю»">
        {(p) => <input className="input" {...p} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

/** Редактирование сути цели. Права проверяет сервер; поля, которые менять нельзя, мы не показываем. */
export function EditGoalDialog({ goal, onClose }: { goal: GoalCard; onClose: () => void }) {
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description ?? '');
  const [ownerId, setOwnerId] = useState(goal.owner?.id ?? '');
  const [ownerName, setOwnerName] = useState(goal.owner?.display_name ?? '');
  const [dueAt, setDueAt] = useState(goal.due_at ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateWork();
  const toast = useToast();
  const save = async () => {
    const e: FieldErrors = {};
    if (!title.trim()) e.title = 'Введите название цели';
    else if (title.trim().length > LIMITS.title) e.title = `Не длиннее ${LIMITS.title} символов`;
    if (Object.keys(e).length) return setErrors(e);
    const patch: Record<string, unknown> = {};
    if (title.trim() !== goal.title) patch.title = title.trim();
    if ((description.trim() || null) !== goal.description) patch.description = description.trim() || null;
    if ((ownerId || null) !== (goal.owner?.id ?? null)) patch.owner_id = ownerId || null;
    if ((dueAt || null) !== goal.due_at) patch.due_at = dueAt || null;
    if (!Object.keys(patch).length) return onClose();
    setSaving(true);
    try {
      await api(`/goals/${goal.id}`, { method: 'PATCH', body: patch });
      await invalidate();
      toast('Цель обновлена');
      onClose();
    } catch (err) {
      setErrors({ ...fieldsOf(err), _: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="Изменить цель"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <Field label="Название" required error={errors.title} counter={{ value: title.length, max: LIMITS.title }}>
        {(p) => <input className="input" {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label="Описание" error={errors.description}>
        {(p) => <textarea className="textarea" {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Field label="Владелец" error={errors.owner_id}>
        {(p) => (
          <OwnerPicker
            {...p}
            value={ownerId}
            valueName={ownerName}
            onChange={(id, name) => {
              setOwnerId(id);
              setOwnerName(name);
            }}
          />
        )}
      </Field>
      <Field label="Срок" error={errors.due_at}>
        {(p) => <input className="input" type="date" {...p} min={todayIso()} value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={{ maxWidth: 240 }} />}
      </Field>
      {errors._ && <p className="field-error">{errors._}</p>}
    </Dialog>
  );
}

/** KPI для черновика, у которого показателя ещё не было. */
export function AddKpiDialog({ goalId, onClose }: { goalId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<UnitId>('minutes');
  const [direction, setDirection] = useState<Direction>('decrease');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateWork();
  const toast = useToast();
  const save = async () => {
    const m = { name: name.trim(), unit, direction, baseline: parseNumber(baseline) ?? NaN, target: parseNumber(target) ?? NaN };
    const e = validateMetric(m);
    if (Object.keys(e).length) return setErrors(e);
    setSaving(true);
    try {
      await api(`/goals/${goalId}/metrics`, { body: m });
      await invalidate();
      toast('KPI добавлен');
      onClose();
    } catch (err) {
      setErrors({ ...fieldsOf(err), _: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="Добавить KPI"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Добавить
          </Button>
        </>
      }
    >
      <Field label="Что измеряем" required error={errors.name}>
        {(p) => <input className="input" {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Время согласования заявки" />}
      </Field>
      <div className="row wrap" style={{ gap: 12 }}>
        <Field label="Единица">
          {(p) => (
            <select className="select" {...p} value={unit} onChange={(e) => setUnit(e.target.value as UnitId)}>
              {UNIT_IDS.map((u) => (
                <option key={u} value={u}>
                  {UNITS[u].label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="field">
          <span className="field-label">Направление</span>
          <Segmented label="Направление" value={direction} onChange={setDirection} options={DIRECTIONS.filter((d) => d !== 'maintain').map((d) => ({ value: d, label: DIRECTION_LABELS[d] }))} />
        </div>
      </div>
      <div className="kpi-inputs">
        <Field label="Сейчас" error={errors.baseline}>
          {(p) => <input className="input input-num" {...p} inputMode="decimal" value={baseline} onChange={(e) => setBaseline(e.target.value)} />}
        </Field>
        <span className="arrow" aria-hidden>
          →
        </span>
        <Field label="Цель" error={errors.target}>
          {(p) => <input className="input input-num" {...p} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />}
        </Field>
      </div>
      {errors._ && <p className="field-error">{errors._}</p>}
    </Dialog>
  );
}

/** Новая задача прямо из дорожной карты: в цель или подцель, с зависимостью. */
export function AddTaskDialog({ roadmap, onClose }: { roadmap: Roadmap; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [goalId, setGoalId] = useState(roadmap.subgoals[0]?.id ?? roadmap.goal.id);
  const [assigneeId, setAssigneeId] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [startAt, setStartAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [dependsOn, setDependsOn] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const invalidate = useInvalidateWork();
  const toast = useToast();
  const save = async () => {
    const e: FieldErrors = {};
    if (!title.trim()) e.title = 'Введите название задачи';
    if (startAt && dueAt && startAt > dueAt) e.due_at = 'Срок не может быть раньше даты начала';
    if (Object.keys(e).length) return setErrors(e);
    setSaving(true);
    try {
      await api('/tasks', {
        idempotencyKey: key,
        body: { title: title.trim(), goal_id: goalId, assignee_id: assigneeId || null, start_at: startAt || null, due_at: dueAt || null, depends_on: dependsOn ? [dependsOn] : [] },
      });
      await invalidate();
      toast('Задача добавлена');
      onClose();
    } catch (err) {
      setErrors({ ...fieldsOf(err), _: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };
  const open = roadmap.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  return (
    <Dialog
      title="Новая задача"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Добавить
          </Button>
        </>
      }
    >
      <Field label="Что сделать" required error={errors.title}>
        {(p) => <input className="input" {...p} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Настроить автозаполнение заявки" />}
      </Field>
      {roadmap.subgoals.length > 0 && (
        <Field label="Куда">
          {(p) => (
            <select className="select" {...p} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              {roadmap.subgoals.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
              <option value={roadmap.goal.id}>Сама цель, без подцели</option>
            </select>
          )}
        </Field>
      )}
      <Field label="Исполнитель" error={errors.assignee_id}>
        {(p) => (
          <OwnerPicker
            {...p}
            value={assigneeId}
            valueName={assigneeName}
            onChange={(id, name) => {
              setAssigneeId(id);
              setAssigneeName(name);
            }}
          />
        )}
      </Field>
      <div className="row wrap" style={{ gap: 12 }}>
        <Field label="Начало" error={errors.start_at}>
          {(p) => <input className="input" type="date" {...p} value={startAt} onChange={(e) => setStartAt(e.target.value)} />}
        </Field>
        <Field label="Срок" error={errors.due_at}>
          {(p) => <input className="input" type="date" {...p} min={startAt || undefined} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}
        </Field>
      </div>
      {open.length > 0 && (
        <Field label="Начать после" hint="Если задачу нельзя начать, пока не закончена другая" error={errors.depends_on}>
          {(p) => (
            <select className="select" {...p} value={dependsOn} onChange={(e) => setDependsOn(e.target.value)}>
              <option value="">Ни от чего не зависит</option>
              {open.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {errors._ && <p className="field-error">{errors._}</p>}
    </Dialog>
  );
}
