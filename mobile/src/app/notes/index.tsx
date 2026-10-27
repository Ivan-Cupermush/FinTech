import { router, Stack, useLocalSearchParams } from 'expo-router';
import { BookOpen, Search, Sparkles, Target, UploadCloud } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, TextInput, View } from 'react-native';
import { NO_WEB_OUTLINE } from '../../ui/primitives';
import { todayIso } from '@offix/core';
import { askRoute, knowledgeStats, pickedDocError } from '../../lib/knowledge';
import { useKnowledgeDocs, useKnowledgeStatus, useReprocessDoc, useUploadDoc } from '../../lib/knowledge-api';
import { noteMeta, notesEmpty, notesQuery, type NotesScope } from '../../lib/notes';
import { useNotes } from '../../lib/queries';
import { font, usePalette } from '../../lib/theme';
import { pickDocuments } from '../../ui/attach';
import { Glass } from '../../ui/fx/Glass';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { PageHero } from '../../ui/fx/PageHero';
import { AskBar, DocRow } from '../../ui/knowledge';
import { Button, Card, Empty, Screen, Text } from '../../ui/primitives';

/** Не дёргаем сервер на каждую букву. */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Tab = 'notes' | 'docs';

/**
 * База знаний на телефоне: статьи и документы — найти и перечитать, а
 * помощнику задать вопрос словами. С параметром goal — статьи и документы
 * одной цели (вход с экрана цели).
 */
