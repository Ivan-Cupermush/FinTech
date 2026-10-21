import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Backdrop } from './Backdrop';
import { Glass } from './Glass';
import type { SectionVariant } from './gradients';

export interface HeroStat {
  label: string;
  value: ReactNode;
  /** Цифра, которая требует внимания, подсвечивается. */
  tone?: 'bad' | 'warn' | 'good';
}

/**
 * Шапка рабочего раздела: живой градиент раздела, стеклянный 3D-знак справа,
 * заголовок, короткая сводка и стеклянные плитки с главными цифрами.
 * Одна на страницу — значит, и WebGL-холст на странице один.
 * `compact` — для внутренних экранов (заметка, подключение, превью шаблона):
 * ниже и без плиток, чтобы не отнимать место у работы.
 */
export function PageHero({
  variant,
  icon,
  eyebrow,
  title,
  subtitle,
  actions,
  stats,
  back,
  compact = false,
  className = '',
  children,
}: {
  variant: SectionVariant;
  icon: LucideIcon;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  stats?: HeroStat[];
  back?: ReactNode;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const showStats = !compact && !!stats?.length;
  return (
    <Backdrop variant={variant} glyph={variant} glyphIcon={icon} className={`app-hero page-hero on-color ${compact ? 'is-compact' : ''} ${className}`} aria-labelledby={id} role="region" data-section={variant}>
      <div className="app-hero-text">
        {back && <div className="page-hero-back">{back}</div>}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 id={id}>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {(showStats || actions) && (
        <div className="page-hero-foot">
          {showStats && (
            <div className="app-hero-stats" style={{ gridTemplateColumns: `repeat(${stats!.length}, minmax(0, 170px))` }}>
              {stats!.map((s) => (
                <Glass key={s.label} className="app-hero-stat" radius={20} clip elasticity={0.06} displacement={40}>
                  <div className="app-hero-stat-body" data-tone={s.tone}>
                    <span className="num">{s.value}</span>
                    <span>{s.label}</span>
                  </div>
                </Glass>
              ))}
            </div>
          )}
          {actions && <div className="page-hero-actions">{actions}</div>}
        </div>
      )}
      {children}
    </Backdrop>
  );
}
