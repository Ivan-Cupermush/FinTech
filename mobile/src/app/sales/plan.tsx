import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Plus, Trash2, Wallet, X } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { emptyPlanForm, planFormOf, ruleText, SALES_UNIT_LABELS, unitForFact, type PlanForm, type SalesMonth, type SalesPlan } from '@offix/core';
import { ApiError } from '../../lib/client';
import {
  addGroupLine,
  FACT_CHOICES,
  itemRows,
  itemsTextOf,
  nextStep,
  payoutChoices,
  planEditMode,
  planEditorTitle,
  planSaveBody,
  planServerErrors,
  salesToday,
  stepRows,
  stepsTextOf,
  UNIT_CHOICES,
  withFactType,
  type ItemRow,
  type PlanEditMode,
  type StepRow,
} from '../../lib/sales';
import { salesApi, useSalesGroups, useSalesMonth, useSalesRefresh } from '../../lib/sales-api';
import { font, radius, usePalette } from '../../lib/theme';
import { Button, Card, Empty, Input, NO_WEB_OUTLINE, Screen, Text } from '../../ui/primitives';
import { Chips } from '../../ui/sales';
import { errText } from '../../ui/sales-month';

/**
 * Показатель плана с телефона — то же, что окно «Показатель» на сайте:
 * название, как считается факт, план, бонус и правило выплаты. У показателя
 * из файла KPI меняется только правило выплаты — остальное приходит с файлом.
 */
export default function SalesPlanScreen() {
  const { id, month = salesToday().slice(0, 7), user } = useLocalSearchParams<{ id?: string; month?: string; user?: string }>();
  const m = useSalesMonth(month, user);
  const plan = id ? m.data?.plans.find((x) => x.id === id) : undefined;
  if (m.isLoading) return <Screen glow={false}>{null}</Screen>;
  const mode: PlanEditMode | null = !m.data?.can.edit ? null : plan ? planEditMode(m.data, plan) : id ? null : 'new';
  if (!m.data || !mode)
    return (
      <Screen glow={false}>
        <Card>
          <Empty
            title={id && m.data && !plan ? 'Показатель не найден' : 'Показатель не открыть'}
            text={m.error ? errText(m.error) : id && m.data && !plan ? 'Возможно, его уже удалили.' : 'План и правила выплат меняет руководитель с правом «Ставить план».'}
          />
        </Card>
      </Screen>
    );
  return <PlanEditor key={plan?.id ?? 'new'} m={m.data} plan={plan} mode={mode} />;
}

const close = () => (router.canGoBack() ? router.back() : router.replace('/sales'));

