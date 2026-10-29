import { CheckCircle2, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import {
  coverageText,
  formatDate,
  formatNumber,
  formatRub,
  monthTitle,
  PLAN_SOURCE_LABELS,
  planBar,
  planForecastText,
  planPayParts,
  planTone,
  salesMonthNav,
  salesValueText,
  type SaleEntry,
  type SalesMonth,
  type SalesPlan,
} from '@offix/core';
import { payoutScale } from '../lib/sales';
import { font, radius, usePalette, type Tone } from '../lib/theme';
import { Glass } from './fx/Glass';
import { GradientBackdrop } from './fx/GradientBackdrop';
import { Card, Pill, Text } from './primitives';

/** ‹ Октябрь 2026 › — вперёд не дальше следующего месяца: план ставят заранее. */
export function MonthSwitcher({ month, current, onChange }: { month: string; current: string; onChange: (m: string) => void }) {
  const p = usePalette();
  const nav = salesMonthNav(month, current);
  const arrow = (label: string, icon: ReactNode, target: string | null) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !target }}
      disabled={!target}
      onPress={() => target && onChange(target)}
      hitSlop={8}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface2, opacity: !target ? 0.35 : pressed ? 0.7 : 1 })}
    >
      {icon}
    </Pressable>
  );
  return (
    <View accessibilityRole="toolbar" accessibilityLabel="Месяц" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 6, borderRadius: 999, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line }}>
      {arrow('Предыдущий месяц', <ChevronLeft size={18} color={p.ink} />, nav.prev)}
      <Text accessibilityLiveRegion="polite" style={{ flex: 1, textAlign: 'center', fontFamily: font.semibold }}>
        {monthTitle(month)}
      </Text>
      {arrow('Следующий месяц', <ChevronRight size={18} color={p.ink} />, nav.next)}
    </View>
  );
}

/** Главная цифра месяца — выплата: стекло на градиенте раздела и шкала «сейчас → прогноз → максимум». */
export function PayoutCard({ m }: { m: SalesMonth }) {
  const t = m.totals;
  const file = t.file != null;
  const scale = payoutScale(t);
  const figure = (label: string, value: number) => (
    <View style={{ flex: 1, gap: 2 }}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#fff', fontFamily: font.semibold, fontSize: 15 }}>
        {formatRub(value)}
      </Text>
      <Text variant="caption" style={{ color: 'rgba(255,255,255,0.7)' }}>
        {label}
      </Text>
    </View>
  );
  return (
    // Статичный градиент, а не живой: на экране уже есть GL-шапка, второй холст телефону ни к чему.
    <View style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: '#071c18' }}>
      <GradientBackdrop variant="sales" />
      <View style={{ padding: 12 }}>
        <Glass radius={22}>
          <View style={{ padding: 16, gap: 14 }} accessible accessibilityLabel={`${file ? 'К выплате по файлу KPI' : 'Прогноз выплаты'}: ${formatRub(file ? t.file! : t.forecast)}`}>
            <View style={{ gap: 4 }}>
              <Text variant="eyebrow" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {file ? 'К выплате по файлу KPI' : 'Прогноз выплаты к концу месяца'}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#fff', fontFamily: font.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1.2 }}>
                {formatRub(file ? t.file! : t.forecast)}
              </Text>
              <Text variant="small" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {file ? 'Итоги месяца из файла KPI' : coverageText(m.coverage)}
              </Text>
            </View>
            {scale && (
              <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' }}>
                <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${scale.forecast}%`, backgroundColor: 'rgba(255,255,255,0.32)' }} />
                <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${scale.now}%`, backgroundColor: '#ffd84a' }} />
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {figure('сейчас', t.now)}
              {figure('максимум', t.max)}
              {figure('оклад', t.fixed)}
            </View>
          </View>
        </Glass>
      </View>
    </View>
  );
}

const SOURCE_TONES: Record<SalesPlan['calc']['source'], Tone> = { file: 'info', report: 'accent', manual: 'neutral' };

