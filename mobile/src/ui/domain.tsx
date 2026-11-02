import { Ban, Check, Circle, CircleDot, CornerDownRight, Eye, Flag, HandHelping } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import {
  BLOCKER_LABELS,
  checkpointProgress,
  diffDays,
  formatDate,
  formatNumber,
  GOAL_TYPE_LABELS,
  isOverdue,
  KPI_STATE_LABELS,
  lastDelta,
  RISK_GRADE,
  RISK_TONE_LABELS,
  riskTone,
  lightOf,
  TASK_LIGHT_LABELS,
  plural,
  requestFrom,
  TASK_STATUS_LABELS,
  UNITS,
  type GoalType,
  type KpiProgress,
  type Metric,
  type Risk,
  type Task,
  type TaskLightView,
  type TaskStatus,
  type UnitId,
} from '@offix/core';
import { dueText } from '../lib/logic';
import { useMe } from '../lib/queries';
import { font, usePalette, type Tone } from '../lib/theme';
import { Avatar, Card, Pill, Text } from './primitives';
import { Odometer } from './fx/Odometer';
import { RiskCard } from './fx/RiskCard';

/** Фирменный элемент: «40 → 36,5 → 30 мин». Нет замера — штриховка и «Нет данных». */
export function KpiTrack({ baseline, target, current, unit, progress, size = 'md', legend = true }: { baseline: number; target: number; current: number | null; unit: UnitId; progress: KpiProgress; size?: 'md' | 'lg' | 'xl'; legend?: boolean }) {
  const p = usePalette();
  const info = UNITS[unit];
  const f = (v: number) => formatNumber(v, info.decimals);
  const fs = { md: 22, lg: 30, xl: 36 }[size];
  const tone = progress.state === 'achieved' || progress.state === 'in_range' ? p.good : progress.state === 'regress' || progress.state === 'out_of_range' ? p.bad : p.accent;
  const bar = progress.bar ?? 0;
  const label = current === null ? `Нет данных, цель ${f(target)} ${info.short}` : `${f(current)} ${info.short}, цель ${f(target)} ${info.short}, ${KPI_STATE_LABELS[progress.state]}`;
  return (
    <View accessible accessibilityLabel={label} style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 }}>
          <Text style={{ fontSize: fs, lineHeight: fs * 1.15, fontFamily: font.medium, color: p.ink3, letterSpacing: -fs * 0.03 }}>{f(baseline)}</Text>
          <Text style={{ fontSize: fs * 0.8, color: p.ink3 }}>→</Text>
          {current !== null && (
            <>
              <Text style={{ fontSize: fs, lineHeight: fs * 1.15, fontFamily: font.bold, letterSpacing: -fs * 0.03 }}>{f(current)}</Text>
              <Text style={{ fontSize: fs * 0.8, color: p.ink3 }}>→</Text>
            </>
          )}
          <Text style={{ fontSize: fs, lineHeight: fs * 1.15, fontFamily: current === null ? font.bold : font.medium, color: current === null ? p.ink : p.ink2, letterSpacing: -fs * 0.03 }}>{f(target)}</Text>
          <Text style={{ fontSize: fs * 0.5, color: p.ink3, fontFamily: font.medium }}>{info.short}</Text>
        </View>
        {progress.raw !== null && (
          <Text variant="small" style={{ fontFamily: font.semibold, color: progress.state === 'regress' ? p.bad : p.ink2, flexShrink: 0, marginLeft: 8 }}>
            {`${Math.round(progress.raw)}\u00a0%`}
          </Text>
        )}
      </View>
      <View style={{ height: 8, borderRadius: 8, backgroundColor: p.surface2, overflow: 'hidden', justifyContent: 'center' }}>
        {progress.state === 'no_data' ? (
          <Svg width="100%" height={8}>
            <Defs>
              <Pattern id="s" width={10} height={10} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <Rect width={5} height={10} fill={p.surface3} />
              </Pattern>
            </Defs>
            <Rect width="100%" height={8} fill="url(#s)" />
          </Svg>
        ) : (
          <View style={{ width: `${bar}%`, height: '100%', borderRadius: 8, backgroundColor: tone }} />
        )}
      </View>
      {legend && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" tone="faint">
            Было
          </Text>
          <Text variant="caption" tone="faint">
            {progress.state === 'no_data' ? 'Нет данных — внесите первый замер' : KPI_STATE_LABELS[progress.state]}
          </Text>
          <Text variant="caption" tone="faint">
            Цель
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * Карточка цели — Risk Radar: жидкость цвета риска (та же модель, что на
 * сайте), главный KPI крупно одометром, линия последних замеров, ход работ.
 */
export function GoalTile({ goal, today, onPress }: { goal: { id: string; title: string; type: GoalType; due_at: string | null; primary_metric: Metric | null; task_progress: { done: number; total: number }; risk_level?: 'critical' | 'warning' | 'ok'; status?: string; blocked?: number; overdue?: number }; today: string; onPress: () => void }) {
  const m = goal.primary_metric;
  const due = dueText(goal.due_at, today);
  const pct = goal.task_progress.total ? (goal.task_progress.done / goal.task_progress.total) * 100 : 0;
  const tone = riskTone({ risk_level: goal.risk_level, blocked: goal.blocked, overdue: goal.overdue, kpi: m?.progress.state ?? null, status: goal.status });
  const unit = m ? UNITS[m.unit] : null;
  const f = (v: number) => formatNumber(v, unit?.decimals ?? 0);
  const value = m?.current_value != null ? f(m.current_value) : null;
  const delta = lastDelta(m?.trend ?? []);
  const white = { color: '#fff' };
  const soft = { color: 'rgba(255,255,255,0.85)' };
  return (
    <RiskCard tone={tone} spark={m?.trend} onPress={onPress} accessibilityLabel={`${goal.title}: ${RISK_TONE_LABELS[tone].toLowerCase()}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text variant="eyebrow" style={{ color: 'rgba(255,255,255,0.8)', flexShrink: 1 }} numberOfLines={1}>
          {GOAL_TYPE_LABELS[goal.type]}
          {goal.status === 'draft' ? ' · черновик' : ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.45)' }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' }} />
          <Text variant="caption" style={white}>
            {RISK_GRADE[tone]} · {RISK_TONE_LABELS[tone]}
          </Text>
        </View>
      </View>
      <Text variant="title" style={white} numberOfLines={2}>
        {goal.title}
      </Text>
      {m ? (
        <>
          {value !== null ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              <Odometer value={value} style={{ fontSize: value.length > 7 ? 34 : 42, fontFamily: font.bold, letterSpacing: -1.6, color: '#fff' }} />
              <Text variant="small" style={[white, { marginBottom: 6 }]}>
                {unit!.short}
              </Text>
            </View>
          ) : (
            <Text variant="h2" style={white}>
              Нет замеров
            </Text>
          )}
          <Text variant="caption" style={soft}>
            {m.name} · цель {f(m.target)}
            {m.progress.raw !== null ? ` · ${Math.round(m.progress.raw)} % пути` : ''}
            {delta ? ` · ${delta > 0 ? '+' : '−'}${f(Math.abs(delta))} к прошлому замеру` : ''}
          </Text>
        </>
      ) : (
        <Text variant="title" style={white}>
          KPI не задан
        </Text>
      )}
      <View style={{ gap: 8, marginTop: 'auto', paddingTop: 60 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text variant="caption" style={soft}>
            {goal.task_progress.total ? `Задачи ${goal.task_progress.done} из ${goal.task_progress.total}` : 'Задач пока нет'}
          </Text>
          <Text variant="caption" style={soft}>
            {due.text}
          </Text>
        </View>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: 4, borderRadius: 2, backgroundColor: '#fff' }} />
        </View>
      </View>
    </RiskCard>
  );
}

const TASK_TONE: Record<TaskStatus, Tone> = { todo: 'neutral', in_progress: 'accent', blocked: 'bad', review: 'info', done: 'good', cancelled: 'neutral' };
export function TaskStatusPill({ task, today }: { task: Pick<Task, 'id' | 'status' | 'due_at' | 'done_at'>; today: string }) {
  if (task.status !== 'blocked' && isOverdue(task, today))
    return (
      <Pill tone="warn" dot>
        Просрочена
      </Pill>
    );
  return (
    <Pill tone={TASK_TONE[task.status]} dot>
      {TASK_STATUS_LABELS[task.status]}
    </Pill>
  );
}

const ICON = { todo: Circle, in_progress: CircleDot, blocked: Ban, review: Eye, done: Check, cancelled: Circle } as const;

/** Светофор задачи: цвет — это риск, подпись объясняет почему. */
export function LightDot({ view, size = 10 }: { view: TaskLightView | null; size?: number }) {
  const p = usePalette();
  if (!view) return null;
  const color = view.light === 'red' ? p.bad : view.light === 'yellow' ? p.warn : p.good;
  return <View accessible accessibilityRole="image" accessibilityLabel={`${TASK_LIGHT_LABELS[view.light]}: ${view.reason}`} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 2, borderColor: `${color}55` }} />;
}

/** Плашка «Просьба» — коротко, рядом с названием. */
export function RequestBadge({ text = 'Просьба' }: { text?: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: p.infoSoft }}>
      <HandHelping size={11} color={p.info} />
      <Text variant="caption" style={{ color: p.info, fontFamily: font.semibold }}>
        {text}
      </Text>
    </View>
  );
}

export function TaskRow({
  task,
  today,
  onPress,
  showAssignee = true,
  meta,
  critical,
}: {
  task: Task;
  today: string;
  onPress: () => void;
  showAssignee?: boolean;
  /** Своя вторая строка — например, про архив. */
  meta?: string | null;
  /** На критическом пути цели: блокировка и просрочка здесь — красный. */
  critical?: boolean;
}) {
  const p = usePalette();
  const Icon = ICON[task.status];
  const blockedFor = task.blocker ? diffDays(task.blocker.since.slice(0, 10), today) : 0;
  const request = task.kind === 'request';
  const me = useMe();
  const cps = checkpointProgress(task.checkpoints ?? []);
  const sub =
    meta ??
    (task.blocker
      ? `${BLOCKER_LABELS[task.blocker.reason]}${task.blocker.note ? `: ${task.blocker.note}` : ''} · ${blockedFor > 0 ? `${blockedFor} ${plural(blockedFor, ['день', 'дня', 'дней'])}` : 'сегодня'}`
      : [request && requestFrom(task, me.data?.id ?? ''), task.team?.name ?? task.unit?.name, task.due_at && `до ${formatDate(task.due_at, { short: true, today })}`].filter(Boolean).join(' · '));
  return (
    // Статус не дублируем подписью: списки и так разбиты по статусу, а значок слева и светофор его показывают — места остаётся названию.
    <Pressable accessibilityRole="button" accessibilityHint={TASK_STATUS_LABELS[task.status]} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
      <Icon size={20} color={task.status === 'done' ? p.good : task.status === 'blocked' ? p.bad : p.ink3} />
      <View style={{ flex: 1, gap: 3 }}>
        {request && <RequestBadge />}
        <Text numberOfLines={2} style={{ fontFamily: font.medium, textDecorationLine: task.status === 'done' ? 'line-through' : 'none', color: task.status === 'done' ? p.ink3 : p.ink }}>
          {task.title}
        </Text>
        {(!!sub || cps.total > 0) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {!!sub && (
              <Text variant="caption" tone="faint" numberOfLines={1} style={{ flexShrink: 1 }}>
                {sub}
              </Text>
            )}
            {cps.total > 0 && (
              <View accessible accessibilityLabel={`Контрольные точки: ${cps.done} из ${cps.total}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Flag size={11} color={p.ink3} />
                <Text variant="caption" tone="faint">
                  {cps.done}/{cps.total}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
      {meta === undefined && <LightDot view={lightOf(task, today, { critical })} />}
      {showAssignee && task.assignee && <Avatar name={task.assignee.display_name} id={task.assignee.id} size={26} />}
    </Pressable>
  );
}

export function RiskItem({ risk, goalTitle, onPress }: { risk: Risk; goalTitle?: string; onPress?: () => void }) {
  const p = usePalette();
  const rail = risk.severity === 'critical' ? p.bad : risk.severity === 'warning' ? p.warn : p.info;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 3, borderRadius: 3, backgroundColor: rail }} />
      <View style={{ flex: 1, gap: 4 }}>
        {goalTitle && (
          <Text variant="caption" tone="faint">
            {goalTitle}
          </Text>
        )}
        <Text style={{ fontFamily: font.semibold }}>{risk.title}</Text>
        <Text variant="small" tone="muted">
          {risk.explanation}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
          <CornerDownRight size={14} color={p.accent} style={{ marginTop: 3 }} />
          <Text variant="small" style={{ flex: 1 }}>
            {risk.suggestion}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Логотип: «o» и стрелка «›» — движение к цели. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const p = usePalette();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: p.ink, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: size * 0.04 }}>
      <View style={{ width: size * 0.36, height: size * 0.36, borderRadius: size, borderWidth: size * 0.09, borderColor: p.bg }} />
      <Text style={{ color: p.accent, fontFamily: font.bold, fontSize: size * 0.5, lineHeight: size * 0.6, marginTop: -size * 0.04 }}>›</Text>
    </View>
  );
}
