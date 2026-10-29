import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { parseFactInput, SALES_UNIT_LABELS, salesValueText } from '@offix/core';
import { salesToday } from '../../../lib/sales';
import { salesApi, useSalesMonth, useSalesMutation } from '../../../lib/sales-api';
import { Button, Card, Empty, Input, Screen, Text } from '../../../ui/primitives';
import { errText } from '../../../ui/sales-month';

/** Отметить факт показателя, который ведётся вручную: выплата пересчитается сразу. */
export default function SalesFactScreen() {
  const { id, month = salesToday().slice(0, 7), user } = useLocalSearchParams<{ id: string; month?: string; user?: string }>();
  const m = useSalesMonth(month, user);
  const plan = m.data?.plans.find((x) => x.id === id);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useSalesMutation((fact: number) => salesApi.setFact(id, fact));

  // Поле заполняем текущим фактом, когда месяц загрузился.
  useEffect(() => {
    if (plan && value === null) setValue(plan.fact ? String(plan.fact).replace('.', ',') : '');
  }, [plan, value]);

  if (m.isLoading) return <Screen glow={false}>{null}</Screen>;
  if (!plan)
    return (
      <Screen glow={false}>
        <Card>
          <Empty title="Показатель не найден" text={m.error ? errText(m.error) : 'Возможно, его уже удалили.'} />
        </Card>
      </Screen>
    );

  const submit = () => {
    const parsed = parseFactInput(value ?? '');
    if (parsed.value == null) return setError(parsed.error);
    save.mutate(parsed.value, {
      onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/sales')),
      onError: (e) => setError(errText(e)),
    });
  };

  return (
    <Screen glow={false}>
      <Card style={{ gap: 12 }}>
        <Text variant="title">{plan.name}</Text>
        <Input
          label={`Факт за месяц, ${SALES_UNIT_LABELS[plan.unit].short}`}
          value={value ?? ''}
          onChangeText={(x) => {
            setValue(x);
            setError(null);
          }}
          keyboardType="decimal-pad"
          autoFocus
          onSubmitEditing={submit}
          error={error}
          hint={plan.plan > 0 ? `План — ${salesValueText(plan.plan, plan.unit)}` : undefined}
        />
      </Card>
      <Button title="Сохранить" loading={save.isPending} onPress={submit} />
    </Screen>
  );
}
