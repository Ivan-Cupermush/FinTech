import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowUp, CalendarClock, ChevronLeft, CornerDownRight, CornerUpLeft, Forward, Info, MessagesSquare, Mic, Paperclip, Pencil, Pin, PinOff, SmilePlus, Trash2, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildFeed, canEditMessage, MESSAGE_MAX, messageBody, REACTIONS, renameSenders, typingText, type Attachment, type ChatHistory, type ChatMessage, type ContactCard, type FeedItem } from '@offix/core';
import { chatStatus, isOnline, nextReaction, type ExternalReply } from '../../../lib/chat-logic';
import { chatApi, ck, loadOlder, patchHistory, pendingExternal, sendMessage, typistNames, useChat, useChatLive, useHistory, usePinned, useScheduled } from '../../../lib/chats';
import { forwardable, forwardTitle, scheduleLabel } from '../../../lib/compose';
import { uploadPicked } from '../../../lib/files';
import { uploadFields, viewerItems, type PickedFile, type ViewerItem } from '../../../lib/media';
import { useContactBook } from '../../../lib/personal-api';
import { useMe } from '../../../lib/queries';
import { font } from '../../../lib/theme';
import { AttachMenu, ContactSheet, SendSheet } from '../../../ui/attach';
import { ActionsSheet, ChatPickSheet, PollSheet, ScheduledSheet, ScheduleSheet, VotersSheet, type SheetAction } from '../../../ui/chat-sheets';
import { Bubble, ChatAvatar, TypingDots, useWall, Wallpaper, WallPill } from '../../../ui/chats';
import { VideoNoteRecorder, VoiceRecorderBar, type Recording } from '../../../ui/recorder';
import { MediaViewer } from '../../../ui/viewer';
import { Glass } from '../../../ui/fx/Glass';
import { NO_WEB_OUTLINE, Text } from '../../../ui/primitives';

