import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../lib/session';
import { usePalette } from '../lib/theme';

/** Точка входа: пока читаем токен из защищённого хранилища — пустой экран без мигания. */
export default function Index() {
  const { ready, token } = useSession();
  const p = usePalette();
  if (!ready) return <View style={{ flex: 1, backgroundColor: p.bg }} />;
  return <Redirect href={token ? '/(tabs)' : '/login'} />;
}
