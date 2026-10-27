import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { NotebookPen, Send } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { noteTitle } from '@offix/core';
import { mk, myNotesApi, useNoteRequest } from '../../lib/personal-api';
import { usePalette } from '../../lib/theme';
import { PageHero } from '../../ui/fx/PageHero';
import { Button, Card, Empty, Pill, Screen, Text } from '../../ui/primitives';

/**
 * Запрос свежей версии заметки: автор видит, чем поделится, и решает сам.
 * Запросивший видит только статус — текст без согласия автора не уходит.
 */
export default function NoteRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const qc = useQueryClient();
  const q = useNoteRequest(id);
  const v = q.data;
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const pending = v?.status === 'pending';

  const answer = async (how: 'approve' | 'decline') => {
    setBusy(how);
    try {
      const next = how === 'approve' ? await myNotesApi.approve(id) : await myNotesApi.decline(id);
      qc.setQueryData(mk.request(id), next);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      Alert.alert('Не получилось', e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  };

  if (q.isError) {
    return (
      <Screen>
        <Card>
          <Empty title="Запрос не найден" text="Возможно, заметку или сообщение с ней удалили." />
        </Card>
      </Screen>
    );
  }
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {v && (
        <>
          <PageHero
            variant="notes"
            icon={NotebookPen}
            compact
            eyebrow="Запрос свежей версии"
            title={noteTitle(v.shared.title)}
            subtitle={v.is_owner ? `${v.requester.name} просит свежую версию вашей заметки` : `Вы попросили ${v.owner.name.split(' ')[0]} поделиться свежей версией`}
          />
          {v.is_owner && v.note ? (
            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text variant="title" numberOfLines={1} style={{ flex: 1 }}>
                  {noteTitle(v.note.title)}
                </Text>
                {v.note.changed_since_share ? <Pill tone="info">Есть изменения</Pill> : <Pill>Без изменений</Pill>}
              </View>
              {!!v.note.preview && (
                <Text tone="muted" numberOfLines={6}>
                  {v.note.preview}
                </Text>
              )}
              {!!v.note.files_count && (
                <Text variant="caption" tone="faint">
                  {`Файлов: ${v.note.files_count}`}
                </Text>
              )}
            </Card>
          ) : (
            v.is_owner && (
              <Card>
                <Empty title="Заметки больше нет" text="Вы её удалили — поделиться нечем." />
              </Card>
            )
          )}
          {pending ? (
            v.is_owner ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Отказать" variant="secondary" style={{ flex: 1 }} loading={busy === 'decline'} disabled={!!busy} onPress={() => void answer('decline')} />
                <Button title="Поделиться" variant="accent" style={{ flex: 1 }} icon={<Send size={16} color={p.accentInk} />} loading={busy === 'approve'} disabled={!!busy || !v.note} onPress={() => void answer('approve')} />
              </View>
            ) : (
              <Text tone="muted" style={{ textAlign: 'center' }}>
                Ждём ответа автора.
              </Text>
            )
          ) : (
            <Card>
              <Text style={{ textAlign: 'center' }}>{v.status === 'approved' ? (v.is_owner ? `Вы поделились — свежая версия у ${v.requester.name.split(' ')[0]}.` : 'Автор поделился — заметка в «Моих заметках».') : v.is_owner ? 'Вы отказали.' : 'Автор не стал делиться.'}</Text>
              {!v.is_owner && v.result_note_id && <Button title="Открыть у себя" variant="accent" onPress={() => router.replace(`/my-notes/${v.result_note_id}`)} />}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
