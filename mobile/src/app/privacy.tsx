import { PRIVACY_SECTIONS, PRIVACY_TITLE, privacyDate } from '@offix/core';
import { ScrollView, View } from 'react-native';
import { font, usePalette } from '../lib/theme';
import { Text } from '../ui/primitives';

/** Политика обработки персональных данных — тот же текст, что на сайте. */
export default function Privacy() {
  const p = usePalette();
  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Text variant="h1">{PRIVACY_TITLE}</Text>
        <Text tone="faint" variant="small">
          Редакция от {privacyDate()}
        </Text>
      </View>
      {PRIVACY_SECTIONS.map((s, i) => (
        <View key={s.id} style={{ backgroundColor: p.surface, borderRadius: 20, borderWidth: 1, borderColor: p.line, padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="caption" style={{ color: '#fff', fontFamily: font.semibold }}>
                {i + 1}
              </Text>
            </View>
            <Text variant="title" style={{ flex: 1 }}>
              {s.title}
            </Text>
          </View>
          {s.paragraphs.map((t) => (
            <Text key={t} tone="muted" style={{ lineHeight: 21 }}>
              {t}
            </Text>
          ))}
          {s.list?.map((t) => (
            <View key={t} style={{ flexDirection: 'row', gap: 8 }}>
              <Text tone="accent">•</Text>
              <Text tone="muted" style={{ flex: 1, lineHeight: 21 }}>
                {t}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