/** Показатель плана: факт из плана, полоса с прогнозом и порогами, выплата и подсказка. */
export function PlanCard({ plan, today, onFact }: { plan: SalesPlan; today: string; onFact?: () => void }) {
  const p = usePalette();
  const c = plan.calc;
  const fixed = plan.payout_rule.type === 'fixed';
  const bar = planBar(plan, c);
  const tone = planTone(plan);
  const forecast = planForecastText(plan);
  const pay = planPayParts(plan);
  const fill = tone === 'done' ? p.good : tone === 'behind' ? p.warn : p.accent;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="title">{plan.name}</Text>
          {c.condition && (
            <Text variant="caption" tone="faint">
              {c.condition}
            </Text>
          )}
        </View>
        <Pill tone={SOURCE_TONES[c.source]}>{PLAN_SOURCE_LABELS[c.source]}</Pill>
        {onFact && (
          <Pressable accessibilityRole="button" accessibilityLabel={`Отметить факт «${plan.name}»`} onPress={onFact} hitSlop={8} style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface2, opacity: pressed ? 0.7 : 1 })}>
            <Pencil size={15} color={p.ink2} />
          </Pressable>
        )}
      </View>
      {fixed ? (
        <Text style={{ fontFamily: font.bold, fontSize: 24, lineHeight: 28 }}>{formatRub(c.now ?? 0)}</Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 24, lineHeight: 28, letterSpacing: -0.6 }}>{salesValueText(plan.fact, plan.unit)}</Text>
            {plan.plan > 0 && <Text tone="faint">из {salesValueText(plan.plan, plan.unit)}</Text>}
            {plan.plan > 0 && (
              <Text tone={tone === 'done' ? 'good' : tone === 'behind' ? 'warn' : 'ink'} style={{ marginLeft: 'auto', fontFamily: font.semibold }}>
                {formatNumber(c.percent, 0)}&nbsp;%
              </Text>
            )}
          </View>
          {bar && (
            <View accessible accessibilityRole="progressbar" accessibilityLabel={`Выполнено ${formatNumber(c.percent, 0)} % плана${c.forecast_percent != null ? `, прогноз ${formatNumber(c.forecast_percent, 0)} %` : ''}`} style={{ height: 8, borderRadius: 4, backgroundColor: p.surface2, overflow: 'hidden' }}>
              {bar.forecast != null && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bar.forecast}%`, backgroundColor: fill, opacity: 0.25 }} />}
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bar.fill}%`, backgroundColor: fill, borderRadius: 4 }} />
              {bar.marks.map((m) => (
                <View key={m} style={{ position: 'absolute', top: 0, bottom: 0, left: `${m}%`, width: 2, marginLeft: -1, backgroundColor: p.surface }} />
              ))}
            </View>
          )}
          {forecast && (
            <Text variant="small" tone="muted">
              {forecast}
            </Text>
          )}
        </>
      )}
      {c.items && c.items.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityLabel="Позиции">
          {c.items.map((it) => (
            <View key={it.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: it.done ? p.goodSoft : p.surface2 }}>
              {it.done && <CheckCircle2 size={12} color={p.good} />}
              <Text variant="caption" style={{ color: it.done ? p.good : p.ink2 }}>
                {it.name} {it.count}/{it.need}
              </Text>
            </View>
          ))}
        </View>
      )}
      {pay.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {pay.map((x) => (
            <View key={x.label} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: p.surface2 }}>
              <Text variant="caption" tone="faint">
                {x.label}
              </Text>
              <Text variant="small" style={{ fontFamily: font.semibold }}>
                {x.value}
              </Text>
            </View>
          ))}
        </View>
      )}
      {!!c.rule && !fixed && (
        <Text variant="caption" tone="faint">
          Выплата: {c.rule}
        </Text>
      )}
      {c.hint && (
        <View style={{ padding: 10, borderRadius: radius.sm, backgroundColor: tone === 'done' ? p.goodSoft : p.accentSoft }}>
          <Text variant="small" style={{ color: tone === 'done' ? p.good : p.accent }}>
            {c.hint}
          </Text>
        </View>
      )}
      {c.as_of && (
        <Text variant="caption" tone="faint">
          Данные на {formatDate(c.as_of, { today })}
        </Text>
      )}
    </Card>
  );
}

/** Записанная продажа: дата, товар, клиент, сумма; своё можно удалить. */
export function EntryRow({ e, first, onDelete }: { e: SaleEntry; first?: boolean; onDelete?: () => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: p.line }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.medium }}>
          {e.product}
          {e.quantity !== 1 ? ` × ${formatNumber(e.quantity, 3)}` : ''}
        </Text>
        <Text variant="caption" tone="faint" numberOfLines={1}>
          {formatDate(e.sold_on)}
          {e.client ? ` · ${e.client}` : ''}
        </Text>
      </View>
      <Text style={{ fontFamily: font.semibold }}>{formatRub(e.amount)}</Text>
      {onDelete && e.can_delete && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Удалить «${e.product}»`} onPress={onDelete} hitSlop={8} style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
          <Trash2 size={16} color={p.ink3} />
        </Pressable>
      )}
    </View>
  );
}

/** Выбор одного из коротких вариантов чипами: дата продажи, показатель. */
export function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const p = usePalette();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value || o.label} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)} style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? p.ink : p.line, backgroundColor: on ? p.ink : p.surface, opacity: pressed ? 0.75 : 1 })}>
            <Text variant="small" style={{ color: on ? p.bg : p.ink }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
