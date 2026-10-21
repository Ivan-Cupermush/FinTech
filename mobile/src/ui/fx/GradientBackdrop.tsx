import { View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { HERO_COLORS } from '../../lib/fx';

/**
 * Статичный вариант живого градиента: первый кадр до запуска WebGL,
 * веб-сборка и телефоны, где GL недоступен. Те же три цвета.
 */
export function GradientBackdrop({ style }: { style?: ViewStyle }) {
  const [a, b, c] = HERO_COLORS;
  return (
    <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, style]} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="base" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={a} />
            <Stop offset="1" stopColor={b} />
          </LinearGradient>
          <RadialGradient id="glow" cx="18%" cy="12%" r="70%">
            <Stop offset="0" stopColor={c} stopOpacity={0.9} />
            <Stop offset="1" stopColor={c} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#base)" />
        <Rect width="100%" height="100%" fill="url(#glow)" />
      </Svg>
    </View>
  );
}
