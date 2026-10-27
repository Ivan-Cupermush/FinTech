import { router } from 'expo-router';
import { CalendarDays, HandHelping, ListTodo } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { archiveNote, isOverdue, monthOf, noteDayLabel, plural, taskCalendar, taskMonthGrid, tasksForDay, todayIso, type Task } from '@offix/core';
import { TASK_SCOPES, TASK_SCOPE_EMPTY, taskSections, tasksStats, type TaskScope } from '../../lib/logic';
import { useTasks } from '../../lib/queries';
import { font, usePalette } from '../../lib/theme';
import { TaskRow } from '../../ui/domain';
import { Glass } from '../../ui/fx/Glass';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { PageHero } from '../../ui/fx/PageHero';
import { MonthCalendar } from '../../ui/my-notes';
import { Button, Card, Empty, Screen, Text } from '../../ui/primitives';

/** Задачи: мои, все, мои просьбы, наблюдаю и архив; список по срочности или календарь сроков. */
export default function Tasks() {
  const p = usePalette();
  const [scope, setScope] = useState<TaskScope>('mine');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const today = todayIso();
  const [month, setMonth] = useState(monthOf(today));
  const [day, setDay] = useState<string | null>(null);
  const q = useTasks(TASK_SCOPES.find((s) => s.value === scope)!.filter);
  const tasks = q.data ?? [];
  const archive = scope === 'archive';
  const calendar = view === 'calendar' && !archive;
  const sections = taskSections(tasks, today);
  const open = (t: Task) => router.push(`/task/${t.id}`);
  const row = (t: Task) => <TaskRow key={t.id} task={t} today={today} showAssignee={scope !== 'mine'} meta={archive ? archiveNote({ archived_at: t.archived?.at ?? null, archived_by_name: t.archived?.by_name }, today) : undefined} onPress={() => open(t)} />;
  const empty = TASK_SCOPE_EMPTY[scope];

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <PageHero
        variant="tasks"
        icon={ListTodo}
        title="Задачи"
        subtitle="Сначала — то, где нужна помощь."
        stats={q.data && !archive ? tasksStats(tasks, today) : undefined}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="Попросить коллегу" onPress={() => router.push('/request')} hitSlop={8}>
            <Glass radius={18} style={{ height: 36, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <HandHelping size={15} color="#fff" />
              <Text variant="caption" style={{ color: '#fff' }}>
                Попросить
              </Text>
            </Glass>
          </Pressable>
        }
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }} style={{ marginHorizontal: -2 }} accessibilityRole="tablist">
        {TASK_SCOPES.map((s) => {
          const on = s.value === scope;
          return (
            <Pressable
              key={s.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setScope(s.value)}
              style={({ pressed }) => ({ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: on ? p.ink : p.surface, borderWidth: 1, borderColor: on ? p.ink : p.line, opacity: pressed ? 0.7 : 1 })}
            >
              <Text variant="small" style={{ color: on ? p.bg : p.ink, fontFamily: on ? font.semibold : font.medium }}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {!archive && (
        <LiquidSegmented
          label="Вид"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'Список' },
            { value: 'calendar', label: 'Календарь' },
          ]}
        />
      )}
      {calendar ? (
        <CalendarView tasks={tasks} today={today} month={month} day={day} onMonth={setMonth} onDay={setDay} row={row} />
      ) : archive && tasks.length ? (
        <View style={{ gap: 8 }}>
          <Text variant="eyebrow" tone="faint">
            В архиве · {tasks.length}
          </Text>
          <Card style={{ gap: 0, paddingVertical: 4 }}>{tasks.map(row)}</Card>
        </View>
      ) : sections.length ? (
        sections.map((s) => (
          <View key={s.key} style={{ gap: 8 }}>
            <Text variant="eyebrow" tone={s.key === 'blocked' ? 'bad' : s.key === 'overdue' ? 'warn' : 'faint'}>
              {s.title} · {s.data.length}
            </Text>
            <Card style={{ gap: 0, paddingVertical: 4 }}>{s.data.map(row)}</Card>
          </View>
        ))
      ) : (
        !q.isLoading && (
          <Card>
            <Empty title={empty.title} text={empty.text} action={scope === 'requests' ? <Button title="Попросить коллегу" variant="secondary" onPress={() => router.push('/request')} /> : undefined} />
          </Card>
        )
      )}
    </Screen>
  );
}

function CalendarView({ tasks, today, month, day, onMonth, onDay, row }: { tasks: Task[]; today: string; month: string; day: string | null; onMonth: (m: string) => void; onDay: (d: string | null) => void; row: (t: Task) => React.ReactNode }) {
  const p = usePalette();
  const days = taskCalendar(tasks, month, today);
  const total = days.reduce((s, d) => s + d.count, 0);
  const late = days.reduce((s, d) => s + d.late, 0);
  const items = tasksForDay(tasks, day, today);
  const overdue = day ? [] : tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled' && isOverdue(t, today));
  const groups = new Map<string, Task[]>();
  for (const t of items) groups.set(t.due_at!, [...(groups.get(t.due_at!) ?? []), t]);
  return (
    <>
      <MonthCalendar
        label="Календарь задач"
        variant="tasks"
        month={month}
        weeks={taskMonthGrid(month, days, { today, selected: day })}
        summary={total ? `${total} ${plural(total, ['срок', 'срока', 'сроков'])}${late ? ` · ${late} просрочено` : ''}` : 'сроков нет'}
        cellLabel={(c) => (c.count ? `, сроков: ${c.count}${c.late ? `, просрочено: ${c.late}` : ''}` : '')}
        onMonth={onMonth}
        onSelect={onDay}
      />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: -6 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onMonth(monthOf(today));
            onDay(today);
          }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, opacity: pressed ? 0.7 : 1 })}
        >
          <CalendarDays size={15} color={p.ink2} />
          <Text variant="small">Сегодня</Text>
        </Pressable>
        {day && (
          <Pressable accessibilityRole="button" onPress={() => onDay(null)} style={({ pressed }) => ({ justifyContent: 'center', height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, opacity: pressed ? 0.7 : 1 })}>
            <Text variant="small">Ближайшая неделя</Text>
          </Pressable>
        )}
      </View>
      <Text variant="title">{day ? noteDayLabel(day, today) : 'Ближайшая неделя'}</Text>
      {overdue.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text variant="eyebrow" tone="warn">
            Просрочены · {overdue.length}
          </Text>
          <Card style={{ gap: 0, paddingVertical: 4 }}>{overdue.map(row)}</Card>
        </View>
      )}
      {items.length
        ? [...groups.entries()].map(([d, list]) => (
            <View key={d} style={{ gap: 8 }}>
              {!day && (
                <Text variant="eyebrow" tone="faint">
                  {noteDayLabel(d, today)}
                </Text>
              )}
              <Card style={{ gap: 0, paddingVertical: 4 }}>{list.map(row)}</Card>
            </View>
          ))
        : !overdue.length && (
            <Card>
              <Empty title={day ? 'В этот день сроков нет' : 'На неделе сроков нет'} text="Выберите другой день в календаре." />
            </Card>
          )}
    </>
  );
}
