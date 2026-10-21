import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { font, usePalette } from '../../lib/theme';
import { Text } from '../primitives';

/**
 * Переключатель с «жидкой» каплей: та же пружина и растяжение, что у панели вкладок,
 * чтобы выбор режима ощущался одним жестом во всём приложении.
 */
export function LiquidSegmented<T extends string | number | boolean>({
  value,
  options,
  onChange,
  label,
  role = 'tab',
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label?: string;
  /** «tab» — переключает вид, «radio» — выбирает вариант в форме. */
  role?: 'tab' | 'radio';
}) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const pos = useRef(new Animated.Value(index)).current;
  const stretch = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(pos, { toValue: index, useNativeDriver: true, damping: 16, stiffness: 200 }),
      Animated.sequence([
        Animated.timing(stretch, { toValue: 1.18, duration: 100, useNativeDriver: true }),
        Animated.spring(stretch, { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 180 }),
      ]),
    ]).start();
  }, [index, pos, stretch]);

  // Ячейки без зазора: капля заполняет ячейку целиком.
  const cell = (width - 6) / Math.max(1, options.length);
  const translateX = Animated.add(3, Animated.multiply(pos, cell));

  return (
    <View accessibilityRole={role === 'tab' ? 'tablist' : 'radiogroup'} accessibilityLabel={label} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', backgroundColor: p.surface2, borderRadius: 999, padding: 3 }}>
      {width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 3,
            bottom: 3,
            left: 0,
            width: cell,
            borderRadius: 999,
            backgroundColor: p.surface,
            shadowColor: '#0b0b0f',
            shadowOpacity: 0.1,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
            transform: [{ translateX }, { scaleX: stretch }],
          }}
        />
      )}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole={role}
            accessibilityState={role === 'tab' ? { selected, disabled: o.disabled } : { checked: selected, disabled: o.disabled }}
            disabled={o.disabled}
            onPress={() => {
              if (selected) return;
              if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined);
              onChange(o.value);
            }}
            style={{ flex: 1, paddingVertical: 9, alignItems: 'center', opacity: o.disabled ? 0.4 : 1 }}
          >
            <Text variant="small" style={{ fontFamily: selected ? font.semibold : font.medium, color: selected ? p.ink : p.ink2 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
