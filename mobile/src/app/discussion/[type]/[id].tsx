import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Paperclip, SendHorizontal, X } from 'lucide-react-native';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buildThread,
  COMMENT_FILES_MAX,
  COMMENT_MAX,
  formatDate,
  insertMention,
  isDiscussionEntity,
  mentionQuery,
  mentionSuggestions,
  splitMentions,
  todayIso,
  validateComment,
  type Attachment,
  type Discussion,
  type DiscussionComment,
  type DiscussionSummary,
  type Member,
} from '@offix/core';
import { dropDraft } from '../../../lib/files';
import { discussionStats } from '../../../lib/logic';
import type { PickedFile } from '../../../lib/media';
import { useMe } from '../../../lib/queries';
import { api } from '../../../lib/session';
import { font, radius, usePalette } from '../../../lib/theme';
import { discussionSummaryKey } from '../../../ui/discussion';
import { AttachmentList, chooseFiles, PendingList, useUploads } from '../../../ui/files';
import { Glass } from '../../../ui/fx/Glass';
import { PageHero } from '../../../ui/fx/PageHero';
import { Avatar, Card, Empty, NO_WEB_OUTLINE, Screen, Text } from '../../../ui/primitives';

const when = (iso: string, today: string) => {
  const time = new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return iso.slice(0, 10) === today ? time : `${formatDate(iso.slice(0, 10), { short: true, today })}, ${time}`;
};

