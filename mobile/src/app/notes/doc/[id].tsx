import { router, Stack, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, Download, RefreshCw, Target, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { formatDate, knowledgeDocBusy, knowledgeDocFacts, knowledgeDocTypeLabel, todayIso } from '@offix/core';
import { openAttachment } from '../../../lib/files';
import { useDeleteDoc, useKnowledgeDoc, useReprocessDoc } from '../../../lib/knowledge-api';
import { font, usePalette } from '../../../lib/theme';
import { PageHero } from '../../../ui/fx/PageHero';
import { DocStatusPill } from '../../../ui/knowledge';
import { Button, Card, Empty, Screen, Text } from '../../../ui/primitives';

const PAGE = 12;

/**
 * Документ базы знаний: что за файл, прочитал ли его помощник и что именно
 * он из него взял — фрагменты, по которым ищутся ответы.
 */
export default function KnowledgeDocScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const today = todayIso();
  const q = useKnowledgeDoc(id);
  const reprocess = useReprocessDoc();
  const del = useDeleteDoc();
  const [shown, setShown] = useState(PAGE);
  const [opening, setOpening] = useState(false);
  const d = q.data?.doc;
  const chunks = q.data?.chunks ?? [];

  if (q.isError) {
    return (
      <Screen>
        <Card>
          <Empty title="Документ недоступен" text="Возможно, его удалили или у вас нет доступа к цели." action={<Button title="Повторить" variant="secondary" onPress={() => q.refetch()} />} />
        </Card>
      </Screen>
    );
  }

  const open = async () => {
    if (!d?.file) return;
    setOpening(true);
    try {
      await openAttachment(d.file);
    } catch (e) {
      Alert.alert('Не удалось открыть файл', (e as Error).message);
    } finally {
      setOpening(false);
    }
  };

  const remove = () =>
    d &&
    Alert.alert('Удалить документ?', `«${d.title}» исчезнет из базы знаний, помощник перестанет на него ссылаться.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => del.mutate(d.id, { onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/notes')) }) },
    ]);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Stack.Screen options={{ title: 'Документ' }} />
      {d && (
        <>
          <PageHero
            variant="knowledge"
            compact
            eyebrow={`${knowledgeDocTypeLabel(d.type)} · ${d.goal_id ? 'документ цели' : 'документ компании'}`}
            title={d.title}
            subtitle={
              <View style={{ gap: 6 }}>
                {d.goal_id && d.goal_title && (
                  <Pressable accessibilityRole="link" onPress={() => router.push(`/goal/${d.goal_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} hitSlop={6}>
                    <Target size={14} color="#fff" />
                    <Text variant="small" style={{ color: '#fff', textDecorationLine: 'underline' }} numberOfLines={1}>
                      {d.goal_title}
                    </Text>
                  </Pressable>
                )}
                <Text variant="small" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  {knowledgeDocFacts(d)}
                </Text>
                <Text variant="small" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  {d.uploaded_by_name ?? 'Без автора'} · {formatDate(d.created_at.slice(0, 10), { today })}
                </Text>
              </View>
            }
          />

          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {d.file && <Button title="Открыть файл" variant="secondary" icon={<Download size={16} color={p.ink} />} loading={opening} onPress={() => void open()} />}
            {d.can_edit && d.status === 'failed' && <Button title="Обработать ещё раз" variant="secondary" icon={<RefreshCw size={16} color={p.ink} />} loading={reprocess.isPending} onPress={() => reprocess.mutate(d.id)} />}
            {d.can_edit && <Button title="Удалить" variant="ghost" icon={<Trash2 size={16} color={p.bad} />} color={p.bad} loading={del.isPending} onPress={remove} />}
          </View>

          {d.status !== 'ready' ? (
            <Card style={{ gap: 10 }}>
              <DocStatusPill doc={d} />
              {knowledgeDocBusy(d) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLiveRegion="polite">
                  <ActivityIndicator size="small" color={p.accent} />
                  <Text variant="small" tone="muted" style={{ flex: 1 }}>
                    Помощник читает документ. Когда закончит, по нему можно будет задавать вопросы.
                  </Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <AlertTriangle size={16} color={p.bad} style={{ marginTop: 2 }} />
                  <Text variant="small" tone="bad" style={{ flex: 1 }}>
                    {d.error ?? 'Документ не удалось прочитать.'}
                  </Text>
                </View>
              )}
            </Card>
          ) : (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Text variant="title">Что прочитал помощник</Text>
                <Text variant="caption" tone="faint">
                  {chunks.length} фрагм.
                </Text>
              </View>
              {chunks.slice(0, shown).map((c) => (
                <Card key={c.idx} style={{ gap: 6 }}>
                  <Text variant="caption" tone="faint" style={{ fontFamily: font.semibold }}>
                    Фрагмент {c.idx + 1}
                  </Text>
                  <Text variant="small" tone="muted">
                    {c.content}
                  </Text>
                </Card>
              ))}
              {chunks.length > shown && <Button title={`Показать ещё ${Math.min(PAGE, chunks.length - shown)}`} variant="secondary" onPress={() => setShown((n) => n + PAGE)} />}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
