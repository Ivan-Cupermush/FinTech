import { formatNumber, KPI_STATE_LABELS, UNITS, type KpiProgress, type UnitId } from '@offix/core';

/**
 * Фирменный элемент offix: путь показателя от исходного значения к цели.
 * «40 → 36,5 → 30 мин». Пока нет измерений — штриховка и «Нет данных»,
 * никакого фиктивного прогресса.
 */
export function KpiTrack({
  baseline,
  target,
  current,
  unit,
  progress,
  size = 'md',
  name,
  showLegend = true,
}: {
  baseline: number;
  target: number;
  current: number | null;
  unit: UnitId;
  progress: KpiProgress;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  name?: string;
  showLegend?: boolean;
}) {
  const info = UNITS[unit];
  const f = (v: number) => formatNumber(v, info.decimals);
  const tone = progress.state === 'achieved' || progress.state === 'in_range' ? 'good' : progress.state === 'regress' || progress.state === 'out_of_range' ? 'bad' : '';
  const bar = progress.bar ?? 0;
  const label = current === null ? `${name ?? 'KPI'}: нет данных, цель ${f(target)} ${info.short}` : `${name ?? 'KPI'}: ${f(current)} ${info.short}, цель ${f(target)} ${info.short}, ${KPI_STATE_LABELS[progress.state]}`;
  return (
    <div className={`kpi kpi-${size}`} role="group" aria-label={label}>
      <div className="kpi-head">
        <div className="kpi-values">
          <span className="from">{f(baseline)}</span>
          <span className="arrow" aria-hidden>
            →
          </span>
          {current !== null ? (
            <>
              <span className="now">{f(current)}</span>
              <span className="arrow" aria-hidden>
                →
              </span>
            </>
          ) : null}
          <span className={current === null ? 'now' : 'to'}>{f(target)}</span>
          <span className="unit">{info.short}</span>
        </div>
        {size !== 'sm' && progress.raw !== null && (
          <span className={`num ${tone === 'bad' ? '' : 'muted'}`} style={{ fontWeight: 600, color: tone === 'bad' ? 'var(--bad)' : undefined }}>
            {Math.round(progress.raw)}&nbsp;%
          </span>
        )}
      </div>
      <div className={`kpi-track ${tone} ${progress.state === 'no_data' ? 'no-data' : ''}`} aria-hidden>
        {progress.state !== 'no_data' && (
          <>
            <div className="kpi-fill" style={{ width: `${bar}%` }} />
            <div className="kpi-marker" style={{ left: `${bar}%` }} />
          </>
        )}
      </div>
      {showLegend && size !== 'sm' && (
        <div className="kpi-legend">
          <span>Было</span>
          <span>{progress.state === 'no_data' ? 'Нет данных — внесите первое измерение' : KPI_STATE_LABELS[progress.state]}</span>
          <span>Цель</span>
        </div>
      )}
    </div>
  );
}
