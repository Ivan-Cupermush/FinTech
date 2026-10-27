import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { BookmarkPlus, NotebookPen, RefreshCw } from 'lucide-react-native';
import { useState } from 'react';
import { Alert } from 'react-native';
import { noteTitle, type NoteShareView } from '@offix/core';
import { mk, myNotesApi, useSharedNote } from '../../lib/personal-api';
import { usePalette } from '../../lib/theme';
import { AttachmentList } from '../../ui/files';
import { PageHero } from '../../ui/fx/PageHero';
import { Markdown } from '../../ui/markdown';
import { Button, Card, Empty, Screen, Text } from '../../ui/primitives';

/** Что видно про запрос свежей версии. */
function requestLine(v: NoteShareView): string | null {
  const r = v.my_request;
  if (!r) return null;
  if (r.status === 'pending') return 'Вы попросили свежую версию — ждём ответа автора.';
  if (r.status === 'approved') return 'Автор поделился свежей версией — она в «Моих заметках».';
  return 'Автор не стал делиться свежей версией.';
}

/**
 * Заметка из чата: снимок на момент отправки. Можно сохранить к себе
 * и попросить у автора свежую версию — он решит сам.
 */
export default function SharedNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const qc = useQueryClient();
  const q = useSharedNote(id);
  const v = q.data;
  const [busy, setBusy] = useState<'accept' | 'request' | null>(null);

  const run = async (kind: 'accept' | 'request') => {
    setBusy(kind);
    try {
      if (kind === 'accept') {
        const note = await myNotesApi.accept(id);
        void qc.invalidateQueries({ queryKey: mk.all });
        router.replace(`/my-notes/${note.id}`);
      } else {
        const r = await myNotesApi.request(id);
        await q.refetch();
        Alert.alert(r.already ? 'Запрос уже у автора' : 'Попросили автора', r.already ? 'Ответ придёт во «Входящие».' : 'Когда автор поделится свежей версией, она появится в «Моих заметках».');
      }
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
          <Empty title="Заметка недоступна" text="Сообщение с ней удалили, или вы больше не в этом чате." />
        </Card>
      </Screen>
    );
  }
  const canRequest = !!v && !v.is_owner && v.original_exists && v.my_request?.status !== 'pending';
  const line = v && requestLine(v);
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {v && (
        <>
          <PageHero
            variant="notes"
            icon={NotebookPen}
            compact
            eyebrow={v.is_owner ? 'Ваша заметка' : `Заметка · ${v.sender_name ?? 'удалённый аккаунт'}`}
            title={noteTitle(v.title)}
            subtitle={`Снимок от ${new Date(v.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`}
          />
          <Card style={{ padding: 18, gap: 16 }}>
            {v.body.trim() ? <Markdown source={v.body} /> : <Text tone="faint">Без текста — только файлы.</Text>}
            {v.attachments.length > 0 && <AttachmentList items={v.attachments} />}
          </Card>
          {line && (
            <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>
              {line}
            </Text>
          )}
          {v.is_owner ? (
            v.original_note_id && <Button title="Открыть мою заметку" variant="accent" icon={<NotebookPen size={18} color={p.accentInk} />} onPress={() => router.push(`/my-notes/${v.original_note_id}`)} />
          ) : v.accepted_note_id ? (
            <Button title="Открыть у себя" variant="accent" icon={<NotebookPen size={18} color={p.accentInk} />} onPress={() => router.push(`/my-notes/${v.accepted_note_id}`)} />
          ) : (
            <Button title="Сохранить к себе" variant="accent" icon={<BookmarkPlus size={18} color={p.accentInk} />} loading={busy === 'accept'} onPress={() => void run('accept')} />
          )}
          {canRequest && <Button title="Запросить свежую версию" variant="secondary" icon={<RefreshCw size={16} color={p.ink} />} loading={busy === 'request'} onPress={() => void run('request')} />}
        </>
      )}
    </Screen>
  );
}
