import { AlertTriangle, ArrowUpRight, Check, Flag, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { capillaryPath, downstream, needsBow, formatDate, layoutCapillary, riskLevelOf, riskTone, TASK_STATUS_LABELS, type CapNode } from '@offix/core';
import type { Roadmap } from '../../lib/types';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import './capillary.css';

const LANE = 104;
const PAD_X = 84;
const PAD_TOP = 56;
const PAD_BOTTOM = 136;
const NARROW = 640;

const STATE_LABEL: Record<CapNode['state'], string> = {
  done: 'готово',
  active: 'в работе',
  blocked: 'блок',
  overdue: 'просрочено',
  planned: 'план',
};

/** Ширина элемента; в jsdom и до первого замера — разумная ширина по умолчанию. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(960);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth) setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Капиллярная карта цели: задачи на оси времени, зависимости — светящиеся
 * капилляры с бегущими импульсами, критический путь — красный с RGB-глитчем.
 * Клик по узлу пускает ударную волну и выливает из узла стеклянную панель
 * с задачей. Внизу — шкала месяцев с отметкой «Сегодня».
 */
export function CapillaryMap({ roadmap, onTask }: { roadmap: Roadmap; onTask: (id: string) => void }) {
  const [boxRef, boxW] = useWidth<HTMLDivElement>();
  const [selected, setSelected] = useState<string | null>(null);
  const [wave, setWave] = useState<{ id: string; n: number } | null>(null);
  const today = roadmap.timeline.today;
  const goal = roadmap.goal;
  const open = roadmap.tasks.filter((t) => t.status !== 'cancelled').length;
  // На узком экране карта шире окна и прокручивается вбок, чтобы узлы не слипались.
  const W0 = boxW >= NARROW ? boxW : Math.max(boxW, Math.min(open * 92 + PAD_X * 2, 1400));

  const layout = useMemo(
    () =>
      layoutCapillary({
        tasks: roadmap.tasks,
        edges: roadmap.edges,
        critical_path: roadmap.critical_path,
        today,
        goal: { id: goal.id, title: goal.title, due_at: goal.due_at },
        minGap: Math.min(0.25, 164 / Math.max(W0 - PAD_X * 2, 300)),
      }),
    [roadmap, today, goal.id, goal.title, goal.due_at, W0],
  );
  const taskCount = layout.nodes.length - 1;
  const W = W0;
  const lanes = layout.laneMax - layout.laneMin;
  const H = PAD_TOP + lanes * LANE + PAD_BOTTOM;
  const px = (x: number) => PAD_X + x * (W - PAD_X * 2);
  const py = (lane: number) => PAD_TOP + (lane - layout.laneMin) * LANE;
  const at = new Map(layout.nodes.map((n) => [n.id, { x: px(n.x), y: py(n.lane), n }]));
  const narrow = boxW < NARROW;
  const goalTone = riskTone({ risk_level: goal.status === 'active' ? riskLevelOf(roadmap.risks) : 'ok', kpi: goal.metrics[0]?.progress.state ?? null, status: goal.status });

  // Карта шире экрана — открываем её там, где «сегодня»: прошлое слева, ближайшие шаги справа.
  const todayPx = PAD_X + layout.today * (W - PAD_X * 2);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, todayPx - el.clientWidth * 0.3);
  }, [boxRef, todayPx]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const pick = (id: string) => {
    setWave((w) => ({ id, n: (w?.n ?? 0) + 1 }));
    setSelected((s) => (s === id ? null : id));
  };
  const sel = selected ? at.get(selected) : undefined;
  const criticalCount = layout.nodes.filter((n) => n.kind === 'task' && n.critical).length;

  if (!taskCount) return null;

  return (
    <section className="cap" aria-label="Капиллярная карта цели">
      <div className="cap-scroll" ref={boxRef}>
        <div className="cap-canvas" style={{ width: W, height: H }} role="group" aria-label={`${taskCount} задач${criticalCount ? `, критический путь — ${criticalCount}` : ''}`}>
          <svg className="cap-svg" width={W} height={H} aria-hidden>
            <line className="cap-today-line" x1={px(layout.today)} x2={px(layout.today)} y1={12} y2={H - 40} />
            {layout.links.map((l, i) => {
              const a = at.get(l.from);
              const b = at.get(l.to);
              if (!a || !b) return null;
              // Обход узлов своего ряда: верхние ряды выгибаются вверх, нижние — вниз.
              const d = capillaryPath(a.x, a.y, b.x, b.y, needsBow(layout, l.from, l.to) ? (a.n.lane > 0 ? 40 : -40) : 0);
              const cls = `cap-link${l.critical ? ' critical' : ''}${l.broken ? ' broken' : ''}${l.done ? ' done' : ''}`;
              return (
                <g key={`${l.from}-${l.to}`} className={cls} style={{ '--d': `${(i * 0.37) % 1.8}s` } as React.CSSProperties}>
                  <path className="cap-glow" d={d} />
                  <path className="cap-line" d={d} />
                  {l.critical && (
                    <>
                      <path className="cap-glitch cap-glitch-c" d={d} />
                      <path className="cap-glitch cap-glitch-m" d={d} />
                    </>
                  )}
                  {!l.done && <path className="cap-pulse" d={d} pathLength={100} />}
                </g>
              );
            })}
          </svg>

          {wave && at.get(wave.id) && (
            <span key={wave.n} className="cap-shock" style={{ left: at.get(wave.id)!.x, top: at.get(wave.id)!.y }} aria-hidden>
              <i />
              <i />
              <i />
            </span>
          )}

          {layout.nodes.map((n) => {
            const p = at.get(n.id)!;
            const goalNode = n.kind === 'goal';
            const meta = goalNode ? (goal.due_at ? `цель · ${formatDate(goal.due_at, { short: true })}` : 'цель') : `${STATE_LABEL[n.state]} · ${formatDate(n.date, { short: true })}`;
            return (
              <button
                key={n.id}
                type="button"
                className={`cap-node ${goalNode ? `goal tone-${goalTone}` : n.state}${n.critical ? ' critical' : ''}${selected === n.id ? ' on' : ''}`}
                style={{ left: p.x, top: p.y }}
                aria-pressed={selected === n.id}
                aria-label={`${goalNode ? 'Цель' : 'Задача'} «${n.title}»: ${meta}${n.critical && !goalNode ? ', критический путь' : ''}`}
                onClick={() => pick(n.id)}
              >
                <span className="cap-orb" aria-hidden>
                  {goalNode ? <Flag size={18} /> : n.state === 'done' ? <Check size={18} strokeWidth={3} /> : n.state === 'blocked' || n.state === 'overdue' ? <AlertTriangle size={16} /> : n.progress !== null ? <b>{n.progress}%</b> : null}
                </span>
                <span className="cap-label" aria-hidden>
                  <span className="cap-title">{goalNode ? `Цель: ${n.title}` : n.title}</span>
                  <span className="cap-meta">{meta}</span>
                </span>
              </button>
            );
          })}

          {sel && !narrow && <Detail key={sel.n.id} node={sel.n} at={sel} W={W} H={H} roadmap={roadmap} onTask={onTask} onClose={() => setSelected(null)} />}

          <div className="cap-axis" aria-hidden>
            {layout.months.map((m) => (
              <span key={`${m.label}-${m.x}`} className="cap-month" style={{ left: px(m.x) }}>
                {m.label}
              </span>
            ))}
            <span className="cap-today" style={{ left: px(layout.today) }}>
              Сегодня
            </span>
          </div>
        </div>
      </div>
      {sel && narrow && <Detail key={sel.n.id} node={sel.n} roadmap={roadmap} onTask={onTask} onClose={() => setSelected(null)} />}
      <ul className="cap-legend" aria-label="Обозначения">
        <li>
          <i className="dot done" /> Выполнено
        </li>
        <li>
          <i className="dot active" /> В работе
        </li>
        <li>
          <i className="dot planned" /> Впереди
        </li>
        <li>
          <i className="dot late" /> Блок или просрочка
        </li>
        <li>
          <i className="line" /> Критический путь
        </li>
      </ul>
    </section>
  );
}

