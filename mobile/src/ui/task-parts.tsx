import { Archive, ArchiveRestore, Check, Flag, HandHeart, Plus, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import {
  CHECKPOINTS_MAX,
  CHECKPOINT_STATE_LABELS,
  TASK_LIGHT_LABELS,
  archiveNote,
  canThank,
  checkpointProgress,
  checkpointState,
  formatDate,
  validateCheckpoint,
  type Checkpoint,
  type TaskDetail,
  type TaskLightView,
} from '@offix/core';
import { usePeople } from '../lib/chats';
import { tasksApi, useTaskAction } from '../lib/tasks-api';
import { font, usePalette } from '../lib/theme';
import { PeoplePicker } from './chats';
import { LightDot } from './domain';
import { Avatar, Button, Card, Input, Text } from './primitives';

const fail = (e: unknown) => Alert.alert('Не получилось', e instanceof Error ? e.message : '');

/** Светофор одной строкой: цвет, что он значит и почему. */
export function LightLine({ view }: { view: TaskLightView }) {
  const p = usePalette();
  const bg = view.light === 'red' ? p.badSoft : view.light === 'yellow' ? p.warnSoft : p.goodSoft;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: bg }}>
      <LightDot view={view} size={12} />
      <Text variant="small" style={{ flex: 1 }}>
        <Text variant="small" style={{ fontFamily: font.semibold }}>
          {TASK_LIGHT_LABELS[view.light]}
        </Text>
        {` · ${view.reason}`}
      </Text>
    </View>
  );
}

/** Выполненная просьба: автор благодарит, исполнитель видит «спасибо». */
export function ThanksCard({ task, meId, today }: { task: TaskDetail; meId: string; today: string }) {
  const p = usePalette();
  const thank = useTaskAction((id: string) => tasksApi.thanks(id));
  if (task.kind !== 'request' || task.status !== 'done' || (task.created_by !== meId && !task.thanked_at)) return null;
  const text = task.thanked_at
    ? task.created_by === meId
      ? `Вы поблагодарили ${formatDate(task.thanked_at.slice(0, 10), { short: true, today })}`
      : `${task.created_by_name ?? 'Автор'} благодарит вас`
    : `${task.assignee?.display_name ?? 'Коллега'} выполнил(а) вашу просьбу`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: p.goodSoft }}>
      <HandHeart size={20} color={p.good} />
      <Text variant="small" style={{ flex: 1 }}>
        {text}
      </Text>
      {canThank(task, meId) && <Button title="Спасибо" variant="accent" loading={thank.isPending} onPress={() => thank.mutate(task.id, { onError: fail })} style={{ minHeight: 36, paddingHorizontal: 14 }} />}
    </View>
  );
}

/** Архив: когда и кто убрал; вернуть — тот, кто может менять задачу. */
export function ArchiveCard({ task, today }: { task: TaskDetail; today: string }) {
  const p = usePalette();
  const act = useTaskAction((back: boolean) => (back ? tasksApi.unarchive(task.id) : tasksApi.archive(task.id)));
  if (task.archived) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: p.ink3, backgroundColor: p.surface2 }}>
        <Archive size={18} color={p.ink3} />
        <Text variant="small" style={{ flex: 1 }}>
          {archiveNote({ archived_at: task.archived.at, archived_by_name: task.archived.by_name }, today)}
        </Text>
        {task.permissions?.edit && <Button title="Вернуть" variant="secondary" icon={<ArchiveRestore size={15} color={p.ink} />} loading={act.isPending} onPress={() => act.mutate(true, { onError: fail })} style={{ minHeight: 36, paddingHorizontal: 12 }} />}
      </View>
    );
  }
  if (!task.permissions?.edit || (task.status !== 'done' && task.status !== 'cancelled')) return null;
  return <Button title="Убрать в архив" variant="ghost" icon={<Archive size={16} color={p.ink2} />} loading={act.isPending} onPress={() => act.mutate(false, { onError: fail })} />;
}

/**
 * Контрольные точки: ставит автор, отмечает тот, кто принимает работу, —
 * автор, согласующий или наблюдатель (в просьбе — сам исполнитель).
 */
