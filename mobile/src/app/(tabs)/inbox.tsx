import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, View } from 'react-native';
import type { Notification } from '@offix/core';
import { Bell, CheckCheck, NotebookPen, Trash2 } from 'lucide-react-native';
import { inboxStats, pushCard, type PushPermission } from '../../lib/logic';
import { inboxTarget, requestOutcome } from '../../lib/personal';
import { myNotesApi } from '../../lib/personal-api';
import { enablePush, pushPermission } from '../../lib/push';
import { useNotifications } from '../../lib/queries';
import { api } from '../../lib/session';
import { font, usePalette } from '../../lib/theme';
import { Glass } from '../../ui/fx/Glass';
import { PageHero } from '../../ui/fx/PageHero';
import { KnowledgeLink } from '../../ui/notes';
import { Avatar, Button, Card, Empty, Screen, Text } from '../../ui/primitives';

export default function Inbox() {
  const p = usePalette();
  const q = useNotifications();
  const qc = useQueryClient();
  const unread = (q.data ?? []).filter((n) => !n.read_at);
  const read = async (ids?: string[]) => {
    await api('/notifications/read', { body: ids ? { ids } : {} });
    await Promise.all([qc.invalidateQueries({ queryKey: ['notifications'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
  };
  const [answering, setAnswering] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['notifications'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
  const open = (n: Notification) => {
    if (!n.read_at) void read([n.id]);
    const t = inboxTarget(n);
    if (t?.kind === 'route') router.push(t.path as never);
    else if (t?.kind === 'request') router.push(`/note-request/${t.id}`);
    else if (t?.kind === 'share') router.push(`/note-share/${t.id}`);
  };
  // Запрос заметки — ответить прямо из ленты, не открывая заметку.
  const answer = async (n: Notification, how: 'approve' | 'decline') => {
    const id = n.data?.request_id;
    if (!id) return;
    setAnswering(`${n.id}:${how}`);
    try {
      await (how === 'approve' ? myNotesApi.approve(id) : myNotesApi.decline(id));
      if (!n.read_at) await api('/notifications/read', { body: { ids: [n.id] } });
      await refresh();
    } catch (e) {
      Alert.alert('Не получилось', e instanceof Error ? e.message : '');
    } finally {
      setAnswering(null);
    }
  };
  const clearRead = () =>
    Alert.alert('Убрать прочитанные?', 'Непрочитанные останутся в ленте.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => void api('/notifications?read=1', { method: 'DELETE' }).then(refresh) },
    ]);
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <PageHero
        variant="inbox"
        icon={Bell}
        title="Входящие"
        subtitle={unread.length ? 'Сначала блокеры — там ждут вашего решения.' : 'Всё прочитано. Новое придёт сюда и push-уведомлением.'}
        stats={q.data ? inboxStats(q.data) : undefined}
        right={
          unread.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Прочитать все" onPress={() => void read()} hitSlop={8}>
              <Glass radius={18} style={{ height: 36, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <CheckCheck size={15} color="#fff" />
                <Text variant="caption" style={{ color: '#fff' }}>
                  Прочитать все
                </Text>
              </Glass>
            </Pressable>
          ) : undefined
        }
      />
      <PushCard />
      <KnowledgeLink />
      {(q.data ?? []).some((n) => n.read_at) && (
        <Pressable accessibilityRole="button" onPress={clearRead} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end' }} hitSlop={8}>
          <Trash2 size={14} color={p.ink3} />
          <Text variant="small" tone="faint">
            Убрать прочитанные
          </Text>
        </Pressable>
      )}
      {q.data?.length ? (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {q.data.map((n, i) => {
            const pending = n.kind === 'note_request' && n.request_status === 'pending';
            const outcome = n.kind === 'note_request' ? requestOutcome(n.request_status) : null;
            return (
              <View key={n.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: p.line }}>
                <Pressable accessibilityRole="button" onPress={() => open(n)} style={({ pressed }) => ({ flexDirection: 'row', gap: 10, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
                  {n.actor_id && n.actor_name ? (
                    <View style={{ width: 32, height: 32 }}>
                      <Avatar name={n.actor_name} id={n.actor_id} size={32} />
                      {n.kind.startsWith('note_request') && (
                        <View style={{ position: 'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface, borderWidth: 1, borderColor: p.line }}>
                          <NotebookPen size={10} color={p.accent} />
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: n.read_at ? 'transparent' : p.accent }} />
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontFamily: n.read_at ? font.regular : font.semibold }}>{n.title}</Text>
                    {n.body && (
                      <Text variant="small" tone="faint">
                        {n.body}
                      </Text>
                    )}
                    {outcome && (
                      <Text variant="caption" tone="faint">
                        {outcome}
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text variant="caption" tone="faint">
                      {new Date(n.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {n.actor_id && !n.read_at && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.accent }} />}
                  </View>
                </Pressable>
                {pending && (
                  <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 12, paddingLeft: 42 }}>
                    <Button title="Отказать" variant="secondary" style={{ flex: 1, minHeight: 38 }} loading={answering === `${n.id}:decline`} disabled={!!answering} onPress={() => void answer(n, 'decline')} />
                    <Button title="Поделиться" variant="accent" style={{ flex: 1, minHeight: 38 }} loading={answering === `${n.id}:approve`} disabled={!!answering} onPress={() => void answer(n, 'approve')} />
                  </View>
                )}
              </View>
            );
          })}
        </Card>
      ) : (
        !q.isLoading && (
          <Card>
            <Empty title="Уведомлений нет" text="Здесь появятся блокеры в вашей зоне, новые задачи, переносы сроков и запросы ваших заметок." />
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
