import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size,
  icon,
  loading,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; icon?: ReactNode; loading?: boolean }) {
  const cls = ['btn', `btn-${variant}`, size && `btn-${size}`, !children && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined}>
      {loading ? <Loader2 className="spin" size={16} aria-hidden /> : icon}
      {children}
    </button>
  );
}
