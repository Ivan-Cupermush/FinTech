import { creditsFor, LICENSE_NAMES, licenseText } from '@offix/core';
import { ChevronDown, ExternalLink } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { font, usePalette } from '../lib/theme';
import { Text } from '../ui/primitives';

/** Благодарности и полные тексты лицензий — тот же список, что на сайте. */
export default function Licenses() {
  const p = usePalette();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}>
      <View style={{ gap: 8 }}>
        <Text variant="h1">Спасибо открытому коду</Text>
        <Text tone="muted">
          3D-знак и живой градиент сделаны на React Three Fiber и three.js — градиент в приложении написан по мотивам ShaderGradient. Ниже полный текст каждой лицензии.
        </Text>
      </View>
      <View style={{ backgroundColor: p.surface, borderRadius: 20, borderWidth: 1, borderColor: p.line }}>
        {creditsFor('mobile').map((c, i) => {
          const expanded = open === c.name;
          return (
            <View key={c.name} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: p.line }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setOpen(expanded ? null : c.name)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, opacity: pressed ? 0.7 : 1 })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: font.semibold }}>{c.name}</Text>
                  <Text variant="caption" tone="faint">
                    {c.role} · {LICENSE_NAMES[c.license]}
                  </Text>
                </View>
                <ChevronDown size={18} color={p.ink3} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
              </Pressable>
              {expanded && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
                  <Pressable onPress={() => void Linking.openURL(c.url)} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text variant="small" tone="accent">
                      {c.url.replace('https://', '')}
                    </Text>
                    <ExternalLink size={14} color={p.accent} />
                  </Pressable>
                  <Text variant="caption" tone="muted" selectable style={{ lineHeight: 17 }}>
                    {licenseText(c)}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
