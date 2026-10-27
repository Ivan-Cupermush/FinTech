import { Ban, Check, Circle, CircleDot, CornerDownRight, Eye, Flag, HandHelping } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
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
import { Avatar, Bar, Card, Pill, Text } from './primitives';

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

export function GoalTile({ goal, today, onPress }: { goal: { id: string; title: string; type: GoalType; due_at: string | null; primary_metric: Metric | null; task_progress: { done: number; total: number }; risk_level?: 'critical' | 'warning' | 'ok'; status?: string }; today: string; onPress: () => void }) {
  const m = goal.primary_metric;
  const due = dueText(goal.due_at, today);
  const pct = goal.task_progress.total ? (goal.task_progress.done / goal.task_progress.total) * 100 : 0;
  return (
    <Card onPress={onPress} style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Pill>{GOAL_TYPE_LABELS[goal.type]}</Pill>
        {goal.status === 'draft' && <Pill>Черновик</Pill>}
        {goal.risk_level === 'critical' && (
          <Pill tone="bad" dot>
            Под угрозой
          </Pill>
        )}
        {goal.risk_level === 'warning' && (
          <Pill tone="warn" dot>
            Есть риски
          </Pill>
        )}
      </View>
      <Text variant="title">{goal.title}</Text>
      {m ? (
        <View style={{ gap: 6 }}>
          <KpiTrack baseline={m.baseline} target={m.target} current={m.current_value} unit={m.unit} progress={m.progress} size="lg" legend={false} />
          <Text variant="caption" tone="faint">
            {m.name}
          </Text>
        </View>
      ) : (
        <Text variant="small" tone="faint">
          KPI не задан — цель пока не измерима
        </Text>
      )}
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text variant="caption" tone="faint">
            {goal.task_progress.total ? `Задачи ${goal.task_progress.done} из ${goal.task_progress.total}` : 'Задач пока нет'}
          </Text>
          <Text variant="caption" tone={due.overdue ? 'bad' : 'faint'}>
            {due.text}
          </Text>
        </View>
        <Bar percent={pct} />
      </View>
    </Card>
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

export function TaskRow({ task, today, onPress, showAssignee = true, meta }: { task: Task; today: string; onPress: () => void; showAssignee?: boolean; /** Своя вторая строка — например, про архив. */ meta?: string | null }) {
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
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
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
      {meta === undefined && <LightDot view={lightOf(task, today)} />}
      <TaskStatusPill task={task} today={today} />
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
