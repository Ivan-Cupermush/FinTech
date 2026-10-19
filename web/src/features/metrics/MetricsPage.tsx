import { Activity, ArrowRight, CircleGauge, Clock3, FileText, Rocket, Sparkles, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MOVEMENT_LABELS, MOVEMENT_TONES, formatDelta, formatHours, formatPercent as percent, northStarCaption, plural, seriesTrend, todayIso, trendText, type Movement } from '@offix/core';
import { useMetrics } from '../../lib/queries';
import type { MetricsReport } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Empty, Skeleton } from '../../ui/Misc';
import { Pill } from '../../ui/Pill';
import { Sparkline } from '../../ui/Sparkline';
import { effectActions } from './effect';
import './metrics.css';

const BREAKDOWN: Movement[] = ['improved', 'flat', 'worse', 'stale'];

/**
 * Эффект: двигает ли работа показатели. Главная цифра — Северная звезда,
 * вокруг неё четыре метрики, которые её объясняют, и шаги, которые её поднимут.
 */
export function MetricsPage() {
  const q = useMetrics();
  const navigate = useNavigate();
  const r = q.data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{r ? `${r.scope === 'company' ? 'Вся компания' : 'Цели вашей зоны'} · ${r.window_days} дней` : ' '}</div>
          <h1 style={{ marginTop: 6 }}>Эффект</h1>
          <p className="muted">Двигает ли работа показатели. Считается по замерам и истории задач, без ручных отчётов.</p>
        </div>
        <Link to="/app/report" className="btn btn-secondary">
          <FileText size={16} /> Отчёт для руководства
        </Link>
      </div>

      {q.isLoading && (
        <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
          <div className="card stack">
            <Skeleton h={14} w="30%" />
            <Skeleton h={72} w="40%" />
            <Skeleton h={10} />
          </div>
          <div className="effect-tiles">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card stack">
                <Skeleton h={12} w="50%" />
                <Skeleton h={34} w="40%" />
              </div>
            ))}
          </div>
        </div>
      )}

      {q.isError && (
        <div className="card">
          <Empty title="Не удалось посчитать метрики" action={<Button onClick={() => q.refetch()}>Повторить</Button>}>
            Проверьте соединение и попробуйте ещё раз.
          </Empty>
        </div>
      )}

      {r && r.north_star.total === 0 && r.launch.total === 0 ? (
        <div className="card">
          <Empty icon={<Sparkles size={22} />} title="Эффект появится с первой целью" action={<Button variant="primary" onClick={() => navigate('/app/goals/new')}>Создать цель</Button>}>
            Запустите цель с KPI и внесите первый замер — здесь будет видно, сдвигает ли работа показатель.
          </Empty>
        </div>
      ) : (
        r && <Report r={r} />
      )}
    </div>
  );
}

