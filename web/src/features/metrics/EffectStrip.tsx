import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatHours, formatPercent as percent } from '@offix/core';
import { useMetrics } from '../../lib/queries';
import './metrics.css';

/** Сводка эффекта на Пульсе: одна цифра и три факта, полная картина — по ссылке. */
export function EffectStrip() {
  const q = useMetrics();
  const r = q.data;
  if (!r || r.north_star.total === 0) return null;
  return (
    <Link to="/app/metrics" className="card card-hover effect-strip" aria-label={`Эффект: ${percent(r.north_star.value)} целей сдвинули KPI за ${r.window_days} дней`}>
      <div className="effect-strip-value num">{percent(r.north_star.value)}</div>
      <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
        <div style={{ fontWeight: 600 }}>целей сдвинули KPI к цели за {r.window_days} дней</div>
        <div className="effect-strip-facts">
          <span>
            Свежие замеры <b className="num">{percent(r.freshness.value)}</b>
          </span>
          {r.blockers.median_hours !== null && (
            <span>
              Блокер снимают за <b className="num">{formatHours(r.blockers.median_hours)}</b>
            </span>
          )}
          {r.on_time.value !== null && (
            <span>
              В срок <b className="num">{percent(r.on_time.value)}</b>
            </span>
          )}
        </div>
      </div>
      <span className="row muted" style={{ gap: 4, fontSize: 14 }}>
        Эффект <ArrowRight size={14} />
      </span>
    </Link>
  );
}
