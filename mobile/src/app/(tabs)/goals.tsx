import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { todayIso } from '@offix/core';
import { useGoals } from '../../lib/queries';
import { font, usePalette } from '../../lib/theme';
import { GoalTile } from '../../ui/domain';
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
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: p.surface2, borderRadius: 999, padding: 3 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }} onPress={() => setTab(t.key)} style={{ flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center', backgroundColor: tab === t.key ? p.surface : 'transparent' }}>
            <Text variant="small" style={{ fontFamily: font.medium, color: tab === t.key ? p.ink : p.ink2 }}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
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
