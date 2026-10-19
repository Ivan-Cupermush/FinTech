import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Switch, View } from 'react-native';
import { PUSH_TOPIC_LABELS, PUSH_TOPICS, QUIET_FROM_HOUR, QUIET_TO_HOUR, plural, type PushSettings, type PushTopic } from '@offix/core';
import { api } from '../lib/session';
import { usePalette } from '../lib/theme';
import { Button, Card, Empty, Screen, SectionTitle, Text } from '../ui/primitives';

type Loaded = PushSettings & { devices: number };
const KEY = ['push-settings'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * Какие push приходят на телефон. Уведомления во «Входящих» сохраняются
 * всегда — здесь только то, что будит телефон.
 */
export default function PushSettingsScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<Loaded>('/push/settings') });
  const save = useMutation({
    mutationFn: (s: PushSettings) => api<PushSettings>('/push/settings', { method: 'PUT', body: s }),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Loaded>(KEY);
      if (prev) qc.setQueryData<Loaded>(KEY, { ...prev, ...s });
      return { prev };
    },
    onError: (_e, _s, ctx) => ctx?.prev && qc.setQueryData(KEY, ctx.prev),
  });
  const s = q.data;
  const set = (patch: Partial<PushSettings>) => s && save.mutate({ muted: patch.muted ?? s.muted, quiet_hours: patch.quiet_hours ?? s.quiet_hours });
  const toggle = (t: PushTopic, on: boolean) => s && set({ muted: on ? s.muted.filter((m) => m !== t) : [...s.muted, t] });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isError && (
        <Card>
          <Empty title="Не удалось загрузить настройки" text={(q.error as Error).message} action={<Button title="Повторить" variant="secondary" onPress={() => q.refetch()} />} />
        </Card>
      )}
      {s && (
        <>
          <View style={{ gap: 8 }}>
            <SectionTitle title="Темы" />
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              {PUSH_TOPICS.map((t, i) => (
                <Row key={t} first={i === 0} title={PUSH_TOPIC_LABELS[t].title} hint={PUSH_TOPIC_LABELS[t].hint} value={!s.muted.includes(t)} onChange={(on) => toggle(t, on)} />
              ))}
            </Card>
          </View>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            <Row
              first
              title={`Тихие часы ${hh(QUIET_FROM_HOUR)}–${hh(QUIET_TO_HOUR)}`}
              hint="Ночью push не приходят, кроме блокеров. Всё остальное ждёт во «Входящих»."
              value={s.quiet_hours}
              onChange={(on) => set({ quiet_hours: on })}
            />
          </Card>
          {save.isError && (
            <Text variant="small" tone="bad">
              Не удалось сохранить: {(save.error as Error).message}
            </Text>
          )}
          <Text variant="caption" tone="faint">
            {s.devices ? `Push приходят на ${s.devices} ${plural(s.devices, ['устройство', 'устройства', 'устройств'])}.` : 'Телефон ещё не привязан: включите уведомления во «Входящих».'}
          </Text>
        </>
      )}
    </Screen>
  );
}

function Row({ title, hint, value, onChange, first }: { title: string; hint: string; value: boolean; onChange: (v: boolean) => void; first?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: p.line }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text>{title}</Text>
        <Text variant="small" tone="faint">
          {hint}
        </Text>
      </View>
      <Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ true: p.ink, false: p.surface3 }} thumbColor={p.surface} ios_backgroundColor={p.surface3} />
    </View>
  );
}
