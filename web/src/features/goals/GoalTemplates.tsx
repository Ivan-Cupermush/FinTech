import { ArrowLeft, Check, FileStack, Info, PencilLine, Search, Sparkles, TriangleAlert } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  GOAL_TEMPLATES,
  GOAL_TYPE_LABELS,
  TEMPLATE_AREA_LABELS,
  TEMPLATE_AREAS,
  UNITS,
  applyTemplate,
  canCreateGoal,
  diffDays,
  findTemplate,
  formatChange,
  formatDate,
  formatNumber,
  plannedChange,
  plural,
  searchTemplates,
  templateDueDate,
  templateSummary,
  todayIso,
  validateGoal,
  type GoalTemplate,
  type TemplateArea,
} from '@offix/core';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useInvalidateWork, useMe } from '../../lib/queries';
import type { GoalCard } from '../../lib/types';
import { Button } from '../../ui/Button';
import { PageHero } from '../../ui/fx/PageHero';
import { Field } from '../../ui/Field';
import { Empty } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { GoalCreatePage, OwnerPicker } from './GoalCreatePage';
import { duePresets, emptyForm, parseNumber } from './goalForm';
import './goals.css';

const DRAFT_KEY = 'offix.goal-draft';

/** В мастере уже что-то введено — возвращаем туда, а не на выбор. */
function hasSavedDraft(): boolean {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return !!raw && JSON.stringify({ ...emptyForm(), ...JSON.parse(raw) }) !== JSON.stringify(emptyForm());
  } catch {
    return false;
  }
}

/** «40 → 30 мин». */
const kpiLine = (t: GoalTemplate) => {
  const u = UNITS[t.kpi.unit];
  return `${formatNumber(t.kpi.baseline, u.decimals)} → ${formatNumber(t.kpi.target, u.decimals)} ${u.short}`;
};

/**
 * Новая цель: сначала «С чего начать». С нуля — мастер в три шага, из
 * шаблона — типовая цель вуза с KPI, подцелями и планом задач, где остаётся
 * подставить владельца, срок и свои цифры. Начатый черновик мастера сразу
 * открывает мастер, чтобы не потерять введённое.
 */
export function GoalNewPage() {
  const [params] = useSearchParams();
  const key = params.get('template');
  if (params.get('from') === 'scratch' || (!key && hasSavedDraft())) return <GoalCreatePage />;
  const t = key ? findTemplate(key) : undefined;
  if (t) return <TemplateApply key={t.key} t={t} />;
  return <StartChooser />;
}

