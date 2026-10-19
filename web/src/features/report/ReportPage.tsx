import { Copy, FileSpreadsheet, Printer } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  HEALTH_LABELS,
  HEALTH_TONES,
  REPORT_PERIOD_LABELS,
  REPORT_PERIODS,
  formatDate,
  formatDelta,
  formatHours,
  isReportPeriod,
  kpiProgress,
  plural,
  reportCsv,
  reportFileName,
  reportPeriodText,
  reportText,
  type Report,
  type ReportGoal,
  type ReportPeriod,
} from '@offix/core';
import { useReport } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { KpiTrack } from '../../ui/KpiTrack';
import { LogoMark } from '../../ui/Logo';
import { Empty, Segmented, Skeleton } from '../../ui/Misc';
import { Pill } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';
import { copyText, downloadFile } from './files';
import { MailSubscription } from './MailSubscription';
import './report.css';

function usePeriod(): [ReportPeriod, (p: ReportPeriod) => void] {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get('days'));
  const period = isReportPeriod(raw) ? raw : 30;
  return [period, (p) => setParams(p === 30 ? {} : { days: String(p) }, { replace: true })];
}

/**
 * Отчёт для руководства. На экране — лист бумаги, при печати — A4 без
 * интерфейса вокруг. Текст для мессенджера и CSV для Excel собирает ядро,
 * поэтому они совпадают с тем, что видно на листе.
 */
export function ReportPage() {
  const [period, setPeriod] = usePeriod();
  const q = useReport(period);
  const toast = useToast();
  const r = q.data;

  // Имя файла при «Сохранить как PDF» берётся из заголовка страницы.
  useEffect(() => {
    if (!r) return;
    const prev = document.title;
    document.title = reportFileName(r, 'pdf').replace(/\.pdf$/, '');
    return () => {
      document.title = prev;
    };
  }, [r]);

  const copy = async () => {
    if (!r) return;
    if (await copyText(reportText(r))) toast('Текст отчёта скопирован, вставьте его в мессенджер или письмо');
    else toast('Не удалось скопировать. Разрешите доступ к буферу обмена', 'error');
  };

  return (
    <div className="page report-page">
      <div className="page-head report-toolbar">
        <div>
          <div className="eyebrow">Для руководства</div>
          <h1 style={{ marginTop: 6 }}>Отчёт</h1>
          <p className="muted">Собирается сам из целей, замеров и задач. Распечатайте, отправьте в мессенджер или откройте в Excel.</p>
        </div>
        <div className="report-actions">
          <Segmented
            label="Период отчёта"
            value={String(period)}
            onChange={(v) => setPeriod(Number(v) as ReportPeriod)}
            options={REPORT_PERIODS.map((p) => ({ value: String(p), label: REPORT_PERIOD_LABELS[p] }))}
          />
          <div className="row" style={{ gap: 8 }}>
            <Button icon={<Copy size={16} />} onClick={copy} disabled={!r}>
              Текст
            </Button>
            <Button icon={<FileSpreadsheet size={16} />} onClick={() => r && downloadFile(reportFileName(r, 'csv'), reportCsv(r), 'text/csv;charset=utf-8')} disabled={!r}>
              Excel
            </Button>
            <Button variant="primary" icon={<Printer size={16} />} onClick={() => window.print()} disabled={!r}>
              PDF
            </Button>
          </div>
        </div>
      </div>

      {q.isLoading && (
        <div className="report-sheet stack" aria-hidden>
          <Skeleton h={18} w="40%" />
          <Skeleton h={64} />
          <div className="report-figures">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h={72} />
            ))}
          </div>
          <Skeleton h={180} />
        </div>
      )}

      {q.isError && (
        <div className="card">
          <Empty title="Не удалось собрать отчёт" action={<Button onClick={() => q.refetch()}>Повторить</Button>}>
            Проверьте соединение и попробуйте ещё раз.
          </Empty>
        </div>
      )}

      {r && <Sheet r={r} />}

      <MailSubscription />
    </div>
  );
}

