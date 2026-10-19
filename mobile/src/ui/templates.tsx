import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  GOAL_TEMPLATES,
  TEMPLATE_AREA_LABELS,
  applyTemplate,
  canCreateGoal,
  formatNumber,
  parseNumber,
  searchTemplates,
  templateDueDate,
  templateSummary,
  todayIso,
  UNITS,
  validateGoal,
  type GoalCard,
  type GoalTemplate,
  type Me,
} from '@offix/core';
import { ApiError, newIdempotencyKey } from '../lib/client';
import { templateDueChoices, templateKpiText } from '../lib/logic';
import { api } from '../lib/session';
import { font, usePalette } from '../lib/theme';
import { Button, Card, Empty, Input, Text } from './primitives';

/** Список шаблонов с поиском. Нажатие — открыть шаблон. */
export function TemplateList({ onPick }: { onPick: (t: GoalTemplate) => void }) {
  const [query, setQuery] = useState('');
  const list = searchTemplates(GOAL_TEMPLATES, query);
  return (
    <View style={{ gap: 10 }}>
      <Input label="Поиск шаблона" value={query} onChangeText={setQuery} placeholder="Договор, NPS, заявка…" />
      {list.map((t) => (
        <Card key={t.key} onPress={() => onPick(t)} style={{ gap: 6 }}>
          <Text variant="eyebrow" tone="faint">
            {TEMPLATE_AREA_LABELS[t.area]}
          </Text>
          <Text variant="title">{t.title}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <Text variant="small" tone="faint" style={{ flex: 1 }}>
              {t.kpi.name}
            </Text>
            <Text style={{ fontFamily: font.semibold }}>{templateKpiText(t)}</Text>
          </View>
          <Text variant="caption" tone="faint">
            {templateSummary(t)}
          </Text>
        </Card>
      ))}
      {!list.length && (
        <Card>
          <Empty title="Шаблон не найден" text="Попробуйте другое слово или создайте цель с нуля." />
        </Card>
      )}
    </View>
  );
}

const FIELD: Record<string, string> = { 'metrics.0.baseline': 'baseline', 'metrics.0.target': 'target' };

/**
 * Цель из шаблона на телефоне: свои цифры «было → цель» и срок. Владелец —
 * тот, кто ставит цель; переназначить и поправить задачи можно на карточке.
 */
export function TemplateApply({ t, me, onBack, onCreated }: { t: GoalTemplate; me: Me | undefined; onBack: () => void; onCreated: (goal: GoalCard) => void }) {
  const p = usePalette();
  const today = todayIso();
  const u = UNITS[t.kpi.unit];
  const [baseline, setBaseline] = useState(formatNumber(t.kpi.baseline, u.decimals));
  const [target, setTarget] = useState(formatNumber(t.kpi.target, u.decimals));
  const [dueAt, setDueAt] = useState(templateDueDate(t, today));
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());

  const b = parseNumber(baseline);
  const g = parseNumber(target);
  const plan = applyTemplate(t, { owner_id: me?.id ?? '', due_at: dueAt, today, baseline: b ?? NaN, target: g ?? NaN });
  const errors: Record<string, string> = { ...server };
  for (const [k, v] of Object.entries(validateGoal(plan.goal, 'active', today))) errors[FIELD[k] ?? k] ??= v;
  const err = (k: string) => (tried ? (errors[k] ?? null) : (server[k] ?? null));
  const allowed = !me || canCreateGoal(me, t.type);

  const create = async () => {
    setTried(true);
    if (Object.keys(errors).length || !me) return;
    setBusy(true);
    setBanner(null);
    try {
      const goal = await api<GoalCard>(`/templates/${t.key}/apply`, { body: { owner_id: me.id, due_at: dueAt, baseline: b, target: g }, idempotencyKey: key.current });
      onCreated(goal);
    } catch (x) {
      if (x instanceof ApiError) {
        setServer(Object.fromEntries(Object.entries(x.fields).map(([k, v]) => [FIELD[k] ?? k, v])));
        setBanner(x.message);
      } else setBanner('Не удалось создать цель. Попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const chip = (selected: boolean) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: selected ? p.ink : p.line, backgroundColor: selected ? p.ink : p.surface });

  return (
    <View style={{ gap: 14 }}>
      <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8}>
        <Text variant="small" tone="muted">
          ← Все шаблоны
        </Text>
      </Pressable>
      <View style={{ gap: 4 }}>
        <Text variant="eyebrow" tone="faint">
          {TEMPLATE_AREA_LABELS[t.area]}
        </Text>
        <Text variant="h2">{t.title}</Text>
        <Text variant="small" tone="muted">
          {t.description}
        </Text>
      </View>
      {banner && (
        <View accessibilityRole="alert" style={{ backgroundColor: p.warnSoft, padding: 12, borderRadius: 12 }}>
          <Text variant="small" tone="warn">
            {banner}
          </Text>
        </View>
      )}
      {!allowed && (
        <Text variant="small" tone="warn">
          Недостаточно прав: такие цели ставят руководители. Личную цель создайте с нуля.
        </Text>
      )}
      <Card>
        <Text style={{ fontFamily: font.semibold }}>{t.kpi.name}</Text>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Input label="Сейчас" value={baseline} onChangeText={(v) => (setBaseline(v), setServer({}))} keyboardType="decimal-pad" error={err('baseline')} />
          </View>
          <Text style={{ marginTop: 38, color: p.ink3, fontSize: 18 }}>→</Text>
          <View style={{ flex: 1 }}>
            <Input label={`Цель, ${u.short}`} value={target} onChangeText={(v) => (setTarget(v), setServer({}))} keyboardType="decimal-pad" error={err('target')} />
          </View>
        </View>
        <Text variant="caption" tone="faint">
          {t.kpi.hint}. Цифры типичные — замените своими.
        </Text>
      </Card>
      <Card>
        <Text variant="small" style={{ fontFamily: font.medium }}>
          Срок
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {templateDueChoices(t, today).map((d) => (
            <Pressable key={d.value} onPress={() => setDueAt(d.value)} style={chip(dueAt === d.value)} accessibilityRole="radio" accessibilityState={{ checked: dueAt === d.value }}>
              <Text variant="small" style={{ color: dueAt === d.value ? p.bg : p.ink }}>
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Input label="Или дата" value={dueAt} onChangeText={(v) => (setDueAt(v), setServer({}))} placeholder="ГГГГ-ММ-ДД" error={err('due_at')} />
        <Text variant="caption" tone="faint">
          Владелец — {me?.display_name ?? 'вы'}. Переназначить можно на карточке цели.
        </Text>
      </Card>
      <Card style={{ gap: 8 }}>
        <Text variant="eyebrow" tone="faint">
          План · {templateSummary(t)}
        </Text>
        {t.subgoals.map((s) => (
          <View key={s.key} style={{ gap: 2 }}>
            <Text variant="small" style={{ fontFamily: font.semibold }}>
              {s.title}
            </Text>
            {t.tasks
              .filter((k) => k.subgoal === s.key)
              .map((k) => (
                <Text key={k.key} variant="small" tone="muted">
                  · {k.title}
                </Text>
              ))}
          </View>
        ))}
      </Card>
      <Button title="Создать черновик" onPress={() => void create()} loading={busy} disabled={!allowed} />
    </View>
  );
}
