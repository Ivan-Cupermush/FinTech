import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View, type ViewStyle } from 'react-native';
import { GradientBackdrop } from './GradientBackdrop';
import HeroScene from './HeroScene';

/**
 * Шапка с живым градиентом и 3D-знаком. Сначала статичный градиент,
 * поверх — GL-сцена; при «Уменьшить движение» сцена стоит на месте.
 */
export function Hero({ children, style }: { children?: ReactNode; style?: ViewStyle }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduceMotion(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return (
    <View style={[{ borderRadius: 28, overflow: 'hidden', backgroundColor: '#090b2a' }, style]}>
      <GradientBackdrop />
      <HeroScene animate={!reduceMotion} />
      {children}
    </View>
  );
}
