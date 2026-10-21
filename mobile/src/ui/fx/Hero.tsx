import { useIsFocused } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from 'react-native';
import type { HeroVariant } from '../../lib/fx';
import { GradientBackdrop } from './GradientBackdrop';
import HeroScene from './HeroScene';
import { OnColor } from './OnColor';

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * Шапка с живым градиентом (и 3D-знаком, если mark). Сначала статичный градиент,
 * поверх — GL-сцена. Анимация идёт, только пока экран на виду и человек
 * не просил уменьшить движение: вкладки в фоне не тратят батарею.
 * Дети получают палитру для цветного фона (белый текст, светлые линии).
 */
export function Hero({ children, style, mark = true, variant = 'hero' }: { children?: ReactNode; style?: StyleProp<ViewStyle>; mark?: boolean; variant?: HeroVariant }) {
  const reduceMotion = useReduceMotion();
  const focused = useIsFocused();
  return (
    <View style={[{ borderRadius: 28, overflow: 'hidden', backgroundColor: '#090b2a' }, style]}>
      <GradientBackdrop variant={variant} />
      <HeroScene animate={focused && !reduceMotion} mark={mark} variant={variant} />
      <OnColor>{children}</OnColor>
    </View>
  );
}
