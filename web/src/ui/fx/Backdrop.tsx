import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { gradientCss, gradientLook, type GradientVariant, type SectionVariant } from './gradients';
import { useDarkTheme, useFxLevel } from './support';
import type { MarkMode } from './layout';
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
export function Backdrop({
  variant,
  mark = false,
  markMode = 'landing',
  glyph,
  glyphIcon,
  framed = false,
  className = '',
  children,
  ...rest
}: {
  variant: GradientVariant;
  mark?: boolean;
  markMode?: MarkMode;
  /** Стеклянный 3D-знак раздела справа (вместо знака offix). */
  glyph?: SectionVariant;
  /** Тот же знак без WebGL: иконка раздела в матовом стекле. */
  glyphIcon?: LucideIcon;
  /** Высокая панель: градиент закрывает кадр целиком, без края «водной глади». */
  framed?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const dark = useDarkTheme();
  const level = useFxLevel();
  const look = gradientLook(variant, dark);
  return (
    <div className={`fx-backdrop ${className}`} data-fx={level} data-variant={variant} {...rest}>
      <div className="fx-layer fx-css" style={{ background: gradientCss(look) }} aria-hidden />
      {level !== 'static' && (
        <div className="fx-layer fx-gl" aria-hidden>
          <SceneBoundary>
            <Suspense fallback={null}>
              <Scene variant={variant} dark={dark} animate={level === 'full'} mark={mark} markMode={markMode} glyph={glyph} framed={framed} />
            </Suspense>
          </SceneBoundary>
        </div>
      )}
      {mark && level === 'static' && <FlatMark side={markMode === 'side'} />}
      {!mark && glyph && glyphIcon && level === 'static' && <FlatGlyph icon={glyphIcon} />}
      {children}
    </div>
  );
}

/** Плоский знак для режима без WebGL: тот же «o›», что и в 3D. */
function FlatMark({ side }: { side: boolean }) {
  return (
    <svg className={side ? 'fx-flat-mark fx-flat-mark-side' : 'fx-flat-mark'} viewBox="0 0 120 64" aria-hidden>
      <circle cx="34" cy="32" r="20" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="11" />
      <path d="M76 12 L96 32 L76 52" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Знак раздела без WebGL: иконка в круге матового стекла, на том же месте, что и 3D. */
function FlatGlyph({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="fx-flat-glyph" aria-hidden>
      <Icon size={56} strokeWidth={1.6} />
    </span>
  );
}
