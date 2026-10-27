import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { MESSAGE_MAX, matchesQuery, sortChats } from '@offix/core';
import { ck, useChats } from '../../lib/chats';
import { myNotesApi } from '../../lib/personal-api';
import { font, usePalette } from '../../lib/theme';
import { ChatAvatar } from '../../ui/chats';
import { Button, Card, Input, Screen, Text } from '../../ui/primitives';

/** Отправить мою заметку в чат: выбор чата и подпись. В чат уходит снимок. */
export default function SendNoteScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const p = usePalette();
  const qc = useQueryClient();
  const chats = useChats();
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = sortChats(chats.data ?? []).filter((c) => matchesQuery([c.title], q));

  const send = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await myNotesApi.share(id, target.id, { text });
      void qc.invalidateQueries({ queryKey: ck.list });
      router.replace({ pathname: '/chat/[id]', params: { id: target.id } });
    } catch (e) {
      Alert.alert('Не отправилось', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen glow={false}>
      <Text tone="muted">{`«${title ?? 'Заметка'}» уйдёт снимком: получатели увидят текст и файлы на эту минуту, а правки потом останутся у вас.`}</Text>
      <Input label="Найти чат" value={q} onChangeText={setQ} placeholder="Название или имя" autoCorrect={false} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {list.map((c, i) => {
          const on = target?.id === c.id;
          return (
            <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={c.title} onPress={() => setTarget({ id: c.id, title: c.title })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: p.line, opacity: pressed ? 0.7 : 1 })}>
              <ChatAvatar title={c.title} group={c.type === 'group'} size={40} userId={c.peer?.id} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold }}>
                  {c.title}
                </Text>
                <Text variant="caption" tone="faint" numberOfLines={1}>
                  {c.type === 'group' ? `${c.members_count} участников` : (c.peer?.position ?? 'Личный чат')}
                </Text>
              </View>
              {on && <Check size={18} color={p.accent} />}
            </Pressable>
          );
        })}
        {chats.data && !list.length && (
          <Text tone="faint" style={{ paddingVertical: 12 }}>
            Чатов не нашлось
          </Text>
        )}
      </Card>
      <Input label="Подпись" value={text} onChangeText={setText} placeholder="Необязательно" multiline maxLength={MESSAGE_MAX} />
      <Button title={target ? `Отправить в «${target.title}»` : 'Выберите чат'} variant="accent" disabled={!target} loading={busy} onPress={() => void send()} />
    </Screen>
  );
}