/** Обсуждение цели или задачи на телефоне: ветки, ответы, @упоминания. */
export default function DiscussionScreen() {
  const params = useLocalSearchParams<{ type: string; id: string; title?: string }>();
  const insets = useSafeAreaInsets();
  const type = isDiscussionEntity(params.type) ? params.type : 'goal';
  const id = params.id;
  const p = usePalette();
  const qc = useQueryClient();
  const me = useMe();
  const key = ['discussion', type, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Discussion>(`/discussions/${type}/${id}`) });
  const [readMark, setReadMark] = useState<string | null | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<DiscussionComment | null>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const up = useUploads();
  const today = todayIso();

  useEffect(() => {
    if (!q.data || readMark !== undefined) return;
    setReadMark(q.data.last_read_at);
    if (q.data.unread > 0) {
      void api(`/discussions/${type}/${id}/read`, { method: 'POST' })
        .then(() => qc.setQueryData<DiscussionSummary>(discussionSummaryKey(type, id), (s) => (s ? { ...s, unread: 0 } : s)))
        .catch(() => undefined);
    }
  }, [q.data, readMark, type, id, qc]);

  const m = mentionQuery(text, caret);
  const users = useQuery({ queryKey: ['users', m?.query.split(' ')[0] ?? ''], queryFn: () => api<Member[]>(`/users?search=${encodeURIComponent(m?.query.split(' ')[0] ?? '')}`), enabled: !!m });
  const suggestions = m ? mentionSuggestions((users.data ?? []).filter((u) => u.active), m.query, 5) : [];
  const thread = useMemo(() => buildThread(q.data?.comments ?? []), [q.data]);
  const people = q.data?.people ?? [];
  const firstNew = readMark === undefined ? undefined : q.data?.comments.find((c) => c.author_id !== me.data?.id && (!readMark || c.created_at > readMark))?.id;

  // С файлами текст не обязателен: «вот скан» можно не писать.
  const canSend = (files.length > 0 ? text.trim().length <= COMMENT_MAX : !validateComment(text)) && !sending && !up.items.some((x) => !x.error);
  const attach = async (list: PickedFile[]) => {
    const room = COMMENT_FILES_MAX - files.length;
    if (list.length > room) Alert.alert('Слишком много файлов', `К комментарию — не больше ${COMMENT_FILES_MAX} файлов`);
    const atts = await up.upload(list.slice(0, Math.max(0, room)));
    setFiles((xs) => [...xs, ...atts]);
  };
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await api(`/discussions/${type}/${id}`, { body: { body: text, parent_id: replyTo?.parent_id ?? replyTo?.id ?? null, attachment_ids: files.length ? files.map((f) => f.id) : undefined } });
      setText('');
      setCaret(0);
      setReplyTo(null);
      setFiles([]);
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: discussionSummaryKey(type, id) })]);
    } catch (e) {
      Alert.alert('Не удалось отправить', (e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const item = (c: DiscussionComment, reply: boolean) => (
    <View key={c.id} style={{ gap: 6 }}>
      {c.id === firstNew && (
        <View accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="eyebrow" tone="accent">
            Новые
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: p.accentSoft }} />
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 10, marginLeft: reply ? 28 : 0 }}>
        <Avatar name={c.author_name} id={c.author_id} size={reply ? 24 : 30} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="small">
            <Text variant="small" style={{ fontFamily: font.semibold }}>
              {c.author_name}
            </Text>
            <Text variant="small" tone="faint">
              {'  '}
              {when(c.created_at, today)}
            </Text>
          </Text>
          <Text>
            {splitMentions(c.body, people).map((s, i) =>
              s.mention ? (
                <Text key={i} style={{ fontFamily: font.semibold, color: s.mention === me.data?.id ? p.accent : p.ink }}>
                  {s.text}
                </Text>
              ) : (
                <Text key={i}>{s.text}</Text>
              ),
            )}
          </Text>
          {c.attachments.length > 0 && <AttachmentList items={c.attachments} author={{ id: c.author_id, name: c.author_name, at: c.created_at }} size={reply ? 64 : 76} />}
          {q.data?.can_comment && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Ответить: ${c.author_name}`} onPress={() => setReplyTo(c)} hitSlop={8}>
              <Text variant="caption" tone="faint">
                Ответить
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );

  const composer = q.data?.can_comment && (
    <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), gap: 8 }}>
      {suggestions.length > 0 && (
        <Glass tone="surface" radius={20}>
          <View style={{ paddingVertical: 4, paddingHorizontal: 12 }} accessibilityLabel="Кого упомянуть">
            {suggestions.map((u, i) => (
              <Pressable
                key={u.id}
                accessibilityRole="button"
                accessibilityLabel={`Упомянуть: ${u.display_name}`}
                onPress={() => {
                  const r = insertMention(text, caret, u.display_name);
                  setText(r.text);
                  setCaret(r.caret);
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: p.line, opacity: pressed ? 0.6 : 1 })}
              >
                <Avatar name={u.display_name} id={u.id} size={24} />
                <Text style={{ fontFamily: font.medium }}>{u.display_name}</Text>
                {u.position && (
                  <Text variant="caption" tone="faint" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
                    {u.position}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        </Glass>
      )}
      <Glass tone="surface" radius={24}>
        {replyTo && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 8, marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: p.accentSoft }}>
            <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              Ответ: {replyTo.author_name} — {replyTo.body}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Отменить ответ" onPress={() => setReplyTo(null)} hitSlop={8}>
              <X size={16} color={p.ink3} />
            </Pressable>
          </View>
        )}
        {(files.length > 0 || up.items.length > 0) && (
          <View style={{ marginHorizontal: 12, marginTop: 10, gap: 6 }}>
            <AttachmentList items={files} size={56} canRemove={() => true} onRemove={(a) => (setFiles((xs) => xs.filter((x) => x.id !== a.id)), void dropDraft(a.id))} />
            <PendingList items={up.items} onDismiss={up.dismiss} />
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 6, paddingLeft: 6 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Прикрепить файл"
            disabled={files.length >= COMMENT_FILES_MAX}
            onPress={() => chooseFiles((f) => void attach(f))}
            style={({ pressed }) => ({ width: 38, height: 40, alignItems: 'center', justifyContent: 'center', opacity: files.length >= COMMENT_FILES_MAX ? 0.35 : pressed ? 0.6 : 1 })}
          >
            <Paperclip size={19} color={p.ink3} />
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
            placeholder="Комментарий… @ — упомянуть"
            placeholderTextColor={p.ink3}
            multiline
            maxLength={COMMENT_MAX}
            accessibilityLabel="Комментарий"
            style={[{ flex: 1, minHeight: 40, maxHeight: 140, paddingTop: 10, paddingBottom: 10, color: p.ink, fontFamily: font.regular, fontSize: 15, textAlignVertical: 'top' }, NO_WEB_OUTLINE]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Отправить"
            accessibilityState={{ disabled: !canSend, busy: sending }}
            disabled={!canSend}
            onPress={() => void send()}
            style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? p.accent : p.surface3, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] })}
          >
            {sending ? <ActivityIndicator color={p.accentInk} /> : <SendHorizontal size={18} color={canSend ? p.accentInk : p.ink3} />}
          </Pressable>
        </View>
      </Glass>
    </View>
  );

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={p.ink3} />}
        >
          <PageHero
            variant="discussion"
            icon={MessageSquare}
            back={type === 'goal' ? 'Цель' : 'Задача'}
            eyebrow={type === 'goal' ? 'Обсуждение цели' : 'Обсуждение задачи'}
            title={params.title || 'Обсуждение'}
            stats={q.data && q.data.comments.length ? discussionStats(q.data.comments, q.data.unread) : undefined}
          />
          {q.isError && <Empty title="Обсуждение недоступно" text="Возможно, у вас нет доступа к цели или задаче." />}
          {thread.length ? (
            <Card style={{ gap: 16 }}>{thread.map((n) => [item(n.comment, false), ...n.replies.map((r) => item(r, true))])}</Card>
          ) : (
            q.data && (
              <Card>
                <Empty title="Обсуждения пока нет" text="Задайте вопрос здесь: контекст останется рядом с целью. Упомяните коллегу через @." />
              </Card>
            )
          )}
        </ScrollView>
        {composer}
      </KeyboardAvoidingView>
    </Screen>
  );
}
