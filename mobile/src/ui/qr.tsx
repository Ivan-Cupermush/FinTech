import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import QR from 'qrcode';
import { qrHole, qrPaths, type QrMatrix } from '@offix/core';

/** Матрица кода: высокая коррекция (H) — середину можно занять знаком offix. */
export function qrMatrix(value: string): QrMatrix {
  const { modules } = QR.create(value, { errorCorrectionLevel: 'H' });
  return { size: modules.size, dark: (r, c) => !!modules.get(r, c) };
}

/**
 * QR-код в стиле offix — как на сайте: круглые точки, «глазки» в фирменном
 * градиенте, знак в центре. Всегда тёмный на белом, чтобы читала любая камера.
 */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const art = useMemo(() => {
    const m = qrMatrix(value);
    const cell = 10;
    const quiet = 2 * cell;
    const p = qrPaths(m, cell, qrHole(m.size));
    return { ...p, quiet, total: p.size + quiet * 2 };
  }, [value]);
  const c = art.total / 2;
  const mark = art.hole * 0.78;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${art.total} ${art.total}`}>
        <Defs>
          <LinearGradient id="qr-eye" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2f4bff" />
            <Stop offset="1" stopColor="#7a6bff" />
          </LinearGradient>
        </Defs>
        <Rect width={art.total} height={art.total} rx={art.total * 0.08} fill="#fff" />
        <G transform={`translate(${art.quiet} ${art.quiet})`}>
          <Path d={art.dots} fill="#141625" />
          <Path d={art.eyes} fill="url(#qr-eye)" />
        </G>
        {art.hole > 0 && (
          <G transform={`translate(${c - mark / 2} ${c - mark / 2}) scale(${mark / 64})`}>
            <Rect width={64} height={64} rx={18} fill="#141625" />
            <Circle cx={26} cy={32} r={11} fill="none" stroke="#fff" strokeWidth={6} />
            <Path d="M41 21 L52 32 L41 43" fill="none" stroke="#5b74ff" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
          </G>
        )}
      </Svg>
    </View>
  );
}
