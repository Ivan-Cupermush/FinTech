import { CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Pencil } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  coverageText,
  formatDate,
  formatNumber,
  formatRub,
  monthTitle,
  PLAN_SOURCE_LABELS,
  planBar,
  planForecastText,
  planPayParts,
  planTone,
  salesMonthNav,
  salesValueText,
  type SalesMonth,
  type SalesPlan,
} from '@offix/core';
import { ApiError, apiBlob, saveBlob } from '../../lib/api';
import { Button } from '../../ui/Button';
import { Glass } from '../../ui/fx/Glass';
import { gradientCss, gradientLook } from '../../ui/fx/gradients';
import { useDarkTheme } from '../../ui/fx/support';
import { Pill } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';
import { TEMPLATE_NAMES } from './data';

/** Текст ошибки для тоста: сначала ошибка поля — она конкретнее. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return Object.values(e.fields)[0] ?? e.message;
  return (e as Error).message;
}

/** ‹ Октябрь 2026 › — вперёд не дальше следующего месяца: план ставят заранее. */
export function MonthSwitcher({ month, current, onChange }: { month: string; current: string; onChange: (m: string) => void }) {
  const nav = salesMonthNav(month, current);
  return (
    <div className="sl-month" role="group" aria-label="Месяц">
      <Button variant="ghost" size="sm" icon={<ChevronLeft size={16} />} onClick={() => onChange(nav.prev)} aria-label="Предыдущий месяц" />
      <span className="sl-month-title" aria-live="polite">
        {monthTitle(month)}
      </span>
      <Button variant="ghost" size="sm" icon={<ChevronRight size={16} />} onClick={() => nav.next && onChange(nav.next)} disabled={!nav.next} aria-label="Следующий месяц" />
    </div>
  );
}

/** Главная цифра месяца — выплата: стекло на градиенте раздела, шкала «сейчас → прогноз → максимум». */
export function PayoutPanel({ m }: { m: SalesMonth }) {
  const dark = useDarkTheme();
  const t = m.totals;
  const file = t.file != null;
  const scale = t.max > 0 ? (n: number) => `${Math.min(100, (n / t.max) * 100)}%` : null;
  return (
    <section className="sl-pay" style={{ background: gradientCss(gradientLook('sales', dark)) }} aria-label="Выплата за месяц">
      <Glass className="sl-pay-glass" radius={24} elasticity={0} displacement={40} blur={0.25} clip>
        <div className="sl-pay-body">
          <div>
            <div className="sl-pay-label">{file ? 'К выплате по файлу KPI' : 'Прогноз выплаты к концу месяца'}</div>
            <div className="sl-pay-big">{formatRub(file ? t.file! : t.forecast)}</div>
            <div className="sl-pay-note">{file ? 'Итоги месяца из файла KPI' : coverageText(m.coverage)}</div>
          </div>
          <div className="sl-pay-figures">
            <div className="sl-pay-figure">
              <b>{formatRub(t.now)}</b>
              заработано сейчас
            </div>
            <div className="sl-pay-figure">
              <b>{formatRub(t.max)}</b>
              максимум
            </div>
            <div className="sl-pay-figure">
              <b>{formatRub(t.fixed)}</b>
              оклад и фиксированные
            </div>
          </div>
          {scale && !file && (
            <div className="sl-pay-scale" role="img" aria-label={`Заработано ${formatRub(t.now)} из ${formatRub(t.max)}, прогноз ${formatRub(t.forecast)}`}>
              <i className="forecast" style={{ width: scale(t.forecast) }} />
              <i className="now" style={{ width: scale(t.now) }} />
            </div>
          )}
        </div>
      </Glass>
    </section>
  );
}


