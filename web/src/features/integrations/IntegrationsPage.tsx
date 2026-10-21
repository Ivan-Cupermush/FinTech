import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleAlert, Plug, Plus, RefreshCw, Target, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  formatDate,
  formatValue,
  INTEGRATION_KIND_LABELS,
  INTEGRATION_KINDS,
  INTEGRATION_STATE_LABELS,
  observationDay,
  ONEC_AGGREGATE_LABELS,
  ONEC_AGGREGATES,
  plural,
  SYNC_INTERVAL_LABELS,
  SYNC_INTERVALS,
  syncMomentText,
  todayIso,
  validateMoodleConfig,
  validateOneCConfig,
  type Integration,
  type IntegrationKind,
  type IntegrationRun,
  type IntegrationState,
  type IntegrationTarget,
  type IntegrationTestResult,
  type MoodleConfig,
  type OneCAggregate,
  type OneCConfig,
} from '@offix/core';
import { api, ApiError } from '../../lib/api';
import { integrationsHeroStats } from '../../lib/hero-stats';
import { useMe } from '../../lib/queries';
import { PageHero } from '../../ui/fx/PageHero';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Empty, Segmented, Skeleton } from '../../ui/Misc';
import { Pill, type Tone } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';
import './integrations.css';

const KEY = ['integrations'];
const STATE_TONE: Record<IntegrationState, Tone> = { ok: 'good', error: 'bad', never: 'info', paused: 'neutral' };
const OBS_FORMS: [string, string, string] = ['замер', 'замера', 'замеров'];

export const isAdminRole = (role: string | undefined) => role === 'owner' || role === 'admin';

/** Знак системы: 1С — жёлтым, как у вендора, Moodle — оранжевым; остальной экран монохромный. */
function KindMark({ kind, size = 40 }: { kind: IntegrationKind; size?: number }) {
  return (
    <span className={`int-mark int-mark-${kind}`} style={{ width: size, height: size }} aria-hidden>
      {kind === 'onec' ? '1С' : 'M'}
    </span>
  );
}

const StatePill = ({ state }: { state: IntegrationState }) => (
  <Pill tone={STATE_TONE[state]} live={state === 'error'}>
    {INTEGRATION_STATE_LABELS[state]}
  </Pill>
);

/** Итог запуска одной строкой: «Записано 4 замера, пропущено 1». */
export function runSummary(r: Pick<IntegrationRun, 'status' | 'imported' | 'skipped' | 'error'>): string {
  if (r.status === 'error') return r.error ?? 'Ошибка';
  if (r.status === 'running') return 'Идёт синхронизация';
  if (!r.imported) return r.skipped ? 'Новых данных нет — всё уже записано' : 'Новых данных нет';
  return `Записано ${r.imported} ${plural(r.imported, OBS_FORMS)}${r.skipped ? `, пропущено ${r.skipped}` : ''}`;
}

/** Строка о синхронизации для списка и карточки. */
function syncLine(i: Integration, now: Date): string {
  if (!i.enabled) return 'Синхронизация по расписанию выключена';
  if (!i.last_sync_at) return 'Первая синхронизация — в ближайшие минуты';
  const next = !i.next_sync_at ? '' : Date.parse(i.next_sync_at) <= now.getTime() ? ' · следующая — в ближайшие минуты' : ` · следующая ${syncMomentText(i.next_sync_at, now)}`;
  return `Синхронизация ${syncMomentText(i.last_sync_at, now)}${next}`;
}

/**
 * Интеграции: замеры KPI приходят сами из 1С и Moodle. Раздел для
 * администратора: подключения, проверка, ручной запуск и журнал.
 */
