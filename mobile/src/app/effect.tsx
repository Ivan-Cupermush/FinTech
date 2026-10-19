import { router } from 'expo-router';
import { ChevronRight, FileText } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import {
  MOVEMENT_LABELS,
  MOVEMENT_TONES,
  effectSteps,
  formatDelta,
  formatHours,
  formatPercent,
  northStarCaption,
  plural,
  seriesTrend,
  todayIso,
  trendText,
  type MetricsReport,
  type Movement,
} from '@offix/core';
import { effectRoute } from '../lib/logic';
import { useMetrics } from '../lib/queries';
import { font, usePalette } from '../lib/theme';
import { MovementBar, Sparkline } from '../ui/effect';
import { Button, Card, Empty, Pill, Screen, SectionTitle, Text } from '../ui/primitives';

/** Эффект: двигает ли работа показатели. Та же картина, что на сайте, в одну колонку. */
export default function Effect() {
  const q = useMetrics();
  const r = q.data;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <View style={{ gap: 6 }}>
        <Text variant="eyebrow" tone="faint">
          {r ? `${r.scope === 'company' ? 'Вся компания' : 'Цели вашей зоны'} · ${r.window_days} дней` : ' '}
        </Text>
        <Text tone="muted">Двигает ли работа показатели. Считается по замерам и истории задач, без ручных отчётов.</Text>
      </View>
      <ReportLink />
      {q.isError && (
        <Card>
          <Empty title="Не удалось посчитать метрики" text={(q.error as Error).message} action={<Button title="Повторить" variant="secondary" onPress={() => q.refetch()} />} />
        </Card>
      )}
      {r && (r.north_star.total === 0 && r.launch.total === 0 ? (
        <Card>
          <Empty title="Эффект появится с первой целью" text="Запустите цель с KPI и внесите первый замер — здесь будет видно, сдвигает ли работа показатель." />
        </Card>
      ) : (
        <Report r={r} />
      ))}
    </Screen>
  );
}

function ReportLink() {
  const p = usePalette();
  return <Button title="Отчёт для руководства" variant="secondary" icon={<FileText size={18} color={p.ink} />} onPress={() => router.push('/report')} />;
}

const ORDER: Movement[] = ['improved', 'flat', 'worse', 'stale'];

function Report({ r }: { r: MetricsReport }) {
  const p = usePalette();
  const ns = r.north_star;
  const steps = effectSteps(r, todayIso());
  return (
    <>
      <Card style={{ gap: 14 }}>
        <Text variant="eyebrow" tone="faint">
          Северная звезда
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={{ fontSize: 72, lineHeight: 76, fontFamily: font.bold, letterSpacing: -4 }}>{ns.value === null ? '—' : ns.value}</Text>
          {ns.value !== null && <Text style={{ fontSize: 30, fontFamily: font.semibold, color: p.ink3, marginLeft: 4 }}>%</Text>}
        </View>
        <Text tone="muted">{northStarCaption(r)}</Text>
        {ns.total > 0 && <MovementBar counts={ns.counts} />}
        {ns.total > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {ORDER.map((k) => (
              <Text key={k} variant="caption" tone={ns.counts[k] ? 'muted' : 'faint'}>
                {MOVEMENT_LABELS[k]} <Text variant="caption" style={{ fontFamily: font.semibold }}>{ns.counts[k]}</Text>
              </Text>
            ))}
          </View>
        )}
        <Sparkline values={r.series.north_star} max={100} height={72} label="Северная звезда по неделям" />
        <Text variant="caption" tone="faint" style={{ textAlign: 'right' }}>
          {trendText(seriesTrend(r.series.north_star)) ?? ' '}
        </Text>
      </Card>

      {ns.items.length > 0 && (
        <>
          <SectionTitle title={`Цели за ${r.window_days} дней`} />
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {ns.items.map((i, k) => (
              <Pressable key={i.id} accessibilityRole="button" onPress={() => router.push(`/goal/${i.id}`)} style={{ paddingVertical: 12, gap: 6, borderTopWidth: k ? 1 : 0, borderTopColor: p.line }}>
                <Text style={{ fontFamily: font.medium }}>{i.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Pill tone={MOVEMENT_TONES[i.movement]} dot>
                    {MOVEMENT_LABELS[i.movement]}
                  </Pill>
                  {i.delta !== null && (
                    <Text variant="small" tone={i.delta > 0 ? 'good' : i.delta < 0 ? 'bad' : 'muted'} style={{ fontFamily: font.semibold }}>
                      {formatDelta(i.delta)}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))}
          </Card>
        </>
      )}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Tile title="Свежесть замеров" value={formatPercent(r.freshness.value)} caption={r.freshness.total ? `${r.freshness.fresh} из ${r.freshness.total} KPI` : 'Нет KPI'} series={r.series.freshness} max={100} />
        <Tile title="Запуск целей" value={formatPercent(r.launch.value)} caption={r.launch.total ? `${r.launch.launched} из ${r.launch.total} за ${r.launch.within_days} дней` : 'Пока рано'} />
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Tile
          title="Снятие блокера"
          value={formatHours(r.blockers.median_hours)}
          caption={r.blockers.resolved ? `медиана по ${r.blockers.resolved} ${plural(r.blockers.resolved, ['блокеру', 'блокерам', 'блокерам'])}` : 'Снятых блокеров нет'}
          series={r.series.blocker_hours}
          color={p.ink2}
        />
        <Tile title="Задачи в срок" value={formatPercent(r.on_time.value)} caption={r.on_time.total ? `${r.on_time.on_time} из ${r.on_time.total} не позже срока` : 'Задачи не закрывали'} series={r.series.on_time} max={100} />
      </View>

      <SectionTitle title="Что поднимет цифры" />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {steps.length ? (
          steps.map((s, k) => (
            <Pressable key={s.key} accessibilityRole="button" accessibilityLabel={`${s.title}. ${s.cta}`} onPress={() => router.push(effectRoute(s.target) as never)} style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: k ? 1 : 0, borderTopColor: p.line }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: s.tone === 'bad' ? p.bad : s.tone === 'warn' ? p.warn : p.ink3 }} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ fontFamily: font.medium }}>{s.title}</Text>
                <Text variant="small" tone="faint">
                  {s.hint}
                </Text>
                <Text variant="small" tone="accent" style={{ fontFamily: font.semibold, marginTop: 2 }}>
                  {s.cta}
                </Text>
              </View>
              <ChevronRight size={18} color={p.ink3} style={{ marginTop: 4 }} />
            </Pressable>
          ))
        ) : (
          <Text tone="faint" style={{ paddingVertical: 12 }}>
            Замеры свежие, блокеров нет, показатели движутся.
          </Text>
        )}
      </Card>
    </>
  );
}

function Tile({ title, value, caption, series, max, color }: { title: string; value: string; caption: string; series?: readonly (number | null)[]; max?: number; color?: string }) {
  return (
    <Card style={{ flex: 1, gap: 6 }}>
      <Text variant="small" tone="muted" style={{ fontFamily: font.medium }}>
        {title}
      </Text>
      <Text style={{ fontSize: 28, lineHeight: 32, fontFamily: font.bold, letterSpacing: -1.2 }}>{value}</Text>
      <Text variant="caption" tone="faint">
        {caption}
      </Text>
      {series && <Sparkline values={series} max={max} color={color} height={36} label={`${title} по неделям`} />}
    </Card>
  );
}
