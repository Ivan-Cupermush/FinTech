import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './support';
import './motion.css';

/** Сколько лишних оборотов делает разряд: младшие крутятся дольше, старшие — ровно до цифры. */
export const odometerTurns = (fromRight: number) => Math.max(0, 2 - fromRight);

/**
 * Одометр: цифры накатывают волной справа налево (620 мс, шаг 40 мс,
 * перелёт 2 px). Число целиком — в скрытом тексте для экранного диктора;
 * видимые разряды рисуются псевдоэлементами, поэтому не дублируют текст.
 * Анимация стартует, когда число впервые попало на экран; при просьбе
 * о меньшем движении — сразу итоговое значение.
 */
export function Odometer({ value, className = '' }: { value: string | number; className?: string }) {
  const text = String(value);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        // Кадр с нулями уже нарисован — следующий запускает прокрутку.
        requestAnimationFrame(() => setShown(true));
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  if (reduced) return <span className={`num ${className}`}>{text}</span>;

  const chars = [...text];
  const digitsTotal = chars.filter((c) => c >= '0' && c <= '9').length;
  let seen = 0;
  return (
    <span ref={ref} className={`odo num ${className}`}>
      <span className="visually-hidden">{text}</span>
      <span className="odo-vis" aria-hidden>
        {chars.map((c, i) => {
          if (c < '0' || c > '9') return <span key={i} className="odo-c" data-c={c === ' ' || c === ' ' ? ' ' : c} />;
          const fromRight = digitsTotal - 1 - seen++;
          const n = shown ? Number(c) + 10 * odometerTurns(fromRight) : 0;
          return (
            <span key={i} className="odo-d">
              <span className="odo-strip" style={{ '--n': n, '--i': fromRight } as React.CSSProperties} />
            </span>
          );
        })}
      </span>
    </span>
  );
}
