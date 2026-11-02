/**
 * Всплеск частиц из точки касания: 32 частицы — осколки, искры и точки,
 * 900 мс, скорость 280–520 px/с со смещением вверх, сопротивление и
 * гравитация. Один холст поверх страницы на время всплеска, потом удаляется.
 * При просьбе о меньшем движении — ничего.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  shape: 'shard' | 'spark' | 'dot';
  rot: number;
  color: string;
}

export const BURST_COLORS = {
  good: ['#3ee6b0', '#2fb8d9', '#ffffff', '#8a72ff'],
  brand: ['#2f4bff', '#8a72ff', '#ffffff', '#2fb8d9'],
} as const;

/** Частицы детерминированы генератором — так всплеск можно проверить в тесте. */
export function makeParticles(x: number, y: number, colors: readonly string[], rand: () => number = Math.random, n = 32): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < n; i++) {
    // Веер вверх: угол от −160° до −20°, немного частиц уходит в стороны и вниз.
    const spread = i % 5 === 0 ? Math.PI * 2 * rand() : -Math.PI * (0.11 + 0.78 * rand());
    const speed = 280 + 240 * rand();
    out.push({
      x,
      y,
      vx: Math.cos(spread) * speed,
      vy: Math.sin(spread) * speed,
      life: 500 + 400 * rand(),
      size: 2 + 5 * rand(),
      shape: i % 3 === 0 ? 'shard' : i % 3 === 1 ? 'spark' : 'dot',
      rot: Math.PI * 2 * rand(),
      color: colors[i % colors.length]!,
    });
  }
  return out;
}

/** Шаг физики: сопротивление −60 % скорости за 200 мс и гравитация. */
export function stepParticle(p: Particle, dt: number): Particle {
  const drag = Math.pow(0.4, dt / 0.2);
  return { ...p, x: p.x + p.vx * dt, y: p.y + p.vy * dt, vx: p.vx * drag, vy: p.vy * drag + 900 * dt, rot: p.rot + dt * 6 };
}

function reduced() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function burst(x: number, y: number, palette: keyof typeof BURST_COLORS = 'good') {
  if (typeof document === 'undefined' || reduced()) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.className = 'fx-burst';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx.scale(dpr, dpr);
  let parts = makeParticles(x, y, BURST_COLORS[palette]);
  const start = performance.now();
  let last = start;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const age = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    // Кольцо-вспышка в первые 300 мс.
    if (age < 300) {
      const k = age / 300;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 14 + 46 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    parts = parts.map((p) => stepParticle(p, dt));
    for (const p of parts) {
      const a = Math.max(0, 1 - age / p.life);
      if (!a) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.shape === 'spark' ? Math.atan2(p.vy, p.vx) : p.rot);
      if (p.shape === 'shard') {
        ctx.beginPath();
        ctx.moveTo(p.size * 1.4, 0);
        ctx.lineTo(-p.size, p.size);
        ctx.lineTo(-p.size * 0.6, -p.size);
        ctx.closePath();
        ctx.fill();
      } else if (p.shape === 'spark') {
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-p.size * 2.2, 0);
        ctx.lineTo(p.size * 1.2, 0);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (age < 900) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Точка всплеска: где нажали, а при нажатии с клавиатуры (координат нет) — центр кнопки. */
export function burstPoint(e: { clientX: number; clientY: number; currentTarget: EventTarget | null }): { x: number; y: number } {
  if ((e.clientX || e.clientY) || !(e.currentTarget instanceof Element)) return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
