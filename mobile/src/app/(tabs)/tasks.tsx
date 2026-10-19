import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { todayIso } from '@offix/core';
import { taskSections } from '../../lib/logic';
import { useTasks } from '../../lib/queries';
import { font, usePalette } from '../../lib/theme';
import { TaskRow } from '../../ui/domain';
import { Card, Empty, Screen, Text } from '../../ui/primitives';

export default function Tasks() {
  const p = usePalette();
  const [mine, setMine] = useState(true);
  const q = useTasks(mine ? 'mine=1' : '');
  const today = todayIso();
  const sections = taskSections(q.data ?? [], today);
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text variant="h1">Задачи</Text>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: p.surface2, borderRadius: 999, padding: 3 }}>
        {[
          { v: true, l: 'Мои' },
          { v: false, l: 'Все доступные' },
        ].map((t) => (
          <Pressable key={t.l} accessibilityRole="tab" accessibilityState={{ selected: mine === t.v }} onPress={() => setMine(t.v)} style={{ flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center', backgroundColor: mine === t.v ? p.surface : 'transparent' }}>
            <Text variant="small" style={{ fontFamily: font.medium, color: mine === t.v ? p.ink : p.ink2 }}>
              {t.l}
            </Text>
          </Pressable>
        ))}
      </View>
      {sections.length
        ? sections.map((s) => (
            <View key={s.key} style={{ gap: 8 }}>
              <Text variant="eyebrow" tone={s.key === 'blocked' ? 'bad' : s.key === 'overdue' ? 'warn' : 'faint'}>
                {s.title} · {s.data.length}
              </Text>
              <Card style={{ gap: 0, paddingVertical: 4 }}>
                {s.data.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} showAssignee={!mine} onPress={() => router.push(`/task/${t.id}`)} />
                ))}
              </Card>
            </View>
          ))
        : !q.isLoading && (
            <Card>
              <Empty title="Задач нет" text="Задачи появляются из дорожных карт целей." />
            </Card>
          )}
    </Screen>
  );
}
