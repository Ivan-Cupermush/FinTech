import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Building2, Check, GraduationCap, Link2, MessagesSquare, NotebookPen, Plug, ShieldCheck, SlidersHorizontal, Sparkles, Wallet, type LucideIcon } from 'lucide-react-native';
import { Alert, Pressable, Switch, View } from 'react-native';
import {
  describeModulesChange,
  matchingPreset,
  MODULE_KEYS,
  MODULE_PRESETS,
  MODULES,
  type CompanyModules,
  type CompanyModulesView,
  type ModuleKey,
  type ModulePresetKey,
  type ModulesHistoryEntry,
} from '@offix/core';
import type { HeroVariant } from '../lib/fx';
import { useMe } from '../lib/queries';
import { api } from '../lib/session';
import { font, usePalette } from '../lib/theme';
import { Glass } from '../ui/fx/Glass';
import { GradientBackdrop } from '../ui/fx/GradientBackdrop';
import { PageHero } from '../ui/fx/PageHero';
import { Card, Empty, Screen, SectionTitle, Text } from '../ui/primitives';

const KEY = ['company-modules'] as const;
const HISTORY = ['company-modules', 'history'] as const;

/** Знак и градиент раздела — как у его собственной шапки. */
const LOOK: Record<ModuleKey, { Icon: LucideIcon; variant: HeroVariant }> = {
  sales: { Icon: Wallet, variant: 'sales' },
  chats: { Icon: MessagesSquare, variant: 'chats' },
  knowledge_ai: { Icon: Sparkles, variant: 'assistant' },
  my_notes: { Icon: NotebookPen, variant: 'notes' },
  integrations: { Icon: Plug, variant: 'settings' },
};
const PRESET_ICON: Record<ModulePresetKey, LucideIcon> = { university: GraduationCap, company: Building2 };
const WHITE = 'rgba(255,255,255,0.86)';

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Функции компании: владелец или администратор включает крупные разделы.
 * Выключенное пропадает из вкладок и меню у всех сотрудников сразу; данные остаются.
 */
