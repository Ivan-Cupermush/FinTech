import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, View } from 'react-native';
import type { Notification } from '@offix/core';
import { pushCard, type PushPermission } from '../../lib/logic';
import { enablePush, pushPermission } from '../../lib/push';
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
      <PushCard />
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

/** Состояние push: включить по кнопке, открыть настройки телефона, если запрещено, или настроить темы. */
function PushCard() {
  const [perm, setPerm] = useState<PushPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const check = useCallback(() => void pushPermission().then(setPerm, () => setPerm('unsupported')), []);
  useEffect(() => {
    check();
    // Вернулся из настроек телефона — перечитываем разрешение.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, [check]);
  if (!perm) return null;
  const c = pushCard(perm);
  const act = async () => {
    if (c.action === 'configure') return router.push('/push-settings');
    if (c.action === 'settings') return void Linking.openSettings();
    setBusy(true);
    try {
      setPerm(await enablePush(api));
    } catch {
      check();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small" style={{ fontFamily: font.semibold }}>
          {c.title}
        </Text>
        <Text variant="small" tone="faint">
          {c.text}
        </Text>
      </View>
      {c.action && c.label && <Button title={c.label} variant={c.action === 'enable' ? 'primary' : 'secondary'} loading={busy} onPress={() => void act()} style={{ minHeight: 36, paddingHorizontal: 14 }} />}
    </Card>
  );
}
