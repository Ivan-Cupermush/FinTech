import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_GAP, TAB_BAR_HEIGHT, tabIndicator } from '../../lib/fx';
import { font, usePalette } from '../../lib/theme';
import { Text } from '../primitives';
import { Glass } from './Glass';

/**
 * Нижняя панель вкладок — парящая капсула из стекла. Под активной вкладкой
 * «капля», которая перетекает к новой вкладке: пружина плюс растяжение
 * по ходу движения, как у жидкости.
 */
export function GlassTabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const pos = useRef(new Animated.Value(state.index)).current;
  const stretch = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      pos.setValue(state.index);
      return;
    }
    Animated.parallel([
      Animated.spring(pos, { toValue: state.index, useNativeDriver: true, damping: 16, stiffness: 180, mass: 0.9 }),
      Animated.sequence([
        Animated.timing(stretch, { toValue: 1.45, duration: 110, useNativeDriver: true }),
        Animated.spring(stretch, { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 160 }),
      ]),
    ]).start();
  }, [state.index, pos, stretch]);

  const slot = tabIndicator(0, count, width);
  const step = tabIndicator(1, count, width).x - slot.x;
  const translateX = pos.interpolate({ inputRange: [0, Math.max(1, count - 1)], outputRange: [slot.x, slot.x + step * Math.max(1, count - 1)] });

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 8) + TAB_BAR_GAP - 4 }}>
      <Glass tone="surface" radius={TAB_BAR_HEIGHT / 2} interactive style={{ shadowColor: '#0b0b0f', shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12 }}>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: TAB_BAR_HEIGHT, flexDirection: 'row', paddingHorizontal: 6 }} accessibilityRole="tablist">
          {width > 0 && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 7,
                bottom: 7,
                left: 0,
                width: slot.w,
                borderRadius: 22,
                backgroundColor: p.accentSoft,
                transform: [{ translateX }, { scaleX: stretch }],
              }}
            />
          )}
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key]!;
            const focused = state.index === index;
            const color = focused ? p.accent : p.ink2;
            const label = typeof options.title === 'string' ? options.title : route.name;
            const onPress = () => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined);
                navigateToTab(route.key);
              }
            };
            const badge = options.tabBarBadge;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={badge ? `${label}, ${badge} новых` : label}
                onPress={onPress}
                onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}
              >
                <View>
                  {options.tabBarIcon?.({ focused, color, size: 22 })}
                  {badge ? (
                    <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: p.bad, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 10.5, fontFamily: font.bold }}>{String(badge)}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={{ color, fontSize: 11, lineHeight: 14, fontFamily: focused ? font.semibold : font.medium }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}
