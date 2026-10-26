import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { chatApi, ck, useChat, usePeople } from '../../../lib/chats';
import { useMe } from '../../../lib/queries';
import { PeoplePicker } from '../../../ui/chats';
import { Button, Card, Input, Screen } from '../../../ui/primitives';

/** Добавить коллег в группу: поиск и отметки, кто уже в чате — неактивен. */
export default function AddMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const me = useMe();
  const chat = useChat(id);
  const [q, setQ] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const people = usePeople(q.trim());
  const add = async () => {
    setBusy(true);
    try {
      await chatApi.addMembers(id, ids);
      await Promise.all([qc.invalidateQueries({ queryKey: ck.detail(id) }), qc.invalidateQueries({ queryKey: ck.list })]);
      router.back();
    } catch (e) {
      Alert.alert('Не удалось добавить', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen glow={false}>
      <Input label="Кого добавить" value={q} onChangeText={setQ} placeholder="Имя или должность" autoCorrect={false} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <PeoplePicker people={people.data ?? []} selected={ids} exclude={chat.data?.members.map((m) => m.id) ?? []} meId={me.data?.id} onToggle={(uid) => setIds((x) => (x.includes(uid) ? x.filter((y) => y !== uid) : [...x, uid]))} />
      </Card>
      <Button title={ids.length > 1 ? `Добавить ${ids.length}` : 'Добавить'} variant="accent" disabled={!ids.length} loading={busy} onPress={() => void add()} />
    </Screen>
  );
}
