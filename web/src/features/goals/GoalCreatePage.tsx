import { ArrowLeft, ArrowRight, Check, Info, Lightbulb, Plus, Rocket, Search, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  activationChecklist,
  canCreateGoal,
  DIRECTION_LABELS,
  formatChange,
  formatDate,
  GOAL_TYPE_HINTS,
  GOAL_TYPE_LABELS,
  GOAL_TYPES,
  kpiProgress,
  LIMITS,
  plannedChange,
  titleHint,
  todayIso,
  UNIT_IDS,
  UNIT_TYPE_LABELS,
  UNITS,
  type Direction,
} from '@offix/core';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useInvalidateWork, useMe, useUnits, useUsers } from '../../lib/queries';
import type { GoalCard } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { PageHero } from '../../ui/fx/PageHero';
import { Field } from '../../ui/Field';
import { KpiTrack } from '../../ui/KpiTrack';
import { Dialog, Segmented } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { duePresets, emptyForm, formErrors, hasKpi, parseNumber, stepErrors, toPayload, type GoalFormState } from './goalForm';
import './goals.css';

const STEPS = ['Результат', 'Ответственность и срок', 'План'] as const;
const DRAFT_KEY = 'offix.goal-draft';
const ROLE_LABELS = { owner: 'Отвечает', executor: 'Исполняет', approver: 'Принимает', contributor: 'Участвует' } as const;

function loadSaved(): GoalFormState {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...emptyForm(), ...JSON.parse(raw) } : emptyForm();
  } catch {
    return emptyForm();
  }
}

