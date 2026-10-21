import { router } from 'expo-router';
import { ChevronLeft, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { heroStatColor, type HeroStat, type HeroVariant } from '../../lib/fx';
import { font } from '../../lib/theme';
import { Text } from '../primitives';
import { Glass } from './Glass';
import { Hero } from './Hero';

/** Стеклянные плитки с цифрами в шапке — те же, что на Пульсе. */
export function HeroStats({ stats }: { stats: HeroStat[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {stats.map((s) => (
        <Glass key={s.label} radius={18} style={{ flex: 1 }}>
          <View style={{ paddingVertical: 10, paddingHorizontal: 12 }} accessible accessibilityLabel={`${s.label}: ${s.value}`}>
            <Text style={{ color: heroStatColor(s.tone), fontFamily: font.bold, fontSize: 22, lineHeight: 26 }}>{s.value}</Text>
            <Text variant="caption" style={{ color: 'rgba(255,255,255,0.72)' }}>
              {s.label}
            </Text>
          </View>
        </Glass>
      ))}
    </View>
  );
}

/**
 * Шапка экрана раздела: живой градиент своего цвета, значок раздела на стекле,
 * заголовок и, если есть, плитки с главными цифрами. `compact` — для внутренних
 * экранов (заметка, настройки): ниже и без плиток.
 */
export function PageHero({
  variant,
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  stats,
  right,
  compact = false,
  back,
  children,
}: {
  variant: HeroVariant;
  icon?: LucideIcon;
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  stats?: HeroStat[];
  right?: ReactNode;
  compact?: boolean;
  /** Своя кнопка «назад» — для экранов без системной шапки. */
  back?: string;
  children?: ReactNode;
}) {
  const showStats = !compact && !!stats?.length;
  return (
    <Hero mark={false} variant={variant}>
      <View style={{ minHeight: showStats ? 196 : 0, padding: 18, gap: 16, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            {back && (
              <Pressable accessibilityRole="button" accessibilityLabel={back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} style={{ alignSelf: 'flex-start', marginBottom: 6 }}>
                <Glass radius={16} style={{ height: 32, paddingLeft: 6, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <ChevronLeft size={18} color="#fff" />
                  <Text variant="caption" style={{ color: '#fff' }}>
                    {back}
                  </Text>
                </Glass>
              </Pressable>
            )}
            {eyebrow && (
              <Text variant="eyebrow" style={{ color: 'rgba(255,255,255,0.72)' }}>
                {eyebrow}
              </Text>
            )}
            <Text accessibilityRole="header" variant={compact || title.length > 36 ? 'h2' : 'h1'} style={{ color: '#fff' }}>
              {title}
            </Text>
            {typeof subtitle === 'string' ? <Text style={{ color: 'rgba(255,255,255,0.8)' }}>{subtitle}</Text> : subtitle}
          </View>
          {right ??
            (Icon && (
              <Glass radius={20} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={22} color="#fff" strokeWidth={1.8} />
              </Glass>
            ))}
        </View>
        {showStats && <HeroStats stats={stats!} />}
        {children}
      </View>
    </Hero>
  );
}
