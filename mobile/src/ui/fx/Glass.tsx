import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Platform, useColorScheme, View, type StyleProp, type ViewStyle } from 'react-native';
import { glassKind, glassTint, type GlassTone } from '../../lib/fx';

/**
 * Стекло в приложении. liquid-glass-react — веб-библиотека, поэтому здесь
 * ближайший нативный аналог: системное Liquid Glass на iOS 26+ (expo-glass-effect),
 * размытие на iOS постарше (expo-blur), полупрозрачная подложка на Android и в вебе.
 *
 * tone="color" — стекло поверх градиента (белый текст), tone="surface" — поверх
 * обычного экрана, подстраивается под светлую и тёмную тему.
 */
export function Glass({ children, style, radius = 24, tone = 'color', interactive = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; tone?: GlassTone; interactive?: boolean }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const kind = glassKind(Platform.OS, Platform.OS === 'ios' && isLiquidGlassAvailable());
  const t = glassTint(tone, scheme);
  const shape: ViewStyle = { borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: t.border };
  if (kind === 'liquid') {
    return (
      <GlassView glassEffectStyle={tone === 'color' ? 'clear' : 'regular'} tintColor={t.liquidTint} isInteractive={interactive} style={[shape, style]}>
        {children}
      </GlassView>
    );
  }
  if (kind === 'blur') {
    return (
      <BlurView tint={t.blurTint} intensity={tone === 'color' ? 50 : 80} style={[shape, style]}>
        {children}
      </BlurView>
    );
  }
  return <View style={[shape, { backgroundColor: t.fill }, style]}>{children}</View>;
}
