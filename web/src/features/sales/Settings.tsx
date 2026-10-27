import { Link2, Search, Unlink, UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, formatRub, GOAL_LINK_MEASURE_LABELS, goalLinkLine, monthTitle, type SalesGoalLink } from '@offix/core';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Skeleton } from '../../ui/Misc';
import { Pill } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';
import { salesApi, useAliases, useClientLists, useGoalLinks, useGoalLinkTargets, useSalesClients, useSalesMutation, useSalesPeople, useUnmatched } from './data';
import { errorText } from './parts';

const LISTS = {
  key: {
    title: 'Ключевые клиенты',
    hint: 'Сеть или крупные клиенты, продажи которым считаются отдельно: показатели «без ключевых» их не учитывают. Подходит часть названия: «Меридиан» найдёт «ГК «Меридиан»».',
  },
  merge: {
    title: 'Задвоенные клиенты',
    hint: 'Один клиент под разными карточками в 1С: в клиентской базе (АКБ) все клиенты с этим названием — одна точка.',
  },
} as const;

/** Списки клиентов: вставить строками или загрузить файлом; каждая правка пересчитывает факт. */
function ClientList({ kind, can }: { kind: 'key' | 'merge'; can: boolean }) {
  const lists = useClientLists();
  const toast = useToast();
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const add = useSalesMutation((t: string) => salesApi.addPatterns(kind, t));
  const remove = useSalesMutation((id: string) => salesApi.deletePattern(id));
  const items = lists.data?.[kind] ?? [];
  const done = (r: { added: number; skipped: number; plans_updated: number }) =>
    toast(`Добавлено: ${r.added}${r.skipped ? `, пропущено повторов: ${r.skipped}` : ''}${r.plans_updated ? ` · пересчитано показателей: ${r.plans_updated}` : ''}`);
  return (
    <section className="card card-tight stack" style={{ '--gap': '10px' } as React.CSSProperties} aria-label={LISTS[kind].title}>
      <div className="spread">
        <h3 className="card-title">{LISTS[kind].title}</h3>
        <span className="faint num">{items.length}</span>
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        {LISTS[kind].hint}
      </p>
      {lists.isLoading ? (
        <Skeleton h={30} />
      ) : items.length ? (
        <div className="sl-chips">
          {items.map((p) => (
            <span key={p.id} className="sl-chip" title={p.created_by_name ? `Добавил(а) ${p.created_by_name}` : undefined}>
              <span>{p.pattern}</span>
              {can && (
                <button type="button" aria-label={`Убрать «${p.pattern}»`} onClick={() => remove.mutate(p.id, { onError: (e) => toast(errorText(e), 'error') })}>
                  <X size={13} />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 13 }}>
          Список пуст.
        </p>
      )}
      {can && (
        <>
          <Field label="Добавить" hint="По одному клиенту на строку">
            {(p) => <textarea className="textarea" {...p} rows={2} value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
          <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
            <Button
              size="sm"
              variant="primary"
              disabled={!text.trim()}
              loading={add.isPending}
              onClick={() =>
                add.mutate(text, {
                  onSuccess: (r) => {
                    setText('');
                    done(r);
                  },
                  onError: (e) => toast(errorText(e), 'error'),
                })
              }
            >
              Добавить в список
            </Button>
            <label className="btn btn-ghost btn-sm" style={{ cursor: progress != null ? 'progress' : 'pointer' }}>
              Из файла
              <input
                type="file"
                hidden
                accept=".xlsx,.xls,.csv,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  setProgress(0);
                  salesApi
                    .uploadPatterns(kind, f)
                    .then(done)
                    .catch((x) => toast(errorText(x), 'error'))
                    .finally(() => setProgress(null));
                }}
              />
            </label>
          </div>
        </>
      )}
    </section>
  );
}

/** Клиенты из отчётов за месяц: видно, кто в списках, и подсказка «похоже на ключевого». */
function ClientsBrowser({ month, can }: { month: string; can: boolean }) {
  const [q, setQ] = useState('');
  const clients = useSalesClients(month, q.trim(), true);
  const toast = useToast();
  const add = useSalesMutation((v: { kind: 'key' | 'merge'; name: string }) => salesApi.addPatterns(v.kind, v.name));
  const list = clients.data ?? [];
  return (
    <section className="card card-tight stack" style={{ '--gap': '10px' } as React.CSSProperties} aria-label="Клиенты из отчётов">
      <div className="spread">
        <h3 className="card-title">Клиенты из отчётов · {monthTitle(month)}</h3>
        <span className="faint num">{list.length}</span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Search size={16} className="faint" aria-hidden />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти клиента" aria-label="Найти клиента" />
      </div>
      {clients.isLoading ? (
        <Skeleton h={60} />
      ) : list.length ? (
        <div className="list" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {list.slice(0, 100).map((c) => (
            <div key={c.name} className="list-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="clip">{c.name}</div>
                <div className="faint clip" style={{ fontSize: 12.5 }}>
                  {c.managers.join(', ')}
                </div>
              </div>
              {c.key ? <Pill tone="accent">Ключевой</Pill> : c.key_hint ? <Pill tone="warn">Похож на ключевого</Pill> : null}
              {c.merge && <Pill tone="info">Задвоенный</Pill>}
              <span className="num" style={{ whiteSpace: 'nowrap' }}>
                {formatRub(c.revenue)}
              </span>
              {can && !c.key && (
                <Button size="sm" variant="ghost" onClick={() => add.mutate({ kind: 'key', name: c.name }, { onSuccess: () => toast(`«${c.name}» — ключевой клиент`), onError: (e) => toast(errorText(e), 'error') })}>
                  В ключевые
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 13 }}>
          {q ? 'Никого не нашли' : 'За этот месяц отчётов ещё нет'}
        </p>
      )}
    </section>
  );
}

/** Менеджеры из отчётов, которых не нашли среди сотрудников, и ручные сопоставления. */
function Matching() {
  const unmatched = useUnmatched(true);
  const aliases = useAliases(true);
  const people = useSalesPeople('sales_reports');
  const toast = useToast();
  const [pick, setPick] = useState<Record<string, string>>({});
  const link = useSalesMutation((v: { name: string; user: string }) => salesApi.addAlias(v.name, v.user));
  const unlink = useSalesMutation((id: string) => salesApi.deleteAlias(id));
  return (
    <section className="card card-tight stack" style={{ '--gap': '10px' } as React.CSSProperties} aria-label="Сопоставление менеджеров">
      <h3 className="card-title">Менеджеры из отчётов</h3>
      <p className="faint" style={{ fontSize: 13 }}>
        Имена в 1С не всегда совпадают с профилем: «Мишина А.» или старая фамилия. Сопоставьте один раз — прошлые и будущие отчёты перейдут к сотруднику.
      </p>
      {unmatched.isLoading ? (
        <Skeleton h={40} />
      ) : unmatched.data?.length ? (
        <div className="list">
          {unmatched.data.map((u) => (
            <div key={u.name} className="list-row" style={{ flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 160 }}>
                <b>{u.name}</b>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {formatRub(u.revenue)} · последний отчёт {formatDate(u.last_date, { short: true })}
                </div>
              </div>
              <select className="select" style={{ maxWidth: 220 }} aria-label={`Сотрудник для «${u.name}»`} value={pick[u.name] ?? ''} onChange={(e) => setPick((x) => ({ ...x, [u.name]: e.target.value }))}>
                <option value="">Кто это?</option>
                {(people.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="primary"
                icon={<UserCheck size={14} />}
                disabled={!pick[u.name]}
                loading={link.isPending && link.variables?.name === u.name}
                onClick={() =>
                  link.mutate(
                    { name: u.name, user: pick[u.name]! },
                    {
                      onSuccess: (r) => toast(`Строк отчётов перешло: ${r.lines}${r.plans_updated ? ` · пересчитано показателей: ${r.plans_updated}` : ''}`),
                      onError: (e) => toast(errorText(e), 'error'),
                    },
                  )
                }
              >
                Сопоставить
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 13 }}>
          Все менеджеры из отчётов найдены среди сотрудников.
        </p>
      )}
      {!!aliases.data?.length && (
        <>
          <h4 style={{ fontSize: 14, marginTop: 6 }}>Сопоставлено вручную</h4>
          <div className="sl-chips">
            {aliases.data.map((a) => (
              <span key={a.id} className="sl-chip">
                <span>
                  {a.name} → {a.user.name}
                </span>
                <button type="button" aria-label={`Отменить сопоставление «${a.name}»`} onClick={() => unlink.mutate(a.id, { onError: (e) => toast(errorText(e), 'error') })}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** KPI целей из продаж: выручка, штуки или клиенты за каждый закрытый месяц попадают в замеры KPI. */
function GoalLinks({ can }: { can: boolean }) {
  const links = useGoalLinks();
  const targets = useGoalLinkTargets(can);
  const toast = useToast();
  const [metric, setMetric] = useState('');
  const [measure, setMeasure] = useState<SalesGoalLink['measure']>('revenue');
  const [unit, setUnit] = useState('');
  const link = useSalesMutation(() => salesApi.linkGoal({ metric_id: metric, measure, unit_id: unit || null }));
  const unlink = useSalesMutation((id: string) => salesApi.unlinkGoal(id));
  const m = targets.data?.metrics.find((x) => x.metric_id === metric);
  const measures = (m?.unit === 'count' ? ['quantity', 'clients'] : ['revenue']) as SalesGoalLink['measure'][];
  return (
    <section className="card card-tight stack" style={{ '--gap': '10px' } as React.CSSProperties} aria-label="KPI целей из продаж">
      <h3 className="card-title">KPI целей из продаж</h3>
      <p className="faint" style={{ fontSize: 13 }}>
        Свяжите KPI цели с продажами — каждый закрытый месяц его замер появится сам: выручка в рублях, проданные штуки или клиенты с продажами.
      </p>
      {links.isLoading ? (
        <Skeleton h={40} />
      ) : links.data?.length ? (
        <div className="list">
          {links.data.map((l) => (
            <div key={l.metric_id} className="list-row">
              <Link2 size={16} className="faint" aria-hidden />
              <div className="grow" style={{ minWidth: 0 }}>
                <Link to={`/app/goals/${l.goal_id}`} className="clip" style={{ display: 'block', fontWeight: 600 }}>
                  {l.goal_title}
                </Link>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {goalLinkLine(l)}
                </div>
              </div>
              {l.can_edit && <Button variant="ghost" size="sm" icon={<Unlink size={14} />} aria-label={`Отвязать «${l.metric_name}»`} onClick={() => unlink.mutate(l.metric_id, { onError: (e) => toast(errorText(e), 'error') })} />}
            </div>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 13 }}>
          Связей пока нет.
        </p>
      )}
      {can && targets.data && (
        targets.data.metrics.length ? (
          <div className="stack" style={{ '--gap': '10px', borderTop: '1px dashed var(--line)', paddingTop: 12 } as React.CSSProperties}>
            <Field label="KPI цели">
              {(p) => (
                <select
                  className="select"
                  {...p}
                  value={metric}
                  onChange={(e) => {
                    setMetric(e.target.value);
                    const next = targets.data!.metrics.find((x) => x.metric_id === e.target.value);
                    setMeasure(next?.unit === 'count' ? 'quantity' : 'revenue');
                  }}
                >
                  <option value="">Выберите KPI в рублях или штуках</option>
                  {targets.data.metrics.map((x) => (
                    <option key={x.metric_id} value={x.metric_id}>
                      {x.goal_title} — {x.metric_name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="grid-2" style={{ gap: 12 }}>
              <Field label="Что считать">
                {(p) => (
                  <select className="select" {...p} value={measure} onChange={(e) => setMeasure(e.target.value as SalesGoalLink['measure'])} disabled={!m}>
                    {measures.map((x) => (
                      <option key={x} value={x}>
                        {GOAL_LINK_MEASURE_LABELS[x]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Чьи продажи">
                {(p) => (
                  <select className="select" {...p} value={unit} onChange={(e) => setUnit(e.target.value)}>
                    {targets.data!.company && <option value="">Вся компания</option>}
                    {!targets.data!.company && <option value="">Выберите подразделение</option>}
                    {targets.data!.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <div>
              <Button
                size="sm"
                variant="primary"
                icon={<Link2 size={14} />}
                disabled={!metric || (!unit && !targets.data.company)}
                loading={link.isPending}
                onClick={() =>
                  link.mutate(undefined, {
                    onSuccess: (r: { goals_updated: number }) => {
                      setMetric('');
                      toast(r.goals_updated ? `Связано · замеров добавлено: ${r.goals_updated}` : 'Связано — замер появится, когда месяц закроется');
                    },
                    onError: (e) => toast(errorText(e), 'error'),
                  })
                }
              >
                Связать с продажами
              </Button>
            </div>
          </div>
        ) : (
          <p className="faint" style={{ fontSize: 13 }}>
            Нет KPI в рублях или штуках, где вы вносите факт.
          </p>
        )
      )}
    </section>
  );
}

export function SettingsTab({ month, can }: { month: string; can: boolean }) {
  return (
    <div className="grid-2">
      <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
        <ClientList kind="key" can={can} />
        <ClientList kind="merge" can={can} />
        <ClientsBrowser month={month} can={can} />
      </div>
      <div className="sl-side">
        {can && <Matching />}
        <GoalLinks can={can} />
      </div>
    </div>
  );
}