export function CheckpointsCard({ task, today }: { task: TaskDetail; today: string }) {
  const p = usePalette();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(task.due_at && task.due_at < today ? task.due_at : today);
  const [touched, setTouched] = useState(false);
  const add = useTaskAction((v: { title: string; due_at: string }) => tasksApi.addCheckpoint(task.id, v));
  const mark = useTaskAction((v: { cid: string; status: Checkpoint['status'] }) => tasksApi.markCheckpoint(task.id, v.cid, v.status));
  const remove = useTaskAction((cid: string) => tasksApi.removeCheckpoint(task.id, cid));
  // В закрытой задаче точки уже не ставят и не убирают.
  const edit = !!task.permissions?.edit && !task.archived && task.status !== 'done' && task.status !== 'cancelled';
  const canMark = !!task.permissions?.mark && !task.archived;
  const list = [...task.checkpoints].sort((a, b) => a.due_at.localeCompare(b.due_at));
  const progress = checkpointProgress(list);
  const errors = validateCheckpoint({ title, due_at: due }, task.due_at);
  if (!list.length && !edit) return null;
  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    add.mutate({ title: title.trim(), due_at: due }, { onSuccess: () => (setTitle(''), setTouched(false)), onError: fail });
  };
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Flag size={16} color={p.ink} />
        <Text variant="title" style={{ flex: 1 }}>
          Контрольные точки
        </Text>
        {list.length > 0 && (
          <Text variant="caption" tone="faint">
            {progress.done} из {progress.total}
          </Text>
        )}
      </View>
      {list.map((c, i) => {
        const state = checkpointState(c, today);
        const done = c.status === 'done';
        const tone = state === 'late' || state === 'missed' ? p.bad : state === 'soon' ? p.warn : p.ink3;
        return (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 10 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: p.line }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done, disabled: !canMark }}
              accessibilityLabel={done ? `Снять отметку: ${c.title}` : `Отметить пройденной: ${c.title}`}
              disabled={!canMark || mark.isPending}
              onPress={() => mark.mutate({ cid: c.id, status: done ? 'pending' : 'done' }, { onError: fail })}
              hitSlop={8}
              style={{ width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: done || c.status === 'missed' ? 0 : 1.5, borderColor: state === 'late' ? p.bad : p.ink3, backgroundColor: done ? p.good : c.status === 'missed' ? p.bad : 'transparent' }}
            >
              {done ? <Check size={14} color="#fff" /> : c.status === 'missed' ? <X size={14} color="#fff" /> : null}
            </Pressable>
            <View style={{ flex: 1, gap: 1 }}>
              <Text numberOfLines={2} style={{ color: done ? p.ink3 : p.ink, textDecorationLine: done ? 'line-through' : 'none' }}>
                {c.title}
              </Text>
              <Text variant="caption" style={{ color: tone }}>
                {state === 'late' || state === 'missed' || state === 'soon' ? `${CHECKPOINT_STATE_LABELS[state]} · ` : ''}
                {formatDate(c.due_at, { short: true, today })}
                {done && c.done_by_name ? ` · отметил(а) ${c.done_by_name}` : ''}
              </Text>
            </View>
            {canMark && state === 'late' && (
              <Pressable accessibilityRole="button" onPress={() => mark.mutate({ cid: c.id, status: 'missed' }, { onError: fail })} hitSlop={6}>
                <Text variant="caption" tone="bad">
                  Сорвана
                </Text>
              </Pressable>
            )}
            {edit && (
              <Pressable accessibilityRole="button" accessibilityLabel={`Убрать точку «${c.title}»`} onPress={() => remove.mutate(c.id, { onError: fail })} hitSlop={8}>
                <Trash2 size={16} color={p.ink3} />
              </Pressable>
            )}
          </View>
        );
      })}
      {edit && list.length < CHECKPOINTS_MAX && (
        <View style={{ gap: 8, paddingTop: list.length ? 6 : 0 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 3 }}>
              <Input label="Новая точка" value={title} onChangeText={setTitle} placeholder="Что должно быть готово" maxLength={200} error={touched ? (errors.title ?? null) : null} />
            </View>
            <View style={{ flex: 2 }}>
              <Input label="Срок" value={due} onChangeText={setDue} placeholder="ГГГГ-ММ-ДД" error={touched ? (errors.due_at ?? null) : null} />
            </View>
          </View>
          <Button title="Добавить точку" variant="secondary" icon={<Plus size={15} color={p.ink} />} loading={add.isPending} onPress={submit} />
        </View>
      )}
    </Card>
  );
}

/** Наблюдатели рядом с согласующим: видят ход работы и отмечают точки, но статус не меняют. */
export function WatchersCard({ task }: { task: TaskDetail }) {
  const p = usePalette();
  const [editing, setEditing] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const people = usePeople(search.trim());
  const save = useTaskAction((ids: string[]) => tasksApi.watchers(task.id, ids));
  const watchers = task.participants.filter((w) => w.role === 'watcher');
  const edit = !!task.permissions?.edit && !task.archived;
  if (task.kind === 'request' || (!watchers.length && !edit)) return null;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title">Наблюдатели</Text>
        {edit && editing === null && (
          <Pressable accessibilityRole="button" accessibilityLabel={watchers.length ? 'Изменить наблюдателей' : 'Добавить наблюдателей'} onPress={() => setEditing(watchers.map((w) => w.user_id))} hitSlop={8}>
            <Text variant="small" tone="accent">
              {watchers.length ? 'Изменить' : 'Добавить'}
            </Text>
          </Pressable>
        )}
      </View>
      {editing === null ? (
        watchers.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {watchers.map((w) => (
              <View key={w.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Avatar name={w.display_name} id={w.user_id} size={22} />
                <Text variant="small">{w.display_name}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text variant="small" tone="faint">
            Добавьте тех, кому важно видеть ход работы: они получат уведомления и смогут отмечать контрольные точки.
          </Text>
        )
      ) : (
        <>
          <Input label="Поиск" value={search} onChangeText={setSearch} placeholder="Имя или должность" autoCorrect={false} />
          <PeoplePicker people={people.data ?? []} selected={editing} exclude={task.assignee ? [task.assignee.id] : []} excludeNote="исполнитель" onToggle={(id) => setEditing((l) => (l!.includes(id) ? l!.filter((x) => x !== id) : [...l!, id]))} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Отмена" variant="ghost" style={{ flex: 1 }} onPress={() => setEditing(null)} />
            <Button title="Сохранить" variant="accent" style={{ flex: 1 }} loading={save.isPending} onPress={() => save.mutate(editing, { onSuccess: () => setEditing(null), onError: fail })} />
          </View>
        </>
      )}
    </Card>
  );
}