function StartChooser() {
  const navigate = useNavigate();
  const me = useMe();
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<TemplateArea | 'all'>('all');
  const list = useMemo(() => searchTemplates(GOAL_TEMPLATES, query, area), [query, area]);
  const allowed = !me.data || canCreateGoal(me.data, 'operational');

  return (
    <div className="page">
      <PageHero
        variant="create"
        icon={Sparkles}
        back={
          <button type="button" onClick={() => navigate('/app/goals')}>
            <ArrowLeft size={15} aria-hidden /> Цели
          </button>
        }
        title="Новая цель"
        subtitle="Цель описывает результат, которого нужно достичь, — а не список работ."
      />

      <section aria-labelledby="start-title" className="stack" style={{ '--gap': '12px', marginBottom: 28 } as React.CSSProperties}>
        <h2 id="start-title" className="eyebrow">
          С чего начать
        </h2>
        <div className="choice-grid" role="radiogroup" aria-label="С чего начать" style={{ maxWidth: 720 }}>
          <button type="button" role="radio" aria-checked="false" className="choice" onClick={() => navigate('/app/goals/new?from=scratch')}>
            <span className="choice-title">
              <PencilLine size={16} /> С нуля
            </span>
            <span className="choice-hint">Три шага мастера: результат и KPI, ответственность и срок, подцели</span>
          </button>
          <button type="button" role="radio" aria-checked="true" className="choice">
            <span className="choice-title">
              <FileStack size={16} /> Из шаблона <Check size={15} />
            </span>
            <span className="choice-hint">Типовая цель вуза: KPI «было → цель», подцели и план задач за минуту</span>
          </button>
        </div>
      </section>

      {!allowed && (
        <div className="hint-box" style={{ marginBottom: 18 }}>
          <Info size={16} />
          <span>Шаблоны — операционные и стратегические цели, их ставят руководители. Личную цель создайте с нуля.</span>
        </div>
      )}

      <div className="tpl-toolbar">
        <div className="tpl-search">
          <Search size={16} className="faint" aria-hidden />
          <input className="input" type="search" placeholder="Поиск: договор, NPS, заявка…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск шаблона" />
        </div>
        <div className="chips" role="group" aria-label="Направление">
          {(['all', ...TEMPLATE_AREAS] as const).map((a) => (
            <button key={a} type="button" className="chip" aria-pressed={area === a} onClick={() => setArea(a)}>
              {a === 'all' ? 'Все' : TEMPLATE_AREA_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      {list.length ? (
        <div className="tpl-grid">
          {list.map((t) => (
            <button key={t.key} type="button" className="card tpl-card" onClick={() => navigate(`/app/goals/new?template=${t.key}`)} aria-label={t.title}>
              <span className="eyebrow">{TEMPLATE_AREA_LABELS[t.area]}</span>
              <span className="tpl-title">{t.title}</span>
              <span className="tpl-kpi">
                <span className="faint">{t.kpi.name}</span>
                <span className="num tpl-kpi-value">{kpiLine(t)}</span>
              </span>
              <span className="faint tpl-meta">{templateSummary(t)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Search size={22} />} title="Шаблон не найден" action={<Button onClick={() => navigate('/app/goals/new?from=scratch')}>Создать с нуля</Button>}>
            Попробуйте другое слово или направление.
          </Empty>
        </div>
      )}
    </div>
  );
}

const FIELD: Record<string, string> = { 'metrics.0.baseline': 'baseline', 'metrics.0.target': 'target', owner_id: 'ownerId', due_at: 'dueAt' };

function TemplateApply({ t }: { t: GoalTemplate }) {
  const navigate = useNavigate();
  const me = useMe();
  const toast = useToast();
  const invalidate = useInvalidateWork();
  const today = todayIso();
  const u = UNITS[t.kpi.unit];
  const [baseline, setBaseline] = useState(formatNumber(t.kpi.baseline, u.decimals));
  const [target, setTarget] = useState(formatNumber(t.kpi.target, u.decimals));
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const [dueAt, setDueAt] = useState(templateDueDate(t, today));
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idemKey = useRef(newIdempotencyKey());

  // Владелец по умолчанию — тот, кто ставит цель.
  const ownerId = owner?.id ?? me.data?.id ?? '';
  const ownerName = owner?.name ?? me.data?.display_name ?? '';
  const b = parseNumber(baseline);
  const g = parseNumber(target);
  const plan = applyTemplate(t, { owner_id: ownerId, due_at: dueAt, today, baseline: b ?? NaN, target: g ?? NaN });
  const errors: Record<string, string> = { ...serverErrors };
  for (const [k, v] of Object.entries(validateGoal(plan.goal, 'active', today))) errors[FIELD[k] ?? k] ??= v;
  const show = (k: string) => (attempted ? errors[k] : undefined);
  const allowed = !me.data || canCreateGoal(me.data, t.type);
  const change = b !== null && g !== null && Number.isFinite(b) && Number.isFinite(g) ? plannedChange(b, g) : null;
  const compressed = diffDays(today, dueAt) < t.plan_days;

  const create = async () => {
    setAttempted(true);
    if (Object.keys(errors).length || busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const goal = await api<GoalCard>(`/templates/${t.key}/apply`, { body: { owner_id: ownerId, due_at: dueAt, baseline: b, target: g }, idempotencyKey: idemKey.current });
      await invalidate();
      toast('Черновик цели создан — проверьте план и запустите цель');
      navigate(`/app/goals/${goal.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) mapped[FIELD[k] ?? k] = v;
        setServerErrors(mapped);
        setBanner(err.message);
      } else setBanner('Не удалось создать цель. Попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const tasksOf = (sub: string | null) => plan.tasks.filter((k) => k.subgoal === sub);

  return (
    <div className="page">
      <PageHero
        variant="create"
        icon={Sparkles}
        compact
        back={
          <button type="button" onClick={() => navigate('/app/goals/new')}>
            <ArrowLeft size={15} aria-hidden /> Шаблоны
          </button>
        }
        eyebrow={`Шаблон · ${TEMPLATE_AREA_LABELS[t.area]} · ${GOAL_TYPE_LABELS[t.type]}`}
        title={t.title}
        subtitle={t.description}
      />

      <div className="wizard">
        <div className="wizard-section">
          {banner && (
            <div className="hint-box warn" role="alert">
              <TriangleAlert size={16} />
              <span>{banner}</span>
            </div>
          )}
          {!allowed && (
            <div className="hint-box warn" role="alert">
              <TriangleAlert size={16} />
              <span>Недостаточно прав: {GOAL_TYPE_LABELS[t.type].toLowerCase()} цели ставят руководители.</span>
            </div>
          )}

          <div className="card stack" style={{ '--gap': '14px' } as React.CSSProperties}>
            <div className="spread">
              <h3>{t.kpi.name}</h3>
              <span className="faint" style={{ fontSize: 13 }}>
                Ключевой показатель
              </span>
            </div>
            <div className="kpi-inputs">
              <Field label="Сейчас" error={show('baseline')} hint={t.kpi.hint}>
                {(p) => <input className="input input-num" {...p} inputMode="decimal" value={baseline} onChange={(e) => (setBaseline(e.target.value), setServerErrors({}))} />}
              </Field>
              <span className="arrow" aria-hidden>
                →
              </span>
              <Field label="Цель к сроку" error={show('target')} hint={`В тех же единицах: ${u.short}`}>
                {(p) => <input className="input input-num" {...p} inputMode="decimal" value={target} onChange={(e) => (setTarget(e.target.value), setServerErrors({}))} />}
              </Field>
            </div>
            <div className="hint-box">
              <Info size={16} />
              <span>
                {change !== null && <>Плановое изменение <b className="num">{formatChange(change)}</b>. </>}
                Цифры типичные для вуза — замените своими. Откуда брать: {t.kpi.source.charAt(0).toLowerCase() + t.kpi.source.slice(1)}.
              </span>
            </div>
          </div>

          <Field label="Владелец цели" required error={show('ownerId')} hint="Один человек, который отвечает за итог">
            {(p) => <OwnerPicker {...p} value={ownerId} valueName={ownerName} onChange={(id, name) => (setOwner({ id, name }), setServerErrors({}))} />}
          </Field>
          <Field label="Срок достижения" required error={show('dueAt')} hint={`Рекомендуем ${t.plan_days} ${plural(t.plan_days, ['день', 'дня', 'дней'])}: столько занимает план`}>
            {(p) => (
              <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                <input className="input" type="date" {...p} min={today} value={dueAt} onChange={(e) => (setDueAt(e.target.value), setServerErrors({}))} style={{ maxWidth: 240 }} />
                <div className="chips">
                  {[{ label: 'По плану шаблона', value: templateDueDate(t, today) }, ...duePresets(today)].map((d) => (
                    <button key={d.label} type="button" className="chip" aria-pressed={dueAt === d.value} onClick={() => setDueAt(d.value)}>
                      {d.label} · {formatDate(d.value, { short: true, today })}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Field>

          <div className="wizard-foot">
            <Button variant="ghost" onClick={() => navigate('/app/goals/new')}>
              Назад
            </Button>
            <span className="grow" />
            <Button variant="primary" loading={busy} disabled={busy || !allowed} onClick={() => void create()}>
              Создать черновик
            </Button>
          </div>
          <p className="faint" style={{ fontSize: 13, marginTop: -12 }}>
            Цель появится черновиком с подцелями и задачами. Исполнителей и даты можно поправить на карточке, затем — запустить.
          </p>
        </div>

        <aside className="wizard-aside" aria-label="План шаблона">
          <div className="card stack" style={{ '--gap': '14px' } as React.CSSProperties}>
            <div className="spread">
              <div className="eyebrow">План</div>
              <span className="faint" style={{ fontSize: 12.5 }}>
                {templateSummary(t)}
              </span>
            </div>
            {compressed && diffDays(today, dueAt) >= 0 && <div className="faint" style={{ fontSize: 12.5 }}>Срок короче плана — сроки задач сожмутся пропорционально.</div>}
            {[...plan.subgoals.map((s) => ({ key: s.key, title: s.title })), { key: null, title: 'Сама цель' }].map((s) => {
              const ts = tasksOf(s.key);
              if (!ts.length) return null;
              return (
                <section key={s.key ?? 'root'} className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</div>
                  <ol className="tpl-tasks">
                    {ts.map((k) => (
                      <li key={k.key}>
                        <span className="grow">{k.title}</span>
                        <span className="faint num">{formatDate(k.due_at, { short: true, today })}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