export function OwnerPicker({ value, valueName, onChange, error, ...aria }: { value: string; valueName: string; onChange: (id: string, name: string) => void; error?: string; id: string; 'aria-invalid': boolean; 'aria-describedby': string }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(!value);
  const users = useUsers(search);
  const list = (users.data ?? []).filter((u) => u.role !== 'observer');
  if (value && !open) {
    return (
      <div className="picker">
        <div className="picker-item" style={{ borderTop: 0 }}>
          <Avatar name={valueName} size={32} />
          <span className="grow">
            <span style={{ fontWeight: 600, display: 'block' }}>{valueName}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Изменить
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="picker" style={error ? { borderColor: 'var(--bad)' } : undefined}>
      <div className="row" style={{ padding: '0 12px' }}>
        <Search size={16} className="faint" />
        <input
          {...aria}
          className="input"
          style={{ border: 0, boxShadow: 'none', paddingLeft: 4 }}
          placeholder="Имя, должность или отдел"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
        />
      </div>
      <div className="picker-list" role="listbox" aria-label="Сотрудники">
        {users.isLoading && <div className="picker-item faint">Ищем…</div>}
        {!users.isLoading && !list.length && <div className="picker-item faint">Никого не нашли. Проверьте написание или пригласите сотрудника в разделе «Организация».</div>}
        {list.map((u) => (
          <button
            key={u.id}
            type="button"
            role="option"
            aria-selected={u.id === value}
            className="picker-item"
            onClick={() => {
              onChange(u.id, u.display_name);
              setOpen(false);
            }}
          >
            <Avatar name={u.display_name} size={30} />
            <span className="grow">
              <span style={{ fontWeight: 560, display: 'block' }}>{u.display_name}</span>
              <span className="faint clip" style={{ fontSize: 12.5, display: 'block' }}>
                {[u.position, u.units.map((x) => x.name).join(', ')].filter(Boolean).join(' · ')}
              </span>
            </span>
            {u.id === value && <Check size={16} />}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Мастер создания цели (ТЗ 4.3). Три шага; форма помнит всё при переходах и
 * временной ошибке сети; одна цель на одну отправку (ключ повторной отправки);
 * после сохранения — карточка цели, а не список.
 */
export function GoalCreatePage() {
  const navigate = useNavigate();
  const me = useMe();
  const unitsQ = useUnits();
  const toast = useToast();
  const invalidate = useInvalidateWork();
  const today = todayIso();
  const [f, setF] = useState<GoalFormState>(loadSaved);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState<Set<number>>(new Set());
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'draft' | 'active' | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [subgoal, setSubgoal] = useState('');
  const idemKey = useRef(newIdempotencyKey());
  const dirty = JSON.stringify(f) !== JSON.stringify(emptyForm());

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(f));
    } catch {
      /* ignore */
    }
  }, [f]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty && !busy) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, busy]);

  const set = <K extends keyof GoalFormState>(k: K, v: GoalFormState[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setServerErrors((e) => {
      const { [k]: _, ...rest } = e;
      return rest;
    });
  };
  const touch = (k: string) => setTouched((t) => new Set(t).add(k));

  const errors = useMemo(() => ({ ...formErrors(f, 'draft', today), ...serverErrors }), [f, today, serverErrors]);
  const activeErrors = useMemo(() => formErrors(f, 'active', today), [f, today]);
  const show = (k: string, s: number) => (touched.has(k) || attempted.has(s) ? errors[k] : undefined);

  const baseline = parseNumber(f.baseline);
  const target = parseNumber(f.target);
  const change = baseline !== null && target !== null && Number.isFinite(baseline) && Number.isFinite(target) ? plannedChange(baseline, target) : null;
  const checklist = activationChecklist({ title: f.title, type: f.type, owner_id: f.ownerId, due_at: f.dueAt, metrics: hasKpi(f) && !activeErrors.kpiName && !activeErrors.baseline && !activeErrors.target ? [1] : [] });
  const canActivate = Object.keys(activeErrors).length === 0;
  const allowedTypes = GOAL_TYPES.filter((t) => !me.data || canCreateGoal(me.data, t));
  const hint = titleHint(f.title);

  const next = () => {
    const e = stepErrors(f, step, today);
    setAttempted((a) => new Set(a).add(step));
    if (Object.keys(e).length) return;
    setStep((s) => (s < 3 ? ((s + 1) as 2 | 3) : s));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (status: 'draft' | 'active') => {
    if (busy) return;
    const e = status === 'active' ? activeErrors : formErrors(f, 'draft', today);
    if (Object.keys(e).length) {
      setAttempted(new Set([1, 2, 3]));
      const first = Object.keys(e)[0]!;
      setStep(STEP_FIELDS_OF(first));
      setBanner(status === 'active' ? 'Чтобы запустить цель, заполните отмеченные поля — или сохраните черновик' : 'Проверьте отмеченные поля');
      return;
    }
    setBusy(status);
    setBanner(null);
    try {
      const goal = await api<GoalCard>('/goals', { body: toPayload(f, status), idempotencyKey: `${idemKey.current}:${status}` });
      for (const title of f.subgoals) {
        await api(`/goals/${goal.id}/children`, { body: { title } }).catch(() => undefined);
      }
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      await invalidate();
      toast(status === 'active' ? 'Цель запущена' : 'Черновик сохранён');
      navigate(`/app/goals/${goal.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped: Record<string, string> = {};
        const keyMap: Record<string, string> = { owner_id: 'ownerId', due_at: 'dueAt', metrics: 'kpi', 'metrics.0.name': 'kpiName', 'metrics.0.baseline': 'baseline', 'metrics.0.target': 'target', unit_ids: 'units' };
        for (const [k, v] of Object.entries(err.fields)) mapped[keyMap[k] ?? k] = v;
        setServerErrors(mapped);
        setAttempted(new Set([1, 2, 3]));
        if (Object.keys(mapped).length) setStep(STEP_FIELDS_OF(Object.keys(mapped)[0]!));
        setBanner(err.isNetwork ? err.message : Object.keys(mapped).length ? err.message : err.message);
      } else setBanner('Не удалось сохранить. Данные не потеряны — попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => (dirty ? setConfirmLeave(true) : navigate('/app/goals'));
  const unitOptions = unitsQ.data ?? [];

  return (
    <div className="page">
      <PageHero
        variant="create"
        icon={Sparkles}
        compact
        back={
          <button type="button" onClick={cancel}>
            <ArrowLeft size={15} aria-hidden /> Цели
          </button>
        }
        eyebrow={`Шаг ${step} из ${STEPS.length}`}
        title="Новая цель"
        subtitle="Цель описывает результат, которого нужно достичь, — а не список работ."
      />

      <div className="wizard">
        <div>
          <nav className="steps" aria-label="Шаги">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                className={`step ${i + 1 === step ? 'current' : i + 1 < step ? 'done' : ''}`}
                aria-current={i + 1 === step ? 'step' : undefined}
                onClick={() => (i + 1 < step ? setStep((i + 1) as 1 | 2 | 3) : i + 1 > step ? next() : undefined)}
              >
                Шаг {i + 1} · {s}
              </button>
            ))}
          </nav>

          {banner && (
            <div className="hint-box warn" role="alert" style={{ marginBottom: 18 }}>
              <TriangleAlert size={16} />
              <span>{banner}</span>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-section">
              <Field label="Название цели" required error={show('title', 1)} hint={hint ?? 'Кратко опишите желаемое изменение, а не действие'} counter={{ value: f.title.length, max: LIMITS.title }}>
                {(p) => <input className="input" {...p} autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} onBlur={() => touch('title')} placeholder="Например: Сократить время обработки заявки" maxLength={LIMITS.title + 20} />}
              </Field>
              <Field label="Описание и ожидаемый результат" error={show('description', 1)} counter={{ value: f.description.length, max: LIMITS.description }}>
                {(p) => (
                  <textarea
                    className="textarea"
                    {...p}
                    value={f.description}
                    onChange={(e) => set('description', e.target.value)}
                    onBlur={() => touch('description')}
                    placeholder="Сократить среднее время обработки заявки с 40 до 30 минут без ухудшения качества и нарушения контрольных процедур"
                  />
                )}
              </Field>
              <div className="field">
                <span className="field-label">Тип цели</span>
                <div className="choice-grid" role="radiogroup" aria-label="Тип цели">
                  {allowedTypes.map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={f.type === t} className="choice" onClick={() => set('type', t)}>
                      <span className="choice-title">
                        {GOAL_TYPE_LABELS[t]} {f.type === t && <Check size={15} />}
                      </span>
                      <span className="choice-hint">{GOAL_TYPE_HINTS[t]}</span>
                    </button>
                  ))}
                </div>
                {show('type', 1) && <div className="field-error">{errors.type}</div>}
              </div>

              <div className="card stack" style={{ '--gap': '16px', background: 'var(--surface)' } as React.CSSProperties}>
                <div className="spread">
                  <h3>Как измерим успех</h3>
                  <span className="faint" style={{ fontSize: 13 }}>
                    Ключевой показатель (KPI)
                  </span>
                </div>
                <Field label="Название показателя" error={show('kpiName', 1)} counter={{ value: f.kpiName.length, max: LIMITS.metricName }}>
                  {(p) => <input className="input" {...p} value={f.kpiName} onChange={(e) => set('kpiName', e.target.value)} onBlur={() => touch('kpiName')} placeholder="Среднее время обработки" />}
                </Field>
                <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
                  <Field label="Что должно произойти">
                    {() => (
                      <Segmented<Direction>
                        label="Направление"
                        value={f.direction}
                        onChange={(v) => set('direction', v)}
                        options={(['decrease', 'increase', 'maintain'] as Direction[]).map((d) => ({ value: d, label: d === 'maintain' ? 'Удержать' : DIRECTION_LABELS[d] }))}
                      />
                    )}
                  </Field>
                  <div style={{ minWidth: 180 }} className="grow">
                    <Field label="Единица измерения" error={show('unit', 1)}>
                      {(p) => (
                        <select className="select" {...p} value={f.unit} onChange={(e) => set('unit', e.target.value as GoalFormState['unit'])}>
                          {UNIT_IDS.map((u) => (
                            <option key={u} value={u}>
                              {UNITS[u].label}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </div>
                </div>
                <div className="kpi-inputs">
                  <Field label="Сейчас" error={show('baseline', 1)} hint="Подтверждённое или оценочное">
                    {(p) => <input className="input input-num" {...p} inputMode="decimal" value={f.baseline} onChange={(e) => set('baseline', e.target.value)} onBlur={() => touch('baseline')} placeholder="40" />}
                  </Field>
                  <span className="arrow" aria-hidden>
                    →
                  </span>
                  <Field label="Цель к сроку" error={show('target', 1)} hint={`В тех же единицах: ${UNITS[f.unit].short}`}>
                    {(p) => <input className="input input-num" {...p} inputMode="decimal" value={f.target} onChange={(e) => set('target', e.target.value)} onBlur={() => touch('target')} placeholder="30" />}
                  </Field>
                </div>
                {f.direction === 'maintain' && (
                  <div className="kpi-inputs">
                    <Field label="Допустимо от" error={show('rangeMin', 1)}>
                      {(p) => <input className="input" {...p} inputMode="decimal" value={f.rangeMin} onChange={(e) => set('rangeMin', e.target.value)} onBlur={() => touch('rangeMin')} />}
                    </Field>
                    <span className="arrow" aria-hidden>
                      —
                    </span>
                    <Field label="до" error={show('rangeMax', 1)}>
                      {(p) => <input className="input" {...p} inputMode="decimal" value={f.rangeMax} onChange={(e) => set('rangeMax', e.target.value)} onBlur={() => touch('rangeMax')} />}
                    </Field>
                  </div>
                )}
                {change !== null && f.direction !== 'maintain' && !errors.target && (
                  <div className="hint-box">
                    <Info size={16} />
                    <span>
                      Плановое изменение <b className="num">{formatChange(change)}</b>. Это план, а не достижение: прогресс появится после первого фактического измерения.
                    </span>
                  </div>
                )}
                {!hasKpi(f) && (
                  <div className="hint-box">
                    <Lightbulb size={16} />
                    <span>Не знаете показатель? Сохраните цель черновиком — запустить её можно будет, когда появится измеримый KPI.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-section">
              <Field label="Владелец цели" required error={show('ownerId', 2) ?? (attempted.has(3) ? activeErrors.ownerId : undefined)} hint="Один человек, который отвечает за итог">
                {(p) => <OwnerPicker {...p} value={f.ownerId} valueName={f.ownerName} onChange={(id, name) => setF((x) => ({ ...x, ownerId: id, ownerName: name }))} />}
              </Field>
              <Field label="Срок достижения" required error={show('dueAt', 2) ?? (attempted.has(3) ? activeErrors.dueAt : undefined)} hint="Дата, к которой показатель должен измениться — не дата создания">
                {(p) => (
                  <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                    <input className="input" type="date" {...p} min={today} value={f.dueAt} onChange={(e) => set('dueAt', e.target.value)} onBlur={() => touch('dueAt')} style={{ maxWidth: 240 }} />
                    <div className="chips">
                      {duePresets(today).map((d) => (
                        <button key={d.value} type="button" className="chip" aria-pressed={f.dueAt === d.value} onClick={() => set('dueAt', d.value)}>
                          {d.label} · {formatDate(d.value, { short: true, today })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Field>
              <div className="field">
                <span className="field-label">Участвующие подразделения</span>
                <span className="field-hint">Необязательно. Подразделения увидят цель; роль показывает вид участия, а не второго владельца.</span>
                <div className="chips" style={{ marginTop: 4 }}>
                  {unitOptions.map((u) => {
                    const sel = f.units.find((x) => x.unit_id === u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className="chip"
                        aria-pressed={!!sel}
                        title={UNIT_TYPE_LABELS[u.unit_type]}
                        onClick={() => set('units', sel ? f.units.filter((x) => x.unit_id !== u.id) : [...f.units, { unit_id: u.id, name: u.name, role: f.units.length ? 'contributor' : 'owner' }])}
                      >
                        {u.color && <span style={{ width: 8, height: 8, borderRadius: 8, background: u.color }} />}
                        {u.name}
                      </button>
                    );
                  })}
                  {!unitOptions.length && <span className="faint">Подразделений пока нет — их можно добавить в разделе «Организация».</span>}
                </div>
                {f.units.length > 0 && (
                  <div className="list" style={{ marginTop: 8 }}>
                    {f.units.map((u) => (
                      <div key={u.unit_id} className="list-row">
                        <span className="grow">{u.name}</span>
                        <select className="select" style={{ width: 170, minHeight: 36, padding: '6px 34px 6px 12px' }} value={u.role} onChange={(e) => set('units', f.units.map((x) => (x.unit_id === u.unit_id ? { ...x, role: e.target.value as typeof u.role } : x)))} aria-label={`Роль: ${u.name}`}>
                          {Object.entries(ROLE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-section">
              <div>
                <h3>Из чего сложится результат</h3>
                <p className="muted" style={{ marginTop: 4 }}>
                  Добавьте подцели — изменения, которые нужны для результата. Задачи, зависимости и исполнителей назначите на карточке цели.
                </p>
              </div>
              <div className="subgoal-input">
                <input
                  className="input"
                  value={subgoal}
                  onChange={(e) => setSubgoal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && subgoal.trim()) {
                      e.preventDefault();
                      set('subgoals', [...f.subgoals, subgoal.trim()]);
                      setSubgoal('');
                    }
                  }}
                  placeholder="Например: Убрать лишние согласования"
                  aria-label="Подцель"
                  maxLength={200}
                />
                <Button
                  icon={<Plus size={16} />}
                  disabled={!subgoal.trim()}
                  onClick={() => {
                    set('subgoals', [...f.subgoals, subgoal.trim()]);
                    setSubgoal('');
                  }}
                >
                  Добавить
                </Button>
              </div>
              {f.subgoals.length > 0 && (
                <ol className="list" style={{ padding: 0, margin: 0, listStyle: 'none' }}>
                  {f.subgoals.map((s, i) => (
                    <li key={`${s}${i}`} className="list-row">
                      <span className="tree-index">{i + 1}</span>
                      <span className="grow">{s}</span>
                      <Button variant="ghost" size="sm" icon={<X size={14} />} aria-label={`Убрать «${s}»`} onClick={() => set('subgoals', f.subgoals.filter((_, j) => j !== i))} />
                    </li>
                  ))}
                </ol>
              )}
              {!canActivate && (
                <div className="hint-box">
                  <Info size={16} />
                  <span>Цель сохранится черновиком: для запуска нужны владелец, срок и измеримый KPI. Черновик можно открыть и продолжить в любой момент.</span>
                </div>
              )}
            </div>
          )}

          <div className="wizard-foot">
            <Button variant="ghost" onClick={cancel}>
              Отмена
            </Button>
            <span className="grow" />
            <Button variant="secondary" loading={busy === 'draft'} disabled={!!busy} onClick={() => void save('draft')}>
              Сохранить черновик
            </Button>
            {step < 3 ? (
              <Button variant="primary" icon={<ArrowRight size={16} />} style={{ flexDirection: 'row-reverse' }} onClick={next}>
                Далее
              </Button>
            ) : (
              <Button variant="accent" icon={<Rocket size={16} />} loading={busy === 'active'} disabled={!!busy || !canActivate} onClick={() => void save('active')} title={canActivate ? undefined : 'Заполните владельца, срок и KPI'}>
                Запустить цель
              </Button>
            )}
          </div>
        </div>

        <aside className="wizard-aside" aria-label="Предварительный результат">
          <div className="card stack" style={{ '--gap': '14px' } as React.CSSProperties}>
            <div className="eyebrow">Так увидит команда</div>
            <div className="preview-title">{f.title.trim() || <span className="faint">Название цели</span>}</div>
            {hasKpi(f) && baseline !== null && target !== null && Number.isFinite(baseline) && Number.isFinite(target) ? (
              <>
                <KpiTrack baseline={baseline} target={target} current={null} unit={f.unit} progress={kpiProgress({ baseline, target, direction: f.direction }, null)} name={f.kpiName} size="lg" showLegend={false} />
                <div className="faint" style={{ fontSize: 13, marginTop: -6 }}>
                  {f.kpiName || 'KPI'} · {change !== null && f.direction !== 'maintain' ? formatChange(change) : DIRECTION_LABELS[f.direction]}
                </div>
              </>
            ) : (
              <div className="faint" style={{ fontSize: 14 }}>
                KPI не задан
              </div>
            )}
            <div className="stack" style={{ '--gap': '6px', fontSize: 14 } as React.CSSProperties}>
              <div className="spread">
                <span className="faint">Владелец</span>
                <span>{f.ownerName || '—'}</span>
              </div>
              <div className="spread">
                <span className="faint">Срок</span>
                <span>{f.dueAt ? formatDate(f.dueAt, { today }) : '—'}</span>
              </div>
              <div className="spread">
                <span className="faint">Тип</span>
                <span>{f.type ? GOAL_TYPE_LABELS[f.type] : '—'}</span>
              </div>
            </div>
          </div>
          <div className="card stack" style={{ '--gap': '12px' } as React.CSSProperties}>
            <div className="eyebrow">Готовность к запуску</div>
            <div className="checklist">
              {checklist.map((c) => (
                <div key={c.key} className={`check ${c.done ? 'done' : ''}`}>
                  <span className="check-dot">{c.done && <Check size={12} strokeWidth={3} />}</span>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {confirmLeave && (
        <Dialog
          title="Уйти без сохранения?"
          onClose={() => setConfirmLeave(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
                Остаться
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(DRAFT_KEY);
                  } catch {
                    /* ignore */
                  }
                  navigate('/app/goals');
                }}
              >
                Уйти
              </Button>
            </>
          }
        >
          <p className="muted">Введённые данные пропадут. Можно сохранить черновик и вернуться к нему позже.</p>
        </Dialog>
      )}
    </div>
  );
}

function STEP_FIELDS_OF(field: string): 1 | 2 | 3 {
  if (['ownerId', 'dueAt', 'units'].includes(field)) return 2;
  return 1;
}
