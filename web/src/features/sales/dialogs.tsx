import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  emptyPlanForm,
  ENTRY_FIELD_LABELS,
  ENTRY_FIELDS,
  FACT_RULE_LABELS,
  formatNumber,
  formatRub,
  PAYOUT_RULE_LABELS,
  planFormBody,
  planFormOf,
  ruleText,
  SALES_UNIT_LABELS,
  SALES_UNITS,
  unitForFact,
  type EntryMapping,
  type PlanForm,
  type SalesImportPreview,
  type SalesPlan,
} from '@offix/core';
import { ApiError } from '../../lib/api';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { salesApi, useSalesGroups, useSalesMutation, useSalesRefresh } from './data';
import { errorText, TemplateButton, UploadZone } from './parts';

/** Ошибки сервера по правилам — к полям формы, где их видно. */
function formErrors(e: unknown, f: PlanForm): Record<string, string> {
  if (!(e instanceof ApiError)) return { _: (e as Error).message };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.fields)) {
    const key = k === 'fact_rule' ? (f.fact_type === 'items' ? 'items' : f.fact_type === 'products' ? 'query' : 'groups') : k === 'payout_rule' ? (f.payout_type === 'rate' ? 'rate' : 'steps') : k;
    out[key] = v;
  }
  if (!Object.keys(out).length) out._ = e.message;
  return out;
}

/**
 * Показатель плана: название, как считается факт (вручную или по отчётам 1С),
 * план, бонус и правило выплаты. У показателя из файла KPI меняется только
 * правило выплаты — остальное приходит с файлом.
 */
