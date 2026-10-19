/**
 * Мини-график по недельным точкам. Пропуски (null) рвут линию, а не рисуются
 * нулём: «нечего считать» и «ноль» — разные вещи.
 */
export function Sparkline({
  values,
  max,
  min = 0,
  tone = 'accent',
  height = 56,
  label,
}: {
  values: readonly (number | null)[];
  max?: number;
  min?: number;
  tone?: 'accent' | 'good' | 'ink';
  height?: number;
  label: string;
}) {
  const W = 100;
  const H = 40;
  const known = values.filter((v): v is number => v !== null);
  const hi = max ?? Math.max(1, ...known);
  const span = hi - min || 1;
  const x = (i: number) => (values.length < 2 ? W / 2 : (i / (values.length - 1)) * W);
  const y = (v: number) => H - 3 - ((Math.min(hi, Math.max(min, v)) - min) / span) * (H - 6);

  const segments: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else cur.push({ i, v });
  });
  if (cur.length) segments.push(cur);

  const lastIndex = values.length - 1;
  const last = values[lastIndex];
  return (
    <div className={`spark spark-${tone}`} style={{ height }} role="img" aria-label={label}>
      {known.length ? (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          {/* Ось на всю ширину: пустой участок слева читается как «данных ещё не было». */}
          <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} className="spark-axis" vectorEffect="non-scaling-stroke" />
          {segments.map((seg, k) => {
            const line = seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
            const area = `${line} L${x(seg[seg.length - 1]!.i).toFixed(2)},${H} L${x(seg[0]!.i).toFixed(2)},${H} Z`;
            return (
              <g key={k}>
                <path d={area} className="spark-area" />
                <path d={seg.length > 1 ? line : `M${x(seg[0]!.i) - 0.01},${y(seg[0]!.v)} L${x(seg[0]!.i) + 0.01},${y(seg[0]!.v)}`} className="spark-line" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="spark-empty" aria-hidden />
      )}
      {last !== null && last !== undefined && <span className="spark-dot" style={{ left: `${x(lastIndex)}%`, top: `${(y(last) / H) * 100}%` }} aria-hidden />}
    </div>
  );
}
