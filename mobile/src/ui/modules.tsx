import { router } from 'expo-router';
import { ToggleRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { isModuleOn, moduleInfo, type ModuleKey } from '@offix/core';
import { useMe } from '../lib/queries';
import { usePalette } from '../lib/theme';
import { Button, Card, Empty, Screen } from './primitives';

/** Включён ли раздел. Пока профиль грузится — выключен: выключенный раздел не мелькнёт. */
export function useModuleOn(key: ModuleKey): boolean {
  const me = useMe();
  return !!me.data && isModuleOn(me.data.modules, key);
}

/** Экран выключенного раздела: старая ссылка, push или пересланная ссылка. */
export function ModuleOff({ module }: { module: ModuleKey }) {
  const p = usePalette();
  const me = useMe();
  const admin = me.data?.role === 'owner' || me.data?.role === 'admin';
  return (
    <Screen>
      <Card>
        <View style={{ alignItems: 'center', paddingTop: 8 }}>
          <ToggleRight size={28} color={p.ink3} />
        </View>
        <Empty
          title="Раздел выключен"
          text={`«${moduleInfo(module).title}» в вашей компании не используется. ${admin ? 'Включить его можно в «Функциях компании».' : 'Если он нужен, попросите владельца или администратора.'}`}
          action={
            admin ? (
              <Button title="Функции компании" variant="secondary" onPress={() => router.replace('/company')} />
            ) : (
              <Button title="На Пульс" variant="secondary" onPress={() => router.replace('/')} />
            )
          }
        />
      </Card>
    </Screen>
  );
}

/** Обёртка экрана раздела: выключен — «Раздел выключен», данные раздела не запрашиваются. */
export function ModuleGate({ module, children }: { module: ModuleKey | ModuleKey[]; children: ReactNode }) {
  const me = useMe();
  if (!me.data) return me.isError ? <>{children}</> : <Screen>{null}</Screen>;
  const off = (Array.isArray(module) ? module : [module]).find((k) => !isModuleOn(me.data!.modules, k));
  if (off) return <ModuleOff module={off} />;
  return <>{children}</>;
}

/** Обернуть экран целиком: export default gated('sales', SalesScreen). */
export function gated<P extends object>(module: ModuleKey | ModuleKey[], Comp: (props: P) => ReactNode) {
  function Gated(props: P) {
    return (
      <ModuleGate module={module}>
        <Comp {...props} />
      </ModuleGate>
    );
  }
  Gated.displayName = `Gated(${Comp.name || 'Screen'})`;
  return Gated;
}
