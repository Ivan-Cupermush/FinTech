import { router, Stack, useLocalSearchParams } from 'expo-router';
import { BookOpen, Search, Target } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { NO_WEB_OUTLINE } from '../../ui/primitives';
import { todayIso } from '@offix/core';
import { noteMeta, notesEmpty, notesQuery, notesStats, type NotesScope } from '../../lib/notes';
import { useNotes } from '../../lib/queries';
import { font, usePalette } from '../../lib/theme';
import { Glass } from '../../ui/fx/Glass';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { PageHero } from '../../ui/fx/PageHero';
import { Button, Card, Empty, Screen, Text } from '../../ui/primitives';

/** Не дёргаем сервер на каждую букву. */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * База знаний на телефоне: регламенты, договорённости и решения — найти
 * и перечитать. С параметром goal — заметки одной цели (вход с экрана цели).
 */
export default function NotesScreen() {
  const params = useLocalSearchParams<{ goal?: string; goalTitle?: string }>();
  const goalId = params.goal || undefined;
  const p = usePalette();
  const today = todayIso();
  const [text, setText] = useState('');
  const [scope, setScope] = useState<NotesScope>('all');
  const q = useDebounced(text);
  const list = useNotes(notesQuery({ q, goalId, scope }));
  // Цифры шапки — по всей базе (или по цели), а не по результату поиска.
  const all = useNotes(notesQuery({ goalId }));
  const empty = notesEmpty({ q, goalId });

  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => void Promise.all([list.refetch(), all.refetch()])}>
      <Stack.Screen options={{ title: goalId ? 'Заметки цели' : 'База знаний' }} />
      <PageHero
        variant="knowledge"
        icon={BookOpen}
        eyebrow={goalId ? 'Заметки цели' : undefined}
        title={goalId ? params.goalTitle || 'Заметки' : 'База знаний'}
        subtitle={goalId ? 'Договорённости, решения и регламенты по этой цели.' : 'Регламенты, договорённости и решения — рядом с целями, а не в переписке.'}
        stats={all.data && !goalId ? notesStats(all.data, today) : undefined}
      />

      <Glass tone="surface" radius={16}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
          <Search size={18} color={p.ink3} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Найти по заголовку и тексту"
            placeholderTextColor={p.ink3}
            accessibilityLabel="Поиск по базе знаний"
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[{ flex: 1, minHeight: 48, fontFamily: font.regular, fontSize: 16, color: p.ink }, NO_WEB_OUTLINE]}
          />
        </View>
      </Glass>

      {!goalId && (
        <LiquidSegmented
          role="radio"
          label="Какие заметки"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all' as const, label: 'Все' },
            { value: 'company' as const, label: 'Общие' },
          ]}
        />
      )}

      {list.isError ? (
        <Card>
          <Empty title="Не удалось загрузить" text={(list.error as Error).message} action={<Button title="Повторить" variant="secondary" onPress={() => list.refetch()} />} />
        </Card>
      ) : list.data?.length ? (
        <View style={{ gap: 10 }}>
          {list.data.map((n) => (
            <Card key={n.id} onPress={() => router.push(`/notes/${n.id}`)} style={{ gap: 6 }}>
              <Text style={{ fontFamily: font.semibold }}>{n.title}</Text>
              {!!n.excerpt && (
                <Text variant="small" tone="muted" numberOfLines={3}>
                  {n.excerpt}
                </Text>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {n.goal_title && !goalId && <Target size={12} color={p.ink3} />}
                <Text variant="caption" tone="faint" numberOfLines={1} style={{ flex: 1 }}>
                  {noteMeta(n, today, !goalId)}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      ) : (
        !list.isLoading && (
          <Card>
            <Empty title={empty.title} text={empty.text} />
          </Card>
        )
      )}
    </Screen>
  );
}