function PlanEditor({ m, plan, mode }: { m: SalesMonth; plan?: SalesPlan; mode: PlanEditMode }) {
  const p = usePalette();
  const refresh = useSalesRefresh();
  const [f, setF] = useState<PlanForm>(() => (plan ? planFormOf(plan) : emptyPlanForm()));
  const [steps, setSteps] = useState<StepRow[]>(() => stepRows(f.steps));
  const [items, setItems] = useState<ItemRow[]>(() => itemRows(f.items));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const full = mode !== 'payout';
  const byReports = f.fact_type === 'revenue' || f.fact_type === 'clients';
  const groups = useSalesGroups(m.month, full && byReports);

  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '', _: '' }));
  };
  const editSteps = (rows: StepRow[]) => {
    setSteps(rows);
    set('steps', stepsTextOf(rows));
  };
  const editItems = (rows: ItemRow[]) => {
    setItems(rows);
    set('items', itemsTextOf(rows));
  };

  const parsed = useMemo(() => planSaveBody(f, mode === 'payout' ? 'payout' : 'full'), [f, mode]);
  const rule = parsed.body?.payout_rule as Parameters<typeof ruleText>[0] | undefined;
  const preview = rule && rule.type !== 'none' ? ruleText(rule, mode === 'payout' ? (plan?.bonus ?? 0) : (parsed.body!.bonus as number)) : '';
  const unit = f.fact_type === 'manual' ? f.unit : unitForFact(f);
  const short = SALES_UNIT_LABELS[unit].short;
  const topGroups = (groups.data ?? []).filter((g) => g.depth <= 1).slice(0, 12);

  const submit = async () => {
    const r = planSaveBody(f, mode);
    if (!r.body) return setErrors(r.errors);
    setBusy(true);
    try {
      if (plan) await salesApi.updatePlan(plan.id, r.body);
      else await salesApi.createPlan({ ...r.body, user_id: m.user.id, month: m.month });
      await refresh();
      close();
    } catch (e) {
      setErrors(e instanceof ApiError && Object.keys(e.fields).length ? planServerErrors(e.fields, f) : { _: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await salesApi.deletePlan(plan!.id);
      await refresh();
      close();
    } catch (e) {
      setErrors({ _: errText(e) });
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen glow={false}>
      <Stack.Screen options={{ title: planEditorTitle(mode) }} />
      <Text variant="small" tone="muted">
        {m.user.name} · {plan ? plan.name : 'новый показатель на месяц'}
      </Text>
      {mode === 'payout' && (
        <Card style={{ backgroundColor: p.surface2 }}>
          <Text variant="small" tone="muted">
            План, факт и бонус пришли из файла KPI и обновятся новой загрузкой. Правило выплаты, которое вы поправите здесь, сохранится и при следующей загрузке.
          </Text>
        </Card>
      )}
      {!!errors._ && (
        <Text accessibilityRole="alert" variant="small" tone="bad">
          {errors._}
        </Text>
      )}

      {full && (
        <Section title="Показатель">
          <Input label="Название" value={f.name} onChangeText={(x) => set('name', x)} placeholder="Выручка без ключевых клиентов" maxLength={320} error={errors.name} autoFocus={!plan} />
          <Label text="Как считается факт" hint={f.fact_type === 'manual' ? 'Сотрудник отмечает сам или прибавляется из записанных продаж' : 'Пересчитывается после каждой загрузки отчёта 1С'} />
          <Chips label="Как считается факт" options={FACT_CHOICES} value={f.fact_type} onChange={(v) => (setF((x) => withFactType(x, v)), setErrors({}))} />
          {f.fact_type === 'manual' ? (
            <>
              <Label text="Единица" />
              <Chips label="Единица" options={UNIT_CHOICES} value={f.unit} onChange={(v) => set('unit', v)} />
            </>
          ) : (
            <Text variant="caption" tone="faint">
              Единица — {SALES_UNIT_LABELS[unit].label.toLowerCase()}: следует за способом подсчёта.
            </Text>
          )}
        </Section>
      )}

      {full && f.fact_type !== 'manual' && (
        <Section title="Что считать">
          {byReports && (
            <>
              <Input label="Группы товаров" value={f.groups} onChangeText={(x) => set('groups', x)} multiline error={errors.groups} hint="По одной на строку. Пусто — все продажи. «Курсы» — любая группа с этим словом, «КУРСЫ › Python» — именно эта." />
              {topGroups.length > 0 && (
                <View accessibilityLabel="Группы из отчётов" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {topGroups.map((g) => (
                    <Pressable key={g.path} accessibilityRole="button" accessibilityLabel={`Добавить группу «${g.path}»`} onPress={() => set('groups', addGroupLine(f.groups, g.path))} style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: p.accentSoft, opacity: pressed ? 0.7 : 1 })}>
                      <Text variant="caption" style={{ color: p.accent }}>
                        + {g.path}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
          {f.fact_type === 'revenue' && (
            <>
              <Label text="Клиенты" />
              <Chips label="Клиенты" options={[{ value: 'all', label: 'Все' }, { value: 'non_key', label: 'Без ключевых' }, { value: 'key', label: 'Только ключевые' }]} value={f.clients} onChange={(v) => set('clients', v)} />
              <Label text="Что считать" />
              <Chips label="Что считать" options={[{ value: 'revenue', label: 'Выручку, ₽' }, { value: 'quantity', label: 'Штуки' }]} value={f.measure} onChange={(v) => set('measure', v)} />
            </>
          )}
          {f.fact_type === 'clients' && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ flex: 1 }}>Без ключевых клиентов</Text>
                <Switch accessibilityLabel="Без ключевых клиентов" value={f.exclude_key} onValueChange={(v) => set('exclude_key', v)} trackColor={{ true: p.accent, false: p.surface2 }} />
              </View>
              <Input label="Задвоенные клиенты" value={f.merge} onChangeText={(x) => set('merge', x)} multiline hint="Все клиенты с таким названием считаются одной точкой. По одному на строку." />
            </>
          )}
          {f.fact_type === 'products' && (
            <>
              <Input label="Товар или группа" value={f.query} onChangeText={(x) => set('query', x)} placeholder="Python" error={errors.query} />
              <Label text="Что считать" />
              <Chips label="Что считать" options={[{ value: 'revenue', label: 'Выручку, ₽' }, { value: 'quantity', label: 'Штуки' }, { value: 'clients', label: 'Клиентов с покупкой' }]} value={f.products_measure} onChange={(v) => set('products_measure', v)} />
            </>
          )}
          {f.fact_type === 'items' && (
            <Rows
              title="Позиции"
              hint="Название и в сколько клиентов продать"
              error={errors.items}
              add="Позиция"
              onAdd={() => editItems([...items, { name: '', need: '' }])}
              rows={items.map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Cell value={r.name} onChange={(x) => editItems(items.map((y, j) => (j === i ? { ...y, name: x } : y)))} placeholder="Курс «Python для аналитиков»" label={`Позиция ${i + 1}`} flex />
                  <Cell value={r.need} onChange={(x) => editItems(items.map((y, j) => (j === i ? { ...y, need: x.replace(/\D/g, '') } : y)))} placeholder="1" label={`Позиция ${i + 1}: в сколько клиентов`} width={56} numeric />
                  <RemoveButton label={`Убрать позицию ${i + 1}`} onPress={() => editItems(items.filter((_, j) => j !== i))} />
                </View>
              ))}
            />
          )}
        </Section>
      )}

      {full && (
        <Section title="План и бонус">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Input label={`План, ${short}`} value={f.plan} onChangeText={(x) => set('plan', x)} keyboardType="decimal-pad" placeholder={unit === 'rub' ? '400 000' : '40'} error={errors.plan} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Бонус, ₽" value={f.bonus} onChangeText={(x) => set('bonus', x)} keyboardType="decimal-pad" placeholder="20 000" error={errors.bonus} hint="За выполнение плана" />
            </View>
          </View>
        </Section>
      )}

      <Section title="Выплата">
        <Chips label="Как считается выплата" options={payoutChoices(full ? f.fact_type : (plan?.fact_rule.type ?? 'manual'))} value={f.payout_type} onChange={(v) => set('payout_type', v)} />
        {f.payout_type === 'threshold' && (
          <>
            <Rows
              title="Пороги"
              hint="От скольких процентов плана и какая доля бонуса: 1 — весь, 0,5 — половина"
              error={errors.steps}
              add="Порог"
              onAdd={() => editSteps([...steps, nextStep(steps)])}
              rows={steps.map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="small" tone="muted">
                    от
                  </Text>
                  <Cell value={r.from} onChange={(x) => editSteps(steps.map((y, j) => (j === i ? { ...y, from: x } : y)))} placeholder="100" label={`Порог ${i + 1}: процент плана`} width={64} numeric />
                  <Text variant="small" tone="muted" style={{ flex: 1 }}>
                    % плана → ×
                  </Text>
                  <Cell value={r.k} onChange={(x) => editSteps(steps.map((y, j) => (j === i ? { ...y, k: x } : y)))} placeholder="1" label={`Порог ${i + 1}: доля бонуса`} width={64} numeric />
                  <RemoveButton label={`Убрать порог ${i + 1}`} onPress={() => editSteps(steps.filter((_, j) => j !== i))} />
                </View>
              ))}
            />
            <Label text="Сверх плана" />
            <Chips label="Сверх плана" options={[{ value: 'cap', label: 'Бонус не растёт' }, { value: 'proportional', label: 'Растёт пропорционально' }]} value={f.over} onChange={(v) => set('over', v)} />
          </>
        )}
        {f.payout_type === 'rate' && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Input label="Процент от продаж" value={f.rate} onChangeText={(x) => set('rate', x)} keyboardType="decimal-pad" placeholder="3,5" error={errors.rate} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Если продано от, ₽" value={f.min} onChangeText={(x) => set('min', x)} keyboardType="decimal-pad" placeholder="50 000" error={errors.min} hint="Пусто — с первого рубля" />
            </View>
          </View>
        )}
        {f.payout_type === 'fixed' && (
          <Text variant="caption" tone="faint">
            {full ? 'Сумма — в поле «Бонус»: она выплачивается целиком, как оклад.' : 'Сумма приходит из файла KPI и выплачивается целиком.'}
          </Text>
        )}
        {!!preview && (
          <View accessibilityLabel={`Выплата: ${preview}`} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: radius.md, backgroundColor: p.accentSoft }}>
            <Wallet size={16} color={p.accent} style={{ marginTop: 2 }} />
            <Text variant="small" style={{ flex: 1, color: p.accent }}>
              {preview.charAt(0).toUpperCase() + preview.slice(1)}
            </Text>
          </View>
        )}
      </Section>

      {full && (
        <Card>
          <Input label="Комментарий" value={f.description} onChangeText={(x) => set('description', x)} multiline maxLength={2000} hint="Видит сотрудник" />
        </Card>
      )}

      {confirm ? (
        <Card style={{ gap: 12, borderColor: p.bad }}>
          <Text variant="title">Удалить показатель?</Text>
          <Text variant="small" tone="muted">
            «{plan!.name}» исчезнет из плана на месяц вместе с выплатой по нему.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Оставить" variant="secondary" onPress={() => setConfirm(false)} style={{ flex: 1 }} />
            <Button title="Удалить" variant="danger" loading={busy} onPress={() => void remove()} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : (
        <>
          <Button title={plan ? 'Сохранить' : 'Добавить показатель'} variant="accent" loading={busy} onPress={() => void submit()} />
          {plan && <Button title="Удалить показатель" variant="ghost" color={p.bad} icon={<Trash2 size={16} color={p.bad} />} onPress={() => setConfirm(true)} />}
        </>
      )}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ gap: 12 }}>
      <Text variant="eyebrow" tone="faint">
        {title}
      </Text>
      {children}
    </Card>
  );
}