export function IntegrationsPage() {
  const me = useMe();
  const navigate = useNavigate();
  const admin = isAdminRole(me.data?.role);
  const q = useQuery({ queryKey: KEY, queryFn: () => api<Integration[]>('/integrations'), enabled: admin });
  const now = new Date();

  if (me.data && !admin) {
    return (
      <div className="page" style={{ maxWidth: 860 }}>
        <PageHero variant="integrations" icon={Plug} compact title="Интеграции" subtitle="Замеры KPI приходят сами из 1С и Moodle — без ручного ввода и таблиц." />
        <div className="card">
          <Empty icon={<Plug size={22} />} title="Интеграции настраивает администратор">
            Если замеры KPI уже есть в 1С или Moodle, попросите администратора подключить систему — цифры будут приходить сами.
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <PageHero
        variant="integrations"
        icon={Plug}
        title="Интеграции"
        subtitle="Замеры KPI приходят сами из 1С и Moodle — без ручного ввода и таблиц."
        stats={q.data?.length ? integrationsHeroStats(q.data) : undefined}
        actions={
          !!q.data?.length && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/app/integrations/new')}>
              Подключить систему
            </Button>
          )
        }
      />
      {q.isLoading || !me.data ? (
        <Skeleton h={180} />
      ) : q.data?.length ? (
        <div className="card card-tight list" aria-label="Подключения">
          {q.data.map((i) => (
            <Link key={i.id} to={`/app/integrations/${i.id}`} className="list-row int-row">
              <KindMark kind={i.kind} />
              <span className="grow stack" style={{ '--gap': '3px', minWidth: 0 } as React.CSSProperties}>
                <span className="int-row-title">{i.name}</span>
                <span className="faint int-row-meta">
                  <Target size={12} aria-hidden />
                  <span className="clip">
                    {i.metric.name} · {i.goal.title}
                  </span>
                </span>
                {i.state === 'error' ? (
                  <span className="int-row-error">{i.last_error}</span>
                ) : (
                  <span className="faint int-row-meta">
                    {syncLine(i, now)}
                    {i.last_run?.status === 'ok' && ` · ${runSummary(i.last_run).toLowerCase()}`}
                  </span>
                )}
              </span>
              <StatePill state={i.state} />
            </Link>
          ))}
        </div>
      ) : (
        <KindPicker onPick={(k) => navigate(`/app/integrations/new?kind=${k}`)} />
      )}
    </div>
  );
}

