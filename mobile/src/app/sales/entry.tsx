import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { entryPlans, validateSaleEntry } from '@offix/core';
import { ApiError } from '../../lib/client';
import { emptyEntry, entryBody, entryDayPresets, salesToday, type EntryDraft } from '../../lib/sales';
import { salesApi, useSalesMonth, useSalesMutation } from '../../lib/sales-api';
import { Button, Card, Input, Screen, Text } from '../../ui/primitives';
import { Chips } from '../../ui/sales';
import { errText } from '../../ui/sales-month';

/**
 * Записать продажу: товар, клиент, количество, сумма и дата. Если факт
 * показателя ведётся вручную, сумма (штуки, клиент) прибавится к нему.
 * Ошибки видны сразу — те же проверки, что на сервере.
 */
export default function SaleEntryScreen() {
  const { month = salesToday().slice(0, 7), user } = useLocalSearchParams<{ month?: string; user?: string }>();
  const today = salesToday();
  const m = useSalesMonth(month, user);
  const plans = entryPlans(m.data?.plans ?? []);
  const [v, setV] = useState<EntryDraft>(() => emptyEntry(today, null));
  const [planTouched, setPlanTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const save = useSalesMutation((body: Record<string, unknown>) => salesApi.addEntry(body));
  // Пока человек не выбрал сам, прибавляем к первому подходящему показателю.
  const planId = planTouched ? v.plan_id : (plans[0]?.id ?? '');

  const set = (k: keyof EntryDraft, x: string) => {
    const next = { ...v, [k]: x };
    setV(next);
    if (tried) setErrors(validateSaleEntry(next, today).errors);
  };

  const submit = () => {
    setTried(true);
    const check = validateSaleEntry(v, today);
    setErrors(check.errors);
    if (!check.entry) return;
    save.mutate(entryBody({ ...v, plan_id: planId }, user), {
      onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/sales')),
      onError: (e) => (e instanceof ApiError && Object.keys(e.fields).length ? setErrors(e.fields) : Alert.alert('Не удалось записать', errText(e))),
    });
  };

  const presets = entryDayPresets(today);
  return (
    <Screen glow={false}>
      <Card style={{ gap: 12 }}>
        <Input label="Товар или услуга" value={v.product} onChangeText={(x) => set('product', x)} placeholder="Курс «Python для аналитиков»" autoFocus maxLength={200} error={errors.product} />
        <Input label="Клиент" value={v.client} onChangeText={(x) => set('client', x)} placeholder="ООО «Альфа»" maxLength={200} error={errors.client} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Input label="Количество" value={v.quantity} onChangeText={(x) => set('quantity', x)} keyboardType="decimal-pad" error={errors.quantity} />
          </View>
          <View style={{ flex: 1.4 }}>
            <Input label="Сумма, ₽" value={v.amount} onChangeText={(x) => set('amount', x)} keyboardType="decimal-pad" placeholder="45 000" error={errors.amount} />
          </View>
        </View>
      </Card>
      <Card style={{ gap: 10 }}>
        <Text variant="eyebrow" tone="faint">
          Когда продали
        </Text>
        <Chips label="Дата продажи" options={presets} value={presets.some((d) => d.value === v.sold_on) ? v.sold_on : ''} onChange={(x) => set('sold_on', x)} />
        <Input label="Или дата" value={v.sold_on} onChangeText={(x) => set('sold_on', x)} placeholder="ГГГГ-ММ-ДД" error={errors.sold_on} />
      </Card>
      {plans.length > 0 && (
        <Card style={{ gap: 10 }}>
          <Text variant="eyebrow" tone="faint">
            Прибавить к показателю
          </Text>
          <Chips
            label="Показатель"
            options={[...plans.map((x) => ({ value: x.id, label: x.name })), { value: '', label: 'Не прибавлять' }]}
            value={planId}
            onChange={(x) => {
              setPlanTouched(true);
              set('plan_id', x);
            }}
          />
          <Text variant="caption" tone="faint">
            Сумма, штуки или клиент добавятся к факту показателя.
          </Text>
        </Card>
      )}
      <Card>
        <Input label="Комментарий" value={v.note} onChangeText={(x) => set('note', x)} maxLength={500} error={errors.note} />
      </Card>
      <Button title="Записать" loading={save.isPending} onPress={submit} />
    </Screen>
  );
}
