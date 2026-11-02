import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cardTilt, RISK_PALETTE, sparkPath, type RiskTone } from '@offix/core';
import { useReducedMotion } from './support';
import './risk.css';

/**
 * Risk Radar: карточка с живой жидкостью под матовым стеклом. Цвет жидкости —
 * тон риска (мята, фирменный синий, янтарь, гранат), критичная пульсирует
 * 72 раза в минуту. Карточка наклоняется к указателю до 8°, блик бежит
 * напротив наклона. Всё на CSS: десятки карточек держат 60 кадров, а без
 * WebGL и при просьбе о меньшем движении карточка просто стоит.
 */
export function RiskCard({
  tone,
  to,
  spark,
  className = '',
  children,
  ...rest
}: {
  tone: RiskTone;
  /** Ссылка: вся карточка кликабельна. */
  to?: string;
  /** Последние замеры — линия тренда внизу карточки. */
  spark?: readonly number[];
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const frame = useRef(0);
  const p = RISK_PALETTE[tone];
  const style = { '--rr-from': p.from, '--rr-to': p.to, '--rr-deep': p.deep, '--rr-glow': p.glow, '--rr-core': p.core, ...rest.style } as React.CSSProperties;

  const move = (e: React.PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType === 'touch') return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const t = cardTilt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.classList.add('rr-tilting');
      el.style.setProperty('--rx', `${t.rx}deg`);
      el.style.setProperty('--ry', `${t.ry}deg`);
      el.style.setProperty('--gx', `${t.gx}%`);
      el.style.setProperty('--gy', `${t.gy}%`);
    });
  };
  const leave = (e: React.PointerEvent<HTMLElement>) => {
    cancelAnimationFrame(frame.current);
    const el = e.currentTarget;
    el.classList.remove('rr-tilting');
    for (const k of ['--rx', '--ry', '--gx', '--gy']) el.style.removeProperty(k);
  };

  const layers = (
    <>
      <span className="rr-liquid" aria-hidden>
        <i className="rr-blob rr-b1" />
        <i className="rr-blob rr-b2" />
        <i className="rr-blob rr-b3" />
      </span>
      <span className="rr-core" aria-hidden />
      {tone === 'critical' && <span className="rr-pulse" aria-hidden />}
      {spark && spark.length > 1 && <Spark values={spark} />}
      <span className="rr-frost" aria-hidden />
      <span className="rr-glint" aria-hidden />
      <div className="rr-body">{children}</div>
    </>
  );
  const cls = `rr rr-${tone} ${className}`;
  const handlers = { onPointerMove: move, onPointerLeave: leave };
  return to ? (
    <Link to={to} ref={(el) => void (ref.current = el)} className={cls} data-tone={tone} {...rest} style={style} {...handlers}>
      {layers}
    </Link>
  ) : (
    <div ref={(el) => void (ref.current = el)} className={cls} data-tone={tone} {...rest} style={style} {...handlers}>
      {layers}
    </div>
  );
}

function Spark({ values }: { values: readonly number[] }) {
  const d = sparkPath(values, 300, 56, 6);
  const last = d.split(' ').slice(-2).map(Number) as [number, number];
  return (
    <span className="rr-spark" aria-hidden>
      <svg viewBox="0 0 300 64" preserveAspectRatio="none">
        <path className="rr-spark-area" d={`${d} L300 64 L0 64 Z`} />
        <path className="rr-spark-glow" d={d} />
        <path className="rr-spark-line" d={d} />
      </svg>
      <i className="rr-spark-dot" style={{ left: `${(last[0] / 300) * 100}%`, top: `${(last[1] / 64) * 100}%` }} />
    </span>
  );
}

/** Метка тона: «D · Под угрозой» с точкой, у критичной точка бьётся. */
export function RiskBadge({ grade, label }: { grade?: string; label: string }) {
  return (
    <span className="rr-badge">
      <span className="rr-badge-dot" aria-hidden />
      {grade && (
        <>
          <span className="rr-badge-grade">{grade}</span>
          <span aria-hidden>·</span>
        </>
      )}
      {label}
    </span>
  );
}