function Sheet({ r }: { r: Report }) {
  const h = r.headline;
  return (
    <article className="report-sheet" aria-label={`Отчёт за ${reportPeriodText(r)}`}>
      <header className="report-head">
        <div className="row" style={{ gap: 12 }}>
          <LogoMark size={34} />
          <div>
            <div className="report-company">{r.company}</div>
            <div className="faint report-meta">
              {r.scope === 'visible' ? 'Цели вашей зоны' : 'Вся организация'} · {REPORT_PERIOD_LABELS[r.days].toLowerCase()}
            </div>
          </div>
        </div>
        <div className="report-period">
          <div className="num">{reportPeriodText(r)}</div>
          <div className="faint report-meta">
            Сформирован {formatDate(r.at, { today: '0000' })}
            {r.author ? ` · ${r.author}` : ''}
          </div>
        </div>
      </header>

      {h.goals === 0 ? (
        <Empty title="За период нет целей в работе">Запущенные и завершённые за период цели появятся здесь сами.</Empty>
      ) : (
        <>
          <section aria-labelledby="rep-main">
            <h2 id="rep-main" className="report-h">
              Главное
            </h2>
            <ul className="report-summary">
              {r.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>

          <div className="report-figures">
            <Figure label="Цели сдвинули KPI" value={h.north_star === null ? '—' : `${h.north_star} %`} note={h.with_kpi ? `${h.improved} из ${h.with_kpi} с KPI` : 'нет целей с KPI'} />
            <Figure
              label="Под угрозой"
              value={String(h.health.critical)}
              tone={h.health.critical ? 'bad' : undefined}
              note={`из ${h.goals} ${plural(h.goals, ['цели', 'целей', 'целей'])} в отчёте`}
            />
            <Figure label="Закрыто задач" value={String(h.tasks_done)} note={h.on_time === null ? 'без сроков' : `${h.on_time} % в срок`} />
            <Figure
              label="Снятие блокера"
              value={formatHours(h.blocker_median_hours)}
              note={h.open_blockers ? `${h.open_blockers} ${plural(h.open_blockers, ['открыт', 'открыто', 'открыто'])} сейчас` : 'открытых нет'}
            />
          </div>

          {r.decisions.length > 0 && (
            <section aria-labelledby="rep-dec">
              <h2 id="rep-dec" className="report-h">
                Нужно решение
              </h2>
              <ol className="report-decisions">
                {r.decisions.map((d, i) => (
                  <li key={`${d.goal_id}:${d.title}`} className={d.severity}>
                    <span className="report-dec-n num" aria-hidden>
                      {i + 1}
                    </span>
                    <div className="stack" style={{ '--gap': '3px' } as React.CSSProperties}>
                      <span className="report-dec-title">{d.title}</span>
                      <span className="faint report-dec-goal">{d.goal_title}</span>
                      <span className="report-dec-why">{d.explanation}</span>
                      <span className="report-dec-do">→ {d.suggestion}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section aria-labelledby="rep-goals">
            <h2 id="rep-goals" className="report-h">
              Цели
            </h2>
            <div className="report-goals">
              {r.goals.map((g) => (
                <GoalRow key={g.id} g={g} today={r.at} inDecisions={r.decisions.some((d) => d.goal_id === g.id && d.title === g.top_risk?.title)} />
              ))}
            </div>
          </section>
        </>
      )}

      <footer className="report-foot faint">
        <span>Данные offix: замеры KPI, история задач и журнал целей. Ручного ввода цифр нет.</span>
        <span>offix</span>
      </footer>
    </article>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'bad' }) {
  return (
    <div className={`report-figure ${tone ?? ''}`}>
      <div className="report-figure-label">{label}</div>
      <div className="report-figure-value num">{value}</div>
      <div className="faint report-figure-note">{note}</div>
    </div>
  );
}

function GoalRow({ g, today, inDecisions }: { g: ReportGoal; today: string; inDecisions: boolean }) {
  const k = g.kpi;
  const meta = [g.owner, g.health === 'done' && g.completed_at ? `завершена ${formatDate(g.completed_at, { today })}` : g.due_at ? `срок ${formatDate(g.due_at, { today })}` : null].filter(Boolean).join(' · ');
  return (
    <div className="report-goal">
      <div className="report-goal-head">
        <div className="grow stack" style={{ '--gap': '2px', minWidth: 0 } as React.CSSProperties}>
          <Link to={`/app/goals/${g.id}`} className="report-goal-title">
            {g.title}
          </Link>
          {meta && <span className="faint report-meta">{meta}</span>}
        </div>
        <Pill tone={HEALTH_TONES[g.health]}>{HEALTH_LABELS[g.health]}</Pill>
      </div>
      <div className="report-goal-body">
        <div className="report-goal-kpi">
          {k ? (
            <>
              <div className="faint report-meta">{k.name}</div>
              <KpiTrack baseline={k.baseline} target={k.target} current={k.current} unit={k.unit} progress={kpiProgress(k, k.current)} size="sm" name={k.name} />
              <div className="report-kpi-foot">
                {k.progress !== null && k.direction !== 'maintain' && <span className="num">{k.progress} % пути</span>}
                {k.delta !== null && <span className={`num report-delta ${k.delta > 0 ? 'good' : k.delta < 0 ? 'bad' : ''}`}>{formatDelta(k.delta)} за период</span>}
                {k.current === null && <span>Замеров ещё нет</span>}
              </div>
            </>
          ) : (
            <span className="faint">Без KPI: эффект не измерить</span>
          )}
        </div>
        <dl className="report-goal-tasks">
          <div>
            <dt>Задачи</dt>
            <dd className="num">{g.tasks.total ? `${g.tasks.done}/${g.tasks.total}` : '—'}</dd>
          </div>
          <div>
            <dt>За период</dt>
            <dd className="num">+{g.tasks.done_in_period}</dd>
          </div>
          {g.tasks.blocked > 0 && (
            <div className="bad">
              <dt>Блокеры</dt>
              <dd className="num">{g.tasks.blocked}</dd>
            </div>
          )}
          {g.tasks.overdue > 0 && (
            <div className="warn">
              <dt>Просрочено</dt>
              <dd className="num">{g.tasks.overdue}</dd>
            </div>
          )}
        </dl>
      </div>
      {/* Риск, который уже стоит в «Нужно решение», второй раз не повторяем. */}
      {g.top_risk && !inDecisions && (
        <p className={`report-goal-risk ${g.top_risk.severity}`}>
          <b>{g.top_risk.title}.</b> {g.top_risk.suggestion}.
        </p>
      )}
    </div>
  );
}
