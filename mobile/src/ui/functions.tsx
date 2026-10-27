import { Check, Minus, ShieldCheck } from 'lucide-react-native';
import { Alert, Pressable, Switch, View } from 'react-native';
import { functionWhereText, type DelegableFunction } from '@offix/core';
import { useMyFunctions, useSetFunctions, useUserFunctions, type FunctionsView } from '../lib/tasks-api';
import { font, usePalette } from '../lib/theme';
import { Card, Text } from './primitives';

function FunctionRows({ view, onChange, busy }: { view: FunctionsView; onChange?: (key: DelegableFunction, value: boolean | null) => void; busy?: boolean }) {
  const p = usePalette();
  return (
    <View>
      {view.functions.map((f, i) => (
        <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: p.line }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: font.semibold }}>{f.label}</Text>
            <Text variant="caption" tone="faint">
              {f.hint}
            </Text>
            <Text variant="caption" style={{ color: f.enabled ? p.good : p.ink3 }}>
              {functionWhereText(f)}
            </Text>
            {onChange && f.override !== null && !f.locked && (
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => onChange(f.key, null)} hitSlop={6}>
                <Text variant="caption" tone="accent">
                  {f.default ? 'Вернуть по должности — включено' : 'Вернуть по должности — выключено'}
                </Text>
              </Pressable>
            )}
          </View>
          {onChange ? (
            <Switch value={f.enabled} disabled={busy || f.locked} onValueChange={(v) => onChange(f.key, v)} trackColor={{ true: p.good }} accessibilityLabel={f.label} />
          ) : f.enabled ? (
            <Check size={18} color={p.good} accessibilityLabel="Включено" />
          ) : (
            <Minus size={18} color={p.ink3} accessibilityLabel="Выключено" />
          )}
        </View>
      ))}
    </View>
  );
}

/** Функции коллеги: руководитель включает подчинённому то, что умеет сам; администратор — любому. */
export function PersonFunctionsCard({ userId, name }: { userId: string; name: string }) {
  const p = usePalette();
  const q = useUserFunctions(userId, true);
  const set = useSetFunctions(userId);
  if (!q.data || (!q.data.can_change && !q.data.functions.some((f) => f.enabled))) return null;
  const change = (key: DelegableFunction, value: boolean | null) =>
    set.mutate(
      { [key]: value },
      {
        onSuccess: () => value && Alert.alert('Функция включена', `${name.split(' ')[0]} узнает об этом во «Входящих».`),
        onError: (e) => Alert.alert('Не получилось', e instanceof Error ? e.message : ''),
      },
    );
  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={18} color={p.ink} />
        <Text variant="title">Функции</Text>
      </View>
      <Text variant="small" tone="faint">
        {q.data.can_change ? 'Включите сотруднику то, что он будет делать вместо вас.' : (q.data.reason ?? 'Менять функции может руководитель сотрудника.')}
      </Text>
      <FunctionRows view={q.data} onChange={q.data.can_change ? change : undefined} busy={set.isPending} />
    </Card>
  );
}

/** «Мои функции» в профиле — только посмотреть. */
export function MyFunctionsCard() {
  const p = usePalette();
  const q = useMyFunctions();
  if (!q.data) return null;
  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={18} color={p.ink} />
        <Text variant="title">Мои функции</Text>
      </View>
      <Text variant="small" tone="faint">
        Что вы можете делать сверх обычной работы. Включает и отключает руководитель.
      </Text>
      <FunctionRows view={q.data} />
    </Card>
  );
}
