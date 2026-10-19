import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Check, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { BLOCKER_LABELS, checkUnitRange, formatDate, formatDuration, GOAL_STATUS_LABELS, KPI_STATE_LABELS, parseNumber, UNITS, type BlockerReason, type Metric, type Risk } from '@offix/core';
import { dueText } from '../../lib/logic';
import { useInvalidateWork, useRoadmap } from '../../lib/queries';
import { api } from '../../lib/session';
import { font, usePalette } from '../../lib/theme';
import { KpiTrack, RiskItem, TaskRow } from '../../ui/domain';
import { Avatar, Button, Card, Empty, Input, Pill, Screen, SectionTitle, Text } from '../../ui/primitives';
import { DiscussionLink } from '../../ui/discussion';

export default function GoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const q = useRoadmap(id);
  const invalidate = useInvalidateWork();
  const [observe, setObserve] = useState<Metric | null>(null);
  const [busy, setBusy] = useState(false);
  const r = q.data;
  if (!r)
    return (
      <Screen>
        {q.isError ? <Empty title="Цель не найдена" text="Возможно, её удалили или у вас нет к ней доступа." /> : <Text tone="faint">Загружаем…</Text>}
      </Screen>
    );
  const g = r.goal;
  const m = g.metrics.find((x) => x.is_primary) ?? g.metrics[0] ?? null;
  const today = r.timeline.today;
  const due = dueText(g.due_at, today);
  const byId = new Map(r.tasks.map((t) => [t.id, t]));
  const groups = [
    ...r.subgoals.map((s) => ({ id: s.id, title: s.title, owner: s.owner?.display_name, tasks: s.task_ids.map((t) => byId.get(t)).filter((t) => !!t && t.status !== 'cancelled') })),
    ...(r.direct_task_ids.length ? [{ id: 'direct', title: 'Задачи цели', owner: undefined, tasks: r.direct_task_ids.map((t) => byId.get(t)).filter((t) => !!t && t.status !== 'cancelled') }] : []),
  ];
  const ready = g.checklist.every((c) => c.done);

  const activate = async () => {
    setBusy(true);
    try {
      await api(`/goals/${g.id}/activate`, { body: {} });
      await invalidate();
    } catch (e) {
      Alert.alert('Не удалось запустить', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reschedule = (risk: Risk) => {
    const lines = (risk.proposals ?? []).map((x) => `• ${byId.get(x.task_id)?.title ?? 'Задача'}: ${formatDate(x.from_due, { short: true })} → ${formatDate(x.to_due, { short: true })} (+${x.shift_days} дн.)`).join('\n');
    Alert.alert('Перенести сроки?', `${lines}\n\nНичего не изменится, пока вы не подтвердите.`, [
      { text: 'Оставить', style: 'cancel' },
      {
        text: 'Перенести',
        onPress: async () => {
          try {
            await api(`/goals/${g.id}/reschedule`, { body: { changes: (risk.proposals ?? []).map((x) => ({ task_id: x.task_id, start_at: x.to_start, due_at: x.to_due })) } });
            await invalidate();
          } catch (e) {
            Alert.alert('Не удалось перенести', (e as Error).message);
          }
        },
      },
    ]);
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Stack.Screen options={{ title: g.parent_goal_id ? 'Подцель' : 'Цель' }} />
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Pill tone={g.status === 'active' ? 'accent' : g.status === 'completed' ? 'good' : g.status === 'on_hold' ? 'warn' : 'neutral'} dot>
            {GOAL_STATUS_LABELS[g.status]}
          </Pill>
          {g.units.map((u) => (
            <Pill key={u.id}>{u.name}</Pill>
          ))}
        </View>
        <Text variant="h2">{g.title}</Text>
        {g.owner && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Avatar name={g.owner.display_name} size={22} />
            <Text variant="small">{g.owner.display_name}</Text>
            <Text variant="small" tone={due.overdue ? 'bad' : 'faint'}>
              · {due.text}
            </Text>
          </View>
        )}
      </View>

      <Card>
        {m ? (
          <>
            <Text variant="eyebrow" tone="faint">
              {m.name}
            </Text>
            <KpiTrack baseline={m.baseline} target={m.target} current={m.current_value} unit={m.unit} progress={m.progress} size="xl" />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text variant="caption" tone="faint" style={{ flex: 1 }}>
                {m.last_observed_at ? `Замер ${formatDate(m.last_observed_at.slice(0, 10), { today })} · ${KPI_STATE_LABELS[m.progress.state]}` : 'Замеров ещё не было'}
              </Text>
              {g.permissions.record && g.status !== 'draft' && <Button title="Внести" variant="accent" onPress={() => setObserve(m)} style={{ minHeight: 38 }} />}
            </View>
          </>
        ) : (
          <Empty title="KPI не задан" text="Без показателя цель нельзя запустить. Добавьте его на сайте или в мастере." />
        )}
      </Card>

      {g.status === 'draft' && (
        <Card>
          <Text variant="title">{ready ? 'Готова к запуску' : 'Чтобы запустить цель'}</Text>
          {g.checklist.map((c) => (
            <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.done ? p.good : 'transparent', borderWidth: c.done ? 0 : 1.5, borderColor: p.line, borderStyle: 'dashed' }}>{c.done && <Check size={12} color="#fff" />}</View>
              <Text tone={c.done ? 'ink' : 'muted'}>{c.label}</Text>
            </View>
          ))}
          {g.permissions.activate && <Button title="Запустить цель" onPress={activate} disabled={!ready} loading={busy} />}
        </Card>
      )}

      {r.risks.length > 0 && g.status === 'active' && (
        <>
          <SectionTitle title="Риски" right={<Text tone="faint">{r.risks.length}</Text>} />
          <Card style={{ gap: 0, paddingVertical: 6 }}>
            {r.risks.map((risk) => (
              <View key={risk.id}>
                <RiskItem risk={risk} onPress={risk.task_ids[0] ? () => router.push(`/task/${risk.task_ids[0]}`) : undefined} />
                {!!risk.proposals?.length && g.permissions.manage && <Button title="Посмотреть перенос сроков" variant="secondary" onPress={() => reschedule(risk)} style={{ marginLeft: 15, marginBottom: 10, minHeight: 40 }} />}
              </View>
            ))}
          </Card>
        </>
      )}

      <DiscussionLink type="goal" id={g.id} />

      <SectionTitle title="Дорожная карта" />
      {groups.length ? (
        groups.map((grp, i) => (
          <Card key={grp.id} style={{ gap: 0, paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: p.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption">{grp.id === 'direct' ? '·' : i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.semibold }}>{grp.title}</Text>
                {grp.owner && (
                  <Text variant="caption" tone="faint">
                    {grp.owner} · {grp.tasks.filter((t) => t!.status === 'done').length} из {grp.tasks.length}
                  </Text>
                )}
              </View>
              {grp.id !== 'direct' && (
                <Pressable accessibilityLabel="Открыть подцель" onPress={() => router.push(`/goal/${grp.id}`)} hitSlop={10}>
                  <ChevronRight size={18} color={p.ink3} />
                </Pressable>
              )}
            </View>
            {grp.tasks.map((t) => (
              <TaskRow key={t!.id} task={t!} today={today} onPress={() => router.push(`/task/${t!.id}`)} />
            ))}
          </Card>
        ))
      ) : (
        <Card>
          <Empty title="Плана пока нет" text="Разбейте цель на подцели и задачи — offix покажет критический путь и риски." />
        </Card>
      )}

      {r.analytics.bottlenecks.length > 0 && (
        <>
          <SectionTitle title="Где теряется время" />
          <Card>
            {r.analytics.bottlenecks.map((b) => (
              <View key={b.key} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="small">{b.key === 'review' ? 'Ожидание проверки' : (BLOCKER_LABELS[b.key as BlockerReason] ?? b.key)}</Text>
                  <Text variant="small" tone="faint">
                    {formatDuration(b.hours)} · {b.share}%
                  </Text>
                </View>
                <View style={{ height: 6, borderRadius: 6, backgroundColor: p.surface2, overflow: 'hidden' }}>
                  <View style={{ width: `${b.share}%`, height: '100%', backgroundColor: p.warn }} />
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      {observe && <ObserveSheet goalId={g.id} metric={observe} onClose={() => setObserve(null)} />}
    </Screen>
  );
}

function ObserveSheet({ goalId, metric, onClose }: { goalId: string; metric: Metric; onClose: () => void }) {
  const p = usePalette();
  const invalidate = useInvalidateWork();
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = parseNumber(value);
    if (v === null || Number.isNaN(v)) return setError('Введите число');
    const range = checkUnitRange(metric.unit, v);
    if (range) return setError(range);
    setBusy(true);
    try {
      await api(`/goals/${goalId}/metrics/${metric.id}/observations`, { body: { value: v, note: note.trim() || undefined } });
      await invalidate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <View style={{ backgroundColor: p.bg, padding: 20, paddingBottom: 40, gap: 14, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
        <Text variant="title">Внести фактическое значение</Text>
        <Text variant="small" tone="muted">
          {metric.name}. Цель — {metric.target} {UNITS[metric.unit].short}.
        </Text>
        <Input label={`Значение, ${UNITS[metric.unit].short}`} value={value} onChangeText={(t) => (setValue(t), setError(null))} keyboardType="decimal-pad" autoFocus error={error} />
        <Input label="Откуда цифра" value={note} onChangeText={setNote} placeholder="Замер по 120 заявкам за неделю" />
        <Button title="Сохранить" onPress={save} loading={busy} />
      </View>
    </Modal>
  );
}
