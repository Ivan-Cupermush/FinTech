import * as Haptics from 'expo-haptics';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text as RNText, TextInput, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { initials } from '@offix/core';
import { useAvatarUri } from '../lib/avatars';
import { font, radius, toneColors, usePalette, type Tone } from '../lib/theme';
import { AmbientGlow } from './fx/AmbientGlow';
import { useTabBarSpace } from './fx/TabBarSpace';

/** Поле внутри стеклянной плашки: рамку фокуса рисует плашка, браузерная не нужна. */
export const NO_WEB_OUTLINE: TextStyle = Platform.OS === 'web' ? { outlineWidth: 0 } : {};

type Variant = 'body' | 'small' | 'caption' | 'title' | 'h1' | 'h2' | 'eyebrow';

const SIZES: Record<Variant, TextStyle> = {
  h1: { fontSize: 30, lineHeight: 34, fontFamily: font.bold, letterSpacing: -0.9 },
  h2: { fontSize: 22, lineHeight: 26, fontFamily: font.semibold, letterSpacing: -0.5 },
  title: { fontSize: 17, lineHeight: 22, fontFamily: font.semibold, letterSpacing: -0.25 },
  body: { fontSize: 15, lineHeight: 21, fontFamily: font.regular },
  small: { fontSize: 13.5, lineHeight: 19, fontFamily: font.regular },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: font.medium },
  eyebrow: { fontSize: 11.5, lineHeight: 14, fontFamily: font.semibold, letterSpacing: 0.7, textTransform: 'uppercase' },
};

export function Text({ variant = 'body', tone = 'ink', style, ...rest }: TextProps & { variant?: Variant; tone?: 'ink' | 'muted' | 'faint' | 'accent' | 'bad' | 'good' | 'warn' }) {
  const p = usePalette();
  const color = { ink: p.ink, muted: p.ink2, faint: p.ink3, accent: p.accent, bad: p.bad, good: p.good, warn: p.warn }[tone];
  return <RNText {...rest} style={[SIZES[variant], { color, fontVariant: ['tabular-nums'] }, style]} />;
}

/**
 * Экран со свечением фирменных цветов в шапке. Внутри вкладок снизу
 * оставляем место под парящую стеклянную панель, чтобы она не закрывала контент.
 */
export function Screen({ children, refreshing, onRefresh, scroll = true, glow = true }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean; glow?: boolean }) {
  const p = usePalette();
  const tabSpace = useTabBarSpace();
  if (!scroll) return <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={['top']}>{children}</SafeAreaView>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: Math.max(40, tabSpace), gap: 16 }} scrollIndicatorInsets={{ bottom: tabSpace }} refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.ink3} /> : undefined}>
        {glow && <AmbientGlow />}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const p = usePalette();
  const base: ViewStyle = { backgroundColor: p.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: p.line, padding: 16, gap: 12 };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] }, style]}>
      {children}
    </Pressable>
  );
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, color }: { title: string; onPress: () => void; variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'; loading?: boolean; disabled?: boolean; icon?: ReactNode; style?: StyleProp<ViewStyle>; /** Цвет текста поверх своей подложки, например белый на градиенте. */ color?: string }) {
  const p = usePalette();
  const bg = { primary: p.ink, accent: p.accent, secondary: p.surface, ghost: 'transparent', danger: p.badSoft }[variant];
  const fg = color ?? { primary: p.bg, accent: p.accentInk, secondary: p.ink, ghost: p.ink2, danger: p.bad }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        { minHeight: 48, borderRadius: 999, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: p.line },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Text style={{ color: fg, fontFamily: font.semibold, fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Pill({ children, tone = 'neutral', dot }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  const p = usePalette();
  const c = toneColors(p, tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: c.bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
      {dot && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.fg }} />}
      <Text variant="caption" style={{ color: c.fg }}>
        {children}
      </Text>
    </View>
  );
}

const HUES = [228, 160, 28, 280, 340, 200, 100];
/** Аватар: фото, если человек его поставил, иначе инициалы на своём цвете. */
export function Avatar({ name, size = 28, id, uri }: { name: string; size?: number; id?: string | null; uri?: string | null }) {
  const hue = HUES[[...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % HUES.length]!;
  const scheme = usePalette().bg === '#0B0B0F';
  const found = useAvatarUri(id, name);
  const photo = uri ?? found;
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = !!photo && broken !== photo;
  return (
    <View accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: `hsl(${hue}, ${scheme ? '30%' : '70%'}, ${scheme ? '22%' : '92%'})` }}>
      {showPhoto ? (
        <Image source={{ uri: photo }} style={{ width: size, height: size }} onError={() => setBroken(photo)} accessibilityIgnoresInvertColors />
      ) : (
        <Text style={{ fontSize: size * 0.38, fontFamily: font.semibold, color: `hsl(${hue}, 55%, ${scheme ? '75%' : '32%'})` }}>{initials(name)}</Text>
      )}
    </View>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
      <Text variant="title" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {text && (
        <Text variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
          {text}
        </Text>
      )}
      {action}
    </View>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
      <Text variant="title">{title}</Text>
      {right}
    </View>
  );
}

export function Input({ label, error, hint, ...rest }: React.ComponentProps<typeof TextInput> & { label: string; error?: string | null; hint?: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="small" style={{ fontFamily: font.medium }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={p.ink3}
        {...rest}
        style={[{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: error ? p.bad : p.line, backgroundColor: p.surface, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 16, color: p.ink }, rest.multiline && { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' }, rest.style]}
      />
      {error ? (
        <Text variant="caption" tone="bad">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="faint">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Bar({ percent, color }: { percent: number; color?: string }) {
  const p = usePalette();
  return (
    <View style={{ height: 4, borderRadius: 4, backgroundColor: p.surface2, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: '100%', backgroundColor: color ?? p.ink }} />
    </View>
  );
}