function Label({ text, hint }: { text: string; hint?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="small" style={{ fontFamily: font.medium }}>
        {text}
      </Text>
      {hint && (
        <Text variant="caption" tone="faint">
          {hint}
        </Text>
      )}
    </View>
  );
}

/** Строки редактора (пороги, позиции) и «+ ещё одна» внизу. */
function Rows({ title, hint, error, add, onAdd, rows }: { title: string; hint: string; error?: string; add: string; onAdd: () => void; rows: ReactNode[] }) {
  const p = usePalette();
  return (
    <View style={{ gap: 10 }}>
      <Label text={title} hint={hint} />
      {rows}
      <Pressable accessibilityRole="button" accessibilityLabel={`Добавить: ${add.toLowerCase()}`} onPress={onAdd} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
        <Plus size={16} color={p.accent} />
        <Text variant="small" tone="accent" style={{ fontFamily: font.semibold }}>
          {add}
        </Text>
      </Pressable>
      {!!error && (
        <Text variant="caption" tone="bad">
          {error}
        </Text>
      )}
    </View>
  );
}

function Cell({ value, onChange, placeholder, label, width, flex, numeric }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; width?: number; flex?: boolean; numeric?: boolean }) {
  const p = usePalette();
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={p.ink3}
      keyboardType={numeric ? 'decimal-pad' : 'default'}
      style={[{ height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: p.line, backgroundColor: p.surface, paddingHorizontal: 10, fontFamily: font.regular, fontSize: 15, color: p.ink, textAlign: numeric ? 'center' : 'left' }, flex ? { flex: 1, minWidth: 0 } : { width }, NO_WEB_OUTLINE]}
    />
  );
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface2, opacity: pressed ? 0.6 : 1 })}>
      <X size={15} color={p.ink2} />
    </Pressable>
  );
}
