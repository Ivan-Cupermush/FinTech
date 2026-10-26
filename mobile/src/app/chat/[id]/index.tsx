import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowUp, ChevronLeft, CornerUpLeft, Info, Pencil, PinOff, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildFeed, canEditMessage, MESSAGE_MAX, REACTIONS, typingText, type ChatHistory, type ChatMessage, type FeedItem } from '@offix/core';
import { chatStatus, isOnline, nextReaction } from '../../../lib/chat-logic';
import { chatApi, ck, loadOlder, patchHistory, sendMessage, typistNames, useChat, useChatLive, useHistory, usePinned } from '../../../lib/chats';
import { useMe } from '../../../lib/queries';
import { font } from '../../../lib/theme';
import { Bubble, ChatAvatar, TypingDots, useWall, Wallpaper, WallPill } from '../../../ui/chats';
import { Glass } from '../../../ui/fx/Glass';
import { NO_WEB_OUTLINE, Text } from '../../../ui/primitives';

type Mode = { kind: 'reply' | 'edit'; message: ChatMessage } | null;

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Не получилось, попробуйте ещё раз');

/**
 * Переписка на телефоне: обои из живого градиента, стеклянные шапка и поле
 * ввода, пузыри с ответами, реакциями и опросами. Касание пузыря — действия,
 * долгое касание — реакция.
 */