export default function NotesScreen() {
  const params = useLocalSearchParams<{ goal?: string; goalTitle?: string; tab?: string; upload?: string }>();
  const goalId = params.goal || undefined;
  const p = usePalette();
  const today = todayIso();
  const [tab, setTab] = useState<Tab>(params.tab === 'docs' ? 'docs' : 'notes');
  const [text, setText] = useState('');
  const [scope, setScope] = useState<NotesScope>('all');
  const q = useDebounced(text);
  const list = useNotes(notesQuery({ q, goalId, scope }));
  // Цифры шапки — по всей базе (или по цели), а не по результату поиска.
  const all = useNotes(notesQuery({ goalId }));
  const status = useKnowledgeStatus();
  const docs = useKnowledgeDocs(goalId);
  const empty = notesEmpty({ q, goalId });
  // Документы компании загружает тот, кому доверено; документы цели — ещё и редакторы цели.
  const canUpload = !!status.data?.can_manage || (!!goalId && params.upload === '1');

  return (
    <Screen
      refreshing={list.isRefetching || docs.isRefetching}
      onRefresh={() => void Promise.all([list.refetch(), all.refetch(), docs.refetch(), status.refetch()])}
    >
      <Stack.Screen options={{ title: goalId ? 'База знаний цели' : 'База знаний' }} />
      <PageHero
        variant="knowledge"
        icon={BookOpen}
        eyebrow={goalId ? 'База знаний цели' : undefined}
        title={goalId ? params.goalTitle || 'Заметки' : 'База знаний'}
        subtitle={goalId ? 'Договорённости, решения и документы по этой цели.' : 'Регламенты, договорённости и документы — рядом с целями, а не в переписке.'}
        stats={all.data && !goalId ? knowledgeStats(all.data, status.data?.docs.ready, today) : undefined}
      >
        <AskBar onAsk={(question) => router.push(askRoute(question))} />
      </PageHero>

      <LiquidSegmented
        role="tab"
        label="Раздел базы знаний"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'notes' as const, label: 'Статьи' },
          { value: 'docs' as const, label: docs.data ? `Документы · ${docs.data.length}` : 'Документы' },
        ]}
      />

      {tab === 'docs' ? (
        <DocsList goalId={goalId} canUpload={canUpload} today={today} docs={docs} />
      ) : (
        <>
      <Glass tone="surface" radius={16}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
          <Search size={18} color={p.ink3} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Найти по заголовку и тексту"
            placeholderTextColor={p.ink3}
            accessibilityLabel="Поиск по базе знаний"
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[{ flex: 1, minHeight: 48, fontFamily: font.regular, fontSize: 16, color: p.ink }, NO_WEB_OUTLINE]}
          />
        </View>
      </Glass>

      {!goalId && (
        <LiquidSegmented
          role="radio"
          label="Какие заметки"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all' as const, label: 'Все' },
            { value: 'company' as const, label: 'Общие' },
          ]}
        />
      )}

      {list.isError ? (
        <Card>
          <Empty title="Не удалось загрузить" text={(list.error as Error).message} action={<Button title="Повторить" variant="secondary" onPress={() => list.refetch()} />} />
        </Card>
      ) : list.data?.length ? (
        <View style={{ gap: 10 }}>
          {list.data.map((n) => (
            <Card key={n.id} onPress={() => router.push(`/notes/${n.id}`)} style={{ gap: 6 }}>
              <Text style={{ fontFamily: font.semibold }}>{n.title}</Text>
              {!!n.excerpt && (
                <Text variant="small" tone="muted" numberOfLines={3}>
                  {n.excerpt}
                </Text>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {n.goal_title && !goalId && <Target size={12} color={p.ink3} />}
                <Text variant="caption" tone="faint" numberOfLines={1} style={{ flex: 1 }}>
                  {noteMeta(n, today, !goalId)}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      ) : (
        !list.isLoading && (
          <Card>
            <Empty title={empty.title} text={empty.text} />
          </Card>
        )
      )}
        </>
      )}
    </Screen>
  );
}

/** Документы: загрузка с телефона (из «Файлов»), статусы, причина ошибки и повтор. */
function DocsList({ goalId, canUpload, today, docs }: { goalId?: string; canUpload: boolean; today: string; docs: ReturnType<typeof useKnowledgeDocs> }) {
  const p = usePalette();
  const upload = useUploadDoc(goalId);
  const reprocess = useReprocessDoc();
  const [progress, setProgress] = useState<{ name: string; value: number } | null>(null);

  const choose = async () => {
    const files = await pickDocuments();
    for (const f of files) {
      const err = pickedDocError(f);
      if (err) {
        Alert.alert(`«${f.name}» не подойдёт`, err);
        continue;
      }
      setProgress({ name: f.name, value: 0 });
      try {
        await upload.mutateAsync({ file: f, onProgress: (v) => setProgress({ name: f.name, value: v }) });
      } catch (e) {
        Alert.alert('Документ не загрузился', (e as Error).message);
      } finally {
        setProgress(null);
      }
    }
  };

  return (
    <View style={{ gap: 10 }}>
      {canUpload && (
        <Card onPress={progress ? undefined : () => void choose()} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderStyle: 'dashed', borderWidth: 1.5, borderColor: p.accent }}>
          {progress ? <ActivityIndicator color={p.accent} /> : <UploadCloud size={22} color={p.accent} />}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: font.semibold }} numberOfLines={1}>
              {progress ? `Загружаем «${progress.name}» — ${Math.round(progress.value * 100)}%` : 'Загрузить документ'}
            </Text>
            <Text variant="small" tone="faint">
              PDF, DOCX, TXT или MD до 20 МБ — помощник прочитает и будет отвечать по нему
            </Text>
          </View>
        </Card>
      )}
      {docs.isError ? (
        <Card>
          <Empty title="Не удалось загрузить" text={(docs.error as Error).message} action={<Button title="Повторить" variant="secondary" onPress={() => docs.refetch()} />} />
        </Card>
      ) : docs.data?.length ? (
        docs.data.map((d) => <DocRow key={d.id} doc={d} today={today} onRetry={() => reprocess.mutate(d.id)} retrying={reprocess.isPending && reprocess.variables === d.id} />)
      ) : (
        !docs.isLoading && (
          <Card>
            <Empty
              title={goalId ? 'У цели пока нет документов' : 'Документов пока нет'}
              text={canUpload ? 'Загрузите регламент или положение — помощник будет отвечать по нему со ссылками.' : 'Регламенты и положения загружает руководитель — помощник отвечает и по ним.'}
            />
          </Card>
        )
      )}
      {!goalId && (
        <Button title="Спросить помощника" variant="ghost" icon={<Sparkles size={16} color={p.accent} />} onPress={() => router.push(askRoute())} />
      )}
    </View>
  );
}
