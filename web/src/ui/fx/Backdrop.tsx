import { Component, lazy, Suspense, type ReactNode } from 'react';
import { gradientCss, gradientLook, type GradientVariant } from './gradients';
import { useDarkTheme, useFxLevel } from './support';
import './fx.css';

const Scene = lazy(() => import('./Scene'));

/** Если WebGL упал посреди работы (потеря контекста, старый драйвер) — остаёмся на CSS. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Живой фон блока: CSS-градиент сразу, поверх — WebGL-сцена, когда загрузится.
 * Контент кладётся поверх как обычные дети.
 */
export function Backdrop({ variant, mark = false, className = '', children }: { variant: GradientVariant; mark?: boolean; className?: string; children?: ReactNode }) {
  const dark = useDarkTheme();
  const level = useFxLevel();
  const look = gradientLook(variant, dark);
  return (
    <div className={`fx-backdrop ${className}`} data-fx={level}>
      <div className="fx-layer fx-css" style={{ background: gradientCss(look) }} aria-hidden />
      {level !== 'static' && (
        <div className="fx-layer fx-gl" aria-hidden>
          <SceneBoundary>
            <Suspense fallback={null}>
              <Scene variant={variant} dark={dark} animate={level === 'full'} mark={mark} />
            </Suspense>
          </SceneBoundary>
        </div>
      )}
      {mark && level === 'static' && <FlatMark />}
      {children}
    </div>
  );
}

/** Плоский знак для режима без WebGL: тот же «o›», что и в 3D. */
function FlatMark() {
  return (
    <svg className="fx-flat-mark" viewBox="0 0 120 64" aria-hidden>
      <circle cx="34" cy="32" r="20" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="11" />
      <path d="M76 12 L96 32 L76 52" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
