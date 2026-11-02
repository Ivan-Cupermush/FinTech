import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { RISK_PALETTE, RISK_PULSE_MS, sparkPath, type RiskTone } from '@offix/core';
import { useReduceMotion } from './Hero';

/** Мягкое пятно жидкости: радиальный градиент в своём квадрате. */
function Blob({ id, color, size }: { id: string; color: string; size: number }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={1} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={size} height={size} fill={`url(#${id})`} />
    </Svg>
  );
}

let seq = 0;

/**
 * Risk Radar в приложении: та же жидкость цвета риска, что на сайте.
 * Пятна медленно перетекают, у критичной карточки — пульс 72 уд/мин.
 * Наклона к пальцу нет (телефон держат в руке), вместо него карточка
 * пружинит при нажатии. При просьбе уменьшить движение всё стоит.
 */
export function RiskCard({ tone, spark, onPress, children, style, accessibilityLabel }: { tone: RiskTone; spark?: readonly number[]; onPress?: () => void; children: ReactNode; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const p = RISK_PALETTE[tone];
  const reduce = useReduceMotion();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ids = useRef(`rr${++seq}`).current;
  const drift = useRef(new Animated.Value(0)).current;
  const beat = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduce) return;
    const a = Animated.loop(Animated.timing(drift, { toValue: 1, duration: 12000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), { iterations: -1 });
    a.start();
    let b: Animated.CompositeAnimation | null = null;
    if (tone === 'critical') {
      b = Animated.loop(Animated.timing(beat, { toValue: 1, duration: RISK_PULSE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }));
      b.start();
    }
    return () => {
      a.stop();
      b?.stop();
    };
  }, [reduce, tone, drift, beat]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 1 || Math.abs(height - size.h) > 1) setSize({ w: width, h: height });
  };
  const { w, h } = size;
  const blob = Math.max(w, h) * 0.95;
  // Пятна ходят туда и обратно: вход 0→1 и обратно даёт «дыхание» без рывка на стыке.
  const wave = drift.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] });
  const move = (dx: number, dy: number) => ({ transform: [{ translateX: wave.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) }, { translateY: wave.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) }] });
  const sparkD = spark && spark.length > 1 && w ? sparkPath(spark, w, 48, 6) : null;

  const body = (
    <Animated.View onLayout={onLayout} style={[styles.card, { shadowColor: p.to, transform: [{ scale: press }] }, style]}>
      <View style={[StyleSheet.absoluteFill, styles.clip]} pointerEvents="none">
        {w > 0 && (
          <>
            <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id={`${ids}bg`} x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={p.from} />
                  <Stop offset="0.6" stopColor={p.to} />
                  <Stop offset="1.2" stopColor={p.deep} />
                </LinearGradient>
              </Defs>
              <Rect width={w} height={h} fill={`url(#${ids}bg)`} />
            </Svg>
            <Animated.View style={[styles.blob, { left: -blob * 0.25, top: -blob * 0.3 }, move(w * 0.18, h * 0.1)]}>
              <Blob id={`${ids}a`} color={p.from} size={blob} />
            </Animated.View>
            <Animated.View style={[styles.blob, { right: -blob * 0.35, top: h * 0.05 }, move(-w * 0.2, h * 0.08)]}>
              <Blob id={`${ids}b`} color={p.to} size={blob * 0.9} />
            </Animated.View>
            <Animated.View style={[styles.blob, { left: w * 0.1, bottom: -blob * 0.55 }, move(w * 0.12, -h * 0.12)]}>
              <Blob id={`${ids}c`} color={p.deep} size={blob} />
            </Animated.View>
            {tone === 'critical' && (
              <Animated.View
                style={[
                  styles.pulse,
                  { right: -50, top: h / 2 - 100, opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [reduce ? 0.35 : 0.7, reduce ? 0.35 : 0] }), transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [reduce ? 0.9 : 0.55, reduce ? 0.9 : 1.3] }) }] },
                ]}
              />
            )}
            {/* Затемнение под текстом и «лак» сверху — текст читается на любом цвете. */}
            <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id={`${ids}sh`} x1="0" y1="0" x2="0.6" y2="1">
                  <Stop offset="0" stopColor="#060a2e" stopOpacity={0.3} />
                  <Stop offset="0.6" stopColor="#060a2e" stopOpacity={0} />
                </LinearGradient>
                <LinearGradient id={`${ids}gl`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#fff" stopOpacity={0.22} />
                  <Stop offset="0.35" stopColor="#fff" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect width={w} height={h} fill={`url(#${ids}sh)`} />
              <Rect width={w} height={h} fill={`url(#${ids}gl)`} />
              {sparkD && (
                <>
                  <Path d={`${sparkD} L${w} 48 L0 48 Z`} fill="rgba(255,255,255,0.12)" transform={`translate(0 ${h - 104})`} />
                  <Path d={sparkD} stroke="rgba(255,255,255,0.35)" strokeWidth={6} fill="none" strokeLinecap="round" transform={`translate(0 ${h - 104})`} />
                  <Path d={sparkD} stroke="#fff" strokeWidth={1.8} fill="none" strokeLinecap="round" transform={`translate(0 ${h - 104})`} />
                </>
              )}
            </Svg>
          </>
        )}
      </View>
      <View style={styles.bevel} pointerEvents="none" />
      {children}
    </Animated.View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={() => !reduce && Animated.spring(press, { toValue: 0.975, useNativeDriver: true, stiffness: 320, damping: 20 }).start()}
      onPressOut={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, stiffness: 170, damping: 12 }).start()}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 18,
    gap: 10,
    minHeight: 200,
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 6,
  },
  clip: { borderRadius: 24, overflow: 'hidden' },
  blob: { position: 'absolute' },
  pulse: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  bevel: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.45)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.7)' },
});
