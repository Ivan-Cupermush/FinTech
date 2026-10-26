import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { BellOff, MessagesSquare, Pin, Search, SquarePen } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { chatListTime, isMuted, muteUntil, type ChatSummary } from '@offix/core';
import { CHAT_FILTERS, chatsStats, filterChats, isOnline, rowPreview, type ChatFilter } from '../../lib/chat-logic';
import { chatApi, ck, typistNames, useChatLive, useChats } from '../../lib/chats';
import { useMe } from '../../lib/queries';
import { font, usePalette } from '../../lib/theme';
import { ChatAvatar, TypingDots } from '../../ui/chats';
import { Glass } from '../../ui/fx/Glass';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { PageHero } from '../../ui/fx/PageHero';
import { Card, Empty, NO_WEB_OUTLINE, Screen, Text } from '../../ui/primitives';

/** Действия с чатом по долгому касанию: закрепить, без звука, прочитать, скрыть. */
function chatActions(c: ChatSummary, now: string, refresh: () => void) {
  const muted = isMuted(c.muted_until, now);
  const run = (fn: () => Promise<unknown>) => () => void fn().then(refresh).catch((e: Error) => Alert.alert('Не получилось', e.message));
  const items = [
    { label: c.pinned ? 'Открепить' : 'Закрепить', run: run(() => chatApi.membership(c.id, { pinned: !c.pinned })) },
    muted ? { label: 'Включить звук', run: run(() => chatApi.membership(c.id, { muted_until: null })) } : { label: 'Без звука на сутки', run: run(() => chatApi.membership(c.id, { muted_until: muteUntil(24, new Date().toISOString()) })) },
    ...(muted ? [] : [{ label: 'Без звука навсегда', run: run(() => chatApi.membership(c.id, { muted_until: muteUntil(null, new Date().toISOString()) })) }]),
    ...(c.unread && !c.is_supergroup ? [{ label: 'Отметить прочитанным', run: run(() => chatApi.read(c.id, Number.MAX_SAFE_INTEGER, null)) }] : []),
    { label: 'Скрыть из списка', run: run(() => chatApi.membership(c.id, { hidden: true })) },
  ];
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ title: c.title, options: [...items.map((i) => i.label), 'Отмена'], cancelButtonIndex: items.length }, (i) => items[i]?.run());
  } else {
    Alert.alert(c.title, undefined, [...items.map((i) => ({ text: i.label, onPress: i.run })), { text: 'Отмена', style: 'cancel' as const }]);
  }
}

/**
 * Чаты на телефоне: живая шапка с цифрами, поиск, папки и список, где
 * сразу видно, кто печатает, что не прочитано и что без звука.
 */
export default function ChatsTab() {
  const p = usePalette();
  const qc = useQueryClient();
  const me = useMe();
  const live = useChatLive();
  const chats = useChats();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('all');
  const now = new Date().toISOString();
  const list = filterChats(chats.data ?? [], filter, q);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ck.list });
    void qc.invalidateQueries({ queryKey: ck.unread });
  };

  return (
    <Screen refreshing={chats.isRefetching} onRefresh={() => void chats.refetch()}>
      <PageHero
        variant="chats"
        icon={MessagesSquare}
        eyebrow="Мессенджер"
        title="Чаты"
        subtitle="Личные переписки, рабочие группы и темы"
        stats={chats.data ? chatsStats(chats.data, live.online, now) : undefined}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="Новый чат" onPress={() => router.push('/chat/new')} hitSlop={8}>
            <Glass radius={18} style={{ height: 36, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <SquarePen size={15} color="#fff" />
              <Text variant="caption" style={{ color: '#fff' }}>
                Новый
              </Text>
            </Glass>
          </Pressable>
        }
      />

      <Glass tone="surface" radius={16}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
          <Search size={18} color={p.ink3} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Поиск по чатам"
            placeholderTextColor={p.ink3}
            accessibilityLabel="Поиск по чатам"
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[{ flex: 1, minHeight: 48, fontFamily: font.regular, fontSize: 16, color: p.ink }, NO_WEB_OUTLINE]}
          />
        </View>
      </Glass>
      <LiquidSegmented label="Папки" value={filter} onChange={setFilter} options={CHAT_FILTERS} />

      {list.length ? (
        <Card style={{ gap: 0, paddingVertical: 4, paddingHorizontal: 8 }}>
          {list.map((c, i) => {
            const typists = typistNames(live, c.id, null);
            const preview = rowPreview(c, me.data?.id ?? '', typists);
            const muted = isMuted(c.muted_until, now);
            const online = c.peer ? isOnline(live, c.peer) : false;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`${c.title}${c.unread ? `, ${c.unread} непрочитанных` : ''}`}
                accessibilityHint="Долгое касание — действия с чатом"
                onPress={() => router.push({ pathname: c.is_supergroup ? '/chat/[id]/topics' : '/chat/[id]', params: { id: c.id } })}
                onLongPress={() => chatActions(c, now, refresh)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 18, backgroundColor: pressed ? p.surface2 : 'transparent' })}
              >
                {i > 0 && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 72, right: 8, height: StyleSheet.hairlineWidth, backgroundColor: p.line }} />}
                <ChatAvatar title={c.title} group={c.type === 'group'} online={online} size={52} userId={c.peer?.id} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 16 }}>
                      {c.title}
                    </Text>
                    {muted && <BellOff size={13} color={p.ink3} />}
                    {c.last_message && (
                      <Text variant="caption" style={{ color: c.unread && !muted ? p.accent : p.ink3 }}>
                        {chatListTime(c.last_message.created_at, now)}
                      </Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {preview.typing && <TypingDots color={p.accent} />}
                    <Text numberOfLines={1} variant="small" style={{ flex: 1, color: preview.typing ? p.accent : p.ink2 }}>
                      {preview.text}
                    </Text>
                    {c.unread ? (
                      <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: muted ? p.ink3 : p.accent }}>
                        <Text style={{ color: p.accentInk, fontSize: 12, fontFamily: font.bold }}>{c.unread > 99 ? '99+' : c.unread}</Text>
                      </View>
                    ) : (
                      c.pinned && <Pin size={14} color={p.ink3} />
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </Card>
      ) : (
        !chats.isLoading && (
          <Card>
            <Empty
              title={q || filter !== 'all' ? 'Ничего не нашлось' : 'Чатов пока нет'}
              text={q || filter !== 'all' ? 'Попробуйте другое слово или папку «Все».' : 'Напишите коллеге или соберите рабочую группу — переписка будет рядом с целями и задачами.'}
            />
          </Card>
        )
      )}
    </Screen>
  );
}
