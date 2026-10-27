import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Building2, MessageCircle, Pencil, Plus, Users } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { CONTACT_NAME_MAX, COMPANY_ROLE_LABELS, contactNameError, lastSeenText, nameFor } from '@offix/core';
import { chatApi, ck, useChatLive } from '../../lib/chats';
import { absUri } from '../../lib/files';
import { accountApi, mk, usePerson, usePersonGroups } from '../../lib/personal-api';
import { font, usePalette } from '../../lib/theme';
import { PageHero } from '../../ui/fx/PageHero';
import { Avatar, Button, Card, Empty, Input, Screen, Text } from '../../ui/primitives';

/**
 * Карточка коллеги: подразделения, «Написать», своё имя для него
 * (видите только вы) и добавление в мои группы.
 */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const qc = useQueryClient();
  const live = useChatLive();
  const q = usePerson(id);
  const person = q.data;
  const groups = usePersonGroups(id, !!person && !person.is_me);
  const [rename, setRename] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (q.isError) {
    return (
      <Screen>
        <Card>
          <Empty title="Сотрудник не найден" text="Возможно, это сотрудник другой компании или ссылка устарела." />
        </Card>
      </Screen>
    );
  }
  if (!person) return <Screen>{null}</Screen>;
  const shown = nameFor(new Map(person.my_name ? [[person.id, person.my_name]] : []), person.id, person.display_name);
  const online = live.online.has(person.id) || (person.online && !live.lastSeen.has(person.id));

  const write = async () => {
    setBusy('write');
    try {
      const c = await chatApi.direct(person.id);
      void qc.invalidateQueries({ queryKey: ck.list });
      router.push({ pathname: '/chat/[id]', params: { id: c.id } });
    } catch (e) {
      Alert.alert('Не получилось', e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  };
  const saveName = async (value: string) => {
    setBusy('name');
    try {
      await accountApi.contactName(person.id, value.trim());
      await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: mk.names }), qc.invalidateQueries({ queryKey: ck.list })]);
      setRename(null);
    } catch (e) {
      Alert.alert('Имя не сохранилось', e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  };
  const addTo = async (chatId: string, title: string) => {
    setBusy(chatId);
    try {
      await chatApi.addMembers(chatId, [person.id]);
      await groups.refetch();
      Alert.alert('Готово', `${shown.split(' ')[0]} — в группе «${title}»`);
    } catch (e) {
      Alert.alert('Не получилось', e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Stack.Screen options={{ title: person.is_me ? 'Это вы' : 'Коллега' }} />
      <PageHero
        variant="profile"
        eyebrow={person.is_me ? 'Это вы' : online ? 'в сети' : lastSeenText(false, live.lastSeen.get(person.id) ?? person.last_seen_at, new Date().toISOString())}
        title={shown}
        subtitle={[person.my_name ? `Настоящее имя — ${person.display_name}` : null, person.position, COMPANY_ROLE_LABELS[person.role]].filter(Boolean).join(' · ')}
        right={<Avatar name={person.display_name} id={person.id} uri={absUri(person.avatar_url)} size={56} />}
      />
      {person.is_me ? (
        <Button title="Открыть мой профиль" variant="secondary" onPress={() => router.replace('/profile')} />
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {person.active && <Button title="Написать" variant="accent" style={{ flex: 1 }} icon={<MessageCircle size={17} color={p.accentInk} />} loading={busy === 'write'} onPress={() => void write()} />}
          <Button title="Переименовать" variant="secondary" style={{ flex: 1 }} icon={<Pencil size={16} color={p.ink} />} onPress={() => setRename(person.my_name ?? '')} />
        </View>
      )}
      {rename !== null && (
        <Card style={{ gap: 12 }}>
          <Input label="Имя для себя" value={rename} onChangeText={setRename} placeholder={person.display_name} autoFocus maxLength={CONTACT_NAME_MAX + 10} error={contactNameError(rename)} hint="Видите только вы — в чатах и в карточке. Пустое поле вернёт настоящее имя." />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {person.my_name && <Button title="Вернуть" variant="ghost" style={{ flex: 1 }} disabled={busy === 'name'} onPress={() => void saveName('')} />}
            <Button title="Сохранить" variant="accent" style={{ flex: 1 }} loading={busy === 'name'} disabled={!!contactNameError(rename)} onPress={() => void saveName(rename)} />
          </View>
        </Card>
      )}
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Building2 size={18} color={p.ink} />
          <Text variant="title">О сотруднике</Text>
        </View>
        <Text variant="small" tone="muted">
          {person.email}
        </Text>
        {person.units.length ? (
          person.units.map((u) => (
            <Text key={u.id} variant="small">
              {u.name}
              {u.is_manager ? ' · руководитель' : ''}
            </Text>
          ))
        ) : (
          <Text variant="small" tone="faint">
            Пока не в подразделении
          </Text>
        )}
      </Card>
      {!person.is_me && !!groups.data?.length && (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }}>
            <Users size={18} color={p.ink} />
            <Text variant="title">Мои группы</Text>
          </View>
          {groups.data.map((g) => (
            <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: p.line }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold }}>
                  {g.name}
                </Text>
                <Text variant="caption" tone="faint">
                  {`${g.members} участников`}
                </Text>
              </View>
              {g.is_member ? (
                <Text variant="caption" tone="faint">
                  уже в группе
                </Text>
              ) : g.can_add ? (
                <Button title="Добавить" variant="secondary" icon={<Plus size={14} color={p.ink} />} loading={busy === g.id} onPress={() => void addTo(g.id, g.name)} style={{ minHeight: 34, paddingHorizontal: 12 }} />
              ) : (
                <Text variant="caption" tone="faint">
                  нет прав
                </Text>
              )}
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
