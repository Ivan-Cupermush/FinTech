import { Linking, Platform, Text as RNText, View } from 'react-native';
import { parseMarkdown, type Inline } from '@offix/core';
import { listMarker } from '../lib/notes';
import { font, radius, usePalette } from '../lib/theme';
import { Text } from './primitives';

const MONO = { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13 };

/** Кусочки строки — простым Text: так они наследуют размер и шрифт своего блока (заголовка, цитаты). */
function Inlines({ items }: { items: Inline[] }) {
  const p = usePalette();
  return (
    <>
      {items.map((i, k) => {
        switch (i.kind) {
          case 'bold':
            return (
              <RNText key={k} style={{ fontFamily: font.semibold }}>
                {i.text}
              </RNText>
            );
          case 'italic':
            return (
              <RNText key={k} style={{ fontStyle: 'italic' }}>
                {i.text}
              </RNText>
            );
          case 'code':
            return (
              <RNText key={k} style={[MONO, { backgroundColor: p.surface2 }]}>
                {` ${i.text} `}
              </RNText>
            );
          case 'link':
            return (
              <RNText key={k} accessibilityRole="link" style={{ color: p.accent, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(i.href)}>
                {i.text}
              </RNText>
            );
          default:
            return <RNText key={k}>{i.text}</RNText>;
        }
      })}
    </>
  );
}

const HEADING = { 1: { fontSize: 22, lineHeight: 27 }, 2: { fontSize: 18, lineHeight: 23 }, 3: { fontSize: 16, lineHeight: 21 } } as const;

/** Заметка в markdown: блоки разбирает ядро — те же, что на сайте, без вставки HTML. */
export function Markdown({ source }: { source: string }) {
  const p = usePalette();
  const blocks = parseMarkdown(source);
  if (!blocks.length) return <Text tone="faint">Пустая заметка.</Text>;
  return (
    <View style={{ gap: 12 }}>
      {blocks.map((b, k) => {
        switch (b.kind) {
          case 'heading':
            return (
              <Text key={k} accessibilityRole="header" style={[HEADING[b.level], { fontFamily: font.semibold, letterSpacing: -0.3, marginTop: k ? 6 : 0 }]}>
                <Inlines items={b.inline} />
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={k} style={{ lineHeight: 23 }}>
                <Inlines items={b.inline} />
              </Text>
            );
          case 'quote':
            return (
              <View key={k} style={{ borderLeftWidth: 3, borderLeftColor: p.accent, paddingLeft: 12 }}>
                <Text tone="muted" style={{ lineHeight: 22 }}>
                  <Inlines items={b.inline} />
                </Text>
              </View>
            );
          case 'code':
            return (
              <View key={k} style={{ backgroundColor: p.surface2, borderRadius: radius.sm, padding: 12 }}>
                <Text style={MONO}>{b.text}</Text>
              </View>
            );
          case 'rule':
            return <View key={k} style={{ height: 1, backgroundColor: p.line, marginVertical: 4 }} />;
          case 'list':
            return (
              <View key={k} style={{ gap: 6 }}>
                {b.items.map((it, j) => (
                  <View key={j} style={{ flexDirection: 'row', gap: 8 }}>
                    <Text tone="faint" style={{ minWidth: b.ordered ? 20 : 10 }}>
                      {listMarker(b.ordered, j)}
                    </Text>
                    <Text style={{ flex: 1, lineHeight: 22 }}>
                      <Inlines items={it} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'checklist':
            return (
              <View key={k} style={{ gap: 6 }}>
                {b.items.map((it, j) => (
                  <View key={j} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <View
                      accessible
                      accessibilityRole="image"
                      accessibilityLabel={it.done ? 'Сделано' : 'Не сделано'}
                      style={{ width: 18, height: 18, marginTop: 2, borderRadius: 5, borderWidth: 1.5, borderColor: it.done ? p.good : p.ink3, backgroundColor: it.done ? p.good : 'transparent', alignItems: 'center', justifyContent: 'center' }}
                    >
                      {it.done && <Text style={{ color: '#fff', fontSize: 11, lineHeight: 13 }}>✓</Text>}
                    </View>
                    <Text tone={it.done ? 'faint' : 'ink'} style={{ flex: 1, lineHeight: 22, textDecorationLine: it.done ? 'line-through' : 'none' }}>
                      <Inlines items={it.inline} />
                    </Text>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}
