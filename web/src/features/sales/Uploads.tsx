import { AlertTriangle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  formatDate,
  formatNumber,
  formatRub,
  monthTitle,
  plural,
  salesPeriodText,
  salesValueText,
  type KpiFilePreview,
  type KpiFileResult,
  type ReportPersonStatus,
  type SalesPerson,
  type SalesReportImport,
} from '@offix/core';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Empty, Skeleton } from '../../ui/Misc';
import { Pill, type Tone } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';
import { salesApi, useSalesMutation, useSalesPeople, useSalesRefresh, useSalesReports } from './data';
import { errorText, TemplateButton, UploadZone } from './parts';

const STATUS: Record<ReportPersonStatus, { label: string; tone: Tone }> = {
  ok: { label: 'Загружено', tone: 'good' },
  unmatched: { label: 'Не нашли сотрудника', tone: 'warn' },
  ambiguous: { label: 'Несколько похожих', tone: 'warn' },
  forbidden: { label: 'Не ваш сотрудник', tone: 'neutral' },
  no_manager: { label: 'Без менеджера', tone: 'neutral' },
};

/**
 * Отчёт о продажах из 1С («Валовая прибыль» с менеджерами и клиентами):
 * строки раскладываются по сотрудникам, факт показателей и KPI целей
 * пересчитываются. Отчёт за тот же период заменяет прежний.
 */
export function ReportUpload({ onSettings }: { onSettings: () => void }) {
  const refresh = useSalesRefresh();
  const toast = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<SalesReportImport | null>(null);
  const upload = (file: File) => {
    setProgress(0);
    salesApi
      .uploadReport(file, { onProgress: setProgress })
      .then(async (r) => {
        setResult(r);
        await refresh();
        toast(r.report ? 'Отчёт загружен' : 'В отчёте не нашлось ваших продаж', r.report ? undefined : 'error');
      })
      .catch((e) => toast(errorText(e), 'error'))
      .finally(() => setProgress(null));
  };
  return (
    <section className="stack" style={{ '--gap': '12px' } as React.CSSProperties} aria-label="Отчёт о продажах из 1С">
      <UploadZone
        title="Отчёт о продажах из 1С"
        hint="«Валовая прибыль» с группировкой по менеджерам и клиентам, .xlsx. Факт показателей и KPI целей пересчитаются сами."
        progress={progress}
        onFile={upload}
        extra={<TemplateButton kind="report">Образец</TemplateButton>}
      />
      {result && <ReportResult r={result} onSettings={onSettings} />}
    </section>
  );
}

