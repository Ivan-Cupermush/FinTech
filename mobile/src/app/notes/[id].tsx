import { router, useLocalSearchParams } from 'expo-router';
import { Target } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { formatDate, todayIso } from '@offix/core';
import { useNote } from '../../lib/queries';
import { PageHero } from '../../ui/fx/PageHero';
import { Markdown } from '../../ui/markdown';
import { Button, Card, Empty, Screen, Text } from '../../ui/primitives';

/** Заметка: шапка с целью и автором, ниже — текст в тех же блоках, что на сайте. */
export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useNote(id);
  const n = q.data;
  const today = todayIso();

  if (q.isError) {
    return (
      <Screen>
        <Card>
          <Empty title="Заметка недоступна" text="Возможно, её удалили или у вас нет доступа к цели." action={<Button title="Повторить" variant="secondary" onPress={() => q.refetch()} />} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {n && (
        <>
          <PageHero
            variant="knowledge"
            compact
            eyebrow={n.goal_id ? 'Заметка цели' : 'Общая заметка'}
            title={n.title}
            subtitle={
              <View style={{ gap: 6 }}>
                {n.goal_id && n.goal_title && (
                  <Pressable accessibilityRole="link" onPress={() => router.push(`/goal/${n.goal_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} hitSlop={6}>
                    <Target size={14} color="#fff" />
                    <Text variant="small" style={{ color: '#fff', textDecorationLine: 'underline' }} numberOfLines={1}>
                      {n.goal_title}
                    </Text>
                  </Pressable>
                )}
                <Text variant="small" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  {n.author_name} · обновлено {formatDate(n.updated_at.slice(0, 10), { short: true, today })}
                  {n.updated_by_name && n.updated_by_name !== n.author_name ? `, ${n.updated_by_name}` : ''}
                </Text>
              </View>
            }
          />
          <Card style={{ padding: 18 }}>
            <Markdown source={n.body} />
          </Card>
          <Text variant="caption" tone="faint" style={{ textAlign: 'center' }}>
            Править заметку можно на сайте — там удобнее работать с текстом.
          </Text>
        </>
      )}
    </Screen>
  );
}
