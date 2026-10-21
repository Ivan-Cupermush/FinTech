import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  DIRECTION_LABELS,
  duePresets,
  emptyForm,
  formatChange,
  formErrors,
  GOAL_TYPE_HINTS,
  GOAL_TYPE_LABELS,
  GOAL_TYPES,
  canCreateGoal,
  parseNumber,
  plannedChange,
  titleHint,
  todayIso,
  toPayload,
  UNIT_IDS,
  UNITS,
  type GoalCard,
  type GoalFormState,
  type GoalTemplate,
  type Member,
} from '@offix/core';
import { ApiError, newIdempotencyKey } from '../../lib/client';
import { useInvalidateWork, useMe } from '../../lib/queries';
import { api } from '../../lib/session';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { font, usePalette } from '../../lib/theme';
import { Avatar, Button, Card, Input, Screen, Text } from '../../ui/primitives';
import { TemplateApply, TemplateList } from '../../ui/templates';

/**
 * Новая цель: «С нуля» — мастер в одну прокрутку (результат → KPI →
 * ответственность), «Из шаблона» — типовая цель вуза с KPI и планом.
 * Та же проверка, что на сайте и сервере.
 */
export default function NewGoal() {
  const p = usePalette();
  const me = useMe();
  const invalidate = useInvalidateWork();
  const today = todayIso();
  const [f, setF] = useState<GoalFormState>(emptyForm);
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'active' | null>(null);
  const [search, setSearch] = useState('');
  const key = useRef(newIdempotencyKey());
  const users = useQuery({ queryKey: ['users', search], queryFn: () => api<Member[]>(`/users?search=${encodeURIComponent(search)}`) });
  const set = <K extends keyof GoalFormState>(k: K, v: GoalFormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const draftErrors = useMemo(() => formErrors(f, 'draft', today), [f, today]);
  const activeErrors = useMemo(() => formErrors(f, 'active', today), [f, today]);
  const err = (k: string) => (tried ? server[k] ?? activeErrors[k] ?? draftErrors[k] : server[k]) ?? null;
  const b = parseNumber(f.baseline);
  const t = parseNumber(f.target);
  const change = b !== null && t !== null && Number.isFinite(b) && Number.isFinite(t) ? plannedChange(b, t) : null;
  const types = GOAL_TYPES.filter((x) => !me.data || canCreateGoal(me.data, x));
  const canTemplate = !me.data || canCreateGoal(me.data, 'operational');
  const [mode, setMode] = useState<'scratch' | 'template'>('template');
  const [tpl, setTpl] = useState<GoalTemplate | null>(null);

  const save = async (status: 'draft' | 'active') => {
    const e = status === 'active' ? activeErrors : draftErrors;
    setTried(true);
    if (Object.keys(e).length) return setBanner(status === 'active' ? 'Чтобы запустить цель, заполните отмеченные поля — или сохраните черновик' : 'Проверьте отмеченные поля');
    setBusy(status);
    setBanner(null);
    try {
      const goal = await api<GoalCard>('/goals', { body: toPayload(f, status), idempotencyKey: `${key.current}:${status}` });
      await invalidate();
      router.replace(`/goal/${goal.id}`);
    } catch (x) {
      if (x instanceof ApiError) {
        const map: Record<string, string> = { owner_id: 'ownerId', due_at: 'dueAt', metrics: 'kpi', 'metrics.0.name': 'kpiName', 'metrics.0.baseline': 'baseline', 'metrics.0.target': 'target' };
        setServer(Object.fromEntries(Object.entries(x.fields).map(([k, v]) => [map[k] ?? k, v])));
        setBanner(x.message);
      } else setBanner('Не удалось сохранить. Попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  };

  const chip = (selected: boolean) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: selected ? p.ink : p.line, backgroundColor: selected ? p.ink : p.surface });

  const start = (
    <LiquidSegmented
      role="radio"
      label="С чего начать"
      value={canTemplate ? mode : 'scratch'}
      onChange={(m) => (setMode(m), setTpl(null))}
      options={[
        { value: 'scratch' as const, label: 'С нуля' },
        { value: 'template' as const, label: 'Из шаблона', disabled: !canTemplate },
      ]}
    />
  );

  if (canTemplate && mode === 'template') {
    return (
      <Screen>
        {start}
        {tpl ? (
          <TemplateApply
            t={tpl}
            me={me.data}
            onBack={() => setTpl(null)}
            onCreated={async (goal) => {
              await invalidate();
              router.replace(`/goal/${goal.id}`);
            }}
          />
        ) : (
          <TemplateList onPick={setTpl} />
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      {start}
      {banner && (
        <View accessibilityRole="alert" style={{ backgroundColor: p.warnSoft, padding: 12, borderRadius: 12 }}>
          <Text variant="small" tone="warn">
            {banner}
          </Text>
        </View>
      )}
      <Text variant="eyebrow" tone="faint">
        1 · Результат
      </Text>
      <Input label="Название цели" value={f.title} onChangeText={(v) => set('title', v)} placeholder="Сократить время обработки заявки" error={err('title')} hint={titleHint(f.title) ?? 'Опишите изменение, а не действие'} maxLength={220} />
      <View style={{ gap: 8 }}>
        {types.map((x) => (
          <Pressable key={x} accessibilityRole="radio" accessibilityState={{ checked: f.type === x }} onPress={() => set('type', x)} style={{ padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: f.type === x ? p.ink : p.line, backgroundColor: p.surface, gap: 2 }}>
            <Text style={{ fontFamily: font.semibold }}>{GOAL_TYPE_LABELS[x]}</Text>
            <Text variant="caption" tone="faint">
              {GOAL_TYPE_HINTS[x]}
            </Text>
          </Pressable>
        ))}
        {err('type') && (
          <Text variant="caption" tone="bad">
            {err('type')}
          </Text>
        )}
      </View>

      <Text variant="eyebrow" tone="faint" style={{ marginTop: 8 }}>
        2 · Как измерим успех
      </Text>
      <Card>
        <Input label="Показатель" value={f.kpiName} onChangeText={(v) => set('kpiName', v)} placeholder="Среднее время обработки" error={err('kpiName') ?? err('kpi')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['decrease', 'increase'] as const).map((d) => (
            <Pressable key={d} onPress={() => set('direction', d)} style={chip(f.direction === d)} accessibilityRole="radio" accessibilityState={{ checked: f.direction === d }}>
              <Text variant="small" style={{ color: f.direction === d ? p.bg : p.ink }}>
                {DIRECTION_LABELS[d]}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {UNIT_IDS.map((u) => (
            <Pressable key={u} onPress={() => set('unit', u)} style={[chip(f.unit === u), { paddingVertical: 6 }]} accessibilityRole="radio" accessibilityState={{ checked: f.unit === u }}>
              <Text variant="caption" style={{ color: f.unit === u ? p.bg : p.ink }}>
                {UNITS[u].label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Input label="Сейчас" value={f.baseline} onChangeText={(v) => set('baseline', v)} keyboardType="decimal-pad" placeholder="40" error={err('baseline')} />
          </View>
          <Text style={{ marginTop: 38, color: p.ink3, fontSize: 18 }}>→</Text>
          <View style={{ flex: 1 }}>
            <Input label="Цель" value={f.target} onChangeText={(v) => set('target', v)} keyboardType="decimal-pad" placeholder="30" error={err('target')} />
          </View>
        </View>
        {change !== null && !draftErrors.target && (
          <Text variant="small" tone="muted">
            Плановое изменение <Text style={{ fontFamily: font.semibold }}>{formatChange(change)}</Text>. Прогресс появится после первого замера.
          </Text>
        )}
      </Card>

      <Text variant="eyebrow" tone="faint" style={{ marginTop: 8 }}>
        3 · Ответственность и срок
      </Text>
      <Card>
        <Input label="Владелец" value={search} onChangeText={setSearch} placeholder={f.ownerName || 'Найти сотрудника'} error={err('ownerId')} />
        {f.ownerName ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Avatar name={f.ownerName} size={26} />
            <Text style={{ fontFamily: font.medium }}>{f.ownerName}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(users.data ?? [])
            .filter((u) => u.active && u.role !== 'observer')
            .slice(0, 8)
            .map((u) => (
              <Pressable key={u.id} onPress={() => setF((x) => ({ ...x, ownerId: u.id, ownerName: u.display_name }))} style={[chip(f.ownerId === u.id), { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 5 }]}>
                <Avatar name={u.display_name} size={20} />
                <Text variant="caption" style={{ color: f.ownerId === u.id ? p.bg : p.ink }}>
                  {u.display_name}
                </Text>
              </Pressable>
            ))}
        </View>
        <Text variant="small" style={{ fontFamily: font.medium }}>
          Срок
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {duePresets(today).map((d) => (
            <Pressable key={d.value} onPress={() => set('dueAt', d.value)} style={chip(f.dueAt === d.value)}>
              <Text variant="small" style={{ color: f.dueAt === d.value ? p.bg : p.ink }}>
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Input label="Или дата" value={f.dueAt} onChangeText={(v) => set('dueAt', v)} placeholder="ГГГГ-ММ-ДД" error={err('dueAt')} />
      </Card>

      <Button title="Запустить цель" onPress={() => save('active')} loading={busy === 'active'} />
      <Button title="Сохранить черновик" variant="secondary" onPress={() => save('draft')} loading={busy === 'draft'} />
    </Screen>
  );
}
