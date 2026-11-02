import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, PointerEvent, ReactNode } from 'react';
import './fx/motion.css';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

/** Угол перелива перламутровой кнопки: оттенки поворачиваются вслед за указателем. */
export function pearlAngle(px: number, py: number, w: number, h: number): number {
  const deg = (Math.atan2(py - h / 2, px - w / 2) * 180) / Math.PI;
  return Math.round((deg + 450) % 360);
}

export function Button({
  variant = 'secondary',
  size,
  icon,
  loading,
  children,
  className,
  onPointerMove,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; icon?: ReactNode; loading?: boolean }) {
  const cls = ['btn', `btn-${variant}`, size && `btn-${size}`, !children && 'btn-icon', className].filter(Boolean).join(' ');
  const pearl =
    variant === 'primary'
      ? (e: PointerEvent<HTMLButtonElement>) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty('--pearl', `${pearlAngle(e.clientX - r.left, e.clientY - r.top, r.width, r.height)}deg`);
          onPointerMove?.(e);
        }
      : onPointerMove;
  return (
    <button type="button" className={cls} {...rest} onPointerMove={pearl} disabled={rest.disabled || loading} aria-busy={loading || undefined}>
      {loading ? <Loader2 className="spin" size={16} aria-hidden /> : icon}
      {children}
    </button>
  );
}
