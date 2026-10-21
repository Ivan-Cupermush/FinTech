import LiquidGlass from 'liquid-glass-react';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './fx.css';

type GlassProps = {
  children: ReactNode;
  className?: string;
  /** Радиус скругления в пикселях: стекло рисует по нему преломление краёв. */
  radius?: number;
  /** Стекло лежит на светлом фоне: тень и блик мягче. */
  overLight?: boolean;
  /** Сила «жидкого» отклика на курсор; 0 — стекло стоит на месте. */
  elasticity?: number;
  /** Сила преломления краёв. */
  displacement?: number;
  blur?: number;
  /**
   * Обрезать слот по скруглению. На градиенте фильтр преломления даёт
   * прямоугольный ореол за углами — у плиток на шапках его срезаем.
   * Тень снаружи при этом пропадает, поэтому на светлом фоне не включаем.
   */
  clip?: boolean;
  style?: CSSProperties;
};

/**
 * Жидкое стекло liquid-glass-react, встроенное в обычную вёрстку.
 * Сам компонент рассчитан на абсолютное позиционирование по центру,
 * поэтому кладём его в слот, а слот получает высоту стекла — и блок
 * ведёт себя как обычная карточка в потоке.
 */
export function Glass({ children, className = '', radius = 24, overLight = false, elasticity = 0.12, displacement = 64, blur = 0.08, clip = false, style }: GlassProps) {
  const slot = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = slot.current?.querySelector<HTMLElement>('.glass');
    if (!el) return;
    let last = -1;
    const measure = () => {
      const h = el.offsetHeight;
      if (h === last) return;
      last = h;
      setHeight(h || undefined);
      // Блики и рамку библиотека меряет только на resize окна — подсказываем ей.
      window.dispatchEvent(new Event('resize'));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={slot} className={`glass-slot ${clip ? 'glass-clip' : ''} ${className}`} style={{ height, clipPath: clip ? `inset(0 round ${radius}px)` : undefined, ...style }}>
      <LiquidGlass
        cornerRadius={radius}
        overLight={overLight}
        elasticity={elasticity}
        displacementScale={displacement}
        blurAmount={blur}
        saturation={150}
        aberrationIntensity={1.5}
        padding="0"
        style={{ position: 'absolute', top: '50%', left: '50%', width: '100%' }}
      >
        <div className="glass-body">{children}</div>
      </LiquidGlass>
    </div>
  );
}
