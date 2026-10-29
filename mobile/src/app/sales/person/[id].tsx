import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { coverageText, formatNumber, formatRub, plansLine } from '@offix/core';
import { useMe } from '../../../lib/queries';
import { employeeTaskFigures, salesHeroStats, salesToday } from '../../../lib/sales';
import { useSalesEmployee } from '../../../lib/sales-api';
import { font, usePalette } from '../../../lib/theme';
import { PageHero } from '../../../ui/fx/PageHero';
import { Button, Card, Empty, Screen, SectionTitle, Text } from '../../../ui/primitives';
import { MonthSwitcher } from '../../../ui/sales';
import { errText, SalesMonthBody } from '../../../ui/sales-month';

/** Продажи сотрудника для руководителя: его месяц, задачи и что он продаёт. */
export default function SalesPersonScreen() {
  const { id, month: m0 } = useLocalSearchParams<{ id: string; month?: string }>();
  const p = usePalette();
  const today = salesToday();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(m0 && /^\d{4}-(0[1-9]|1[0-2])$/.test(m0) ? m0 : current);
  const me = useMe();
  const e = useSalesEmployee(id, month);
  const d = e.data;
  return (
    <Screen refreshing={e.isRefetching} onRefresh={() => e.refetch()}>
      <Stack.Screen options={{ title: d?.month.user.name ?? 'Сотрудник' }} />
      <PageHero
        variant="sales"
        icon={Wallet}
        eyebrow={d?.month.user.position ?? 'Продажи сотрудника'}
        title={d?.month.user.name ?? 'Сотрудник'}
        subtitle={d ? `${coverageText(d.month.coverage)} · ${plansLine(d.month.plans).toLowerCase()}` : undefined}
        stats={d ? salesHeroStats(d.month) : undefined}
      />
      <MonthSwitcher month={month} current={current} onChange={setMonth} />
      {e.isError && (
        <Card>
          <Empty title="Не удалось открыть продажи сотрудника" text={errText(e.error)} action={<Button title="Повторить" variant="secondary" onPress={() => e.refetch()} />} />
        </Card>
      )}
      {d && (
        <>
          <SalesMonthBody m={d.month} today={today} self={d.month.user.id === me.data?.id} />

          <SectionTitle title="Задачи" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {employeeTaskFigures(d.tasks).map((t) => (
              <Card key={t.label} style={{ flexBasis: '47%', flexGrow: 1, gap: 2 }}>
                <Text tone={t.bad ? 'bad' : 'ink'} style={{ fontFamily: font.bold, fontSize: 24, lineHeight: 28 }}>
                  {t.value}
                </Text>
                <Text variant="caption" tone="faint">
                  {t.label}
                </Text>
              </Card>
            ))}
          </View>
          <Pressable accessibilityRole="link" onPress={() => router.push(`/person/${d.month.user.id}`)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text variant="small" tone="accent">
              Профиль сотрудника →
            </Text>
          </Pressable>

          <SectionTitle title="Что продаёт" />
          <Card style={{ paddingVertical: 4 }}>
            {d.top_products.length ? (
              d.top_products.map((x, i) => (
                <View key={x.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: p.line }}>
                  <Text style={{ flex: 1 }} numberOfLines={2}>
                    {x.name}
                  </Text>
                  <Text variant="caption" tone="faint">
                    {formatNumber(x.quantity, 2)} шт
                  </Text>
                  <Text style={{ fontFamily: font.semibold }}>{formatRub(x.revenue)}</Text>
                </View>
              ))
            ) : (
              <Text variant="small" tone="faint" style={{ paddingVertical: 12 }}>
                За месяц продаж нет.
              </Text>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