function ReportResult({ r, onSettings }: { r: SalesReportImport; onSettings: () => void }) {
  const needsMatch = r.people.some((p) => p.status === 'unmatched' || p.status === 'ambiguous');
  return (
    <div className="card card-tight stack" style={{ '--gap': '10px' } as React.CSSProperties} role="status">
      <div className="spread">
        <b>
          {r.report ? `Отчёт ${salesPeriodText(r.report.period_start, r.report.period_end)}: ${formatRub(r.report.total)}` : 'Ничего не сохранено'}
        </b>
        {r.replaced > 0 && <Pill tone="info">Заменил прежний: {r.replaced}</Pill>}
      </div>
      {r.goals_updated > 0 && <div className="faint">KPI целей обновлено: {r.goals_updated}</div>}
      {r.key_list_empty && (
        <div className="sl-plan-hint">
          Список ключевых клиентов пуст — продажи «без ключевых» сейчас равны всем продажам.{' '}
          <button type="button" className="sl-link" onClick={onSettings}>
            Заполнить список
          </button>
        </div>
      )}
      {[...r.warnings].map((w) => (
        <div key={w} className="row faint" style={{ gap: 6, fontSize: 13 }}>
          <AlertTriangle size={14} aria-hidden /> {w}
        </div>
      ))}
      <div className="sl-table-wrap">
        <table className="sl-table">
          <thead>
            <tr>
              <th>Менеджер в отчёте</th>
              <th>Сотрудник</th>
              <th className="num">Продажи</th>
              <th className="num">Ключевые</th>
              <th className="num">Клиенты</th>
              <th className="num">Показателей</th>
            </tr>
          </thead>
          <tbody>
            {r.people.map((p) => (
              <tr key={p.manager}>
                <td>{p.manager}</td>
                <td>
                  {p.user ? p.user.name : <Pill tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Pill>}
                  {p.error && (
                    <div className="faint" style={{ fontSize: 12 }}>
                      {p.error}
                    </div>
                  )}
                </td>
                <td className="num">{formatRub(p.total)}</td>
                <td className="num">{formatRub(p.key)}</td>
                <td className="num">{p.clients}</td>
                <td className="num">{p.plans_updated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {needsMatch && (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="faint">Сопоставьте менеджеров из отчёта с сотрудниками — их продажи перейдут к ним.</span>
          <Button size="sm" onClick={onSettings}>
            Сопоставить
          </Button>
        </div>
      )}
    </div>
  );
}

/** Загруженные отчёты: период, сумма, кто загрузил; удалить — если в нём только ваши сотрудники. */
export function ReportsList() {
  const reports = useSalesReports(true);
  const toast = useToast();
  const remove = useSalesMutation((id: string) => salesApi.deleteReport(id));
  const [confirm, setConfirm] = useState<string | null>(null);
  const target = reports.data?.find((r) => r.id === confirm);
  return (
    <section className="card card-tight" aria-label="Загруженные отчёты">
      <h3 className="card-title" style={{ marginBottom: 4 }}>
        Загруженные отчёты
      </h3>
      {reports.isLoading ? (
        <Skeleton h={60} />
      ) : reports.data?.length ? (
        <div className="list">
          {reports.data.slice(0, 30).map((r) => (
            <div key={r.id} className="list-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="clip">{r.file_name}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {monthTitle(r.month)} · {salesPeriodText(r.period_start, r.period_end)} · {r.uploaded_by_name ?? 'сотрудник'}, {formatDate(r.created_at.slice(0, 10), { short: true })}
                  {r.unmatched > 0 && ` · не сопоставлено: ${r.unmatched}`}
                </div>
              </div>
              <span className="num" style={{ whiteSpace: 'nowrap' }}>
                {formatRub(r.total)}
              </span>
              {r.can_delete && <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={`Удалить отчёт «${r.file_name}»`} onClick={() => setConfirm(r.id)} />}
            </div>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ padding: '8px 0', fontSize: 14 }}>
          Отчётов пока нет.
        </p>
      )}
      {target && (
        <Dialog
          title="Удалить отчёт?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Оставить
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(target.id, {
                    onSuccess: () => {
                      setConfirm(null);
                      toast('Отчёт удалён, факт пересчитан');
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
          <p className="muted">
            Продажи из «{target.file_name}» ({salesPeriodText(target.period_start, target.period_end)}) уйдут из факта показателей и KPI целей.
          </p>
        </Dialog>
      )}
    </section>
  );
}

/**
 * Файл KPI: предпросмотр (кто на листах, месяц, показатели и правила
 * выплаты), затем сохранение. Один лист можно отдать выбранному сотруднику,
 * несколько листов распределяются по именам.
 */
export function KpiFlow({ user, month, onDone }: { user?: SalesPerson; month?: string; onDone?: () => void }) {
  const toast = useToast();
  const refresh = useSalesRefresh();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<KpiFilePreview | null>(null);
  const [who, setWho] = useState('');
  const [mon, setMon] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<KpiFileResult[] | null>(null);
  const people = useSalesPeople('sales_files', !user);

  const pick = (f: File) => {
    setFile(f);
    setResults(null);
    setProgress(0.5);
    salesApi
      .previewKpi(f)
      .then((p) => {
        setPreview(p);
        const one = p.sheets.length === 1 ? p.sheets[0]! : null;
        setWho(user?.id ?? one?.suggested_user?.id ?? '');
        setMon(one?.month ?? month ?? '');
      })
      .catch((e) => toast(errorText(e), 'error'))
      .finally(() => setProgress(null));
  };

  const save = async () => {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const single = preview.sheets.length === 1;
      const r = await salesApi.saveKpi(file, { user_id: single ? who || undefined : undefined, month: mon || undefined });
      setResults(r.results);
      setPreview(null);
      await refresh();
      const ok = r.results.filter((x) => !x.error).length;
      toast(`Файл KPI загружен: ${ok} ${ok === 1 ? 'сотрудник' : 'сотрудника'}`);
      onDone?.();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const options = user ? [user, ...(preview?.people ?? []).filter((p) => p.id !== user.id)] : (preview?.people ?? people.data ?? []);
  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      <UploadZone
        title={user ? `Файл KPI: ${user.name}` : 'Файлы KPI сотрудников'}
        hint="План, факт, бонус и «к выплате» по каждому показателю. Несколько листов — несколько сотрудников. Прежние показатели из файла за месяц заменятся."
        progress={progress}
        onFile={pick}
        extra={<TemplateButton kind="kpi">Образец</TemplateButton>}
      />
      {preview && (
        <>
          {preview.sheets.map((s) => (
            <div key={s.sheet} className="card card-tight stack" style={{ '--gap': '10px' } as React.CSSProperties}>
              <div className="spread">
                <div>
                  <b>{s.employee || s.sheet}</b>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    Лист «{s.sheet}» · {s.month ? monthTitle(s.month) : 'месяц не указан'} · {s.metrics.length} {plural(s.metrics.length, ['показатель', 'показателя', 'показателей'])}
                  </div>
                </div>
                <Pill tone={s.has_results ? 'good' : 'info'}>{s.has_results ? 'С итогами' : 'План'}</Pill>
              </div>
              {preview.sheets.length > 1 && (
                <div className={s.suggested_user ? 'faint' : 'field-error'} style={{ fontSize: 13 }}>
                  {s.suggested_user ? `Сотрудник: ${s.suggested_user.name}` : 'Сотрудник не найден — этот лист загрузите отдельно'}
                </div>
              )}
              {s.warnings.map((w) => (
                <div key={w} className="row faint" style={{ gap: 6, fontSize: 13 }}>
                  <AlertTriangle size={14} aria-hidden /> {w}
                </div>
              ))}
              <div className="sl-table-wrap">
                <table className="sl-table">
                  <thead>
                    <tr>
                      <th>Показатель</th>
                      <th className="num">План</th>
                      <th className="num">Факт</th>
                      <th className="num">Бонус</th>
                      <th className="num">{s.has_results ? 'К выплате' : 'Выполнение'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.metrics.map((x, i) => (
                      <tr key={i}>
                        <td>
                          {x.name}
                          {x.rule && (
                            <div className="faint" style={{ fontSize: 12 }}>
                              {x.rule}
                            </div>
                          )}
                        </td>
                        <td className="num">{x.plan ? salesValueText(x.plan, x.unit) : '—'}</td>
                        <td className="num">{x.fact != null ? salesValueText(x.fact, x.unit) : '—'}</td>
                        <td className="num">{x.bonus ? formatRub(x.bonus) : '—'}</td>
                        <td className="num">{s.has_results ? formatRub(x.payment ?? 0) : `${formatNumber(x.percent, 0)} %`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <div className="grid-2" style={{ gap: 14 }}>
            {preview.sheets.length === 1 && (
              <Field label="Сотрудник" required error={!who ? 'Выберите, чей это файл' : null}>
                {(p) => (
                  <select className="select" {...p} value={who} onChange={(e) => setWho(e.target.value)}>
                    <option value="">Выберите сотрудника</option>
                    {options.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.position ? ` — ${x.position}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="Месяц" hint="Если в файле другой — укажите нужный">
              {(p) => <input className="input" type="month" {...p} value={mon} onChange={(e) => setMon(e.target.value)} />}
            </Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Отмена
            </Button>
            <Button variant="primary" loading={busy} disabled={preview.sheets.length === 1 && !who} onClick={save}>
              Загрузить показатели
            </Button>
          </div>
        </>
      )}
      {results && (
        <div className="card card-tight" role="status">
          <div className="list">
            {results.map((r) => (
              <div key={r.sheet} className="list-row">
                <div className="grow">
                  <b>{r.user?.name ?? r.employee}</b>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    {r.error ?? `${r.month ? monthTitle(r.month) : ''} · показателей: ${r.created}${r.replaced ? `, заменено: ${r.replaced}` : ''}`}
                  </div>
                </div>
                <Pill tone={r.error ? 'warn' : 'good'}>{r.error ? 'Не загружен' : 'Загружен'}</Pill>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function KpiFileDialog({ user, month, onClose }: { user: SalesPerson; month: string; onClose: () => void }) {
  return (
    <Dialog wide title="Файл KPI" onClose={onClose}>
      <KpiFlow user={user} month={month} onDone={onClose} />
    </Dialog>
  );
}

export function UploadsTab({ reports, kpi, onSettings }: { reports: boolean; kpi: boolean; onSettings: () => void }) {
  if (!reports && !kpi)
    return (
      <div className="card">
        <Empty title="Загрузки недоступны">Загружать отчёты 1С и файлы KPI может руководитель или тот, кому он включил эти функции.</Empty>
      </div>
    );
  return (
    <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      {reports && <ReportUpload onSettings={onSettings} />}
      {kpi && <KpiFlow />}
      <div className="grid-2">
        {reports ? <ReportsList /> : <span />}
        <section className="card card-tight stack" style={{ '--gap': '6px' } as React.CSSProperties} aria-label="Образцы файлов">
          <h3 className="card-title">Образцы файлов</h3>
          <p className="faint" style={{ fontSize: 13 }}>
            Скачайте и сравните со своими выгрузками: так понятно, какие колонки и строки мы читаем.
          </p>
          <div className="row wrap" style={{ gap: 4 }}>
            <TemplateButton kind="report">Отчёт 1С</TemplateButton>
            <TemplateButton kind="kpi">Файл KPI</TemplateButton>
            <TemplateButton kind="entries">Продажи</TemplateButton>
          </div>
        </section>
      </div>
    </div>
  );
}
