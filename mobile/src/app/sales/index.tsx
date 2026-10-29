import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { coverageText, formatRub, plansLine, teamMemberLine, type SalesTeam } from '@offix/core';
import { defaultSalesView, salesHeroStats, salesToday, teamHeroStats, type SalesView } from '../../lib/sales';
import { useSalesMonth, useSalesTeam } from '../../lib/sales-api';
import { font, usePalette } from '../../lib/theme';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { PageHero } from '../../ui/fx/PageHero';
import { Avatar, Bar, Button, Card, Empty, Screen, Text } from '../../ui/primitives';
import { MonthSwitcher } from '../../ui/sales';
import { errText, SalesMonthBody } from '../../ui/sales-month';

/**
 * Мои продажи: выплата за месяц, показатели плана, продажи, записанные вручную,
 * и загрузка отчёта 1С. У руководителя — вкладка «Команда», а показатели
 * плана и правила выплат он меняет прямо здесь. Файлы KPI — на сайте.
 */
export default function SalesScreen() {
  const params = useLocalSearchParams<{ month?: string; view?: string }>();
  const today = salesToday();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : current);
  const [picked, setView] = useState<SalesView | null>(params.view === 'team' || params.view === 'month' ? params.view : null);
  const m = useSalesMonth(month);
  const can = m.data?.can;
  const view: SalesView = (picked ?? (m.data ? defaultSalesView(m.data) : 'month')) === 'team' && can?.team ? 'team' : 'month';
  const team = useSalesTeam(month, !!can?.team && view === 'team');
  const d = m.data;

  return (
    <Screen refreshing={m.isRefetching || team.isRefetching} onRefresh={() => void Promise.all([m.refetch(), view === 'team' && team.refetch()])}>
      <PageHero
        variant="sales"
        icon={Wallet}
        eyebrow="Продажи и KPI"
        title={view === 'team' ? 'Продажи команды' : 'Мои продажи'}
        subtitle={d ? (view === 'team' ? coverageText(d.coverage) : `${coverageText(d.coverage)} · ${plansLine(d.plans).toLowerCase()}`) : 'План на месяц, выплаты и продажи по отчётам 1С'}
        stats={view === 'team' ? (team.data ? teamHeroStats(team.data) : undefined) : d ? salesHeroStats(d) : undefined}
      />
      {can?.team && (
        <LiquidSegmented<SalesView>
          label="Раздел продаж"
          value={view}
          onChange={setView}
          options={[
            { value: 'month', label: 'Мой месяц' },
            { value: 'team', label: 'Команда' },
          ]}
        />
      )}
      <MonthSwitcher month={month} current={current} onChange={setMonth} />
      {m.isError && (
        <Card>
          <Empty title="Не удалось открыть продажи" text={errText(m.error)} action={<Button title="Повторить" variant="secondary" onPress={() => m.refetch()} />} />
        </Card>
      )}
      {d && (view === 'team' ? <Team month={month} team={team.data} loading={team.isLoading} /> : <SalesMonthBody m={d} today={today} self />)}
    </Screen>
  );
}

/** Команда: кто сколько продал и сколько заработает; нажатие — месяц сотрудника. */
function Team({ month, team, loading }: { month: string; team: SalesTeam | undefined; loading: boolean }) {
  const p = usePalette();
  if (loading || !team) return <Text tone="faint">Загружаю команду…</Text>;
  if (!team.members.length)
    return (
      <Card>
        <Empty title="В команде пока нет продаж" text="Сотрудники появятся здесь, когда им поставят план или придёт отчёт 1С с их продажами." />
      </Card>
    );
  return (
    <Card style={{ paddingVertical: 4 }}>
      {team.members.map((x, i) => (
        <Pressable
          key={x.user.id}
          accessibilityRole="button"
          accessibilityLabel={`${x.user.name}: ${teamMemberLine(x)}`}
          onPress={() => router.push(`/sales/person/${x.user.id}?month=${month}`)}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: p.line, opacity: pressed ? 0.7 : 1 })}
        >
          <Avatar name={x.user.name} id={x.user.id} size={38} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontFamily: font.semibold }} numberOfLines={1}>
              {x.user.name}
            </Text>
            <Text variant="caption" tone="faint" numberOfLines={2}>
              {teamMemberLine(x)}
            </Text>
            {x.percent != null && <Bar percent={x.percent} color={x.percent >= 100 ? p.good : x.percent < 70 ? p.warn : p.accent} />}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={{ fontFamily: font.semibold }}>{formatRub(x.totals.file ?? x.totals.forecast)}</Text>
            <Text variant="caption" tone="faint">
              {x.totals.file != null ? 'к выплате' : 'прогноз'}
            </Text>
          </View>
          <ChevronRight size={16} color={p.ink3} />
        </Pressable>
      ))}
      <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: p.line }}>
        <Text variant="caption" tone="faint">
          План и правила выплат меняются на экране сотрудника. Файлы KPI и сопоставление менеджеров из отчётов — на сайте, в разделе «Продажи».
        </Text>
      </View>
    </Card>
  );
}
