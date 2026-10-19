import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { Notification } from '@offix/core';
import { useNotifications } from '../../lib/queries';
import { api } from '../../lib/session';
import { font, usePalette } from '../../lib/theme';
import { Button, Card, Empty, Screen, Text } from '../../ui/primitives';

export default function Inbox() {
  const p = usePalette();
  const q = useNotifications();
  const qc = useQueryClient();
  const unread = (q.data ?? []).filter((n) => !n.read_at);
  const read = async (ids?: string[]) => {
    await api('/notifications/read', { body: ids ? { ids } : {} });
    await Promise.all([qc.invalidateQueries({ queryKey: ['notifications'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
  };
  const open = (n: Notification) => {
    if (!n.read_at) void read([n.id]);
    if (n.task_id) router.push(`/task/${n.task_id}`);
    else if (n.goal_id) router.push(`/goal/${n.goal_id}`);
  };
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="h1">Входящие</Text>
        {unread.length > 0 && <Button title="Прочитать все" variant="ghost" onPress={() => void read()} style={{ minHeight: 36, paddingHorizontal: 8 }} />}
      </View>
      {q.data?.length ? (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {q.data.map((n, i) => (
            <Pressable key={n.id} accessibilityRole="button" onPress={() => open(n)} style={({ pressed }) => ({ flexDirection: 'row', gap: 10, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: p.line, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: n.read_at ? 'transparent' : p.accent }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: n.read_at ? font.regular : font.semibold }}>{n.title}</Text>
                {n.body && (
                  <Text variant="small" tone="faint">
                    {n.body}
                  </Text>
                )}
              </View>
              <Text variant="caption" tone="faint">
                {new Date(n.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : (
        !q.isLoading && (
          <Card>
            <Empty title="Уведомлений нет" text="Здесь появятся блокеры в вашей зоне, новые задачи и переносы сроков." />
          </Card>
        )
      )}
    </Screen>
  );
}
