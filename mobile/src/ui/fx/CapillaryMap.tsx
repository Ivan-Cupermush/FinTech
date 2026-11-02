import { router } from 'expo-router';
import { AlertTriangle, Check, Flag } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text as RNText, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import Svg, { Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { capillaryPath, downstream, formatDate, layoutCapillary, needsBow, riskLevelOf, riskTone, TASK_STATUS_LABELS, type CapNode, type Roadmap } from '@offix/core';
import { font } from '../../lib/theme';
import { Button } from '../primitives';
import { useReduceMotion } from './Hero';

const LANE = 92;
const PAD_X = 64;
const PAD_TOP = 40;
const PAD_BOTTOM = 126;
const ORB = 38;

const STATE: Record<CapNode['state'], string> = { done: 'готово', active: 'в работе', blocked: 'блок', overdue: 'просрочено', planned: 'план' };
const ORB_COLORS: Record<string, [string, string, string]> = {
  done: ['#3b55ff', '#1b2382', 'rgba(59,85,255,0.55)'],
  active: ['#7d6bff', '#3a2a9e', 'rgba(138,114,255,0.6)'],
  planned: ['rgba(140,150,255,0.35)', 'rgba(40,46,140,0.55)', 'rgba(120,130,255,0.3)'],
  late: ['#ffb547', '#c4561c', 'rgba(255,150,70,0.6)'],
  critical: ['#ff3b5c', '#8e1846', 'rgba(255,59,92,0.75)'],
  safe: ['#3ee6b0', '#1f7fc4', 'rgba(62,230,176,0.6)'],
  steady: ['#8a72ff', '#2f4bff', 'rgba(138,114,255,0.7)'],
  warning: ['#ffb547', '#e0563a', 'rgba(255,138,76,0.65)'],
};

/** Кольцо, расходящееся от узла: ударная волна при касании и пульс критичных узлов. */
function Ring({ size, loop, color, delay = 0 }: { size: number; loop: boolean; color: string; delay?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.timing(v, { toValue: 1, duration: loop ? 833 : 900, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    const run = loop ? Animated.loop(a) : a;
    run.start();
    return () => run.stop();
  }, [v, loop, delay]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        left: -size / 2,
        top: -size / 2,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [loop ? 0.8 : 0.15, loop ? 1.6 : 1.5] }) }],
      }}
    />
  );
}

/**
 * Капиллярная карта цели в приложении: та же геометрия из ядра, что на сайте.
 * Узлы — стеклянные капли, капилляры светятся, критический путь красный.
 * Касание узла — ударная волна и стеклянная панель задачи под картой.
 */