type Mode = { kind: 'reply' | 'edit'; message: ChatMessage } | ({ kind: 'external' } & ExternalReply) | null;

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
  const [sheet, setSheet] = useState<
    | { kind: 'menu' }
    | { kind: 'send'; files: PickedFile[]; asFile: boolean }
    | { kind: 'contact' }
    | { kind: 'note' }
    | { kind: 'viewer'; items: ViewerItem[]; index: number }
    | { kind: 'poll' }
    | { kind: 'schedule'; text: string }
    | { kind: 'scheduled' }
    | { kind: 'forward'; ids: string[] }
    | { kind: 'external'; message: ChatMessage }
    | { kind: 'voters'; message: ChatMessage }
    | { kind: 'actions'; message: ChatMessage; items: SheetAction[] }
    | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const scheduled = useScheduled(chatId);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const meId = me.data?.id ?? '';
  const now = new Date().toISOString();

  const c = chat.data;
  const topic = c?.topics.find((t) => t.id === topicId) ?? null;

  // Пришли сюда из «Ответить в другом чате» — цитата уже ждёт в поле ввода.
  useEffect(() => {
    const x = pendingExternal.get(chatId);
    if (!x) return;
    pendingExternal.delete(chatId);
    setMode({ kind: 'external', ...x });
  }, [chatId]);

  // Подсказка на обоях гаснет сама.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);
  const data = history.data;
  if (readMark.current === null && data) readMark.current = data.my_last_read_seq;
  // Подписи отправителей и цитат — моими именами для коллег.
  const book = useContactBook();
  const messages = useMemo(() => renameSenders(data?.messages ?? [], book), [data, book]);
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
      const items: SheetAction[] = [
        { label: 'Ответить', icon: CornerUpLeft, run: () => setMode({ kind: 'reply', message: m }) },
        { label: 'Реакция…', icon: SmilePlus, run: () => setReactFor(m) },
        ...(can('pin_messages')
          ? [
              {
                label: m.pinned ? 'Открепить' : 'Закрепить',
                icon: m.pinned ? PinOff : Pin,
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
        ...(forwardable(m)
          ? [
              { label: 'Переслать', icon: Forward, run: () => setSheet({ kind: 'forward', ids: [m.id] }) },
              { label: 'Ответить в другом чате', icon: MessagesSquare, run: () => setSheet({ kind: 'external', message: m }) },
            ]
          : []),
        ...(canEditMessage(m, meId, new Date().toISOString())
          ? [
              {
                label: 'Изменить',
                icon: Pencil,
                run: () => {
                  setMode({ kind: 'edit', message: m });
                  setText(m.text ?? '');
                },
              },
            ]
          : []),
        { label: 'Удалить', icon: Trash2, danger: true, run: () => removeMessage(m) },
      ];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options: [...items.map((i) => i.label), 'Отмена'], cancelButtonIndex: items.length, destructiveButtonIndex: items.findIndex((i) => i.danger) },
          (i) => items[i]?.run(),
        );
      } else setSheet({ kind: 'actions', message: m, items });
    },
    [meId, patch, qc, chatId, topicId, c], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const vote = useCallback(
    (m: ChatMessage, optionIds: string[]) =>
      void chatApi
        .vote(m.id, optionIds)
        .then((poll) => patch(m.id, (x) => ({ ...x, poll })))
        .catch((e) => Alert.alert('Голос не принят', errText(e))),
    [patch],
  );

  const pollAction = useCallback(
    (m: ChatMessage, a: 'unvote' | 'voters' | 'close') => {
      if (a === 'voters') return setSheet({ kind: 'voters', message: m });
      const run = (fn: () => Promise<ChatMessage['poll']>) =>
        void fn()
          .then((poll) => patch(m.id, (x) => ({ ...x, poll })))
          .catch((e) => Alert.alert('Не получилось', errText(e)));
      if (a === 'unvote') return run(() => chatApi.unvote(m.id));
      Alert.alert('Закрыть опрос?', 'Голосовать больше будет нельзя, итоги увидят все.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Закрыть', style: 'destructive', onPress: () => run(() => chatApi.closePoll(m.id)) },
      ]);
    },
    [patch],
  );

  const openExternal = useCallback((id: string) => (id === chatId ? undefined : router.push({ pathname: '/chat/[id]', params: { id } })), [chatId]);

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
      void sendMessage(qc, { chatId, topicId, me: { id: meId, name: me.data?.display_name ?? '' }, text: m.text ?? '', clientId: m.client_id ?? undefined, attachments: m.attachments, contact: m.contact }).catch(() => undefined);
    },
    [qc, chatId, topicId, meId, me.data?.display_name],
  );

  const openMedia = useCallback((m: ChatMessage, index: number) => setSheet({ kind: 'viewer', ...viewerItems(qc.getQueryData<ChatHistory>(ck.history(chatId, topicId))?.messages ?? [], m.id, index) }), [qc, chatId, topicId]);

  const listen = useCallback(
    (m: ChatMessage) => {
      patch(m.id, (x) => ({ ...x, listened: true }));
      void chatApi.listen(m.id).catch(() => undefined);
    },
    [patch],
  );

  const openNote = useCallback((m: ChatMessage) => m.note && router.push(`/note-share/${m.note.id}`), []);
  const writeTo = useCallback(
    (c: ContactCard) =>
      void chatApi
        .direct(c.id)
        .then((x) => router.push({ pathname: '/chat/[id]', params: { id: x.id } }))
        .catch((e) => Alert.alert('Чат не открылся', errText(e))),
    [],
  );

  const who = { id: meId, name: me.data?.display_name ?? '' };
  const takeReply = () => {
    const r = mode?.kind === 'reply' ? mode.message : null;
    if (r) setMode(null);
    return r;
  };
  const takeExternal = (): ExternalReply | null => {
    if (mode?.kind !== 'external') return null;
    setMode(null);
    return { message: mode.message, chatTitle: mode.chatTitle };
  };

  /** Альбомы по 10: ответ — у первого, подпись — у последнего. */
  const sendBatches = async (batches: { attachments: Attachment[]; caption: string }[]) => {
    setSheet(null);
    let replyTo = takeReply();
    let externalReply = takeExternal();
    list.current?.scrollToOffset({ offset: 0, animated: true });
    for (const b of batches) {
      await sendMessage(qc, { chatId, topicId, me: who, text: b.caption, attachments: b.attachments, replyTo, externalReply }).catch(() => undefined);
      replyTo = null;
      externalReply = null;
    }
  };

  /** Голосовое и кружочек: сначала файл, потом сообщение. */
  const sendRecording = async (kind: 'voice' | 'video_note', r: Recording) => {
    setRecording(false);
    setSheet(null);
    const what = kind === 'voice' ? 'голосовое' : 'кружочек';
    setBusy(`Отправляем ${what}…`);
    try {
      const att = await uploadPicked(r.file, { fields: uploadFields({ kind, duration: r.duration, waveform: r.waveform }), onProgress: (p) => setBusy(`Отправляем ${what}… ${Math.round(p * 100)}%`) });
      await sendMessage(qc, { chatId, topicId, me: who, text: '', attachments: [att], replyTo: takeReply() });
      list.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (e) {
      Alert.alert(kind === 'voice' ? 'Голосовое не отправилось' : 'Кружочек не отправился', errText(e));
    } finally {
      setBusy(null);
    }
  };

  const sendContact = (u: { id: string; display_name: string; position: string | null }) => {
    setSheet(null);
    void sendMessage(qc, { chatId, topicId, me: who, text: '', contact: { id: u.id, display_name: u.display_name, position: u.position, avatar_url: null }, replyTo: takeReply() }).catch(() => undefined);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const tooLong = text.trim().length > MESSAGE_MAX;
  const captionOnly = mode?.kind === 'edit' && mode.message.attachments.length > 0;
  const canSend = (!!text.trim() || captionOnly) && !tooLong;
  const canRecord = !text.trim() && mode?.kind !== 'edit';
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
    void sendMessage(qc, { chatId, topicId, me: { id: meId, name: me.data?.display_name ?? '' }, text: t, replyTo: m?.kind === 'reply' ? m.message : null, externalReply: m?.kind === 'external' ? { message: m.message, chatTitle: m.chatTitle } : null }).catch(() => undefined);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  /** Долгое касание «Отправить» — как в привычных мессенджерах: отправить позже. */
  const scheduleCurrent = () => {
    if (mode?.kind === 'edit') return;
    setSheet({ kind: 'schedule', text: text.trim() });
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
                {c && <ChatAvatar title={c.title} group={!!group} online={!!c.peer && isOnline(live, c.peer)} size={40} icon={topic?.icon} userId={c.peer?.id} />}
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
            <Pressable accessibilityRole="button" accessibilityLabel={`Закреплённое сообщение: ${messageBody(pin)}`} onPress={() => jump(pin.id)}>
              <Glass tone="surface" radius={18}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12 }}>
                  <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: '#3b5bff' }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#3b5bff', fontFamily: font.semibold, fontSize: 12.5 }}>Закреплённое сообщение</Text>
                    <Text numberOfLines={1} style={{ color: w.ink, fontSize: 14 }}>
                      {messageBody(pin)}
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
                <Bubble m={item.message} mine={item.message.sender_id === meId} group={!!group} first={item.first} last={item.last} onPress={openActions} onLongPress={setReactFor} onReact={react} onJump={jump} onVote={vote} onPoll={pollAction} canClosePoll={!!group && can('delete_messages')} onOpenExternal={openExternal} onRetry={retry} onOpenMedia={openMedia} onListen={listen} onWrite={writeTo} onOpenNote={openNote} />
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
                  {mode.kind === 'edit' ? <Pencil size={16} color="#3b5bff" /> : mode.kind === 'external' ? <CornerDownRight size={16} color="#8a5cff" /> : <CornerUpLeft size={16} color="#3b5bff" />}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: mode.kind === 'external' ? '#8a5cff' : '#3b5bff', fontFamily: font.semibold, fontSize: 13 }}>
                      {mode.kind === 'edit' ? (captionOnly ? 'Изменение подписи' : 'Изменение сообщения') : mode.kind === 'external' ? `Ответ из «${mode.chatTitle}» · ${mode.message.sender_name ?? 'удалённый аккаунт'}` : `Ответ · ${mode.message.sender_name ?? 'удалённый аккаунт'}`}
                    </Text>
                    <Text numberOfLines={1} style={{ color: w.inkSoft, fontSize: 13 }}>
                      {messageBody(mode.message)}
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
            {busy && <WallPill text={busy} />}
            {notice && <WallPill text={notice} accent />}
            {!!scheduled.data?.length && !mode && (
              <Pressable accessibilityRole="button" accessibilityLabel={`Отложенные сообщения: ${scheduled.data.length}`} onPress={() => setSheet({ kind: 'scheduled' })} style={({ pressed }) => ({ alignSelf: 'center', opacity: pressed ? 0.7 : 1 })}>
                <Glass tone="surface" radius={16}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <CalendarClock size={14} color="#3b5bff" />
                    <Text style={{ color: w.ink, fontFamily: font.semibold, fontSize: 13 }}>
                      {`Отложенные · ${scheduled.data.length}`}
                      <Text style={{ color: w.inkSoft, fontFamily: font.regular, fontSize: 13 }}>{` · ближайшее ${scheduleLabel(scheduled.data.reduce((a, b) => (a.send_at < b.send_at ? a : b)).send_at, new Date())}`}</Text>
                    </Text>
                  </View>
                </Glass>
              </Pressable>
            )}
            <Glass tone="surface" radius={26}>
              {recording ? (
                <VoiceRecorderBar onCancel={() => setRecording(false)} onDone={(r) => void sendRecording('voice', r)} />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 6 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Вложения"
                    accessibilityState={{ disabled: mode?.kind === 'edit' }}
                    disabled={mode?.kind === 'edit'}
                    onPress={() => setSheet({ kind: 'menu' })}
                    style={({ pressed }) => ({ width: 40, height: 42, alignItems: 'center', justifyContent: 'center', opacity: mode?.kind === 'edit' ? 0.35 : pressed ? 0.6 : 1 })}
                  >
                    <Paperclip size={21} color={w.inkSoft} />
                  </Pressable>
                  <TextInput
                    value={text}
                    onChangeText={(v) => {
                      setText(v);
                      if (mode?.kind !== 'edit') live.sendTyping(chatId, topicId, !v.trim());
                    }}
                    placeholder={captionOnly ? 'Подпись' : topic ? `Сообщение в «${topic.name}»` : 'Сообщение'}
                    placeholderTextColor={w.inkSoft}
                    multiline
                    // В веб-сборке многострочное поле по умолчанию в несколько строк — начинаем с одной.
                    numberOfLines={Platform.OS === 'web' ? 1 : undefined}
                    accessibilityLabel="Сообщение"
                    style={[{ flex: 1, minHeight: 40, maxHeight: 140, paddingTop: 10, paddingBottom: 10, color: w.ink, fontFamily: font.regular, fontSize: 16, textAlignVertical: 'top' }, NO_WEB_OUTLINE]}
                  />
                  {canRecord ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Записать голосовое"
                      onPress={() => setRecording(true)}
                      style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(59,91,255,0.14)', transform: [{ scale: pressed ? 0.92 : 1 }] })}
                    >
                      <Mic size={20} color="#3b5bff" />
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={mode?.kind === 'edit' ? 'Сохранить' : 'Отправить'}
                      accessibilityState={{ disabled: !canSend }}
                      disabled={!canSend}
                      onPress={submit}
                      onLongPress={scheduleCurrent}
                      delayLongPress={380}
                      accessibilityHint={mode?.kind === 'edit' ? undefined : 'Долгое касание — отправить позже'}
                      style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? '#3b5bff' : 'rgba(127,127,160,0.3)', transform: [{ scale: pressed ? 0.92 : 1 }] })}
                    >
                      <ArrowUp size={20} color="#fff" strokeWidth={2.4} />
                    </Pressable>
                  )}
                </View>
              )}
            </Glass>
            {tooLong && <Text style={{ color: '#e0464c', fontSize: 12, textAlign: 'right' }}>{`${text.trim().length}/${MESSAGE_MAX}`}</Text>}
          </View>
        )}
      </KeyboardAvoidingView>

      {sheet?.kind === 'menu' && (
        <AttachMenu
          onClose={() => setSheet(null)}
          onFiles={(files, asFile) => setSheet({ kind: 'send', files, asFile })}
          onContact={() => setSheet({ kind: 'contact' })}
          onMyNote={() => router.push({ pathname: '/my-notes/pick', params: topicId ? { chat: chatId, topic: topicId } : { chat: chatId } })}
          onVideoNote={Platform.OS !== 'web' ? () => setSheet({ kind: 'note' }) : undefined}
          onPoll={() => setSheet({ kind: 'poll' })}
          onSchedule={() => setSheet({ kind: 'schedule', text: text.trim() })}
        />
      )}
      {sheet?.kind === 'send' && <SendSheet files={sheet.files} asFile={sheet.asFile} onClose={() => setSheet(null)} onSend={(b) => void sendBatches(b)} />}
      {sheet?.kind === 'contact' && <ContactSheet meId={meId} onClose={() => setSheet(null)} onPick={sendContact} />}
      {sheet?.kind === 'note' && <VideoNoteRecorder onClose={() => setSheet(null)} onDone={(r) => void sendRecording('video_note', r)} />}
      {sheet?.kind === 'viewer' && <MediaViewer items={sheet.items} index={sheet.index} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'poll' && <PollSheet chatId={chatId} topicId={topicId} onClose={() => setSheet(null)} onCreated={() => list.current?.scrollToOffset({ offset: 0, animated: true })} />}
      {sheet?.kind === 'voters' && <VotersSheet message={sheet.message} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'actions' && <ActionsSheet title="Сообщение" sub={`${sheet.message.sender_name} · ${messageBody(sheet.message).slice(0, 80)}`} items={sheet.items} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'scheduled' && <ScheduledSheet chatId={chatId} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'schedule' && (
        <ScheduleSheet
          chatId={chatId}
          topicId={topicId}
          replyTo={mode?.kind === 'reply' ? mode.message : null}
          initialText={sheet.text}
          onClose={() => setSheet(null)}
          onDone={(at) => {
            // Текст из поля ввода ушёл в отложенные — поле очищаем.
            if (sheet.text && text.trim() === sheet.text) setText('');
            if (mode?.kind === 'reply') setMode(null);
            setNotice(`Отправим ${scheduleLabel(at, new Date())}`);
          }}
        />
      )}
      {sheet?.kind === 'forward' && (
        <ChatPickSheet
          title={forwardTitle(sheet.ids.length)}
          sub="Касание — и сообщение уже там"
          onClose={() => setSheet(null)}
          onPick={async (target) => {
            try {
              await chatApi.forward(sheet.ids, target.id);
              setSheet(null);
              void qc.invalidateQueries({ queryKey: ck.list });
              if (target.id !== chatId) router.push({ pathname: '/chat/[id]', params: { id: target.id } });
              else setNotice('Переслано');
            } catch (e) {
              Alert.alert('Не получилось переслать', errText(e));
            }
          }}
        />
      )}
      {sheet?.kind === 'external' && (
        <ChatPickSheet
          title="Ответить в другом чате"
          sub="Цитата попадёт в выбранный чат"
          exclude={chatId}
          onClose={() => setSheet(null)}
          onPick={(target) => {
            pendingExternal.set(target.id, { message: sheet.message, chatTitle: topic ? `${c?.title ?? ''} · ${topic.name}` : (c?.title ?? 'другого чата') });
            setSheet(null);
            router.push({ pathname: '/chat/[id]', params: { id: target.id } });
          }}
        />
      )}

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
