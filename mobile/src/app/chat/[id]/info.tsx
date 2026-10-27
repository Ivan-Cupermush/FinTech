import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Bell, BellOff, ChevronRight, Hash, IdCard, Images, LogOut, Pin, PinOff, Trash2, UserPlus } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { isMuted, lastSeenText, muteUntil, nameFor, MUTE_PRESETS, type ChatMember } from '@offix/core';
import { chatStatus, isOnline } from '../../../lib/chat-logic';
import { mediaLine } from '../../../lib/media';
import { chatApi, ck, useChat, useChatLive, useChatStats } from '../../../lib/chats';
import { useContactBook } from '../../../lib/personal-api';
import { useMe } from '../../../lib/queries';
import { font, usePalette } from '../../../lib/theme';
import { ChatAvatar } from '../../../ui/chats';
import { Avatar, Button, Card, Empty, Screen, Text } from '../../../ui/primitives';

const ROLE: Record<ChatMember['role'], string> = { creator: 'создатель', admin: 'администратор', member: '' };
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Не получилось');

/** Карточка чата: мои настройки, участники и их роли, темы, выход и удаление. */
export default function ChatInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const qc = useQueryClient();
  const me = useMe();
  const live = useChatLive();
  const book = useContactBook();
  const chat = useChat(id);
  const stats = useChatStats(id);
  const c = chat.data;
  const now = new Date().toISOString();

  if (!c) return <Screen>{chat.isError ? <Empty title="Чат не найден" text="Возможно, вас удалили из группы." /> : null}</Screen>;

  const group = c.type === 'group';
  const can = (perm: string) => c.my_rights.includes(perm as never);
  const muted = isMuted(c.muted_until, now);
  const iAmCreator = group && c.created_by === me.data?.id;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ck.detail(id) }), qc.invalidateQueries({ queryKey: ck.list })]);
  const act = (fn: () => Promise<unknown>) => void fn().then(refresh).catch((e) => Alert.alert('Не получилось', errText(e)));
  const leaveTo = (fn: () => Promise<unknown>) =>
    void fn()
      .then(() => {
        void qc.invalidateQueries({ queryKey: ck.list });
        router.dismissTo('/chats');
      })
      .catch((e) => Alert.alert('Не получилось', errText(e)));

  const mute = () =>
    muted
      ? act(() => chatApi.membership(id, { muted_until: null }))
      : Alert.alert('Без звука', undefined, [...MUTE_PRESETS.map((m) => ({ text: m.label, onPress: () => act(() => chatApi.membership(id, { muted_until: muteUntil(m.hours, new Date().toISOString()) })) })), { text: 'Отмена', style: 'cancel' as const }]);

  const memberActions = (m: ChatMember) => {
    const items = [
      ...(can('ban_users') && m.role !== 'creator'
        ? [
            {
              text: 'Исключить из группы',
              style: 'destructive' as const,
              onPress: () => act(() => chatApi.removeMember(id, m.id)),
            },
          ]
        : []),
    ];
    if (items.length) Alert.alert(m.display_name, undefined, [...items, { text: 'Отмена', style: 'cancel' as const }]);
  };

  const action = (label: string, icon: ReactNode, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 18, backgroundColor: pressed ? p.surface3 : p.surface2 })}>
      {icon}
      <Text variant="caption" style={{ fontFamily: font.medium }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Screen refreshing={chat.isRefetching} onRefresh={() => void chat.refetch()}>
      <Stack.Screen options={{ title: group ? (c.is_supergroup ? 'Группа с темами' : 'Группа') : 'Личный чат' }} />
      <View style={{ alignItems: 'center', gap: 8, paddingTop: 8 }}>
        <ChatAvatar title={c.title} group={group} online={!!c.peer && isOnline(live, c.peer)} size={96} userId={c.peer?.id} />
        <Text variant="h2" style={{ textAlign: 'center' }}>
          {c.title}
        </Text>
        <Text variant="small" tone="muted">
          {chatStatus(c, live, [], now)}
        </Text>
        {!group && c.peer?.contact_name && (
          <Text variant="small" tone="faint">
            {`Настоящее имя: ${c.peer.display_name}`}
          </Text>
        )}
        {!group && c.peer?.position && (
          <Text variant="small" tone="faint">
            {c.peer.position}
          </Text>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {action(muted ? 'Включить звук' : 'Без звука', muted ? <Bell size={20} color={p.ink} /> : <BellOff size={20} color={p.ink} />, mute)}
        {action(c.pinned ? 'Открепить' : 'Закрепить', c.pinned ? <PinOff size={20} color={p.ink} /> : <Pin size={20} color={p.ink} />, () => act(() => chatApi.membership(id, { pinned: !c.pinned })))}
        {!group && c.peer && action('Профиль', <IdCard size={20} color={p.ink} />, () => router.push(`/person/${c.peer!.id}`))}
        {group && can('add_users') && action('Добавить', <UserPlus size={20} color={p.ink} />, () => router.push({ pathname: '/chat/[id]/members', params: { id } }))}
      </View>

      <Card onPress={() => router.push({ pathname: '/chat/[id]/media', params: { id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Images size={20} color={p.ink2} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: font.semibold }}>Медиа и файлы</Text>
          <Text variant="small" tone="faint">
            {stats.data ? mediaLine(stats.data) : 'Фото, видео, документы, голосовые и ссылки'}
          </Text>
        </View>
        <ChevronRight size={18} color={p.ink3} />
      </Card>

      {group && c.can_manage_topics && !c.is_supergroup && (
        <Card>
          <Text style={{ fontFamily: font.semibold }}>Темы</Text>
          <Text variant="small" tone="muted">
            Разделите переписку на ветки: объявления, вопросы, проекты. Вся история окажется в теме «Общее».
          </Text>
          <Button
            title="Включить темы"
            variant="secondary"
            icon={<Hash size={16} color={p.ink} />}
            onPress={() =>
              Alert.alert('Включить темы?', 'Группа станет группой с темами. Новые темы смогут создавать создатель и администраторы.', [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Включить', onPress: () => act(() => chatApi.enableTopics(id)) },
              ])
            }
          />
        </Card>
      )}

      {group && (
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          <Text variant="eyebrow" tone="faint" style={{ paddingVertical: 8 }}>
            {`Участники · ${c.members_count}`}
          </Text>
          {c.members.map((m, i) => {
            const on = isOnline(live, m);
            return (
              <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.display_name}${ROLE[m.role] ? `, ${ROLE[m.role]}` : ''}`} onPress={() => memberActions(m)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: p.line, opacity: pressed ? 0.6 : 1 })}>
                <View>
                  <Avatar name={m.display_name} id={m.id} size={40} />
                  {on && <View style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: p.good, borderWidth: 2, borderColor: p.surface }} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: font.medium }}>
                    {nameFor(book, m.id, m.display_name)}
                    {m.id === me.data?.id ? ' (вы)' : ''}
                  </Text>
                  <Text variant="caption" tone={on ? 'accent' : 'faint'}>
                    {on ? 'в сети' : lastSeenText(false, live.lastSeen.get(m.id) ?? m.last_seen_at, now)}
                  </Text>
                </View>
                {ROLE[m.role] ? (
                  <Text variant="caption" tone="accent">
                    {ROLE[m.role]}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </Card>
      )}

      <View style={{ gap: 8 }}>
        {group && (
          <Button
            title="Выйти из группы"
            variant="secondary"
            icon={<LogOut size={16} color={p.ink} />}
            onPress={() =>
              Alert.alert('Выйти из группы?', iAmCreator ? 'Вы создатель: группа перейдёт администратору или самому давнему участнику.' : 'Вернуться можно будет, только если вас снова пригласят.', [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Выйти', style: 'destructive', onPress: () => leaveTo(() => chatApi.leave(id)) },
              ])
            }
          />
        )}
        {(!group || iAmCreator) && (
          <Button
            title={group ? 'Удалить группу' : 'Удалить чат'}
            variant="danger"
            icon={<Trash2 size={16} color={p.bad} />}
            onPress={() =>
              Alert.alert(group ? 'Удалить группу?' : 'Удалить чат?', group ? 'Группа и вся переписка исчезнут у всех участников.' : 'Переписка исчезнет у вас обоих.', [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Удалить', style: 'destructive', onPress: () => leaveTo(() => chatApi.remove(id)) },
              ])
            }
          />
        )}
      </View>
    </Screen>
  );
}