export function CapillaryMap({ roadmap }: { roadmap: Roadmap }) {
  const { width: screenW } = useWindowDimensions();
  const reduce = useReduceMotion();
  const [sel, setSel] = useState<string | null>(null);
  const [wave, setWave] = useState(0);
  const scroller = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(false);
  const goal = roadmap.goal;
  const open = roadmap.tasks.filter((t) => t.status !== 'cancelled');
  const W0 = Math.max(screenW - 32, open.length * 96 + PAD_X * 2);
  const layout = useMemo(
    () => layoutCapillary({ tasks: roadmap.tasks, edges: roadmap.edges, critical_path: roadmap.critical_path, today: roadmap.timeline.today, goal: { id: goal.id, title: goal.title, due_at: goal.due_at }, minGap: 128 / (W0 - PAD_X * 2), maxLanes: 2 }),
    [roadmap, goal.id, goal.title, goal.due_at, W0],
  );
  // Узлы не поместились в ряды — карта шире, чтобы подписи соседей не наезжали.
  const W = Math.round(PAD_X * 2 + (W0 - PAD_X * 2) * layout.stretch);
  if (!open.length) return null;
  const H = PAD_TOP + (layout.laneMax - layout.laneMin) * LANE + PAD_BOTTOM;
  const px = (x: number) => PAD_X + x * (W - PAD_X * 2);
  const py = (lane: number) => PAD_TOP + (lane - layout.laneMin) * LANE;
  const at = new Map(layout.nodes.map((n) => [n.id, { x: px(n.x), y: py(n.lane), n }]));
  const goalTone = riskTone({ risk_level: goal.status === 'active' ? riskLevelOf(roadmap.risks) : 'ok', kpi: goal.metrics[0]?.progress.state ?? null, status: goal.status });
  const selected = sel ? at.get(sel) : undefined;
  const task = selected ? roadmap.tasks.find((t) => t.id === selected.n.id) : undefined;
  const waiting = task ? downstream(roadmap.edges, task.id).filter((id) => open.some((t) => t.id === id && t.status !== 'done')).length : 0;
  const cps = task?.checkpoints ?? [];

  return (
    <View style={styles.wrap} accessibilityLabel="Капиллярная карта цели">
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={(cw) => {
          // Длинная карта открывается на «сегодня», а не на начале проекта.
          if (scrolled.current || cw <= screenW - 32) return;
          scrolled.current = true;
          scroller.current?.scrollTo({ x: Math.max(0, Math.min(cw - (screenW - 32), px(layout.today) - (screenW - 32) * 0.3)), animated: false });
        }}
      >
        <View style={{ width: W, height: H }}>
          <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
            <Line x1={px(layout.today)} x2={px(layout.today)} y1={8} y2={H - 40} stroke="rgba(160,172,255,0.35)" strokeDasharray="3 6" />
            {layout.links.map((l) => {
              const a = at.get(l.from);
              const b = at.get(l.to);
              if (!a || !b) return null;
              const d = capillaryPath(a.x, a.y, b.x, b.y, needsBow(layout, l.from, l.to) ? (a.n.lane > 0 ? 36 : -36) : 0);
              const c = l.critical ? '#ff3b5c' : l.broken ? '#ffb547' : l.done ? '#8f9bff' : '#7f8cff';
              return (
                <G key={`${l.from}-${l.to}`}>
                  <Path d={d} stroke={c} strokeOpacity={l.critical ? 0.28 : 0.16} strokeWidth={l.critical ? 11 : 9} fill="none" strokeLinecap="round" />
                  <Path d={d} stroke={c} strokeOpacity={l.done ? 0.6 : 1} strokeWidth={l.critical ? 2.4 : 2} fill="none" strokeLinecap="round" />
                </G>
              );
            })}
          </Svg>

          {layout.nodes.map((n) => {
            const p = at.get(n.id)!;
            const isGoal = n.kind === 'goal';
            const late = n.state === 'blocked' || n.state === 'overdue';
            const key = isGoal ? goalTone : late ? (n.critical ? 'critical' : 'late') : n.state;
            const [c1, c2, halo] = ORB_COLORS[key]!;
            const size = isGoal ? 50 : ORB;
            const meta = isGoal ? (goal.due_at ? `цель · ${formatDate(goal.due_at, { short: true })}` : 'цель') : `${STATE[n.state]} · ${formatDate(n.date, { short: true })}`;
            return (
              <View key={n.id} style={{ position: 'absolute', left: p.x, top: p.y }}>
                {!reduce && ((late && n.critical) || (isGoal && goalTone === 'critical')) && <Ring size={size + 16} loop color="rgba(255,90,120,0.7)" />}
                {!reduce && sel === n.id && [0, 110, 220].map((d) => <Ring key={`${wave}-${d}`} size={180} loop={false} delay={d} color="rgba(255,255,255,0.75)" />)}
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel === n.id }}
                  accessibilityLabel={`${isGoal ? 'Цель' : 'Задача'} «${n.title}»: ${meta}${n.critical && !isGoal ? ', критический путь' : ''}`}
                  onPress={() => {
                    setWave((w) => w + 1);
                    setSel((s) => (s === n.id ? null : n.id));
                  }}
                  hitSlop={10}
                  style={{ position: 'absolute', left: -size / 2, top: -size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: c2, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center', shadowColor: halo, shadowOpacity: 1, shadowRadius: 14, elevation: 8, overflow: 'visible' }}
                >
                  <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
                    <Defs>
                      <LinearGradient id={`o${n.id}`} x1="0.3" y1="0" x2="0.7" y2="1">
                        <Stop offset="0" stopColor={c1} />
                        <Stop offset="1" stopColor={c2} />
                      </LinearGradient>
                    </Defs>
                    <Rect width={size} height={size} rx={size / 2} fill={`url(#o${n.id})`} />
                    <Rect x={size * 0.24} y={size * 0.14} width={size * 0.22} height={size * 0.14} rx={size * 0.07} fill="rgba(255,255,255,0.75)" />
                  </Svg>
                  {isGoal ? <Flag size={18} color="#fff" /> : n.state === 'done' ? <Check size={17} color="#fff" strokeWidth={3} /> : late ? <AlertTriangle size={15} color="#fff" /> : n.progress !== null ? <RNText style={styles.pct}>{n.progress}%</RNText> : null}
                </Pressable>
                <View pointerEvents="none" style={[styles.label, { top: size / 2 + 8 }]}>
                  <RNText style={styles.title} numberOfLines={2}>
                    {isGoal ? `Цель: ${n.title}` : n.title}
                  </RNText>
                  <RNText style={[styles.meta, late && { color: n.critical ? '#ff8aa0' : '#ffc88a' }]}>{meta.toUpperCase()}</RNText>
                </View>
              </View>
            );
          })}

          <View style={[styles.axis, { width: W }]} pointerEvents="none">
            {layout.months.map((m) => (
              <RNText key={`${m.label}-${m.x}`} style={[styles.month, { left: px(m.x) - 30 }]}>
                {m.label.toUpperCase()}
              </RNText>
            ))}
            <View style={[styles.today, { left: px(layout.today) - 40 }]}>
              <RNText style={styles.todayText}>СЕГОДНЯ</RNText>
            </View>
          </View>
        </View>
      </ScrollView>

      {selected && (
        <View style={styles.detail} accessibilityLabel={selected.n.kind === 'goal' ? 'Цель' : `Задача «${selected.n.title}»`}>
          <RNText style={styles.eyebrow}>
            {selected.n.kind === 'goal' ? 'ЦЕЛЬ' : 'ЗАДАЧА'}
            {selected.n.critical && selected.n.kind !== 'goal' ? ' · КРИТИЧЕСКИЙ ПУТЬ' : ''}
            {task ? ` · ${TASK_STATUS_LABELS[task.status].toUpperCase()}` : ''}
          </RNText>
          <RNText style={styles.detailTitle}>{selected.n.title}</RNText>
          <View style={styles.bar}>
            <View style={{ width: `${selected.n.progress ?? 0}%`, height: 6, borderRadius: 3, backgroundColor: selected.n.state === 'blocked' || selected.n.state === 'overdue' ? '#ff5d6c' : '#9d8cff' }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 20 }}>
            {task ? (
              <>
                <Fig v={cps.length ? `${cps.filter((c) => c.status === 'done').length}/${cps.length}` : `${selected.n.progress ?? 0}%`} l={cps.length ? 'ТОЧЕК' : 'ГОТОВО'} />
                <Fig v={task.due_at ? formatDate(task.due_at, { short: true }) : '—'} l="СРОК" />
                <Fig v={String(waiting)} l="ЗАВИСЯТ" />
              </>
            ) : (
              <>
                <Fig v={`${open.filter((t) => t.status === 'done').length}/${open.length}`} l="ЗАДАЧ" />
                <Fig v={goal.due_at ? formatDate(goal.due_at, { short: true }) : '—'} l="СРОК" />
              </>
            )}
          </View>
          {task && <Button title="Открыть задачу" variant="secondary" onPress={() => router.push(`/task/${task.id}`)} style={{ minHeight: 40, alignSelf: 'flex-start' }} />}
        </View>
      )}
    </View>
  );
}

