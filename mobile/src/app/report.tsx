import { router } from 'expo-router';
import { Share2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import {
  HEALTH_LABELS,
  HEALTH_TONES,
  REPORT_PERIOD_LABELS,
  REPORT_PERIODS,
  formatDelta,
  formatHours,
  kpiLine,
  plural,
  reportPeriodText,
  reportText,
  type Report,
  type ReportPeriod,
} from '@offix/core';
import { useReport } from '../lib/queries';
import { font, radius, usePalette } from '../lib/theme';
import { Button, Card, Empty, Pill, Screen, SectionTitle, Text } from '../ui/primitives';

/**
 * Отчёт для руководства на телефоне: главное, решения и цели в одну колонку.
 * «Поделиться» отправляет тот же текст, что сайт копирует в буфер, — в
 * мессенджер или почту. PDF и Excel — на сайте.
 */
export default function ReportScreen() {
  const [period, setPeriod] = useState<ReportPeriod>(30);
  const q = useReport(period);
  const r = q.data;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <PeriodPicker value={period} onChange={setPeriod} />
      {q.isError && (
        <Card>
          <Empty title="Не удалось собрать отчёт" text={(q.error as Error).message} action={<Button title="Повторить" variant="secondary" onPress={() => q.refetch()} />} />
        </Card>
      )}
      {r && <Body r={r} />}
    </Screen>
  );
}

function PeriodPicker({ value, onChange }: { value: ReportPeriod; onChange: (p: ReportPeriod) => void }) {
  const p = usePalette();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 3, gap: 2, borderRadius: 999, backgroundColor: p.surface2 }}>
      {REPORT_PERIODS.map((d) => {
        const on = d === value;
        return (
          <Pressable
            key={d}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(d)}
            style={{ flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? p.surface : 'transparent' }}
          >
            <Text variant="small" tone={on ? 'ink' : 'muted'} style={{ fontFamily: on ? font.semibold : font.medium }}>
              {REPORT_PERIOD_LABELS[d]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Body({ r }: { r: Report }) {
  const p = usePalette();
  const h = r.headline;
  const share = () => Share.share({ title: `Отчёт offix · ${r.company}`, message: reportText(r) }).catch(() => undefined);
  return (
    <>
      <View style={{ gap: 4 }}>
        <Text variant="eyebrow" tone="faint">
          {r.scope === 'company' ? 'Вся организация' : 'Цели вашей зоны'}
        </Text>
        <Text variant="h2">{reportPeriodText(r)}</Text>
        <Text variant="small" tone="faint">
          {r.company}
        </Text>
      </View>

      {h.goals === 0 ? (
        <Card>
          <Empty title="За период нет целей в работе" text="Запущенные и завершённые за период цели появятся здесь сами." />
        </Card>
      ) : (
        <>
          <Card style={{ gap: 10 }}>
            <Text variant="eyebrow" tone="faint">
              Главное
            </Text>
            {r.summary.map((s) => (
              <View key={s} style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 9, backgroundColor: p.accent }} />
                <Text style={{ flex: 1, fontSize: 16, lineHeight: 23 }}>{s}</Text>
              </View>
            ))}
          </Card>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Figure label="Сдвинули KPI" value={h.north_star === null ? '—' : `${h.north_star} %`} note={h.with_kpi ? `${h.improved} из ${h.with_kpi}` : 'нет KPI'} />
            <Figure label="Под угрозой" value={String(h.health.critical)} note={`из ${h.goals} ${plural(h.goals, ['цели', 'целей', 'целей'])}`} bad={h.health.critical > 0} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Figure label="Закрыто задач" value={String(h.tasks_done)} note={h.on_time === null ? 'без сроков' : `${h.on_time} % в срок`} />
            <Figure label="Снятие блокера" value={formatHours(h.blocker_median_hours)} note={h.open_blockers ? `${h.open_blockers} открыто` : 'открытых нет'} />
          </View>

          {r.decisions.length > 0 && (
            <>
              <SectionTitle title="Нужно решение" />
              <View style={{ gap: 10 }}>
                {r.decisions.map((d, i) => (
                  <Pressable
                    key={`${d.goal_id}:${d.title}`}
                    accessibilityRole="button"
                    onPress={() => router.push(`/goal/${d.goal_id}`)}
                    style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: d.severity === 'critical' ? p.badSoft : p.surface2 }}
                  >
                    <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: d.severity === 'critical' ? p.bad : p.surface }}>
                      <Text variant="small" style={{ fontFamily: font.semibold, color: d.severity === 'critical' ? '#fff' : p.ink }}>
                        {i + 1}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ fontFamily: font.semibold }}>{d.title}</Text>
                      <Text variant="caption" tone="faint">
                        {d.goal_title}
                      </Text>
                      <Text variant="small" tone="muted">
                        {d.explanation}
                      </Text>
                      <Text variant="small" style={{ fontFamily: font.medium }}>
                        → {d.suggestion}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <SectionTitle title="Цели" />
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {r.goals.map((g, k) => (
              <Pressable key={g.id} accessibilityRole="button" onPress={() => router.push(`/goal/${g.id}`)} style={{ paddingVertical: 14, gap: 6, borderTopWidth: k ? 1 : 0, borderTopColor: p.line }}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <Text style={{ flex: 1, fontFamily: font.medium }}>{g.title}</Text>
                  <Pill tone={HEALTH_TONES[g.health]} dot>
                    {HEALTH_LABELS[g.health]}
                  </Pill>
                </View>
                <Text variant="small" tone="muted">
                  {g.kpi ? `${g.kpi.name}: ${kpiLine(g.kpi)}` : 'Без KPI'}
                </Text>
                {g.kpi?.delta != null && (
                  <Text variant="caption" tone={g.kpi.delta > 0 ? 'good' : g.kpi.delta < 0 ? 'bad' : 'faint'}>
                    {formatDelta(g.kpi.delta)} за период{g.kpi.progress !== null ? ` · ${g.kpi.progress} % пути` : ''}
                  </Text>
                )}
              </Pressable>
            ))}
          </Card>
        </>
      )}

      <Button title="Поделиться отчётом" icon={<Share2 size={18} color={p.bg} />} onPress={share} />
      <Text variant="caption" tone="faint" style={{ textAlign: 'center' }}>
        PDF для печати и таблица для Excel — в разделе «Отчёт» на сайте.
      </Text>
    </>
  );
}

function Figure({ label, value, note, bad }: { label: string; value: string; note: string; bad?: boolean }) {
  return (
    <Card style={{ flex: 1, gap: 4 }}>
      <Text variant="small" tone="muted" style={{ fontFamily: font.medium }}>
        {label}
      </Text>
      <Text tone={bad ? 'bad' : 'ink'} style={{ fontSize: 28, lineHeight: 32, fontFamily: font.bold, letterSpacing: -1.2 }}>
        {value}
      </Text>
      <Text variant="caption" tone="faint">
        {note}
      </Text>
    </Card>
  );
}
