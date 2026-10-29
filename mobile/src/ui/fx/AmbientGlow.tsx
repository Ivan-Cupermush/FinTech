import { useColorScheme, View } from 'react-native';
import { useId } from 'react';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { HERO_COLORS } from '../../lib/fx';

/**
 * Мягкое свечение фирменных цветов в шапке экрана: даёт глубину и то,
 * что стеклу есть что преломлять, не мешая читать.
 * `offset` — высота системной шапки над экраном: свечение начинается в ней
 * (см. HeaderGlow) и продолжается в теле без шва на границе.
 */
export function AmbientGlow({ height = 360, offset = 0 }: { height?: number; offset?: number }) {
  // Свой id на каждый экземпляр: в вебе одинаковые id в скрытой вкладке ломают градиент.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const dark = useColorScheme() === 'dark';
  const [blue, , violet] = HERO_COLORS;
  const k = dark ? 0.32 : 0.16;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: -offset, left: 0, right: 0, height }}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`g1${uid}`} cx="12%" cy="0%" rx="75%" ry="70%">
            <Stop offset="0" stopColor={blue} stopOpacity={k} />
            <Stop offset="1" stopColor={blue} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`g2${uid}`} cx="95%" cy="10%" rx="60%" ry="55%">
            <Stop offset="0" stopColor={violet} stopOpacity={k * 0.9} />
            <Stop offset="1" stopColor={violet} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#g1${uid})`} />
        <Rect width="100%" height="100%" fill={`url(#g2${uid})`} />
      </Svg>
    </View>
  );
}

/** Фон системной шапки экрана: верх того же свечения, тело экрана продолжает его ниже. */
export function HeaderGlow({ bg }: { bg: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: bg, overflow: 'hidden' }}>
      <AmbientGlow />
    </View>
  );
}
