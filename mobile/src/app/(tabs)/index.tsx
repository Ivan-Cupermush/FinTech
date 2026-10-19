import { router } from 'expo-router';
import { HandHelping, LogOut, Plus } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { formatDate } from '@offix/core';
import { greeting } from '../../lib/logic';
import { useDashboard, useMe, useMetrics } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { usePalette } from '../../lib/theme';
import { GoalTile, RiskItem, TaskRow } from '../../ui/domain';
import { EffectSummary } from '../../ui/effect';
import { Button, Card, Empty, Screen, SectionTitle, Text } from '../../ui/primitives';

/** Пульс: что под угрозой, кому помочь и мои задачи — за 10 секунд. */
export default function Pulse() {
  const p = usePalette();
  const me = useMe();
  const dash = useDashboard();
  const metrics = useMetrics();
  const { logout } = useSession();
  const d = dash.data;
  const critical = d?.risks.filter((r) => r.severity === 'critical').length ?? 0;
  return (
    <Screen refreshing={dash.isRefetching} onRefresh={() => void Promise.all([dash.refetch(), metrics.refetch()])}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: 6, flex: 1 }}>
          <Text variant="eyebrow" tone="faint">
            {d ? formatDate(d.today, { today: '0000' }) : ' '}
          </Text>
          <Text variant="h1">
            {greeting(new Date().getHours())}
            {me.data ? `, ${me.data.display_name.split(' ')[0]}` : ''}
          </Text>
          {d && (
            <Text tone="muted">{critical ? `${critical} ${critical === 1 ? 'вопрос требует' : 'вопроса требуют'} решения сегодня.` : 'Критичных вопросов нет — цели идут по плану.'}</Text>
          )}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Выйти" onPress={() => void logout().then(() => router.replace('/login'))} hitSlop={12} style={{ padding: 6 }}>
          <LogOut size={20} color={p.ink3} />
        </Pressable>
      </View>

      {dash.isError && (
        <Card>
          <Empty title="Не удалось загрузить" text={(dash.error as Error).message} action={<Button title="Повторить" variant="secondary" onPress={() => dash.refetch()} />} />
        </Card>
      )}

      {d && (
        <>
          {d.goals.length ? (
            d.goals.map((g) => <GoalTile key={g.id} goal={g} today={d.today} onPress={() => router.push(`/goal/${g.id}`)} />)
          ) : (
            <Card>
              <Empty title="Начните с одной измеримой цели" text="Опишите, какой показатель должен измениться, — offix построит путь и покажет, где теряется время." />
            </Card>
          )}

          {metrics.data && <EffectSummary r={metrics.data} />}

          {d.risks.length > 0 && (
            <>
              <SectionTitle title="Требует внимания" right={<Text tone="faint">{d.risks.length}</Text>} />
              <Card style={{ gap: 0, paddingVertical: 6 }}>
                {d.risks.map((r) => (
                  <RiskItem key={r.goal_id + r.id} risk={r} goalTitle={r.goal_title} onPress={() => (r.task_ids[0] ? router.push(`/task/${r.task_ids[0]}`) : router.push(`/goal/${r.goal_id}`))} />
                ))}
              </Card>
            </>
          )}

          {d.help_needed.length > 0 && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <HandHelping size={18} color={p.ink} />
                <Text variant="title">Кому нужна помощь</Text>
              </View>
              <Card style={{ gap: 0, paddingVertical: 4 }}>
                {d.help_needed.map((t) => (
                  <TaskRow key={t.id} task={t} today={d.today} onPress={() => router.push(`/task/${t.id}`)} />
                ))}
              </Card>
            </>
          )}

          <SectionTitle title="Мои задачи" />
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {d.my_tasks.length ? (
              d.my_tasks.slice(0, 6).map((t) => <TaskRow key={t.id} task={t} today={d.today} showAssignee={false} onPress={() => router.push(`/task/${t.id}`)} />)
            ) : (
              <Text tone="faint" style={{ paddingVertical: 12 }}>
                Открытых задач нет.
              </Text>
            )}
          </Card>

          <Button title="Новая цель" variant="secondary" icon={<Plus size={18} color={p.ink} />} onPress={() => router.push('/goal/new')} />
        </>
      )}
    </Screen>
  );
}
