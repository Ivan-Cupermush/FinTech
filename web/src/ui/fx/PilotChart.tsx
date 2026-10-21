import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatNumber } from '@offix/core';
import { gradientCss, gradientLook } from './gradients';
import { kpiBarHeights } from './layout';
import type { Bar } from './PilotChart3D';
import { useFxLevel } from './support';
import './fx.css';

const Chart3D = lazy(() => import('./PilotChart3D'));

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Плоская версия тех же столбиков: без WebGL, в тестах и при печати. */
function FlatBars({ bars }: { bars: Bar[] }) {
  const h = kpiBarHeights(
    bars.map((b) => b.value),
    100,
  );
  return (
    <div className="pilot-flat" aria-hidden>
      {bars.map((b, i) => (
        <span key={b.label} className={b.target ? 'is-target' : ''} style={{ height: `${h[i]}%` }} />
      ))}
    </div>
  );
}

/**
 * Карточка пилота: путь показателя в 3D. Сцена грузится, только когда карточка
 * доехала до экрана, и останавливается, когда уходит из виду.
 */
export function PilotChart({ bars, unit, caption }: { bars: Bar[]; unit: string; caption: string }) {
  const level = useFxLevel();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const label = bars.map((b) => `${b.label} ${formatNumber(b.value, 1)} ${unit}`).join(', ');
  return (
    <figure ref={ref} className="pilot-chart on-color" style={{ background: gradientCss(gradientLook('login', true)) }} aria-label={`${caption}: ${label}`}>
      <div className="pilot-stage">
        {level === 'static' ? (
          <FlatBars bars={bars} />
        ) : (
          (visible || level === 'calm') && (
            <Boundary fallback={<FlatBars bars={bars} />}>
              <Suspense fallback={<FlatBars bars={bars} />}>
                <Chart3D bars={bars} animate={level === 'full' && visible} />
              </Suspense>
            </Boundary>
          )
        )}
      </div>
      <figcaption className="pilot-legend">
        {bars.map((b) => (
          <div key={b.label} className={b.target ? 'is-target' : ''}>
            <span className="num">
              {formatNumber(b.value, 1)}
              <small> {unit}</small>
            </span>
            <span>{b.label}</span>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}
