import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import {
  buildThread,
  COMMENT_MAX,
  formatDate,
  insertMention,
  isDiscussionEntity,
  mentionQuery,
  mentionSuggestions,
  splitMentions,
  todayIso,
  validateComment,
  type Discussion,
  type DiscussionComment,
  type DiscussionSummary,
  type Member,
} from '@offix/core';
import { useMe } from '../../../lib/queries';
import { api } from '../../../lib/session';
import { font, radius, usePalette } from '../../../lib/theme';
import { discussionSummaryKey } from '../../../ui/discussion';
import { Avatar, Button, Card, Empty, Screen, Text } from '../../../ui/primitives';

const when = (iso: string, today: string) => {
  const time = new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return iso.slice(0, 10) === today ? time : `${formatDate(iso.slice(0, 10), { short: true, today })}, ${time}`;
};

/** Обсуждение цели или задачи на телефоне: ветки, ответы, @упоминания. */
export default function DiscussionScreen() {
  const params = useLocalSearchParams<{ type: string; id: string }>();
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

  const send = async () => {
    if (validateComment(text) || sending) return;
    setSending(true);
    try {
      await api(`/discussions/${type}/${id}`, { body: { body: text, parent_id: replyTo?.parent_id ?? replyTo?.id ?? null } });
      setText('');
      setCaret(0);
      setReplyTo(null);
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
        <Avatar name={c.author_name} size={reply ? 24 : 30} />
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

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
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

      {q.data?.can_comment && (
        <View style={{ gap: 8 }}>
          {replyTo && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.sm, backgroundColor: p.surface2 }}>
              <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                Ответ: {replyTo.author_name} — {replyTo.body}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Отменить ответ" onPress={() => setReplyTo(null)} hitSlop={8}>
                <Text tone="faint">×</Text>
              </Pressable>
            </View>
          )}
          {suggestions.length > 0 && (
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              {suggestions.map((u) => (
                <Pressable
                  key={u.id}
                  accessibilityRole="button"
                  onPress={() => {
                    const r = insertMention(text, caret, u.display_name);
                    setText(r.text);
                    setCaret(r.caret);
                  }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}
                >
                  <Avatar name={u.display_name} size={22} />
                  <Text style={{ flex: 1 }}>{u.display_name}</Text>
                </Pressable>
              ))}
            </Card>
          )}
          <TextInput
            value={text}
            onChangeText={setText}
            onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
            placeholder="Комментарий… @ — упомянуть коллегу"
            placeholderTextColor={p.ink3}
            multiline
            maxLength={COMMENT_MAX}
            accessibilityLabel="Комментарий"
            style={{ minHeight: 72, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: p.line, backgroundColor: p.surface, color: p.ink, fontFamily: font.regular, fontSize: 15, textAlignVertical: 'top' }}
          />
          <Button title="Отправить" onPress={() => void send()} loading={sending} disabled={!!validateComment(text)} />
        </View>
      )}
    </Screen>
  );
}