function Report({ r }: { r: MetricsReport }) {
  const today = todayIso();
  // Первая точка ряда — на (n − 1) недель раньше текущей.
  const weeks = r.series.at.length - 1;
  const ns = r.north_star;
  const actions = effectActions(r, today);
  return (
    <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
      <section className="card effect-hero" aria-labelledby="ns-h">
        <div className="effect-hero-main">
          <div className="eyebrow" id="ns-h">
            Северная звезда
          </div>
          <div className="effect-big num">{ns.value === null ? '—' : <>{ns.value}<span className="effect-big-unit">%</span></>}</div>
          <p className="effect-caption">
            {northStarCaption(r)}
          </p>
          <Breakdown counts={ns.counts} total={ns.total} />
        </div>
        <div className="effect-hero-chart">
          <Sparkline values={r.series.north_star} max={100} height={120} label={`Северная звезда по неделям: ${r.series.north_star.map((v) => (v === null ? 'нет данных' : `${v} %`)).join(', ')}`} />
          <div className="spread faint effect-axis">
            <span>{weeks} {plural(weeks, ['неделю', 'недели', 'недель'])} назад</span>
            <span>{trendText(seriesTrend(r.series.north_star)) ?? 'сейчас'}</span>
          </div>
        </div>
      </section>

      {ns.items.length > 0 && (
        <section className="card" aria-labelledby="ns-goals-h">
          <div className="section-title">
            <h3 id="ns-goals-h">Цели за {r.window_days} дней</h3>
          </div>
          <div className="list">
            {ns.items.map((i) => (
              <Link key={i.id} to={`/app/goals/${i.id}`} className="list-row effect-goal">
                <span className="grow clip">{i.title}</span>
                {i.delta !== null && <span className={`num effect-delta ${i.delta < 0 ? 'bad' : i.delta > 0 ? 'good' : ''}`}>{formatDelta(i.delta)}</span>}
                <Pill tone={MOVEMENT_TONES[i.movement]}>{MOVEMENT_LABELS[i.movement]}</Pill>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="effect-tiles">
        <Tile
          icon={<CircleGauge size={18} />}
          title="Свежесть замеров"
          value={percent(r.freshness.value)}
          caption={r.freshness.total ? `${r.freshness.fresh} из ${r.freshness.total} KPI с замером не старше ${r.freshness.max_age_days} дней` : 'Нет активных целей с KPI'}
          how="Доля KPI активных целей, у которых последний замер не старше двух недель."
          series={r.series.freshness}
          max={100}
          trend={trendText(seriesTrend(r.series.freshness))}
        />
        <Tile
          icon={<Rocket size={18} />}
          title="Запуск целей"
          value={percent(r.launch.value)}
          caption={r.launch.total ? `${r.launch.launched} из ${r.launch.total} запущены в первые ${r.launch.within_days} дней${r.launch.median_days !== null ? ` · медиана ${formatDays(r.launch.median_days)}` : ''}` : 'Пока нет целей старше недели'}
          how="Доля целей, которые дошли от черновика до работы за неделю. Свежий черновик не учитывается, у него ещё есть время."
        />
        <Tile
          icon={<Timer size={18} />}
          title="Снятие блокера"
          value={formatHours(r.blockers.median_hours)}
          caption={r.blockers.resolved ? `медиана по ${r.blockers.resolved} ${plural(r.blockers.resolved, ['блокеру', 'блокерам', 'блокерам'])}${r.blockers.open ? ` · ${r.blockers.open} открыто` : ''}` : r.blockers.open ? `${r.blockers.open} открыто, снятых за период нет` : 'Блокеров за период не было'}
          how="Медиана времени от отметки «Заблокирована» до возврата задачи в работу."
          series={r.series.blocker_hours}
          tone="ink"
          trend={trendText(seriesTrend(r.series.blocker_hours), 'hours')}
        />
        <Tile
          icon={<Clock3 size={18} />}
          title="Задачи в срок"
          value={percent(r.on_time.value)}
          caption={r.on_time.total ? `${r.on_time.on_time} из ${r.on_time.total} закрыты не позже срока` : 'За период задачи не закрывали'}
          how="Доля задач, закрытых за период в день срока или раньше."
          series={r.series.on_time}
          max={100}
          trend={trendText(seriesTrend(r.series.on_time))}
        />
      </div>

      <section className="card" aria-labelledby="act-h">
        <div className="section-title">
          <h3 id="act-h">
            <Activity size={18} /> Что поднимет цифры
          </h3>
        </div>
        {actions.length ? (
          <div className="list">
            {actions.map((a) => (
              <div key={a.key} className="list-row effect-action">
                <span className={`effect-action-dot ${a.tone}`} aria-hidden />
                <div className="grow stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                  <span style={{ fontWeight: 560 }}>{a.title}</span>
                  <span className="faint" style={{ fontSize: 13.5 }}>
                    {a.hint}
                  </span>
                </div>
                <Link to={a.to} className="btn btn-secondary btn-sm">
                  {a.cta} <ArrowRight size={14} />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="faint">Замеры свежие, блокеров нет, показатели движутся. Так держать.</p>
        )}
      </section>
    </div>
  );
}

function formatDays(d: number) {
  return `${String(d).replace('.', ',')} ${plural(d, ['день', 'дня', 'дней'])}`;
}

function Breakdown({ counts, total }: { counts: Record<Movement, number>; total: number }) {
  if (!total) return null;
  return (
    <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
      <div className="effect-bar" aria-hidden>
        {BREAKDOWN.filter((k) => counts[k]).map((k) => (
          <span key={k} className={`effect-bar-${k}`} style={{ flexGrow: counts[k] }} />
        ))}
      </div>
      <ul className="effect-legend">
        {BREAKDOWN.map((k) => (
          <li key={k} className={counts[k] ? '' : 'zero'}>
            <span className={`effect-swatch effect-bar-${k}`} aria-hidden />
            {MOVEMENT_LABELS[k]} <b className="num">{counts[k]}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({
  icon,
  title,
  value,
  caption,
  how,
  series,
  max,
  tone = 'accent',
  trend,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  caption: string;
  how: string;
  series?: readonly (number | null)[];
  max?: number;
  tone?: 'accent' | 'good' | 'ink';
  trend?: string | null;
}) {
  return (
    <section className="card effect-tile" aria-label={title}>
      <div className="row muted" style={{ gap: 8, fontSize: 14, fontWeight: 560 }}>
        {icon}
        {title}
      </div>
      <div className="effect-tile-value num">{value}</div>
      <p className="effect-tile-caption">{caption}</p>
      {series && <Sparkline values={series} max={max} tone={tone} height={44} label={`${title} по неделям`} />}
      {trend && <div className="faint effect-tile-trend">{trend}</div>}
      <details className="effect-how">
        <summary>Как считаем</summary>
        <p>{how}</p>
      </details>
    </section>
  );
}
