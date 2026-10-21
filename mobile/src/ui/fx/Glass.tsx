import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';
import { glassKind } from '../../lib/fx';

/**
 * Стекло в приложении. liquid-glass-react — веб-библиотека, поэтому здесь
 * ближайший нативный аналог: системное Liquid Glass на iOS 26+ (expo-glass-effect),
 * размытие на iOS постарше (expo-blur), полупрозрачная подложка на Android и в вебе.
 */
export function Glass({ children, style, radius = 24 }: { children: ReactNode; style?: ViewStyle; radius?: number }) {
  const kind = glassKind(Platform.OS, Platform.OS === 'ios' && isLiquidGlassAvailable());
  const shape: ViewStyle = { borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' };
  if (kind === 'liquid') {
    return (
      <GlassView glassEffectStyle="clear" tintColor="rgba(20,26,90,0.25)" style={[shape, style]}>
        {children}
      </GlassView>
    );
  }
  if (kind === 'blur') {
    return (
      <BlurView tint="systemUltraThinMaterialDark" intensity={50} style={[shape, style]}>
        {children}
      </BlurView>
    );
  }
  return <View style={[shape, { backgroundColor: 'rgba(14,18,60,0.42)' }, style]}>{children}</View>;
}
