import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { todayIso } from '@offix/core';
import { useGoals } from '../../lib/queries';
import { usePalette } from '../../lib/theme';
import { GoalTile } from '../../ui/domain';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { Card, Empty, Screen, Text } from '../../ui/primitives';

const TABS = [
  { key: 'active', label: 'В работе', filter: 'scope=top&status=active' },
  { key: 'mine', label: 'Мои', filter: 'owner=me' },
  { key: 'drafts', label: 'Черновики', filter: 'status=draft' },
] as const;

export default function Goals() {
  const p = usePalette();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('active');
  const q = useGoals(TABS.find((t) => t.key === tab)!.filter);
  const today = todayIso();
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="h1">Цели</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Новая цель" onPress={() => router.push('/goal/new')} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Plus size={20} color={p.bg} />
        </Pressable>
      </View>
      <LiquidSegmented label="Какие цели" value={tab} onChange={setTab} options={TABS.map((t) => ({ value: t.key, label: t.label }))} />
      {q.data?.length
        ? q.data.map((g) => <GoalTile key={g.id} goal={g} today={today} onPress={() => router.push(`/goal/${g.id}`)} />)
        : !q.isLoading && (
            <Card>
              <Empty title={tab === 'drafts' ? 'Черновиков нет' : 'Целей нет'} text="Создайте цель с измеримым результатом — например, «Сократить время согласования с 40 до 30 минут»." />
            </Card>
          )}
    </Screen>
  );
}