/** Пустой раздел: сразу выбор системы, а не пустая таблица. */
function KindPicker({ onPick }: { onPick: (k: IntegrationKind) => void }) {
  return (
    <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
      <p className="muted" style={{ margin: 0 }}>
        Подключений пока нет. Выберите систему, где уже лежат нужные цифры:
      </p>
      <div className="int-kinds">
        {INTEGRATION_KINDS.map((k) => (
          <button key={k} type="button" className="card card-hover int-kind" onClick={() => onPick(k)}>
            <KindMark kind={k} size={44} />
            <span className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
              <span className="int-row-title">{INTEGRATION_KIND_LABELS[k].title}</span>
              <span className="faint" style={{ fontSize: 13.5 }}>
                {INTEGRATION_KIND_LABELS[k].hint}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface FormState {
  kind: IntegrationKind;
  name: string;
  metric_id: string;
  base_url: string;
  username: string;
  secret: string;
  entity: string;
  date_field: string;
  value_field: string;
  aggregate: OneCAggregate;
  filter: string;
  course_id: string;
  interval_hours: (typeof SYNC_INTERVALS)[number];
  enabled: boolean;
}

const emptyForm = (kind: IntegrationKind): FormState => ({
  kind,
  name: '',
  metric_id: '',
  base_url: '',
  username: '',
  secret: '',
  entity: '',
  date_field: 'Date',
  value_field: '',
  aggregate: 'avg',
  filter: '',
  course_id: '',
  interval_hours: 24,
  enabled: true,
});

function fromIntegration(i: Integration): FormState {
  const base = { ...emptyForm(i.kind), name: i.name, metric_id: i.metric.id, username: i.username ?? '', interval_hours: i.interval_hours, enabled: i.enabled };
  if (i.kind === 'onec') {
    const c = i.config as OneCConfig;
    return { ...base, base_url: c.base_url, entity: c.entity, date_field: c.date_field, value_field: c.value_field, aggregate: c.aggregate, filter: c.filter };
  }
  const c = i.config as MoodleConfig;
  return { ...base, base_url: c.base_url, course_id: String(c.course_id) };
}

const configOf = (f: FormState) =>
  f.kind === 'onec'
    ? { base_url: f.base_url, entity: f.entity, date_field: f.date_field, value_field: f.value_field, aggregate: f.aggregate, filter: f.filter }
    : { base_url: f.base_url, course_id: f.course_id.trim() };

/** Те же проверки, что на сервере, — ошибки видны до отправки. */
function checkForm(f: FormState, hasSecret: boolean, forTest = false): Record<string, string> {
  const { errors } = f.kind === 'onec' ? validateOneCConfig(configOf(f)) : validateMoodleConfig(configOf(f));
  const out: Record<string, string> = Object.fromEntries(Object.entries(errors).map(([k, v]) => [`config.${k}`, v]));
  if (!forTest && !f.name.trim()) out.name = 'Назовите подключение';
  if (!forTest && !f.metric_id) out.metric_id = 'Выберите KPI';
  if (f.kind === 'onec' && !f.username.trim()) out.username = 'Укажите пользователя 1С';
  if (!f.secret && !hasSecret) out.secret = f.kind === 'onec' ? 'Укажите пароль пользователя 1С' : 'Укажите токен веб-сервиса Moodle';
  return out;
}

/** Подключение: настройки слева, состояние и журнал запусков справа. */
export function IntegrationPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const admin = isAdminRole(me.data?.role);
  const list = useQuery({ queryKey: KEY, queryFn: () => api<Integration[]>('/integrations'), enabled: admin && !isNew });
  const targets = useQuery({ queryKey: ['integration-targets'], queryFn: () => api<IntegrationTarget[]>('/integrations/targets'), enabled: admin });
  const current = list.data?.find((i) => i.id === id);
  const runs = useQuery({ queryKey: ['integration-runs', id], queryFn: () => api<IntegrationRun[]>(`/integrations/${id}/runs`), enabled: admin && !isNew });

  const startKind = (INTEGRATION_KINDS as readonly string[]).includes(params.get('kind') ?? '') ? (params.get('kind') as IntegrationKind) : 'onec';
  const [f, setF] = useState<FormState>(() => emptyForm(startKind));
  const [loaded, setLoaded] = useState(isNew);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [test, setTest] = useState<IntegrationTestResult | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (current && !loaded) {
      setF(fromIntegration(current));
      setLoaded(true);
    }
  }, [current, loaded]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setTest(null);
    setErrors((e) => {
      const key = ['name', 'metric_id', 'username', 'secret'].includes(k) ? k : `config.${k}`;
      if (!e[key]) return e;
      const { [key]: _, ...rest } = e;
      return rest;
    });
  };

  const payload = () => ({
    kind: f.kind,
    name: f.name.trim(),
    metric_id: f.metric_id,
    config: configOf(f),
    ...(f.kind === 'onec' ? { username: f.username.trim() } : {}),
    ...(f.secret ? { secret: f.secret } : {}),
    interval_hours: f.interval_hours,
    enabled: f.enabled,
  });

  const fail = (e: unknown) => {
    if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
    toast((e as Error).message, 'error');
  };

  const check = useMutation({
    mutationFn: () => api<IntegrationTestResult>('/integrations/test', { body: { kind: f.kind, config: configOf(f), username: f.kind === 'onec' ? f.username.trim() : undefined, secret: f.secret || undefined, id: isNew ? undefined : id } }),
    onSuccess: setTest,
    onError: fail,
  });

  const save = useMutation({
    mutationFn: () => {
      const { kind, ...rest } = payload();
      return isNew ? api<Integration>('/integrations', { body: { kind, ...rest } }) : api<Integration>(`/integrations/${id}`, { method: 'PATCH', body: rest });
    },
    onSuccess: async (saved) => {
      toast(isNew ? 'Подключение сохранено' : 'Изменения сохранены');
      await qc.invalidateQueries({ queryKey: KEY });
      setF((prev) => ({ ...prev, secret: '' }));
      if (isNew) navigate(`/app/integrations/${saved.id}`, { replace: true });
    },
    onError: fail,
  });

  const sync = useMutation({
    mutationFn: () => api<{ run: IntegrationRun; integration: Integration }>(`/integrations/${id}/sync`, { method: 'POST' }),
    onSuccess: async ({ run }) => {
      toast(runSummary(run), run.status === 'error' ? 'error' : undefined);
      await Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['integration-runs', id] })]);
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: () => api(`/integrations/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast('Подключение удалено, записанные замеры остались в KPI');
      await qc.invalidateQueries({ queryKey: KEY });
      navigate('/app/integrations', { replace: true });
    },
    onError: fail,
  });

  if (me.data && !admin) return <IntegrationsPage />;
  if (!isNew && (list.isLoading || !me.data)) return <Skeleton h={320} />;
  if (!isNew && !current) {
    return (
      <div className="page" style={{ maxWidth: 860 }}>
        <div className="card">
          <Empty icon={<Plug size={22} />} title="Подключение не найдено" action={<Button onClick={() => navigate('/app/integrations')}>Ко всем интеграциям</Button>} />
        </div>
      </div>
    );
  }

  const hasSecret = !!current?.secret_mask;
  const submit = (forTest: boolean) => {
    const e = checkForm(f, hasSecret, forTest);
    setErrors(e);
    if (Object.keys(e).length) return;
    (forTest ? check : save).mutate();
  };
  const unit = targets.data?.find((t) => t.metric_id === f.metric_id)?.unit;
  const goals = groupTargets(targets.data ?? []);
  const today = todayIso();
  const now = new Date();
  const onec = f.kind === 'onec';
  const text = (k: keyof FormState, label: string, opts: { hint?: React.ReactNode; placeholder?: string; required?: boolean; type?: string; mono?: boolean; autoComplete?: string } = {}) => {
    const key = ['name', 'username', 'secret'].includes(k) ? k : `config.${k}`;
    return (
      <Field label={label} required={opts.required} hint={opts.hint} error={errors[key]}>
        {(p) => (
          <input
            className={opts.mono ? 'input int-mono' : 'input'}
            {...p}
            type={opts.type ?? 'text'}
            autoComplete={opts.autoComplete ?? 'off'}
            spellCheck={false}
            value={String(f[k])}
            placeholder={opts.placeholder}
            onChange={(e) => set(k, e.target.value as never)}
          />
        )}
      </Field>
    );
  };

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <PageHero
        variant="integrations"
        icon={Plug}
        compact
        back={
          <Link to="/app/integrations">
            <ArrowLeft size={15} aria-hidden /> Все интеграции
          </Link>
        }
        eyebrow={
          <span className="row" style={{ gap: 8 }}>
            <KindMark kind={f.kind} size={22} /> {INTEGRATION_KIND_LABELS[f.kind].title}
          </span>
        }
        title={isNew ? 'Новое подключение' : current!.name}
        subtitle={INTEGRATION_KIND_LABELS[f.kind].hint}
      />

      <div className={isNew ? 'int-layout int-layout-single' : 'int-layout'}>
        <form
          className="card int-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          {isNew && (
            <section className="int-section">
              <h2 className="card-title">Система</h2>
              <Segmented<IntegrationKind>
                label="Система"
                value={f.kind}
                onChange={(k) => {
                  setF((prev) => ({ ...emptyForm(k), name: prev.name, metric_id: prev.metric_id, interval_hours: prev.interval_hours }));
                  setErrors({});
                  setTest(null);
                }}
                options={INTEGRATION_KINDS.map((k) => ({ value: k, label: INTEGRATION_KIND_LABELS[k].title }))}
              />
            </section>
          )}

          <section className="int-section">
            <h2 className="card-title">Подключение</h2>
            {text('name', 'Название', { required: true, placeholder: onec ? '1С: договоры' : 'Moodle: цифровая грамотность' })}
            {text('base_url', onec ? 'Адрес публикации базы' : 'Адрес Moodle', {
              required: true,
              mono: true,
              placeholder: onec ? 'https://1c.univ.ru/univ' : 'https://lms.univ.ru',
              hint: onec ? 'Адрес, по которому база опубликована на веб-сервере, без /odata в конце' : 'Главная страница Moodle вашего вуза',
            })}
            <div className="int-pair">
              {onec && text('username', 'Пользователь 1С', { required: true, placeholder: 'offix', autoComplete: 'off' })}
              {text('secret', onec ? 'Пароль' : 'Токен веб-сервиса', {
                required: !hasSecret,
                type: 'password',
                autoComplete: 'new-password',
                placeholder: hasSecret ? `Сохранён ${current!.secret_mask}` : undefined,
                hint: hasSecret ? 'Оставьте пустым, чтобы не менять' : onec ? 'Лучше завести отдельного пользователя только с правом чтения' : 'Администрирование → Плагины → Веб-службы → Управление токенами',
              })}
            </div>
          </section>

          <section className="int-section">
            <h2 className="card-title">Что забирать</h2>
            {onec ? (
              <>
                {text('entity', 'Документ или регистр', { required: true, mono: true, placeholder: 'Document_ДоговорКонтрагента', hint: 'Имя набора в OData: Document_…, Catalog_…, AccumulationRegister_…' })}
                <div className="int-pair">
                  {text('date_field', 'Поле с датой', { required: true, mono: true, placeholder: 'Date' })}
                  {f.aggregate !== 'count' && text('value_field', 'Поле с числом', { required: true, mono: true, placeholder: 'СрокСогласования' })}
                </div>
                <Field label="Как считать за день" hint="За день в KPI попадает одно значение">
                  {(p) => (
                    <select className="select" {...p} value={f.aggregate} onChange={(e) => set('aggregate', e.target.value as OneCAggregate)}>
                      {ONEC_AGGREGATES.map((a) => (
                        <option key={a} value={a}>
                          {ONEC_AGGREGATE_LABELS[a]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {text('filter', 'Условие отбора', { mono: true, placeholder: 'Posted eq true', hint: 'Необязательно. Условие $filter в OData, например только проведённые документы' })}
              </>
            ) : (
              <>
                {text('course_id', 'Номер курса', { required: true, mono: true, placeholder: '101', hint: 'Видно в адресе курса: course/view.php?id=101' })}
                <p className="faint" style={{ margin: 0, fontSize: 13 }}>
                  Считаем долю слушателей курса, завершивших его по условиям завершения в Moodle. Преподаватели не учитываются.
                </p>
              </>
            )}
          </section>

          <section className="int-section">
            <h2 className="card-title">Куда писать</h2>
            <Field label="KPI" required error={errors.metric_id} hint={onec ? undefined : 'Доля в процентах — выберите KPI в процентах'}>
              {(p) => (
                <select className="select" {...p} value={f.metric_id} onChange={(e) => set('metric_id', e.target.value)}>
                  <option value="">Выберите KPI цели</option>
                  {goals.map((g) => (
                    <optgroup key={g.goal_id} label={g.goal_title}>
                      {g.metrics.map((m) => (
                        <option key={m.metric_id} value={m.metric_id}>
                          {m.metric_name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </Field>
            <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
              <span className="field-label">Как часто</span>
              <Segmented label="Как часто синхронизировать" value={String(f.interval_hours)} onChange={(v) => set('interval_hours', Number(v) as FormState['interval_hours'])} options={SYNC_INTERVALS.map((n) => ({ value: String(n), label: SYNC_INTERVAL_LABELS[n] }))} />
            </div>
            <label className="row int-switch">
              <span className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                <span style={{ fontWeight: 560 }}>Синхронизировать по расписанию</span>
                <span className="faint" style={{ fontSize: 12.5 }}>
                  Выключенное подключение можно запустить вручную
                </span>
              </span>
              <input type="checkbox" role="switch" className="switch" aria-label="Синхронизировать по расписанию" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            </label>
          </section>

          {test && <TestResult result={test} unit={unit} today={today} />}

          <div className="int-actions">
            {!isNew && (
              <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => setConfirm(true)} className="int-delete">
                Удалить
              </Button>
            )}
            <span className="grow" />
            <Button onClick={() => submit(true)} loading={check.isPending}>
              Проверить подключение
            </Button>
            <Button variant="primary" type="submit" loading={save.isPending}>
              {isNew ? 'Подключить' : 'Сохранить'}
            </Button>
          </div>
        </form>

        {!isNew && current && (
          <aside className="stack" style={{ '--gap': '16px' } as React.CSSProperties} aria-label="Состояние">
            <section className="card int-status">
              <div className="spread">
                <h2 className="card-title">Состояние</h2>
                <StatePill state={current.state} />
              </div>
              <p className="faint" style={{ margin: 0, fontSize: 13.5 }}>
                {syncLine(current, now)}
              </p>
              {current.state === 'error' && (
                <div className="int-error" role="alert">
                  <CircleAlert size={16} aria-hidden />
                  <span>{current.last_error}</span>
                </div>
              )}
              <Button variant="accent" icon={<RefreshCw size={16} />} loading={sync.isPending} onClick={() => sync.mutate()}>
                Синхронизировать сейчас
              </Button>
            </section>
            <section className="card card-tight">
              <h2 className="card-title" style={{ padding: '4px 4px 8px' }}>
                Журнал запусков
              </h2>
              {runs.isLoading ? (
                <Skeleton h={120} />
              ) : runs.data?.length ? (
                <ol className="list int-runs">
                  {runs.data.map((r) => (
                    <li key={r.id} className="list-row int-run">
                      <span className={`int-dot int-dot-${r.status}`} aria-hidden />
                      <span className="grow stack" style={{ '--gap': '2px', minWidth: 0 } as React.CSSProperties}>
                        <span className={r.status === 'error' ? 'int-run-error' : undefined}>{runSummary(r)}</span>
                        <span className="faint" style={{ fontSize: 12.5 }}>
                          {syncMomentText(r.started_at, now)} · {r.trigger === 'manual' ? 'вручную' : 'по расписанию'}
                          {r.status === 'ok' && r.fetched > 0 && ` · получено ${r.fetched}`}
                        </span>
                        {r.status === 'ok' && r.error && <span className="int-run-warn">{r.error}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="faint" style={{ margin: 0, padding: '0 4px 6px', fontSize: 13.5 }}>
                  Запусков ещё не было.
                </p>
              )}
            </section>
          </aside>
        )}
      </div>

      {confirm && (
        <Dialog
          title="Удалить подключение?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button onClick={() => setConfirm(false)}>Отмена</Button>
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                Удалить
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>Синхронизация прекратится, журнал запусков удалится. Замеры, которые уже пришли, останутся в KPI.</p>
        </Dialog>
      )}
    </div>
  );
}

function groupTargets(list: IntegrationTarget[]) {
  const map = new Map<string, { goal_id: string; goal_title: string; metrics: IntegrationTarget[] }>();
  for (const t of list) {
    const g = map.get(t.goal_id) ?? { goal_id: t.goal_id, goal_title: t.goal_title, metrics: [] };
    g.metrics.push(t);
    map.set(t.goal_id, g);
  }
  return [...map.values()];
}

/** Итог проверки: работает — с последними днями, как они попадут в KPI; нет — причина. */
function TestResult({ result, unit, today }: { result: IntegrationTestResult; unit?: IntegrationTarget['unit']; today: string }) {
  if (!result.ok) {
    return (
      <div className="int-test int-test-bad" role="status" aria-label="Результат проверки">
        <CircleAlert size={18} aria-hidden />
        <span>{result.message}</span>
      </div>
    );
  }
  return (
    <div className="int-test int-test-ok" role="status" aria-label="Результат проверки">
      <CheckCircle2 size={18} aria-hidden />
      <div className="grow stack" style={{ '--gap': '10px' } as React.CSSProperties}>
        <span>
          {result.message}
          {result.invalid > 0 && `. Без даты или числа: ${result.invalid}`}
        </span>
        {result.points.length > 0 && (
          <table className="int-preview">
            <caption className="faint">Последние дни из системы</caption>
            <tbody>
              {result.points.map((p) => (
                <tr key={p.at}>
                  <td>{formatDate(observationDay(p.at), { short: true, today })}</td>
                  <td className="num">{unit ? formatValue(p.value, unit) : p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
