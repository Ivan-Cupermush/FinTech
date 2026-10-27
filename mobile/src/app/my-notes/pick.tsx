import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { todayIso } from '@offix/core';
import { ck } from '../../lib/chats';
import { myNotesQuery } from '../../lib/personal';
import { myNotesApi, useMyNotes } from '../../lib/personal-api';
import { NoteRow } from '../../ui/my-notes';
import { Button, Card, Empty, Input, Screen } from '../../ui/primitives';

/** Из чата: выбрать мою заметку и отправить её снимок в этот чат (и тему). */
export default function PickNoteScreen() {
  const { chat, topic } = useLocalSearchParams<{ chat: string; topic?: string }>();
  const qc = useQueryClient();
  const today = todayIso();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 250);
    return () => clearTimeout(t);
  }, [text]);
  const list = useMyNotes(myNotesQuery({ q }));

  const send = async (id: string) => {
    setBusy(id);
    try {
      await myNotesApi.share(id, chat, { topicId: topic || null });
      void qc.invalidateQueries({ queryKey: ['chat-history', chat] });
      void qc.invalidateQueries({ queryKey: ck.list });
      router.back();
    } catch (e) {
      Alert.alert('Не отправилось', e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen glow={false}>
      <Input label="Найти в моих заметках" value={text} onChangeText={setText} placeholder="Заголовок или текст" autoCorrect={false} />
      {list.data?.length ? (
        <View style={{ gap: 8, opacity: busy ? 0.6 : 1 }} pointerEvents={busy ? 'none' : 'auto'}>
          {list.data.map((n) => (
            <NoteRow key={n.id} n={n} today={today} onPress={() => void send(n.id)} />
          ))}
        </View>
      ) : (
        !list.isLoading && (
          <Card>
            <Empty title={q.trim() ? 'Ничего не нашлось' : 'Заметок пока нет'} text="Личные заметки пишутся в разделе «Мои заметки» — и на сайте, и в приложении." action={<Button title="Новая заметка" variant="secondary" onPress={() => router.replace('/my-notes/new')} />} />
          </Card>
        )
      )}
    </Screen>
  );
}
