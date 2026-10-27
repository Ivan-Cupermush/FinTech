import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { CHECKPOINTS_MAX, requestDuePresets, todayIso, validateRequest } from '@offix/core';
import { usePeople } from '../lib/chats';
import { ApiError } from '../lib/client';
import { useMe } from '../lib/queries';
import { tasksApi, useTaskAction } from '../lib/tasks-api';
import { font, usePalette } from '../lib/theme';
import { PeoplePicker } from '../ui/chats';
import { Avatar, Button, Card, Input, Screen, Text } from '../ui/primitives';

/** Просьба коллеге: кого просим, о чём и к какому дню. Он отметит «Выполнено», а вы поблагодарите. */
export default function RequestScreen() {
  const { to } = useLocalSearchParams<{ to?: string }>();
  const p = usePalette();
  const me = useMe();
  const qc = useQueryClient();
  const today = todayIso();
  const [search, setSearch] = useState('');
  const people = usePeople(search.trim());
  const all = usePeople('');
  const [assignee, setAssignee] = useState<string | null>(to ?? null);
  const [picking, setPicking] = useState(!to);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [due, setDue] = useState('');
  const [cps, setCps] = useState<{ title: string; due_at: string }[]>([]);
  const [touched, setTouched] = useState(false);
  const [server, setServer] = useState<Record<string, string>>({});
  const create = useTaskAction(tasksApi.create);
  const person = (all.data ?? []).find((u) => u.id === assignee) ?? (people.data ?? []).find((u) => u.id === assignee);
  const form = { title, assignee_id: assignee, due_at: due || null, checkpoints: cps };
  const errors = { ...validateRequest(form, me.data?.id ?? '', today), ...server };
  const err = (k: string) => (touched ? (errors[k] ?? null) : null);

  const submit = () => {
    setTouched(true);
    if (Object.keys(validateRequest(form, me.data?.id ?? '', today)).length) return;
    create.mutate(
      { kind: 'request', title: title.trim(), description: details.trim() || null, assignee_id: assignee, due_at: due || null, checkpoints: cps.map((c) => ({ title: c.title.trim(), due_at: c.due_at })) },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: ['tasks'] });
          router.back();
          Alert.alert('Просьба отправлена', `${person?.display_name ?? 'Коллега'} увидит её во «Входящих».`);
        },
        onError: (e) => {
          if (e instanceof ApiError && Object.keys(e.fields).length) setServer(e.fields);
          else Alert.alert('Не удалось отправить', e instanceof Error ? e.message : '');
        },
      },
    );
  };

  return (
    <Screen glow={false}>
      <Text variant="small" tone="muted">
        Попросите коллегу из любого отдела. Он отметит «Выполнено», а вы сможете поблагодарить.
      </Text>
      <Card style={{ gap: 10 }}>
        <Text variant="eyebrow" tone="faint">
          Кого просите
        </Text>
        {person && !picking ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={person.display_name} id={person.id} size={36} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.semibold }}>
                {person.display_name}
              </Text>
              {!!person.position && (
                <Text variant="caption" tone="faint" numberOfLines={1}>
                  {person.position}
                </Text>
              )}
            </View>
            <Button title="Изменить" variant="ghost" onPress={() => setPicking(true)} style={{ minHeight: 34, paddingHorizontal: 10 }} />
          </View>
        ) : (
          <>
            <Input label="Поиск" value={search} onChangeText={setSearch} placeholder="Имя или должность" autoCorrect={false} />
            <PeoplePicker
              // Наблюдателю просьбу не отправить — он только смотрит.
              people={(people.data ?? []).filter((u) => u.role !== 'observer')}
              single
              selected={assignee ? [assignee] : []}
              meId={me.data?.id}
              onToggle={(id) => {
                setAssignee(id);
                setPicking(false);
                setServer(({ assignee_id: _, ...rest }) => rest);
              }}
            />
          </>
        )}
        {!!err('assignee_id') && (
          <Text variant="caption" tone="bad">
            {errors.assignee_id}
          </Text>
        )}
      </Card>
      <Card style={{ gap: 12 }}>
        <Input label="О чём просите" value={title} onChangeText={setTitle} placeholder="Например, подписать приказ о практике" maxLength={220} error={err('title')} />
        <Input label="Подробности" value={details} onChangeText={setDetails} placeholder="Что именно нужно и где взять данные" multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
        <Text variant="eyebrow" tone="faint">
          К какому дню
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[{ label: 'Без срока', value: '' }, ...requestDuePresets(today)].map((d) => {
            const on = due === d.value;
            return (
              <Pressable key={d.label} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setDue(d.value)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? p.ink : p.line, backgroundColor: on ? p.ink : p.surface }}>
                <Text variant="small" style={{ color: on ? p.bg : p.ink }}>
                  {d.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Input label="Или дата" value={due} onChangeText={setDue} placeholder="ГГГГ-ММ-ДД" error={err('due_at')} />
      </Card>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="eyebrow" tone="faint">
            Контрольные точки
          </Text>
          {cps.length < CHECKPOINTS_MAX && (
            <Pressable accessibilityRole="button" accessibilityLabel="Добавить контрольную точку" onPress={() => setCps((l) => [...l, { title: '', due_at: due || today }])} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Plus size={15} color={p.accent} />
              <Text variant="small" tone="accent">
                Добавить
              </Text>
            </Pressable>
          )}
        </View>
        {!cps.length && (
          <Text variant="small" tone="faint">
            Промежуточные сроки: например, «черновик — к среде».
          </Text>
        )}
        {cps.map((c, i) => (
          <View key={i} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <View style={{ flex: 3 }}>
                <Input label={`Точка ${i + 1}`} value={c.title} placeholder="Что будет готово" onChangeText={(v) => setCps((l) => l.map((x, j) => (j === i ? { ...x, title: v } : x)))} />
              </View>
              <View style={{ flex: 2 }}>
                <Input label="Срок" value={c.due_at} placeholder="ГГГГ-ММ-ДД" onChangeText={(v) => setCps((l) => l.map((x, j) => (j === i ? { ...x, due_at: v } : x)))} />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Убрать точку ${i + 1}`} onPress={() => setCps((l) => l.filter((_, j) => j !== i))} hitSlop={8} style={{ height: 48, justifyContent: 'center' }}>
                <Trash2 size={18} color={p.ink3} />
              </Pressable>
            </View>
            {!!err(`checkpoints.${i}`) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <X size={13} color={p.bad} />
                <Text variant="caption" tone="bad">
                  {errors[`checkpoints.${i}`]}
                </Text>
              </View>
            )}
          </View>
        ))}
      </Card>
      <Button title="Отправить просьбу" variant="accent" loading={create.isPending} onPress={submit} />
    </Screen>
  );
}