export default function CompanyScreen() {
  const p = usePalette();
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<CompanyModulesView>('/company/modules') });
  const can = !!q.data?.can_change;
  const history = useQuery({ queryKey: HISTORY, queryFn: () => api<ModulesHistoryEntry[]>('/company/modules/history'), enabled: can });
  const save = useMutation({
    mutationFn: (body: { modules: Partial<CompanyModules> } | { preset: ModulePresetKey }) => api<CompanyModulesView>('/company/modules', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: HISTORY });
      void qc.invalidateQueries({ queryKey: ['functions'] });
    },
    onError: (e) => Alert.alert('Не получилось', e instanceof Error ? e.message : ''),
  });
  const mods = q.data?.modules;
  const preset = mods ? matchingPreset(mods) : null;
  const on = mods ? MODULE_KEYS.filter((k) => mods[k]).length : 0;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void Promise.all([q.refetch(), history.refetch()])}>
      <Stack.Screen options={{ title: 'Функции компании' }} />
      <PageHero
        variant="settings"
        icon={SlidersHorizontal}
        eyebrow={me.data?.company_name}
        title="Функции компании"
        subtitle="Выключенный раздел пропадает из вкладок и меню у всех сотрудников. Данные остаются."
        stats={mods ? [{ label: 'включено', value: `${on} из ${MODULE_KEYS.length}` }, { label: 'выключено', value: MODULE_KEYS.length - on, tone: on < MODULE_KEYS.length ? 'warn' : undefined }] : undefined}
      />
      {q.isError ? (
        <Card>
          <Empty title="Не удалось загрузить" text={(q.error as Error).message} />
        </Card>
      ) : !mods ? null : (
        <>
          {!can && (
            <Card style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <ShieldCheck size={18} color={p.accent} />
              <Text variant="small" tone="muted" style={{ flex: 1 }}>
                Это настройки всей компании. Менять их может владелец или администратор — здесь видно, что включено.
              </Text>
            </Card>
          )}
          <SectionTitle title="Готовые наборы" />
          <View style={{ gap: 8 }}>
            {MODULE_PRESETS.map((pr) => {
              const Icon = PRESET_ICON[pr.key];
              const active = preset === pr.key;
              return (
                <Pressable
                  key={pr.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: !can || active }}
                  accessibilityLabel={`Набор «${pr.title}»${active ? ', выбран' : ''}`}
                  disabled={!can || active || save.isPending}
                  onPress={() => save.mutate({ preset: pr.key })}
                >
                  <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: active ? 1.5 : 0, borderColor: p.accent }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={20} color={p.accent} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontFamily: font.semibold }}>{pr.title}</Text>
                      <Text variant="caption" tone="faint">
                        {pr.description}
                      </Text>
                    </View>
                    {active ? <Check size={18} color={p.accent} /> : can ? <Text variant="small" tone="accent">Применить</Text> : null}
                  </Card>
                </Pressable>
              );
            })}
          </View>

          <SectionTitle title="Разделы" />
          <View style={{ gap: 12 }}>
            {MODULES.map((m) => {
              const value = mods[m.key];
              const { Icon, variant } = LOOK[m.key];
              return (
                <View key={m.key} style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: '#0a0c2e', opacity: value ? 1 : 0.78 }}>
                  {value ? <GradientBackdrop variant={variant} /> : <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#3a3a44' }} />}
                  <View style={{ padding: 8 }}>
                    <Glass radius={22}>
                      <View style={{ padding: 14, gap: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon size={20} color="#fff" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: '#fff', fontFamily: font.semibold, fontSize: 16 }}>{m.title}</Text>
                            <Text variant="caption" style={{ color: WHITE }}>
                              {value ? 'Включено' : 'Выключено'}
                            </Text>
                          </View>
                          <Switch
                            value={value}
                            disabled={!can || save.isPending}
                            onValueChange={(v) => save.mutate({ modules: { [m.key]: v } })}
                            trackColor={{ true: 'rgba(255,255,255,0.9)', false: 'rgba(255,255,255,0.25)' }}
                            thumbColor={value ? '#1b2bd6' : '#fff'}
                            accessibilityLabel={m.title}
                          />
                        </View>
                        <Text variant="small" style={{ color: WHITE }}>
                          {m.description}
                        </Text>
                        <View style={{ backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 14, padding: 10, gap: 4 }}>
                          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.7)', fontFamily: font.semibold }}>
                            {value ? 'ЕСЛИ ВЫКЛЮЧИТЬ, ПРОПАДЁТ' : 'СЕЙЧАС СКРЫТО У ВСЕХ'}
                          </Text>
                          {m.impact.map((i) => (
                            <Text key={i} variant="caption" style={{ color: '#fff' }}>
                              • {i}
                            </Text>
                          ))}
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                          <Link2 size={13} color={WHITE} style={{ marginTop: 2 }} />
                          <Text variant="caption" style={{ color: WHITE, flex: 1 }}>
                            {m.related}
                          </Text>
                        </View>
                      </View>
                    </Glass>
                  </View>
                </View>
              );
            })}
          </View>

          <Card style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <ShieldCheck size={18} color={p.accent} />
            <Text variant="small" tone="muted" style={{ flex: 1 }}>
              Ядро offix включено всегда: цели и KPI, задачи, оргструктура, «Эффект», отчёт и статьи базы знаний.
            </Text>
          </Card>

          {can && (
            <>
              <SectionTitle title="Журнал изменений" />
              <Card style={{ gap: 0 }}>
                {history.data?.length ? (
                  history.data.map((e, i) => (
                    <View key={e.id} style={{ paddingVertical: 10, gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: p.line }}>
                      <Text variant="small">{describeModulesChange(e)}</Text>
                      <Text variant="caption" tone="faint">
                        {e.actor_name ?? 'Система'} · {when(e.created_at)}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text variant="small" tone="faint">
                    Пока ничего не меняли — включено то, что было с самого начала.
                  </Text>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