function Fig({ v, l }: { v: string; l: string }) {
  return (
    <View style={{ gap: 2 }}>
      <RNText style={{ color: '#eef0ff', fontFamily: font.bold, fontSize: 20, letterSpacing: -0.5 }}>{v}</RNText>
      <RNText style={styles.metaFaint}>{l}</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 24, overflow: 'hidden', backgroundColor: '#0b0e3a', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  label: { position: 'absolute', left: -66, width: 132, alignItems: 'center', gap: 2 },
  title: { color: '#eef0ff', fontFamily: font.semibold, fontSize: 12, lineHeight: 15, textAlign: 'center' },
  meta: { color: 'rgba(214,220,255,0.62)', fontFamily: font.semibold, fontSize: 9.5, letterSpacing: 0.8 },
  metaFaint: { color: 'rgba(214,220,255,0.62)', fontFamily: font.semibold, fontSize: 9.5, letterSpacing: 0.8 },
  pct: { color: '#fff', fontFamily: font.bold, fontSize: 11 },
  axis: { position: 'absolute', left: 0, bottom: 0, height: 36, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  month: { position: 'absolute', top: 12, width: 60, textAlign: 'center', color: 'rgba(214,220,255,0.62)', fontFamily: font.semibold, fontSize: 9.5, letterSpacing: 1.2 },
  today: { position: 'absolute', top: -11, width: 80, height: 22, borderRadius: 11, backgroundColor: '#3a4be8', alignItems: 'center', justifyContent: 'center', shadowColor: '#4a5cff', shadowOpacity: 0.9, shadowRadius: 10 },
  todayText: { color: '#fff', fontFamily: font.bold, fontSize: 9.5, letterSpacing: 1.2 },
  detail: { margin: 12, marginTop: 4, padding: 16, gap: 10, borderRadius: 20, backgroundColor: 'rgba(64,76,220,0.38)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  eyebrow: { color: 'rgba(214,220,255,0.7)', fontFamily: font.semibold, fontSize: 10, letterSpacing: 1.2 },
  detailTitle: { color: '#fff', fontFamily: font.semibold, fontSize: 16, lineHeight: 21 },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
});
