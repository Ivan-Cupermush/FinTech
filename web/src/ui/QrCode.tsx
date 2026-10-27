import { useId, useMemo } from 'react';
import QR from 'qrcode';
import { qrHole, qrPaths, type QrMatrix } from '@offix/core';

/** Матрица кода: высокая коррекция (H) — середину можно занять знаком offix. */
export function qrMatrix(value: string): QrMatrix {
  const { modules } = QR.create(value, { errorCorrectionLevel: 'H' });
  return { size: modules.size, dark: (r, c) => !!modules.get(r, c) };
}

/**
 * QR-код в стиле offix: круглые точки, скруглённые «глазки» в фирменном
 * градиенте и знак в центре. Всегда тёмный на светлом — так его читает
 * любая камера, и в тёмной теме тоже.
 */
export function QrCode({ value, size = 220, label, faded }: { value: string; size?: number; label: string; faded?: boolean }) {
  const gid = useId().replace(/:/g, '');
  const art = useMemo(() => {
    const m = qrMatrix(value);
    const quiet = 2;
    const cell = 10;
    const p = qrPaths(m, cell, qrHole(m.size));
    return { ...p, quiet: quiet * cell, total: p.size + quiet * 2 * cell };
  }, [value]);
  const c = art.total / 2;
  const mark = art.hole * 0.78;
  return (
    <svg className={`qr ${faded ? 'is-faded' : ''}`} width={size} height={size} viewBox={`0 0 ${art.total} ${art.total}`} role="img" aria-label={label} data-value={value}>
      <defs>
        <linearGradient id={`qr-eye-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f4bff" />
          <stop offset="1" stopColor="#7a6bff" />
        </linearGradient>
      </defs>
      <rect width={art.total} height={art.total} rx={art.total * 0.08} fill="#fff" />
      <g transform={`translate(${art.quiet} ${art.quiet})`}>
        <path d={art.dots} fill="#141625" />
        <path d={art.eyes} fill={`url(#qr-eye-${gid})`} />
      </g>
      {art.hole > 0 && (
        <g transform={`translate(${c - mark / 2} ${c - mark / 2}) scale(${mark / 64})`} aria-hidden>
          <rect width="64" height="64" rx="18" fill="#141625" />
          <circle cx="26" cy="32" r="11" fill="none" stroke="#fff" strokeWidth="6" />
          <path d="M41 21 L52 32 L41 43" fill="none" stroke="#5b74ff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
