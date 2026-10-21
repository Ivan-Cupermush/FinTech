import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

/** Те же токены, что на сайте: монохром, один акцент, цвет — только со смыслом. */
export const light = {
  bg: '#F6F6F3',
  surface: '#FFFFFF',
  surface2: '#EFEFEA',
  surface3: '#E7E7E1',
  ink: '#0B0B0F',
  ink2: '#4A4A55',
  ink3: '#8A8A96',
  line: '#E4E4DD',
  accent: '#3B5BFF',
  accentInk: '#FFFFFF',
  accentSoft: '#EBEFFF',
  good: '#12A36A',
  goodSoft: '#E3F6EE',
  warn: '#D97A00',
  warnSoft: '#FFF1DC',
  bad: '#E0464C',
  badSoft: '#FDE8E8',
  info: '#6E6AF0',
  infoSoft: '#EEEDFE',
};

export type Palette = typeof light;

export const dark: Palette = {
  bg: '#0B0B0F',
  surface: '#131318',
  surface2: '#1B1B22',
  surface3: '#24242C',
  ink: '#F3F3EF',
  ink2: '#B4B4BD',
  ink3: '#7C7C88',
  line: '#26262E',
  accent: '#6F86FF',
  accentInk: '#0B0B0F',
  accentSoft: '#1D2342',
  good: '#35C48A',
  goodSoft: '#10291F',
  warn: '#F0A33A',
  warnSoft: '#2E2210',
  bad: '#FF6B70',
  badSoft: '#321517',
  info: '#9894FF',
  infoSoft: '#1F1E3C',
};

export const font = {
  regular: 'Onest_400Regular',
  medium: 'Onest_500Medium',
  semibold: 'Onest_600SemiBold',
  bold: 'Onest_700Bold',
};

export const radius = { sm: 10, md: 14, lg: 20, xl: 28 };

/**
 * Палитра поверх живого градиента: белый текст, полупрозрачные подложки.
 * Компоненты (KPI, метки, текст) внутри шапки-градиента берут её сами —
 * через PaletteOverride, без отдельных «белых» версий.
 */
export const onColor: Palette = {
  bg: '#0B0B1A',
  surface: 'rgba(255,255,255,0.12)',
  surface2: 'rgba(255,255,255,0.18)',
  surface3: 'rgba(255,255,255,0.28)',
  ink: '#FFFFFF',
  ink2: 'rgba(255,255,255,0.82)',
  ink3: 'rgba(255,255,255,0.62)',
  line: 'rgba(255,255,255,0.2)',
  accent: '#FFFFFF',
  accentInk: '#0B0B1A',
  accentSoft: 'rgba(255,255,255,0.18)',
  good: '#7CF0BD',
  goodSoft: 'rgba(124,240,189,0.18)',
  warn: '#FFC46B',
  warnSoft: 'rgba(255,196,107,0.2)',
  bad: '#FF8F94',
  badSoft: 'rgba(255,90,100,0.22)',
  info: '#C9C4FF',
  infoSoft: 'rgba(201,196,255,0.2)',
};

export const PaletteOverride = createContext<Palette | null>(null);

export function usePalette(): Palette {
  const scheme = useColorScheme();
  return useContext(PaletteOverride) ?? (scheme === 'dark' ? dark : light);
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent' | 'info';

export function toneColors(p: Palette, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'good':
      return { fg: p.good, bg: p.goodSoft };
    case 'warn':
      return { fg: p.warn, bg: p.warnSoft };
    case 'bad':
      return { fg: p.bad, bg: p.badSoft };
    case 'accent':
      return { fg: p.accent, bg: p.accentSoft };
    case 'info':
      return { fg: p.info, bg: p.infoSoft };
    default:
      return { fg: p.ink2, bg: p.surface2 };
  }
}
