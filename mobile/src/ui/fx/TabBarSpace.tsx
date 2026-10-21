import { createContext, useContext, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tabBarSpace } from '../../lib/fx';

/** Сколько места внизу занимает парящая панель вкладок; вне вкладок — 0. */
const Ctx = createContext(false);

export function TabBarSpaceProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value>{children}</Ctx.Provider>;
}

export function useTabBarSpace(): number {
  const inTabs = useContext(Ctx);
  const insets = useSafeAreaInsets();
  return inTabs ? tabBarSpace(insets.bottom) : 0;
}
