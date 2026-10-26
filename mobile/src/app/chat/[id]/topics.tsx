import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Lock, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { chatListTime, messagePreview, TOPIC_COLORS, TOPIC_ICONS, TOPIC_NAME_MAX, type ChatTopic } from '@offix/core';
import { chatApi, ck, useChat } from '../../../lib/chats';
import { useMe } from '../../../lib/queries';
import { font, usePalette } from '../../../lib/theme';
import { ChatAvatar } from '../../../ui/chats';
import { PageHero } from '../../../ui/fx/PageHero';
import { Button, Card, Empty, Input, Screen, Text } from '../../../ui/primitives';

/** Темы группы: общая сверху, у каждой — значок, цвет, последнее и непрочитанное. */
export default function TopicsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const qc = useQueryClient();
  const me = useMe();
  const chat = useChat(id);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(TOPIC_ICONS[0]);
  const [color, setColor] = useState<string>(TOPIC_COLORS[0]);
  const c = chat.data;
  const now = new Date().toISOString();
  const refresh = () => qc.invalidateQueries({ queryKey: ck.detail(id) });
  const open = (t: ChatTopic) => router.push({ pathname: '/chat/[id]', params: { id, topic: t.id } });

  const create = () =>
    void chatApi
      .createTopic(id, { name: name.trim(), icon, color })
      .then(() => {
        setCreating(false);
        setName('');
        return refresh();
      })
      .catch((e: Error) => Alert.alert('Тема не создана', e.message));

  const manage = (t: ChatTopic) => {
    if (!c?.can_manage_topics) return;
    Alert.alert(t.name, undefined, [
      { text: t.closed ? 'Открыть тему' : 'Закрыть тему', onPress: () => void chatApi.editTopic(id, t.id, { closed: !t.closed }).then(refresh).catch((e: Error) => Alert.alert('Не получилось', e.message)) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  return (
    <Screen refreshing={chat.isRefetching} onRefresh={() => void chat.refetch()}>
      <Stack.Screen options={{ title: c?.title ?? 'Темы' }} />
      {c && (
        <PageHero
          variant="chats"
          eyebrow="Группа с темами"
          title={c.title}
          subtitle={`${c.topics.length} тем · ${c.members_count} участников`}
          right={
            <Pressable accessibilityRole="button" accessibilityLabel="Информация о группе" onPress={() => router.push({ pathname: '/chat/[id]/info', params: { id } })}>
              <ChatAvatar title={c.title} group size={44} />
            </Pressable>
          }
        />
      )}
      {c?.topics.length ? (
        <Card style={{ gap: 0, paddingVertical: 4, paddingHorizontal: 8 }}>
          {c.topics.map((t, i) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`${t.name}${t.unread ? `, ${t.unread} непрочитанных` : ''}${t.closed ? ', закрыта' : ''}`}
              onPress={() => open(t)}
              onLongPress={() => manage(t)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 16, borderTopWidth: i ? 1 : 0, borderTopColor: p.line, backgroundColor: pressed ? p.surface2 : 'transparent' })}
            >
              <View style={{ width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: `${t.color}26`, borderWidth: 1, borderColor: `${t.color}55` }}>
                <Text style={{ fontSize: 22 }}>{t.icon}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold }}>
                    {t.name}
                  </Text>
                  {t.closed && <Lock size={13} color={p.ink3} />}
                  {t.last_message && (
                    <Text variant="caption" tone="faint">
                      {chatListTime(t.last_message.created_at, now)}
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text numberOfLines={1} variant="small" tone="muted" style={{ flex: 1 }}>
                    {t.last_message ? messagePreview(t.last_message, me.data?.id ?? '', true) : 'Пока без сообщений'}
                  </Text>
                  {t.unread > 0 && (
                    <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent }}>
                      <Text style={{ color: p.accentInk, fontSize: 12, fontFamily: font.bold }}>{t.unread}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          ))}
        </Card>
      ) : (
        !chat.isLoading && (
          <Card>
            <Empty title="Тем пока нет" />
          </Card>
        )
      )}

      {c?.can_manage_topics &&
        (creating ? (
          <Card>
            <Input label="Название темы" value={name} onChangeText={setName} maxLength={TOPIC_NAME_MAX} placeholder="Например, «Расписание»" autoFocus />
            <View accessibilityRole="radiogroup" accessibilityLabel="Значок темы" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {TOPIC_ICONS.map((x) => (
                <Pressable key={x} accessibilityRole="radio" accessibilityState={{ checked: icon === x }} accessibilityLabel={x} onPress={() => setIcon(x)} style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: icon === x ? p.accentSoft : p.surface2 }}>
                  <Text style={{ fontSize: 20 }}>{x}</Text>
                </Pressable>
              ))}
            </View>
            <View accessibilityRole="radiogroup" accessibilityLabel="Цвет темы" style={{ flexDirection: 'row', gap: 10 }}>
              {TOPIC_COLORS.map((x) => (
                <Pressable key={x} accessibilityRole="radio" accessibilityState={{ checked: color === x }} accessibilityLabel={x} onPress={() => setColor(x)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: x, borderWidth: 3, borderColor: color === x ? p.ink : 'transparent' }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Отмена" variant="ghost" onPress={() => setCreating(false)} style={{ flex: 1 }} />
              <Button title="Создать" variant="accent" disabled={!name.trim()} onPress={create} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <Button title="Новая тема" variant="secondary" icon={<Plus size={16} color={p.ink} />} onPress={() => setCreating(true)} />
        ))}
    </Screen>
  );
}
