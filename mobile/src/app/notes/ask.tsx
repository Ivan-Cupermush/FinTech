import { Stack, useLocalSearchParams } from 'expo-router';
import { MessageSquarePlus, SendHorizontal, Sparkles, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KNOWLEDGE_LIMITS, KNOWLEDGE_SUGGESTIONS, knowledgeStatusLine, plural, todayIso, validateQuestion } from '@offix/core';
import { useAsk, useDeleteSession, useFeedback, useKnowledgeSession, useKnowledgeSessions, useKnowledgeStatus } from '../../lib/knowledge-api';
import { sessionMeta } from '../../lib/knowledge';
import { font, radius, usePalette } from '../../lib/theme';
import { Glass } from '../../ui/fx/Glass';
import { PageHero } from '../../ui/fx/PageHero';
import { AnswerView, AssistantMark, QuestionBubble } from '../../ui/knowledge';
import { Card, Empty, NO_WEB_OUTLINE, Screen, Text } from '../../ui/primitives';

/**
 * Помощник базы знаний: вопрос словами — ответ со ссылками на статьи и
 * документы, которые сотруднику можно видеть. Вопрос из строки на экране
 * базы знаний приходит параметром q и задаётся сразу.
 */
export default function AskScreen() {
  const params = useLocalSearchParams<{ q?: string; session?: string }>();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const today = todayIso();
  const [sid, setSid] = useState<string | undefined>(params.session || undefined);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const status = useKnowledgeStatus();
  const sessions = useKnowledgeSessions();
  const session = useKnowledgeSession(sid);
  const ask = useAsk();
  const feedback = useFeedback(sid);
  const del = useDeleteSession();
  const scroll = useRef<ScrollViewInstance>(null);
  const asked = useRef(false);

  const send = (raw: string) => {
    const question = raw.trim();
    if (validateQuestion(question) || ask.isPending) return;
    setPending(question);
    setText('');
    ask.mutate(
      { question, session_id: sid },
      {
        onSuccess: (r) => setSid(r.session.id),
        onError: () => setText(question),
        onSettled: () => setPending(null),
      },
    );
  };

  useEffect(() => {
    if (asked.current || !params.q?.trim() || params.session) return;
    asked.current = true;
    send(params.q);
    // Вопрос из параметра задаём один раз, при открытии экрана.
  }, []);

  const messages = sid ? (session.data?.messages ?? []) : [];
  const chatting = messages.length > 0 || !!pending;
  const st = status.data;
  const canSend = !!text.trim() && !ask.isPending;

  const removeSession = (id: string, title: string) =>
    Alert.alert('Удалить вопрос?', `«${title}» исчезнет из истории. Статьи и документы останутся.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => del.mutate(id, { onSuccess: () => id === sid && setSid(undefined) }) },
    ]);

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title: 'Помощник' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={{ padding: 16, gap: 16 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => chatting && scroll.current?.scrollToEnd({ animated: true })}
        >
          <PageHero
            variant="assistant"
            compact={chatting}
            icon={Sparkles}
            eyebrow="База знаний"
            title={chatting ? session.data?.session.title || pending || 'Помощник' : 'Спросите помощника'}
            subtitle={knowledgeStatusLine(st)}
            right={
              chatting ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Новый вопрос" onPress={() => (setSid(undefined), setPending(null))} hitSlop={8}>
                  <Glass radius={20} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <MessageSquarePlus size={20} color="#fff" />
                  </Glass>
                </Pressable>
              ) : undefined
            }
          />

          {!chatting && (
            <>
              {st && (
                <Text variant="small" tone="muted">
                  В базе: {st.notes} {plural(st.notes, ['статья', 'статьи', 'статей'])} и {st.docs.ready} {plural(st.docs.ready, ['документ', 'документа', 'документов'])}. Помощник отвечает только по тому, что вам доступно.
                </Text>
              )}
              <View style={{ gap: 8 }}>
                <Text variant="eyebrow" tone="faint">
                  С чего начать
                </Text>
                {KNOWLEDGE_SUGGESTIONS.map((s) => (
                  <Pressable key={s} accessibilityRole="button" onPress={() => send(s)} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
                    <Glass tone="surface" radius={16}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
                        <Sparkles size={15} color={p.accent} />
                        <Text style={{ flex: 1 }}>{s}</Text>
                      </View>
                    </Glass>
                  </Pressable>
                ))}
              </View>
              {!!sessions.data?.length && (
                <View style={{ gap: 8 }}>
                  <Text variant="eyebrow" tone="faint">
                    Мои вопросы
                  </Text>
                  <Card style={{ padding: 6, gap: 0 }}>
                    {sessions.data.map((s) => (
                      <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Pressable accessibilityRole="button" onPress={() => setSid(s.id)} style={({ pressed }) => ({ flex: 1, padding: 10, borderRadius: radius.sm, opacity: pressed ? 0.7 : 1 })}>
                          <Text style={{ fontFamily: font.medium }} numberOfLines={1}>
                            {s.title}
                          </Text>
                          <Text variant="caption" tone="faint">
                            {sessionMeta(s, today)}
                          </Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Удалить «${s.title}»`} onPress={() => removeSession(s.id, s.title)} hitSlop={6} style={{ padding: 10 }}>
                          <Trash2 size={16} color={p.ink3} />
                        </Pressable>
                      </View>
                    ))}
                  </Card>
                </View>
              )}
            </>
          )}

          {sid && session.isError && (
            <Card>
              <Empty title="Вопрос недоступен" text="Возможно, его удалили. Задайте вопрос заново." />
            </Card>
          )}

          {messages.map((m) =>
            m.role === 'user' ? <QuestionBubble key={m.id} text={m.content} /> : <AnswerView key={m.id} message={m} onFeedback={(f) => feedback.mutate({ id: m.id, feedback: f })} />,
          )}
          {pending && (
            <>
              <QuestionBubble text={pending} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLiveRegion="polite">
                <AssistantMark size={26} />
                <ActivityIndicator size="small" color={p.ink3} />
                <Text variant="small" tone="muted">
                  Ищу в статьях и документах…
                </Text>
              </View>
            </>
          )}
          {ask.isError && (
            <Text variant="small" tone="bad" accessibilityLiveRegion="polite">
              {(ask.error as Error).message}
            </Text>
          )}
        </ScrollView>

        <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10) }}>
          <Glass tone="surface" radius={24}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 6, paddingLeft: 14 }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={chatting ? 'Уточните или спросите ещё…' : 'Ваш вопрос'}
                placeholderTextColor={p.ink3}
                multiline
                maxLength={KNOWLEDGE_LIMITS.question}
                accessibilityLabel="Вопрос"
                style={[{ flex: 1, minHeight: 40, maxHeight: 140, paddingTop: 10, paddingBottom: 10, color: p.ink, fontFamily: font.regular, fontSize: 15, textAlignVertical: 'top' }, NO_WEB_OUTLINE]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Спросить"
                accessibilityState={{ disabled: !canSend, busy: ask.isPending }}
                disabled={!canSend}
                onPress={() => send(text)}
                style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? p.accent : p.surface3, opacity: pressed ? 0.8 : 1 })}
              >
                {ask.isPending ? <ActivityIndicator color={p.accentInk} /> : <SendHorizontal size={18} color={canSend ? p.accentInk : p.ink3} />}
              </Pressable>
            </View>
          </Glass>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