/** Карточка показателя: факт и план, полоса с порогами и прогнозом, выплата сейчас / прогноз / максимум, подсказка. */
export function PlanCard({ p, today, actions }: { p: SalesPlan; today: string; actions?: ReactNode }) {
  const c = p.calc;
  const fixed = p.payout_rule.type === 'fixed';
  const bar = planBar(p, c);
  const tone = planTone(p);
  const forecast = planForecastText(p);
  const pay = planPayParts(p);
  return (
    <article className="card sl-plan" data-tone={tone} data-fixed={fixed} aria-label={p.name}>
      <div className="sl-plan-head">
        <div className="sl-plan-title">
          <h3>{p.name}</h3>
          {c.condition && <div className="faint sl-plan-cond">{c.condition}</div>}
        </div>
        <Pill tone={c.source === 'file' ? 'info' : c.source === 'report' ? 'accent' : 'neutral'} plain>
          {PLAN_SOURCE_LABELS[c.source]}
        </Pill>
        {actions}
      </div>
      {fixed ? (
        <div className="sl-plan-fixed num">{formatRub(c.now ?? 0)}</div>
      ) : (
        <>
          <div className="sl-plan-values">
            <span className="num sl-plan-fact">{salesValueText(p.fact, p.unit)}</span>
            {p.plan > 0 && <span className="faint">из {salesValueText(p.plan, p.unit)}</span>}
            {p.plan > 0 && <span className="num sl-plan-pct">{formatNumber(c.percent, 0)}&nbsp;%</span>}
          </div>
          {bar && (
            <div className="sl-bar" role="img" aria-label={`Выполнено ${formatNumber(c.percent, 0)} % плана${c.forecast_percent != null ? `, прогноз ${formatNumber(c.forecast_percent, 0)} %` : ''}`}>
              <div className="sl-bar-track">
                {bar.forecast != null && <div className="sl-bar-forecast" style={{ width: `${bar.forecast}%` }} />}
                <div className="sl-bar-fill" style={{ width: `${bar.fill}%` }} />
              </div>
              {bar.marks.map((m) => (
                <div key={m} className="sl-bar-mark" style={{ left: `${m}%` }}>
                  <span>{formatNumber(m, 0)}%</span>
                </div>
              ))}
            </div>
          )}
          {forecast && (
            <div className="faint" style={{ fontSize: 13 }}>
              {forecast}
            </div>
          )}
        </>
      )}
      {c.items && c.items.length > 0 && (
        <ul className="sl-items" aria-label="Позиции">
          {c.items.map((it) => (
            <li key={it.name} className={it.done ? 'done' : ''}>
              {it.done && <CheckCircle2 size={13} aria-hidden />}
              {it.name}
              <span className="num">
                {it.count}/{it.need}
              </span>
            </li>
          ))}
        </ul>
      )}
      {pay.length > 0 && (
        <div className="sl-plan-pay">
          {pay.map((x) => (
            <span key={x.label}>
              {x.label} <b>{x.value}</b>
            </span>
          ))}
        </div>
      )}
      {c.rule && !fixed && <div className="faint sl-plan-rule">Выплата: {c.rule}</div>}
      {c.hint && <div className="sl-plan-hint">{c.hint}</div>}
      {c.as_of && (
        <div className="faint" style={{ fontSize: 12.5 }}>
          Данные на {formatDate(c.as_of, { today })}
        </div>
      )}
    </article>
  );
}

export const EditButton = ({ label, onClick }: { label: string; onClick: () => void }) => <Button variant="ghost" size="sm" icon={<Pencil size={14} />} onClick={onClick} aria-label={label} title={label} />;

/** Зона загрузки файла: перетаскиванием или кнопкой, с полосой прогресса. */
export function UploadZone({
  title,
  hint,
  accept = '.xlsx,.xls,.csv',
  button = 'Выбрать файл',
  progress,
  onFile,
  extra,
}: {
  title: string;
  hint: ReactNode;
  accept?: string;
  button?: string;
  progress: number | null;
  onFile: (f: File) => void;
  extra?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const busy = progress != null;
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f && !busy) onFile(f);
  };
  return (
    <div className="stack sl-drop-wrap" style={{ '--gap': '8px' } as React.CSSProperties}>
      <div
        className={`sl-drop ${over ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <span className="sl-drop-icon" aria-hidden>
          <FileSpreadsheet size={22} />
        </span>
        <div className="sl-drop-text">
          <b>{title}</b>
          <span className="faint">{hint}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {extra}
          <Button size="sm" variant="primary" loading={busy} onClick={() => input.current?.click()}>
            {button}
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={accept}
          aria-label={title}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
      </div>
      {busy && (
        <div className="sl-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Загрузка файла">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Скачать образец файла: отчёт 1С, файл KPI, продажи для Excel. */
export function TemplateButton({ kind, children }: { kind: keyof typeof TEMPLATE_NAMES; children: ReactNode }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<Download size={14} />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          saveBlob(await apiBlob(`/sales/templates/${kind}`), TEMPLATE_NAMES[kind]);
        } catch (e) {
          toast(errorText(e), 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
