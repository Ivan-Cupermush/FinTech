import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { CHAT_NAME_MAX, validateChatName } from '@offix/core';
import { chatApi, ck, usePeople } from '../../lib/chats';
import { useMe } from '../../lib/queries';
import { font, usePalette } from '../../lib/theme';
import { PeoplePicker } from '../../ui/chats';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { Button, Card, Input, Screen, Text } from '../../ui/primitives';

/** Новый чат: личный — одним касанием по коллеге, группа — название, участники, темы. */
export default function NewChatScreen() {
  const p = usePalette();
  const qc = useQueryClient();
  const me = useMe();
  const [kind, setKind] = useState<'direct' | 'group'>('direct');
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [topics, setTopics] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = usePeople(q.trim());
  const nameErr = validateChatName(name);

  const open = async (fn: () => Promise<{ id: string }>) => {
    setBusy(true);
    try {
      const c = await fn();
      void qc.invalidateQueries({ queryKey: ck.list });
      router.replace({ pathname: '/chat/[id]', params: { id: c.id } });
    } catch (e) {
      Alert.alert('Не удалось создать чат', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen glow={false}>
      <LiquidSegmented
        label="Тип чата"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'direct', label: 'Личный' },
          { value: 'group', label: 'Группа' },
        ]}
      />
      {kind === 'group' && (
        <Card>
          <Input label="Название группы" value={name} onChangeText={setName} placeholder="Например, «Приёмная кампания»" maxLength={CHAT_NAME_MAX} error={touched ? nameErr : null} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.semibold }}>С темами</Text>
              <Text variant="caption" tone="faint">
                Отдельные ветки для разных вопросов
              </Text>
            </View>
            <Switch value={topics} onValueChange={setTopics} trackColor={{ true: p.accent }} accessibilityLabel="Группа с темами" />
          </View>
        </Card>
      )}
      <Input label={kind === 'group' ? 'Участники' : 'Кому написать'} value={q} onChangeText={setQ} placeholder="Имя или должность" autoCorrect={false} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <PeoplePicker
          people={people.data ?? []}
          single={kind === 'direct'}
          selected={ids}
          meId={me.data?.id}
          onToggle={(uid) => {
            if (kind === 'direct') void open(() => chatApi.direct(uid));
            else setIds((x) => (x.includes(uid) ? x.filter((y) => y !== uid) : [...x, uid]));
          }}
        />
      </Card>
      {kind === 'group' && (
        <Button
          title={ids.length ? `Создать группу · ${ids.length + 1}` : 'Создать группу'}
          variant="accent"
          loading={busy}
          onPress={() => {
            setTouched(true);
            if (!nameErr) void open(() => chatApi.createGroup({ name: name.trim(), member_ids: ids, supergroup: topics }));
          }}
        />
      )}
    </Screen>
  );
}
