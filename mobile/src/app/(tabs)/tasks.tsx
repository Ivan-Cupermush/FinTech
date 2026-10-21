import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { todayIso } from '@offix/core';
import { taskSections } from '../../lib/logic';
import { useTasks } from '../../lib/queries';
import { TaskRow } from '../../ui/domain';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { Card, Empty, Screen, Text } from '../../ui/primitives';

export default function Tasks() {
  const [mine, setMine] = useState(true);
  const q = useTasks(mine ? 'mine=1' : '');
  const today = todayIso();
  const sections = taskSections(q.data ?? [], today);
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text variant="h1">Задачи</Text>
      <LiquidSegmented
        label="Чьи задачи"
        value={mine}
        onChange={setMine}
        options={[
          { value: true, label: 'Мои' },
          { value: false, label: 'Все доступные' },
        ]}
      />
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
