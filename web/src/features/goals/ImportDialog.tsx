import { Download, FileUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate, formatValue, importTemplate, observationDay, parseTable, planImport, plural, todayIso, UNITS, type ImportRow } from '@offix/core';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useInvalidateWork } from '../../lib/queries';
import type { Metric } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';

const OBS_FORMS = ['замер', 'замера', 'замеров'] as const;
const STATUS_LABEL: Record<ImportRow['status'], string> = { ok: 'Добавится', duplicate: 'Уже есть', error: 'Ошибка' };

/** CSV из Excel бывает в UTF-8 или в windows-1251 — пробуем по очереди. */
export async function readTextFile(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1251').decode(buf);
  }
}

function downloadTemplate(unitShort: string) {
  const blob = new Blob([importTemplate(unitShort)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'offix-замеры.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Импорт замеров из таблицы: вставка из Excel или Google Таблиц либо CSV.
 * До отправки показываем, что добавится, что уже есть и что не так, — ничего
 * не отбрасываем молча. За один день у KPI — один замер, поэтому повторный
 * импорт того же файла ничего не задваивает.
 */
export function ImportDialog({ goalId, metrics, onClose }: { goalId: string; metrics: Metric[]; onClose: () => void }) {
  const [metricId, setMetricId] = useState((metrics.find((m) => m.is_primary) ?? metrics[0])!.id);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [cols, setCols] = useState<{ date: number | null; value: number | null }>({ date: null, value: null });
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateWork();
  const toast = useToast();

  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0]!;
  const unit = UNITS[metric.unit];
  const existing = useQuery({
    queryKey: ['goal', goalId, 'observations', metricId],
    queryFn: () => api<{ observed_at: string }[]>(`/goals/${goalId}/metrics/${metricId}/observations`),
  });

  const table = useMemo(() => parseTable(text), [text]);
  const dateCol = cols.date ?? table.dateCol;
  const valueCol = cols.value ?? table.valueCol;
  const plan = useMemo(() => {
    if (dateCol === null || valueCol === null || !existing.data) return null;
    const existingDays = existing.data.map((o) => observationDay(o.observed_at));
    return planImport(table, dateCol, valueCol, { unit: metric.unit, now: new Date(), existingDays });
  }, [table, dateCol, valueCol, existing.data, metric.unit]);
  // Новый ключ на каждый новый набор строк: двойной клик не задвоит, а изменённый файл уйдёт как новый запрос.
  const idemKey = useMemo(() => newIdempotencyKey(), [plan, note]);

  const onText = (v: string) => {
    setText(v);
    setCols({ date: null, value: null });
    setError(null);
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    onText(await readTextFile(file));
  };

  const submit = async () => {
    if (!plan || plan.counts.ok === 0) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ imported: number; skipped: number }>(`/goals/${goalId}/metrics/${metricId}/observations/import`, {
        body: { rows: plan.observations, note: note.trim() || undefined },
        idempotencyKey: idemKey,
      });
      await invalidate();
      toast(`Добавлено ${r.imported} ${plural(r.imported, OBS_FORMS)}${r.skipped ? `, ${r.skipped} уже были` : ''}`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const today = todayIso(new Date());
  const lastAt = metric.last_observed_at;
  const becomesCurrent = plan?.latest && (!lastAt || plan.latest.at > lastAt);
  const hasTable = table.rows.length > 0;
  const manyColumns = table.columns.length > 2;
  const columnMissing = hasTable && (dateCol === null || valueCol === null);

  return (
    <Dialog
      wide
      title="Импорт из таблицы"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" icon={<Download size={14} />} onClick={() => downloadTemplate(unit.short)} style={{ marginRight: 'auto' }}>
            Скачать шаблон
          </Button>
          <Button variant="primary" loading={saving} disabled={!plan || plan.counts.ok === 0} onClick={submit}>
            {plan && plan.counts.ok > 0 ? `Добавить ${plan.counts.ok} ${plural(plan.counts.ok, OBS_FORMS)}` : 'Добавить замеры'}
          </Button>
        </>
      }
    >
      {metrics.length > 1 && (
        <Field label="KPI">
          {(p) => (
            <select className="select" {...p} value={metricId} onChange={(e) => setMetricId(e.target.value)}>
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <p className="muted" style={{ fontSize: 14 }}>
        Две колонки: дата и значение в единицах «{unit.label.toLowerCase()}». За один день — один замер: дни, за которые замер уже есть, пропустим.
      </p>
      <Field label="Вставьте ячейки из Excel или Google Таблиц" hint={fileName ? `Файл: ${fileName}` : 'Или выберите CSV-файл. Файл .xlsx сохраните как CSV или просто скопируйте ячейки'}>
        {(p) => (
          <textarea
            className="textarea import-paste"
            {...p}
            rows={5}
            spellCheck={false}
            placeholder={'Дата\tЗначение\n01.10.2026\t40\n08.10.2026\t38,5'}
            value={text}
            onChange={(e) => {
              setFileName(null);
              onText(e.target.value);
            }}
          />
        )}
      </Field>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button size="sm" icon={<FileUp size={14} />} onClick={() => fileRef.current?.click()}>
          Выбрать CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          hidden
          aria-label="CSV-файл с замерами"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {hasTable && manyColumns && (
        <div className="import-cols">
          <Field label="Колонка с датой">
            {(p) => (
              <select className="select" {...p} value={dateCol ?? ''} onChange={(e) => setCols((c) => ({ ...c, date: Number(e.target.value) }))}>
                {dateCol === null && <option value="">Выберите колонку</option>}
                {table.columns.map((c, i) => (
                  <option key={i} value={i}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Колонка со значением">
            {(p) => (
              <select className="select" {...p} value={valueCol ?? ''} onChange={(e) => setCols((c) => ({ ...c, value: Number(e.target.value) }))}>
                {valueCol === null && <option value="">Выберите колонку</option>}
                {table.columns.map((c, i) => (
                  <option key={i} value={i}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      )}

      {columnMissing && !manyColumns && (
        <div className="field-error" role="alert">
          Не нашли {dateCol === null ? 'колонку с датами' : 'колонку с числами'}. Нужны две колонки: дата и значение.
        </div>
      )}

      {hasTable && existing.isError && <div className="field-error" role="alert">Не удалось загрузить уже внесённые замеры. Закройте окно и попробуйте ещё раз.</div>}

      {plan && (
        <section className="stack" style={{ '--gap': '10px' } as React.CSSProperties} aria-label="Предпросмотр импорта">
          <div className="import-summary" role="status">
            <span>
              Добавится <b className="num">{plan.counts.ok}</b>
            </span>
            <span aria-hidden> · </span>
            <span>
              уже есть <b className="num">{plan.counts.duplicate}</b>
            </span>
            <span aria-hidden> · </span>
            <span className={plan.counts.error ? 'import-bad' : undefined}>
              ошибок <b className="num">{plan.counts.error}</b>
            </span>
          </div>
          <p className="muted" style={{ fontSize: 14 }}>
            {becomesCurrent
              ? `Текущее значение станет ${formatValue(plan.latest!.value, metric.unit)} (замер ${formatDate(plan.latest!.day, { today })}), сейчас ${formatValue(metric.current_value, metric.unit)}.`
              : plan.latest
                ? `Текущее значение не изменится: ${formatValue(metric.current_value, metric.unit)} — в таблице нет замеров новее.`
                : plan.counts.duplicate && !plan.counts.error
                  ? 'Все замеры из таблицы уже внесены — добавлять нечего.'
                  : 'Добавлять нечего.'}
          </p>
          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th scope="col" className="import-line">Стр.</th>
                  <th scope="col">Дата</th>
                  <th scope="col">Значение</th>
                  <th scope="col">Статус</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.line} className={`import-${r.status}`}>
                    <td className="import-line faint num">{r.line}</td>
                    <td>{r.day ? formatDate(r.day, { today, short: true }) : r.rawDate || '—'}</td>
                    <td className="num">{r.value !== undefined ? formatValue(r.value, metric.unit) : r.rawValue || '—'}</td>
                    <td>
                      <span className="import-status">{STATUS_LABEL[r.status]}</span>
                      {r.reason && <span className="import-reason">{r.reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field label="Откуда цифры" hint="Например: «выгрузка из 1С за сентябрь»">
            {(p) => <input className="input" {...p} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </section>
      )}

      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
