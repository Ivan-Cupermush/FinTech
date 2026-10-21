import type { ReactNode } from 'react';
import { onColor, PaletteOverride } from '../../lib/theme';

/** Всё внутри рисуется для тёмного градиента: белый текст, светлые линии. */
export function OnColor({ children }: { children: ReactNode }) {
  return <PaletteOverride.Provider value={onColor}>{children}</PaletteOverride.Provider>;
}
