import { useEffect, useRef } from 'react';
import { Animated, Easing, Text as RNText, View, type TextStyle } from 'react-native';
import { useReduceMotion } from './Hero';

const DIGITS = Array.from({ length: 30 }, (_, i) => String(i % 10));

/** Один разряд: колонка 0–9 ×3 едет к нужной цифре с перелётом. */
function Digit({ d, fromRight, style, lh }: { d: number; fromRight: number; style: TextStyle; lh: number }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const target = d + 10 * Math.max(0, 2 - fromRight);
    Animated.timing(y, { toValue: -target * lh, duration: 620, delay: fromRight * 40, easing: Easing.bezier(0.2, 1.18, 0.36, 1), useNativeDriver: true }).start();
  }, [d, fromRight, lh, y]);
  return (
    <View style={{ height: lh, overflow: 'hidden' }}>
      <Animated.View style={{ transform: [{ translateY: y }] }}>
        {DIGITS.map((c, i) => (
          <RNText key={i} style={[style, { height: lh, lineHeight: lh }]}>
            {c}
          </RNText>
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * Одометр: цифры накатывают волной справа налево (620 мс, шаг 40 мс).
 * Для экранного диктора — целое число; при просьбе уменьшить движение — сразу оно.
 */
export function Odometer({ value, style }: { value: string; style: TextStyle }) {
  const reduce = useReduceMotion();
  const lh = Math.round((style.fontSize ?? 16) * 1.12);
  if (reduce) return <RNText style={[style, { fontVariant: ['tabular-nums'] }]}>{value}</RNText>;
  const chars = [...value];
  const total = chars.filter((c) => c >= '0' && c <= '9').length;
  let seen = 0;
  return (
    <View accessible accessibilityLabel={value} style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      {chars.map((c, i) => {
        if (c < '0' || c > '9')
          return (
            <RNText key={i} style={[style, { height: lh, lineHeight: lh }]}>
              {c === ' ' ? ' ' : c}
            </RNText>
          );
        const fromRight = total - 1 - seen++;
        return <Digit key={i} d={Number(c)} fromRight={fromRight} style={{ ...style, fontVariant: ['tabular-nums'] }} lh={lh} />;
      })}
    </View>
  );
}
