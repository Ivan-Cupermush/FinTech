import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { BLOCKER_LABELS, BLOCKER_REASONS, diffDays, formatDate, lightOf, plural, requestBadge, TASK_ROLE_LABELS, TASK_STATUS_LABELS, todayIso, type BlockerReason, type TaskRole } from '@offix/core';
import { dueText, taskActions } from '../../lib/logic';
import { useMe, useTask, useTaskStatus } from '../../lib/queries';
import { font, usePalette } from '../../lib/theme';
import { RequestBadge, TaskStatusPill } from '../../ui/domain';
import { ArchiveCard, CheckpointsCard, LightLine, ThanksCard, WatchersCard } from '../../ui/task-parts';
import { Avatar, Button, Card, Empty, Input, Screen, Text } from '../../ui/primitives';
import { DiscussionLink } from '../../ui/discussion';
import { TaskFiles } from '../../ui/files';

/** Задача: главный вопрос — что мешает и что делать дальше. Блокер без причины поставить нельзя. */
export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const q = useTask(id);
  const me = useMe();
  const status = useTaskStatus();
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState<BlockerReason | null>(null);
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const t = q.data;
  const today = todayIso();
  if (!t) return <Screen>{q.isError ? <Empty title="Задача не найдена" text="Возможно, у вас нет к ней доступа." /> : <Text tone="faint">Загружаем…</Text>}</Screen>;
  const due = dueText(t.due_at, today);
  const light = t.archived ? null : lightOf(t, today);
  const meId = me.data?.id ?? '';
  const request = t.kind === 'request';

  const change = async (to: string) => {
    if (to === 'blocked') return setBlocking(true);
    try {
      await status.mutateAsync({ id: t.id, status: to });
    } catch (e) {
      Alert.alert('Не удалось изменить статус', (e as Error).message);
    }
  };

  const block = async () => {
    if (!reason) return setError('Выберите, что мешает');
    try {
      await status.mutateAsync({ id: t.id, status: 'blocked', blocked_reason: reason, blocked_note: note.trim() || undefined, next_step: next.trim() || undefined });
      setBlocking(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {request && <RequestBadge text={requestBadge(t, meId)} />}
          <TaskStatusPill task={t} today={today} />
        </View>
        <Text variant="h2">{t.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {t.assignee && (
            <>
              <Avatar name={t.assignee.display_name} id={t.assignee.id} size={22} />
              <Text variant="small">{t.assignee.display_name}</Text>
            </>
          )}
          <Text variant="small" tone={due.overdue ? 'bad' : 'faint'}>
            {due.text}
          </Text>
        </View>
      </View>

      <ArchiveCard task={t} today={today} />
      {light && <LightLine view={light} />}
      <ThanksCard task={t} meId={meId} today={today} />

      {t.blocker && (
        <Card style={{ backgroundColor: p.badSoft, borderColor: p.badSoft }}>
          <Text variant="eyebrow" tone="bad">
            Заблокирована · {(() => {
              const d = diffDays(t.blocker.since.slice(0, 10), today);
              return d > 0 ? `${d} ${plural(d, ['день', 'дня', 'дней'])}` : 'с сегодня';
            })()}
          </Text>
          <Text style={{ fontFamily: font.semibold }}>{BLOCKER_LABELS[t.blocker.reason]}</Text>
          {t.blocker.note && <Text tone="muted">{t.blocker.note}</Text>}
          {t.blocker.next_step && <Text variant="small">Следующий шаг: {t.blocker.next_step}</Text>}
        </Card>
      )}

      {t.permissions?.status && !blocking && !t.archived && (
        <View style={{ gap: 8 }}>
          {taskActions(t).map((a) => (
            <Button key={a.status} title={a.label} variant={a.primary ? 'primary' : a.status === 'blocked' ? 'danger' : 'secondary'} loading={status.isPending && status.variables?.status === a.status} onPress={() => change(a.status)} />
          ))}
        </View>
      )}

      {blocking && (
        <Card>
          <Text variant="title">Что мешает?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {BLOCKER_REASONS.map((r) => (
              <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: reason === r }} onPress={() => (setReason(r), setError(null))} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: reason === r ? p.ink : p.line, backgroundColor: reason === r ? p.ink : p.surface }}>
                <Text variant="small" style={{ color: reason === r ? p.bg : p.ink }}>
                  {BLOCKER_LABELS[r]}
                </Text>
              </Pressable>
            ))}
          </View>
          {error && (
            <Text variant="caption" tone="bad">
              {error}
            </Text>
          )}
          <Input label="Подробнее" value={note} onChangeText={setNote} placeholder="Нет доступа к справочнику подразделений" />
          <Input label="Что нужно, чтобы двинуться дальше" value={next} onChangeText={setNext} placeholder="Доступ от IT до пятницы" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Отмена" variant="ghost" onPress={() => setBlocking(false)} style={{ flex: 1 }} />
            <Button title="Сообщить о блокере" variant="danger" onPress={block} loading={status.isPending} style={{ flex: 2 }} />
          </View>
          <Text variant="caption" tone="faint">
            Руководитель увидит блокер в Пульсе сразу.
          </Text>
        </Card>
      )}

      {(t.description || t.definition_of_done) && (
        <Card>
          {t.description && <Text>{t.description}</Text>}
          {t.definition_of_done && (
            <Text variant="small" tone="muted">
              Готово, когда: {t.definition_of_done}
            </Text>
          )}
        </Card>
      )}

      {t.dependencies.length > 0 && (
        <Card style={{ gap: 8 }}>
          <Text variant="eyebrow" tone="faint">
            Зависимости
          </Text>
          {t.dependencies.map((d) => (
            <View key={d.id + d.direction} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text variant="small" style={{ flex: 1 }}>
                {d.direction === 'before' ? 'После: ' : 'Ждёт эту: '}
                {d.title}
              </Text>
              <Text variant="caption" tone="faint">
                {TASK_STATUS_LABELS[d.status]}
              </Text>
            </View>
          ))}
        </Card>
      )}

      <CheckpointsCard key={t.id} task={t} today={today} />

      <TaskFiles task={t} />

      <WatchersCard task={t} />

      {t.participants.some((x) => x.role !== 'watcher') && (
        <Card style={{ gap: 8 }}>
          <Text variant="eyebrow" tone="faint">
            Участники
          </Text>
          {t.participants
            .filter((x) => x.role !== 'watcher')
            .map((x) => (
              <View key={x.user_id + x.role} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Avatar name={x.display_name} id={x.user_id} size={22} />
                <Text variant="small" style={{ flex: 1 }}>
                  {x.display_name}
                </Text>
                <Text variant="caption" tone="faint">
                  {TASK_ROLE_LABELS[x.role as TaskRole] ?? x.role}
                </Text>
              </View>
            ))}
        </Card>
      )}

      <DiscussionLink type="task" id={t.id} title={t.title} />

      {t.history.length > 0 && (
        <Card style={{ gap: 8 }}>
          <Text variant="eyebrow" tone="faint">
            История
          </Text>
          {[...t.history].reverse().map((h, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text variant="small" style={{ flex: 1 }}>
                {TASK_STATUS_LABELS[h.status]}
                {h.blocked_reason ? ` — ${BLOCKER_LABELS[h.blocked_reason]}` : ''}
                {h.actor_name ? ` · ${h.actor_name}` : ''}
              </Text>
              <Text variant="caption" tone="faint">
                {formatDate(h.at.slice(0, 10), { short: true, today })}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