/** Стеклянная панель задачи, вылитая из узла: прогресс, срок, кто делает и сколько задач ждут. */
function Detail({
  node,
  at,
  W = 0,
  H = 0,
  roadmap,
  onTask,
  onClose,
}: {
  node: CapNode;
  at?: { x: number; y: number };
  W?: number;
  H?: number;
  roadmap: Roadmap;
  onTask: (id: string) => void;
  onClose: () => void;
}) {
  const task = roadmap.tasks.find((t) => t.id === node.id);
  const isGoal = node.kind === 'goal';
  const waiting = task ? downstream(roadmap.edges, task.id).filter((id) => roadmap.tasks.some((t) => t.id === id && t.status !== 'cancelled' && t.status !== 'done')).length : 0;
  const cps = task?.checkpoints ?? [];
  const progress = isGoal ? node.progress : task?.status === 'done' ? 100 : cps.length ? Math.round((cps.filter((c) => c.status === 'done').length / cps.length) * 100) : null;
  const open = roadmap.tasks.filter((t) => t.status !== 'cancelled');

  // Панель справа от узла, если влезает, иначе слева; по высоте — в пределах карты.
  const PW = 320;
  const PH = 214;
  let style: React.CSSProperties | undefined;
  let neck: string | null = null;
  if (at) {
    const right = at.x + 46 + PW < W - 8;
    const left = right ? at.x + 46 : Math.max(8, at.x - 46 - PW);
    const top = Math.min(Math.max(8, at.y - PH - 18), Math.max(8, H - PH - 50));
    style = { left, top, width: PW, transformOrigin: `${at.x - left}px ${at.y - top}px` };
    const ex = right ? left + 18 : left + PW - 18;
    const ey = top + PH - 22;
    neck = `M${at.x} ${at.y} C${at.x} ${(at.y + ey) / 2} ${ex} ${ey + (at.y - ey) * 0.25} ${ex} ${ey}`;
  }

  return (
    <>
      {neck && (
        <svg className="cap-neck" aria-hidden>
          <path d={neck} pathLength={100} />
        </svg>
      )}
      <div className={`cap-detail${at ? '' : ' inline'}`} style={style} role="region" aria-label={isGoal ? 'Цель' : `Задача «${node.title}»`}>
        <div className="spread" style={{ alignItems: 'flex-start', gap: 8 }}>
          <div className="cap-detail-eyebrow">
            {isGoal ? 'Цель' : 'Задача'}
            {node.critical && !isGoal ? ' · критический путь' : ''}
            {task ? ` · ${TASK_STATUS_LABELS[task.status].toLowerCase()}` : ''}
          </div>
          <button type="button" className="cap-detail-close" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>
        <div className="cap-detail-title">{node.title}</div>
        <div className={`cap-detail-bar ${node.state}`} aria-hidden>
          <span style={{ width: `${progress ?? 0}%` }} />
        </div>
        <div className="cap-detail-figs">
          {isGoal ? (
            <>
              <Fig v={`${open.filter((t) => t.status === 'done').length}/${open.length}`} l="задач" />
              <Fig v={roadmap.goal.due_at ? formatDate(roadmap.goal.due_at, { short: true }) : '—'} l="срок" />
              <Fig v={String(roadmap.critical_path.length)} l="крит. путь" />
            </>
          ) : (
            <>
              <Fig v={cps.length ? `${cps.filter((c) => c.status === 'done').length}/${cps.length}` : progress !== null ? `${progress}%` : '—'} l={cps.length ? 'точек' : 'готово'} />
              <Fig v={task?.due_at ? formatDate(task.due_at, { short: true }) : '—'} l="срок" />
              <Fig v={String(waiting)} l="зависят" />
            </>
          )}
          {task?.assignee && (
            <span className="cap-detail-who" title={task.assignee.display_name}>
              <Avatar name={task.assignee.display_name} id={task.assignee.id} size={30} />
            </span>
          )}
        </div>
        {task && (
          <Button size="sm" variant="primary" icon={<ArrowUpRight size={15} />} onClick={() => onTask(task.id)}>
            Открыть задачу
          </Button>
        )}
      </div>
    </>
  );
}

function Fig({ v, l }: { v: string; l: string }) {
  return (
    <span className="cap-fig">
      <b className="num">{v}</b>
      <span>{l}</span>
    </span>
  );
}
