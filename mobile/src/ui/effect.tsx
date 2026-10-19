import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { formatHours, formatPercent, type MetricsReport, type Movement } from '@offix/core';
import { sparkSegments } from '../lib/logic';
import { font, usePalette } from '../lib/theme';
import { Card, Text } from './primitives';

/** Мини-график по неделям: пунктирная ось на всю ширину, линия только там, где есть данные. */
export function Sparkline({ values, height = 44, max, color, label }: { values: readonly (number | null)[]; height?: number; max?: number; color?: string; label: string }) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const c = color ?? p.accent;
  // Отступ справа, чтобы точка «сейчас» не обрезалась краем.
  const segs = sparkSegments(values, width, height, max, 0, 5);
  const last = segs.at(-1)?.at(-1);
  const lastIsCurrent = values.at(-1) !== null && values.at(-1) !== undefined;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
      <Svg width={width} height={height}>
        <Line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke={p.line} strokeWidth={1} strokeDasharray="3 4" />
        {segs.map((seg, k) => {
          const d = seg.map((pt, j) => `${j ? 'L' : 'M'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
          const area = `${d} L${seg.at(-1)!.x.toFixed(1)},${height} L${seg[0]!.x.toFixed(1)},${height} Z`;
          return (
            <Path key={`a${k}`} d={area} fill={c} fillOpacity={0.12} />
          );
        })}
        {segs.map((seg, k) => (
          <Path key={`l${k}`} d={seg.map((pt, j) => `${j ? 'L' : 'M'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')} stroke={c} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {last && lastIsCurrent && <Circle cx={last.x} cy={last.y} r={4} fill={p.surface} stroke={c} strokeWidth={2.5} />}
      </Svg>
      )}
    </View>
  );
}

/** Полоса «сдвинулись / без изменений / хуже / нет замеров». */
export function MovementBar({ counts }: { counts: Record<Movement, number> }) {
  const p = usePalette();
  const colors: Record<Movement, string> = { improved: p.good, flat: p.ink3, worse: p.bad, stale: p.surface3 };
  const order: Movement[] = ['improved', 'flat', 'worse', 'stale'];
  return (
    <View style={{ flexDirection: 'row', gap: 3, height: 10 }} importantForAccessibility="no-hide-descendants">
      {order
        .filter((k) => counts[k])
        .map((k) => (
          <View key={k} style={{ flexGrow: counts[k], minWidth: 10, borderRadius: 5, backgroundColor: colors[k], borderWidth: k === 'stale' ? 1 : 0, borderColor: p.line }} />
        ))}
    </View>
  );
}

/** Сводка эффекта на Пульсе: одна цифра и три факта, полная картина — по нажатию. */
export function EffectSummary({ r }: { r: MetricsReport }) {
  const p = usePalette();
  if (!r.north_star.total) return null;
  const facts = [
    `Свежие замеры ${formatPercent(r.freshness.value)}`,
    r.blockers.median_hours !== null ? `Блокер снимают за ${formatHours(r.blockers.median_hours)}` : null,
    r.on_time.value !== null ? `В срок ${formatPercent(r.on_time.value)}` : null,
  ].filter(Boolean);
  return (
    <Card onPress={() => router.push('/effect')} style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <Text style={{ fontSize: 40, lineHeight: 44, fontFamily: font.bold, letterSpacing: -2 }}>{formatPercent(r.north_star.value)}</Text>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontFamily: font.semibold }}>целей сдвинули KPI за {r.window_days} дней</Text>
        <Text variant="small" tone="muted">
          {facts.join(' · ')}
        </Text>
      </View>
      <ChevronRight size={18} color={p.ink3} />
    </Card>
  );
}
