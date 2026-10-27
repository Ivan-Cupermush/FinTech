import { router, Stack, useLocalSearchParams } from 'expo-router';
import { CalendarDays, NotebookPen, Plus, Search } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { monthOf, noteDayLabel, plural, todayIso, type MyNoteSummary } from '@offix/core';
import { myNotesEmpty, myNotesQuery, myNotesStats, type MyNotesView } from '../../lib/personal';
import { myNotesApi, useMyNotes, useNoteDays, useRefreshNotes } from '../../lib/personal-api';
import { font, usePalette } from '../../lib/theme';
import { Glass } from '../../ui/fx/Glass';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { PageHero } from '../../ui/fx/PageHero';
import { NoteCalendar, NoteRow } from '../../ui/my-notes';
import { Button, Card, Empty, NO_WEB_OUTLINE, Screen, Text } from '../../ui/primitives';

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Мои заметки: личный ежедневник. Календарь на градиенте — точки там, где
 * есть записи; ниже заметки выбранного дня, избранное или найденное.
 */
export default function MyNotesScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const p = usePalette();
  const today = todayIso();
  const refresh = useRefreshNotes();
  const [selected, setSelected] = useState<string | null>(params.date ?? null);
  const [month, setMonth] = useState(() => monthOf(params.date ?? today));
  const [view, setView] = useState<MyNotesView>('all');
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const searching = !!q.trim();
  const list = useMyNotes(myNotesQuery({ date: searching ? null : selected, favorite: view === 'favorite', q }));
  const all = useMyNotes('');
  const days = useNoteDays(month);
  const empty = myNotesEmpty({ q, view, date: selected });
  const heading = searching ? 'Найдено' : view === 'favorite' ? 'Избранное' : selected ? noteDayLabel(selected, today) : 'Все заметки';
  const create = () => router.push(`/my-notes/new${selected ? `?date=${selected}` : ''}`);

  const favorite = async (n: MyNoteSummary) => {
    try {
      await myNotesApi.update(n.id, { is_favorite: !n.is_favorite });
      await refresh();
    } catch (e) {
      Alert.alert('Не получилось', e instanceof Error ? e.message : '');
    }
  };

  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => void Promise.all([list.refetch(), days.refetch(), all.refetch()])}>
      <Stack.Screen options={{ title: 'Мои заметки' }} />
      <PageHero
        variant="notes"
        icon={NotebookPen}
        title="Мои заметки"
        subtitle="Личный ежедневник: видите только вы. Захотите поделиться — отправьте заметку в чат."
        stats={all.data ? myNotesStats(all.data, today) : undefined}
      />
      <Button title="Новая заметка" variant="accent" icon={<Plus size={18} color={p.accentInk} />} onPress={create} />

      <NoteCalendar month={month} today={today} selected={selected} days={days.data ?? []} onMonth={setMonth} onSelect={setSelected} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: -6 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setMonth(monthOf(today));
            setSelected(today);
          }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, opacity: pressed ? 0.7 : 1 })}
        >
          <CalendarDays size={15} color={p.ink2} />
          <Text variant="small">Сегодня</Text>
        </Pressable>
        {selected && (
          <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={({ pressed }) => ({ justifyContent: 'center', height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, opacity: pressed ? 0.7 : 1 })}>
            <Text variant="small">Все дни</Text>
          </Pressable>
        )}
      </View>

      <Glass tone="surface" radius={16}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
          <Search size={18} color={p.ink3} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Поиск по заголовку и тексту"
            placeholderTextColor={p.ink3}
            accessibilityLabel="Поиск по моим заметкам"
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[{ flex: 1, minHeight: 48, fontFamily: font.regular, fontSize: 16, color: p.ink }, NO_WEB_OUTLINE]}
          />
        </View>
      </Glass>
      <LiquidSegmented
        label="Какие заметки"
        value={view}
        onChange={setView}
        options={[
          { value: 'all' as const, label: 'Все' },
          { value: 'favorite' as const, label: 'Избранное' },
        ]}
      />

      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text variant="title">{heading}</Text>
        {!!list.data?.length && (
          <Text variant="small" tone="faint">
            {`${list.data.length} ${plural(list.data.length, ['заметка', 'заметки', 'заметок'])}`}
          </Text>
        )}
      </View>
      {list.isError ? (
        <Card>
          <Empty title="Не удалось загрузить" text={(list.error as Error).message} action={<Button title="Повторить" variant="secondary" onPress={() => list.refetch()} />} />
        </Card>
      ) : list.data?.length ? (
        <View style={{ gap: 8 }}>
          {list.data.map((n) => (
            <NoteRow key={n.id} n={n} today={today} onPress={() => router.push(`/my-notes/${n.id}`)} onFavorite={() => void favorite(n)} />
          ))}
        </View>
      ) : (
        !list.isLoading && (
          <Card>
            <Empty title={empty.title} text={empty.text} action={!searching && view === 'all' ? <Button title={selected ? 'Записать на этот день' : 'Написать первую'} variant="secondary" onPress={create} /> : undefined} />
          </Card>
        )
      )}
    </Screen>
  );
}