export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string; topic?: string }>();
  const chatId = params.id;
  const topicId = params.topic || null;
  const chat = useChat(chatId);
  const history = useHistory(chatId, topicId);
  const pinned = usePinned(chatId, topicId);
  const me = useMe();
  const live = useChatLive();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const w = useWall();
  const list = useRef<FlatList<FeedItem<ChatMessage>>>(null);
  const readMark = useRef<number | null>(null);
  const sentRead = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>(null);
  const [reactFor, setReactFor] = useState<ChatMessage | null>(null);
  const meId = me.data?.id ?? '';
  const now = new Date().toISOString();

  const c = chat.data;
  const topic = c?.topics.find((t) => t.id === topicId) ?? null;
  const data = history.data;
  if (readMark.current === null && data) readMark.current = data.my_last_read_seq;
  const messages = useMemo(() => data?.messages ?? [], [data]);
  // Перевёрнутый список: новое внизу и прокрутка к концу — бесплатно.
  const items = useMemo(() => buildFeed(messages, { now, lastReadSeq: readMark.current, meId }).reverse(), [messages, meId]); // eslint-disable-line react-hooks/exhaustive-deps
  const typists = typistNames(live, chatId, topicId);

  // Прочитано, когда конец ленты на экране.
  useEffect(() => {
    const last = [...messages].reverse().find((m) => !m.id.startsWith('local-'));
    if (!last || !atBottom || data?.has_after) return;
    if (last.seq <= Math.max(sentRead.current, data?.my_last_read_seq ?? 0)) return;
    sentRead.current = last.seq;
    chatApi
      .read(chatId, last.seq, topicId)
      .then((r) => {
        qc.setQueryData(ck.unread, { unread: r.unread });
        void qc.invalidateQueries({ queryKey: ck.list });
        if (c?.is_supergroup) void qc.invalidateQueries({ queryKey: ck.detail(chatId) });
      })
      .catch(() => (sentRead.current = 0));
  }, [messages, atBottom, chatId, topicId, qc, data?.has_after, data?.my_last_read_seq, c?.is_supergroup]);

  const patch = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => patchHistory(qc, chatId, (h: ChatHistory) => ({ ...h, messages: h.messages.map((m) => (m.id === id ? fn(m) : m)) })), [qc, chatId]);

  const react = useCallback(
    (m: ChatMessage, emoji: string) => {
      setReactFor(null);
      chatApi
        .react(m.id, nextReaction(m.reactions, emoji))
        .then((reactions) => patch(m.id, (x) => ({ ...x, reactions })))
        .catch((e) => Alert.alert('Реакция не поставилась', errText(e)));
    },
    [patch],
  );

  const can = (perm: string) => !!c?.my_rights.includes(perm as never);

  const removeMessage = (m: ChatMessage) => {
    const mine = m.sender_id === meId;
    const forAll = mine || (c?.type === 'group' && can('delete_messages'));
    const drop = (how: 'me' | 'all') =>
      chatApi
        .deleteMany([m.id], how)
        .then(() => patchHistory(qc, chatId, (h) => ({ ...h, messages: h.messages.filter((x) => x.id !== m.id) })))
        .catch((e) => Alert.alert('Не удалось удалить', errText(e)));
    Alert.alert('Удалить сообщение?', undefined, [
      { text: 'Только у меня', onPress: () => void drop('me') },
      ...(forAll ? [{ text: c?.type === 'group' ? 'У всех' : 'У обоих', style: 'destructive' as const, onPress: () => void drop('all') }] : []),
      { text: 'Отмена', style: 'cancel' as const },
    ]);
  };

  const openActions = useCallback(
    (m: ChatMessage) => {
      if (m.id.startsWith('local-')) return;
      const items: { label: string; run: () => void; danger?: boolean }[] = [
        { label: 'Ответить', run: () => setMode({ kind: 'reply', message: m }) },
        { label: 'Реакция…', run: () => setReactFor(m) },
        ...(can('pin_messages')
          ? [
              {
                label: m.pinned ? 'Открепить' : 'Закрепить',
                run: () =>
                  void chatApi
                    .pin(m.id, !m.pinned)
                    .then((x) => {
                      patch(m.id, () => x);
                      void qc.invalidateQueries({ queryKey: ck.pinned(chatId, topicId) });
                    })
                    .catch((e) => Alert.alert('Не получилось', errText(e))),
              },
            ]
          : []),
        ...(canEditMessage(m, meId, new Date().toISOString())
          ? [
              {
                label: 'Изменить',
                run: () => {
                  setMode({ kind: 'edit', message: m });
                  setText(m.text ?? '');
                },
              },
            ]
          : []),
        { label: 'Удалить', danger: true, run: () => removeMessage(m) },
      ];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options: [...items.map((i) => i.label), 'Отмена'], cancelButtonIndex: items.length, destructiveButtonIndex: items.findIndex((i) => i.danger) },
          (i) => items[i]?.run(),
        );
      } else {
        Alert.alert('Сообщение', undefined, [...items.map((i) => ({ text: i.label, onPress: i.run, style: i.danger ? ('destructive' as const) : undefined })), { text: 'Отмена', style: 'cancel' as const }]);
      }
    },
    [meId, patch, qc, chatId, topicId, c], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const vote = useCallback(
    (m: ChatMessage, optionId: string) =>
      void chatApi
        .vote(m.id, [optionId])
        .then((poll) => patch(m.id, (x) => ({ ...x, poll })))
        .catch((e) => Alert.alert('Голос не принят', errText(e))),
    [patch],
  );

  const jump = useCallback(
    (id: string) => {
      const index = items.findIndex((it) => it.type === 'message' && it.message.id === id);
      if (index >= 0) list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    },
    [items],
  );

  const retry = useCallback(
    (m: ChatMessage) => {
      patchHistory(qc, chatId, (h) => ({ ...h, messages: h.messages.filter((x) => x.id !== m.id) }));
      void sendMessage(qc, { chatId, topicId, me: { id: meId, name: me.data?.display_name ?? '' }, text: m.text ?? '', clientId: m.client_id ?? undefined }).catch(() => undefined);
    },
    [qc, chatId, topicId, meId, me.data?.display_name],
  );

  const tooLong = text.trim().length > MESSAGE_MAX;
  const canSend = !!text.trim() && !tooLong;
  const submit = () => {
    const t = text.trim();
    if (!canSend) return;
    const m = mode;
    setMode(null);
    setText('');
    live.sendTyping(chatId, topicId, true);
    if (m?.kind === 'edit') {
      void chatApi
        .edit(m.message.id, t)
        .then((x) => patch(x.id, () => x))
        .catch((e) => Alert.alert('Не удалось изменить', errText(e)));
      return;
    }
    void sendMessage(qc, { chatId, topicId, me: { id: meId, name: me.data?.display_name ?? '' }, text: t, replyTo: m?.kind === 'reply' ? m.message : null }).catch(() => undefined);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  if (c?.is_supergroup && !topicId) return <Redirect href={{ pathname: '/chat/[id]/topics', params: { id: chatId } }} />;

  const group = c?.type === 'group';
  const status = c ? chatStatus(c, live, typists, now) : '';
  const pin = pinned.data?.[0];
  const closed = !!topic?.closed && !c?.can_manage_topics;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Wallpaper />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 10, gap: 8, zIndex: 2 }}>
          <Glass tone="surface" radius={24}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={topic ? 'К темам' : 'Назад'} onPress={() => (router.canGoBack() ? router.back() : topic ? router.replace({ pathname: '/chat/[id]/topics', params: { id: chatId } }) : router.replace('/chats'))} hitSlop={8} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                <ChevronLeft size={24} color={w.ink} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`${topic?.name ?? c?.title ?? 'Чат'}: информация о чате`} onPress={() => router.push({ pathname: '/chat/[id]/info', params: { id: chatId } })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {c && <ChatAvatar title={c.title} group={!!group} online={!!c.peer && isOnline(live, c.peer)} size={40} icon={topic?.icon} />}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: w.ink, fontFamily: font.semibold, fontSize: 16 }}>
                    {topic?.name ?? c?.title ?? ' '}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {typists.length > 0 && <TypingDots color="#3b5bff" />}
                    <Text numberOfLines={1} style={{ color: typists.length ? '#3b5bff' : w.inkSoft, fontSize: 13 }}>
                      {topic ? c?.title : status}
                    </Text>
                  </View>
                </View>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Информация" onPress={() => router.push({ pathname: '/chat/[id]/info', params: { id: chatId } })} hitSlop={8} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                <Info size={20} color={w.ink} />
              </Pressable>
            </View>
          </Glass>
          {pin && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Закреплённое сообщение: ${pin.text ?? ''}`} onPress={() => jump(pin.id)}>
              <Glass tone="surface" radius={18}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12 }}>
                  <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: '#3b5bff' }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#3b5bff', fontFamily: font.semibold, fontSize: 12.5 }}>Закреплённое сообщение</Text>
                    <Text numberOfLines={1} style={{ color: w.ink, fontSize: 14 }}>
                      {pin.poll ? `📊 ${pin.poll.question}` : pin.text}
                    </Text>
                  </View>
                  {can('pin_messages') && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Открепить"
                      hitSlop={8}
                      onPress={() =>
                        void chatApi
                          .pin(pin.id, false)
                          .then((x) => {
                            patch(x.id, () => x);
                            void qc.invalidateQueries({ queryKey: ck.pinned(chatId, topicId) });
                          })
                          .catch((e) => Alert.alert('Не получилось', errText(e)))
                      }
                    >
                      <PinOff size={18} color={w.inkSoft} />
                    </Pressable>
                  )}
                </View>
              </Glass>
            </Pressable>
          )}
        </View>

        {chat.isError ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <WallPill text="Чат не найден — возможно, вас удалили из группы" />
          </View>
        ) : (
          <FlatList
            ref={list}
            inverted
            data={items}
            keyExtractor={(it) => it.key}
            contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 10 }}
            onScroll={(e) => setAtBottom(e.nativeEvent.contentOffset.y < 80)}
            scrollEventThrottle={64}
            onEndReachedThreshold={0.3}
            onEndReached={() => void loadOlder(qc, chatId, topicId).catch(() => undefined)}
            onScrollToIndexFailed={() => undefined}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={history.isLoading ? <ActivityIndicator style={{ marginTop: 40 }} color={w.ink} /> : <WallPill text={group ? 'Начало группы — напишите первым' : 'Начало переписки'} />}
            ListHeaderComponent={
              typists.length > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: w.pill }}>
                  <TypingDots color={w.inkSoft} />
                  <Text style={{ color: w.inkSoft, fontSize: 13 }}>{typingText(typists, !!group)}</Text>
                </View>
              ) : undefined
            }
            renderItem={({ item }) =>
              item.type === 'day' ? (
                <WallPill text={item.label} />
              ) : item.type === 'new' ? (
                <WallPill text="Новые сообщения" accent />
              ) : (
                <Bubble m={item.message} mine={item.message.sender_id === meId} group={!!group} first={item.first} last={item.last} onPress={openActions} onLongPress={setReactFor} onReact={react} onJump={jump} onVote={vote} onRetry={retry} />
              )
            }
          />
        )}

        {closed ? (
          <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 12) }}>
            <WallPill text="Тема закрыта — писать в ней могут администраторы" />
          </View>
        ) : (
          <View style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10), gap: 6 }}>
            {mode && (
              <Glass tone="surface" radius={16}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12 }}>
                  {mode.kind === 'edit' ? <Pencil size={16} color="#3b5bff" /> : <CornerUpLeft size={16} color="#3b5bff" />}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#3b5bff', fontFamily: font.semibold, fontSize: 13 }}>{mode.kind === 'edit' ? 'Изменение сообщения' : `Ответ · ${mode.message.sender_name ?? 'удалённый аккаунт'}`}</Text>
                    <Text numberOfLines={1} style={{ color: w.inkSoft, fontSize: 13 }}>
                      {mode.message.poll ? `📊 ${mode.message.poll.question}` : mode.message.text}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Отменить"
                    hitSlop={8}
                    onPress={() => {
                      if (mode.kind === 'edit') setText('');
                      setMode(null);
                    }}
                  >
                    <X size={18} color={w.inkSoft} />
                  </Pressable>
                </View>
              </Glass>
            )}
            <Glass tone="surface" radius={26}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 6, paddingLeft: 16 }}>
                <TextInput
                  value={text}
                  onChangeText={(v) => {
                    setText(v);
                    if (mode?.kind !== 'edit') live.sendTyping(chatId, topicId, !v.trim());
                  }}
                  placeholder={topic ? `Сообщение в «${topic.name}»` : 'Сообщение'}
                  placeholderTextColor={w.inkSoft}
                  multiline
                  // В веб-сборке многострочное поле по умолчанию в несколько строк — начинаем с одной.
                  numberOfLines={Platform.OS === 'web' ? 1 : undefined}
                  accessibilityLabel="Сообщение"
                  style={[{ flex: 1, minHeight: 40, maxHeight: 140, paddingTop: 10, paddingBottom: 10, color: w.ink, fontFamily: font.regular, fontSize: 16, textAlignVertical: 'top' }, NO_WEB_OUTLINE]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={mode?.kind === 'edit' ? 'Сохранить' : 'Отправить'}
                  accessibilityState={{ disabled: !canSend }}
                  disabled={!canSend}
                  onPress={submit}
                  style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? '#3b5bff' : 'rgba(127,127,160,0.3)', transform: [{ scale: pressed ? 0.92 : 1 }] })}
                >
                  <ArrowUp size={20} color="#fff" strokeWidth={2.4} />
                </Pressable>
              </View>
            </Glass>
            {tooLong && <Text style={{ color: '#e0464c', fontSize: 12, textAlign: 'right' }}>{`${text.trim().length}/${MESSAGE_MAX}`}</Text>}
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={!!reactFor} transparent animationType="fade" onRequestClose={() => setReactFor(null)}>
        <Pressable accessibilityLabel="Закрыть" style={{ flex: 1, backgroundColor: 'rgba(5,8,30,0.35)', justifyContent: 'center', padding: 20 }} onPress={() => setReactFor(null)}>
          <Glass tone="surface" radius={28}>
            <View accessibilityRole="menu" accessibilityLabel="Реакции" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4, padding: 10 }}>
              {REACTIONS.map((e) => {
                const mine = reactFor?.reactions.find((r) => r.mine)?.emoji === e;
                return (
                  <Pressable key={e} accessibilityRole="button" accessibilityLabel={`Реакция ${e}`} onPress={() => reactFor && react(reactFor, e)} style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? 'rgba(59,91,255,0.25)' : 'transparent', transform: [{ scale: pressed ? 1.25 : 1 }] })}>
                    <Text style={{ fontSize: 28 }}>{e}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Glass>
        </Pressable>
      </Modal>
    </View>
  );
}