export function PlanDialog({ userId, month, plan, onClose }: { userId: string; month: string; plan?: SalesPlan; onClose: () => void }) {
  const toast = useToast();
  const refresh = useSalesRefresh();
  const [f, setF] = useState<PlanForm>(() => (plan ? planFormOf(plan) : emptyPlanForm()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const fromFile = plan?.source === 'file';
  const groups = useSalesGroups(month, f.fact_type === 'revenue' || f.fact_type === 'clients');
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '', _: '' }));
  };
  const parsed = useMemo(() => planFormBody(f), [f]);

  const save = useMutation({
    mutationFn: async () => {
      if (fromFile) {
        // План и бонус приходят из файла: проверяем только правило выплаты.
        const r = planFormBody({ ...f, name: f.name || 'x', plan: '1', bonus: '0', fact_type: 'manual' });
        if (!r.body) throw new ApiError(422, 'VALIDATION', 'Проверьте правило выплаты', r.errors);
        return salesApi.updatePlan(plan!.id, { payout_rule: r.body.payout_rule });
      }
      const { body, errors: errs } = planFormBody(f);
      if (!body) throw new ApiError(422, 'VALIDATION', 'Проверьте поля', errs);
      return plan ? salesApi.updatePlan(plan.id, { ...body }) : salesApi.createPlan({ ...body, user_id: userId, month });
    },
    onSuccess: async () => {
      await refresh();
      toast(plan ? 'Показатель сохранён' : 'Показатель добавлен');
      onClose();
    },
    onError: (e) => setErrors(formErrors(e, f)),
  });
  const remove = useSalesMutation(() => salesApi.deletePlan(plan!.id));

  if (confirm && plan)
    return (
      <Dialog
        title="Удалить показатель?"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Оставить
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast('Показатель удалён');
                    onClose();
                  },
                  onError: (e) => toast(errorText(e), 'error'),
                })
              }
            >
              Удалить
            </Button>
          </>
        }
      >
        <p className="muted">«{plan.name}» исчезнет из плана на месяц вместе с выплатой по нему.</p>
      </Dialog>
    );

  const unit = f.fact_type === 'manual' ? f.unit : unitForFact(f);
  const preview = parsed.body && parsed.body.payout_rule.type !== 'none' ? ruleText(parsed.body.payout_rule, parsed.body.bonus) : '';
  const topGroups = (groups.data ?? []).filter((g) => g.depth <= 1).slice(0, 14);
  const addGroup = (path: string) => set('groups', f.groups.split('\n').includes(path) ? f.groups : [f.groups.trim(), path].filter(Boolean).join('\n'));

  return (
    <Dialog
      wide
      title={plan ? (fromFile ? 'Правило выплаты' : 'Показатель') : 'Новый показатель'}
      onClose={onClose}
      footer={
        <>
          {plan && (
            <Button variant="ghost" onClick={() => setConfirm(true)} style={{ marginRight: 'auto', color: 'var(--bad)' }}>
              Удалить
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </Button>
        </>
      }
    >
      {fromFile && <p className="muted">План, факт и бонус пришли из файла KPI и обновятся новой загрузкой. Правило выплаты, которое вы поправите здесь, сохранится и при следующей загрузке.</p>}
      {errors._ && (
        <div className="field-error" role="alert">
          {errors._}
        </div>
      )}
      {!fromFile && (
        <>
          <Field label="Название" required error={errors.name}>
            {(p) => <input className="input" {...p} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Выручка без ключевых клиентов" maxLength={320} autoFocus />}
          </Field>
          <div className="grid-2" style={{ gap: 14 }}>
            <Field label="Как считается факт" hint={f.fact_type === 'manual' ? 'Сотрудник отмечает сам или прибавляется из записанных продаж' : 'Пересчитывается после каждой загрузки отчёта 1С'}>
              {(p) => (
                <select className="select" {...p} value={f.fact_type} onChange={(e) => set('fact_type', e.target.value as PlanForm['fact_type'])}>
                  {Object.entries(FACT_RULE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Единица" error={errors.unit} hint={f.fact_type !== 'manual' ? 'Следует за способом подсчёта' : undefined}>
              {(p) => (
                <select className="select" {...p} value={unit} disabled={f.fact_type !== 'manual'} onChange={(e) => set('unit', e.target.value as PlanForm['unit'])}>
                  {SALES_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {SALES_UNIT_LABELS[u].label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {(f.fact_type === 'revenue' || f.fact_type === 'clients') && (
            <>
              <Field label="Группы товаров" error={errors.groups} hint="По одной на строку. Пусто — все продажи. «Курсы» — любая группа с этим словом, «КУРСЫ › Python» — именно эта.">
                {(p) => <textarea className="textarea" {...p} rows={3} value={f.groups} onChange={(e) => set('groups', e.target.value)} />}
              </Field>
              {topGroups.length > 0 && (
                <div className="sl-chips" aria-label="Группы из отчётов">
                  {topGroups.map((g) => (
                    <button key={g.path} type="button" className="sl-chip is-add" onClick={() => addGroup(g.path)}>
                      + {g.path}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {f.fact_type === 'revenue' && (
            <div className="grid-2" style={{ gap: 14 }}>
              <Field label="Клиенты">
                {(p) => (
                  <select className="select" {...p} value={f.clients} onChange={(e) => set('clients', e.target.value as PlanForm['clients'])}>
                    <option value="all">Все клиенты</option>
                    <option value="non_key">Без ключевых клиентов</option>
                    <option value="key">Только ключевые клиенты</option>
                  </select>
                )}
              </Field>
              <Field label="Что считать">
                {(p) => (
                  <select className="select" {...p} value={f.measure} onChange={(e) => set('measure', e.target.value as PlanForm['measure'])}>
                    <option value="revenue">Выручку, ₽</option>
                    <option value="quantity">Штуки</option>
                  </select>
                )}
              </Field>
            </div>
          )}
          {f.fact_type === 'clients' && (
            <>
              <label className="sl-check">
                <input type="checkbox" checked={f.exclude_key} onChange={(e) => set('exclude_key', e.target.checked)} />
                Без ключевых клиентов
              </label>
              <Field label="Задвоенные клиенты" hint="Все клиенты с таким названием считаются одной точкой. По одному на строку.">
                {(p) => <textarea className="textarea" {...p} rows={2} value={f.merge} onChange={(e) => set('merge', e.target.value)} />}
              </Field>
            </>
          )}
          {f.fact_type === 'products' && (
            <div className="grid-2" style={{ gap: 14 }}>
              <Field label="Товар или группа" error={errors.query}>
                {(p) => <input className="input" {...p} value={f.query} onChange={(e) => set('query', e.target.value)} placeholder="Python" />}
              </Field>
              <Field label="Что считать">
                {(p) => (
                  <select className="select" {...p} value={f.products_measure} onChange={(e) => set('products_measure', e.target.value as PlanForm['products_measure'])}>
                    <option value="revenue">Выручку, ₽</option>
                    <option value="quantity">Штуки</option>
                    <option value="clients">Клиентов с покупкой</option>
                  </select>
                )}
              </Field>
            </div>
          )}
          {f.fact_type === 'items' && (
            <Field label="Позиции" error={errors.items} hint="«Название: в сколько клиентов продать», по одной на строку">
              {(p) => <textarea className="textarea" {...p} rows={4} value={f.items} onChange={(e) => set('items', e.target.value)} placeholder={'Курс «Python для аналитиков»: 3\nВебинар по Excel: 5'} />}
            </Field>
          )}
          <div className="grid-2" style={{ gap: 14 }}>
            <Field label={`План${unit === 'rub' ? ', ₽' : ''}`} error={errors.plan}>
              {(p) => <input className="input" {...p} inputMode="decimal" value={f.plan} onChange={(e) => set('plan', e.target.value)} placeholder="400 000" />}
            </Field>
            <Field label="Бонус, ₽" error={errors.bonus} hint="Сумма за выполнение плана">
              {(p) => <input className="input" {...p} inputMode="decimal" value={f.bonus} onChange={(e) => set('bonus', e.target.value)} placeholder="20 000" />}
            </Field>
          </div>
        </>
      )}
      <Field label="Как считается выплата">
        {(p) => (
          <select className="select" {...p} value={f.payout_type} onChange={(e) => set('payout_type', e.target.value as PlanForm['payout_type'])}>
            {Object.entries(PAYOUT_RULE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      {f.payout_type === 'threshold' && (
        <div className="grid-2" style={{ gap: 14 }}>
          <Field label="Пороги" error={errors.steps} hint="«% плана: коэффициент бонуса», по одному на строку">
            {(p) => <textarea className="textarea" {...p} rows={3} value={f.steps} onChange={(e) => set('steps', e.target.value)} />}
          </Field>
          <Field label="Сверх плана">
            {(p) => (
              <select className="select" {...p} value={f.over} onChange={(e) => set('over', e.target.value as PlanForm['over'])}>
                <option value="cap">Бонус не растёт</option>
                <option value="proportional">Растёт пропорционально</option>
              </select>
            )}
          </Field>
        </div>
      )}
      {f.payout_type === 'rate' && (
        <div className="grid-2" style={{ gap: 14 }}>
          <Field label="Процент от продаж" error={errors.rate}>
            {(p) => <input className="input" {...p} inputMode="decimal" value={f.rate} onChange={(e) => set('rate', e.target.value)} placeholder="3,5" />}
          </Field>
          <Field label="Если продано от, ₽" error={errors.min} hint="Пусто — с первого рубля">
            {(p) => <input className="input" {...p} inputMode="decimal" value={f.min} onChange={(e) => set('min', e.target.value)} placeholder="50 000" />}
          </Field>
        </div>
      )}
      {preview && <div className="sl-plan-hint">Выплата: {preview}</div>}
      {!fromFile && (
        <Field label="Комментарий" hint="Видит сотрудник">
          {(p) => <textarea className="textarea" {...p} rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} />}
        </Field>
      )}
    </Dialog>
  );
}

/** Сотрудник сам отмечает факт своего показателя «вручную». */
export function FactDialog({ plan, onClose }: { plan: SalesPlan; onClose: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(plan.fact ? String(plan.fact).replace('.', ',') : '');
  const [error, setError] = useState<string | null>(null);
  const save = useSalesMutation((fact: number) => salesApi.updatePlan(plan.id, { fact }));
  const submit = () => {
    const n = Number(value.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return setError('Факт — число не меньше нуля');
    save.mutate(n, {
      onSuccess: () => {
        toast('Факт обновлён');
        onClose();
      },
      onError: (e) => setError(errorText(e)),
    });
  };
  return (
    <Dialog
      title="Отметить факт"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Сохранить
          </Button>
        </>
      }
    >
      <p className="muted">{plan.name}</p>
      <Field label={`Факт за месяц, ${SALES_UNIT_LABELS[plan.unit].short}`} error={error} hint={plan.plan > 0 ? `План — ${formatNumber(plan.plan, 2)} ${SALES_UNIT_LABELS[plan.unit].short}` : undefined}>
        {(p) => <input className="input" {...p} inputMode="decimal" autoFocus value={value} onChange={(e) => (setValue(e.target.value), setError(null))} onKeyDown={(e) => e.key === 'Enter' && submit()} />}
      </Field>
    </Dialog>
  );
}

/** Показатели, к факту которых прибавляются продажи: «вручную», в рублях, штуках или клиентах. */
export const entryPlans = (plans: SalesPlan[]) => plans.filter((p) => p.source === 'manual' && p.fact_rule.type === 'manual' && p.unit !== 'percent' && p.unit !== 'items' && p.payout_rule.type !== 'fixed');

function PlanSelect({ plans, value, onChange }: { plans: SalesPlan[]; value: string; onChange: (v: string) => void }) {
  if (!plans.length) return null;
  return (
    <Field label="Прибавить к показателю" hint="Сумма, штуки или клиент добавятся к факту показателя">
      {(p) => (
        <select className="select" {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Не прибавлять</option>
          {plans.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Записать продажу: товар, клиент, количество, сумма и дата. */
export function EntryDialog({ userId, plans, today, onClose }: { userId?: string; plans: SalesPlan[]; today: string; onClose: () => void }) {
  const toast = useToast();
  const usable = entryPlans(plans);
  const [v, setV] = useState({ product: '', client: '', quantity: '1', amount: '', sold_on: today, note: '', plan_id: usable[0]?.id ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSalesMutation(() => salesApi.addEntry({ ...v, user_id: userId, plan_id: v.plan_id || null }));
  const set = (k: keyof typeof v, x: string) => {
    setV((o) => ({ ...o, [k]: x }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  return (
    <Dialog
      title="Записать продажу"
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
              save.mutate(undefined, {
                onSuccess: () => {
                  toast('Продажа записана');
                  onClose();
                },
                onError: (e) => (e instanceof ApiError && Object.keys(e.fields).length ? setErrors(e.fields) : toast(errorText(e), 'error')),
              })
            }
          >
            Записать
          </Button>
        </>
      }
    >
      <Field label="Товар или услуга" required error={errors.product}>
        {(p) => <input className="input" {...p} autoFocus value={v.product} onChange={(e) => set('product', e.target.value)} placeholder="Курс «Python для аналитиков»" />}
      </Field>
      <Field label="Клиент" error={errors.client}>
        {(p) => <input className="input" {...p} value={v.client} onChange={(e) => set('client', e.target.value)} placeholder="ООО «Альфа»" />}
      </Field>
      <div className="grid-2" style={{ gap: 14 }}>
        <Field label="Количество" error={errors.quantity}>
          {(p) => <input className="input" {...p} inputMode="decimal" value={v.quantity} onChange={(e) => set('quantity', e.target.value)} />}
        </Field>
        <Field label="Сумма, ₽" error={errors.amount}>
          {(p) => <input className="input" {...p} inputMode="decimal" value={v.amount} onChange={(e) => set('amount', e.target.value)} placeholder="45 000" />}
        </Field>
      </div>
      <Field label="Дата" error={errors.sold_on}>
        {(p) => <input className="input" type="date" {...p} max={today} value={v.sold_on} onChange={(e) => set('sold_on', e.target.value)} />}
      </Field>
      <PlanSelect plans={usable} value={v.plan_id} onChange={(x) => set('plan_id', x)} />
      <Field label="Комментарий" error={errors.note}>
        {(p) => <input className="input" {...p} value={v.note} onChange={(e) => set('note', e.target.value)} />}
      </Field>
    </Dialog>
  );
}

/**
 * Продажи из Excel или CSV: файл → таблица и предложенные колонки → проверка
 * → запись. Пока человек не подтвердил, ничего не записывается; закрыл окно —
 * загрузка отменяется.
 */
export function ImportEntriesDialog({ userId, plans, onClose }: { userId?: string; plans: SalesPlan[]; onClose: () => void }) {
  const toast = useToast();
  const refresh = useSalesRefresh();
  const usable = entryPlans(plans);
  const [progress, setProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<SalesImportPreview | null>(null);
  const [mapping, setMapping] = useState<EntryMapping | null>(null);
  const [planId, setPlanId] = useState(usable[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const pending = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (pending.current && !done.current) void salesApi.cancelImport(pending.current);
    },
    [],
  );

  const upload = (file: File) => {
    setError(null);
    setProgress(0);
    salesApi
      .importEntries(file, userId, { onProgress: setProgress })
      .then((p) => {
        if (pending.current) void salesApi.cancelImport(pending.current);
        pending.current = p.id;
        setPreview(p);
        setMapping(p.mapping);
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setProgress(null));
  };

  const check = async (m: EntryMapping) => {
    setMapping(m);
    if (!preview) return;
    try {
      const r = await salesApi.confirmImport(preview.id, { mapping: m, dry_run: true });
      setPreview(r.preview);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const submit = async () => {
    if (!preview || !mapping) return;
    setBusy(true);
    try {
      const r = await salesApi.confirmImport(preview.id, { mapping, plan_id: planId || null });
      done.current = true;
      await refresh();
      toast(`Записано продаж: ${r.imported}${r.skipped ? `, пропущено строк: ${r.skipped}` : ''}`);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      wide
      title="Продажи из Excel"
      onClose={onClose}
      footer={
        preview ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button variant="primary" loading={busy} disabled={!preview.valid} onClick={submit}>
              Записать {preview.valid} {preview.valid === 1 ? 'продажу' : preview.valid < 5 && preview.valid > 0 ? 'продажи' : 'продаж'}
            </Button>
          </>
        ) : undefined
      }
    >
      {!preview ? (
        <UploadZone
          title="Таблица продаж"
          hint="Excel или CSV: строка с названиями колонок и продажи под ней. Колонки подберём сами, вы проверите."
          progress={progress}
          onFile={upload}
          extra={<TemplateButton kind="entries">Образец</TemplateButton>}
        />
      ) : (
        <>
          <p className="muted">
            «{preview.file_name}»: строк — {preview.total_rows}. Проверьте, какая колонка что значит.
          </p>
          <div className="grid-2" style={{ gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {ENTRY_FIELDS.map((k) => (
              <Field key={k} label={ENTRY_FIELD_LABELS[k]}>
                {(p) => (
                  <select className="select" {...p} value={mapping?.[k] ?? ''} onChange={(e) => void check({ ...mapping!, [k]: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">—</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Колонка ${i + 1}`}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ))}
          </div>
          <div className="sl-table-wrap">
            <table className="sl-table">
              <thead>
                <tr>
                  {preview.headers.map((h, i) => (
                    <th key={i}>{h || `Колонка ${i + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sl-plan-hint" role="status">
            Пройдёт строк: {preview.valid} из {preview.total_rows} на сумму {formatRub(preview.amount)}
          </div>
          {preview.errors.length > 0 && (
            <ul className="faint" style={{ fontSize: 13, paddingLeft: 18 }}>
              {preview.errors.slice(0, 5).map((e) => (
                <li key={e.row}>
                  Строка {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <PlanSelect plans={usable} value={planId} onChange={setPlanId} />
        </>
      )}
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
