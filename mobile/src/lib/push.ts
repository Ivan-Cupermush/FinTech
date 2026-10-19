import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PushPermission } from './logic';

type Api = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

let configured = false;

/** Показ push, пока приложение открыто, и каналы Android: блокеры — отдельным громким каналом. */
export function configurePush() {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', { name: 'Задачи и цели', importance: Notifications.AndroidImportance.DEFAULT });
    void Notifications.setNotificationChannelAsync('urgent', { name: 'Блокеры', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200] });
  }
}

const supported = () => Platform.OS !== 'web' && Device.isDevice;

export async function pushPermission(): Promise<PushPermission> {
  if (!supported()) return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

const projectId = () => (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? Constants.easConfig?.projectId;

/** Последний токен этого телефона: нужен, чтобы отвязать его при выходе. */
let lastToken: string | null = null;

/**
 * Спросить разрешение (только по нажатию человека, не при запуске) и
 * привязать телефон к сотруднику. Возвращает итоговое состояние разрешения.
 */
export async function enablePush(api: Api): Promise<PushPermission> {
  if (!supported()) return 'unsupported';
  configurePush();
  let perm = await pushPermission();
  if (perm === 'undetermined') {
    const r = await Notifications.requestPermissionsAsync();
    perm = r.status === 'granted' ? 'granted' : 'denied';
  }
  if (perm !== 'granted') return perm;
  await registerDevice(api);
  return 'granted';
}

/** Привязать телефон, если разрешение уже есть. Вызывается после входа и при запуске. */
export async function registerDevice(api: Api): Promise<boolean> {
  if (!supported() || (await pushPermission()) !== 'granted') return false;
  const id = projectId();
  if (!id) return false;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  await api('/push/devices', { body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
  lastToken = token;
  return true;
}

/** При выходе: чужие уведомления на этот телефон больше не придут. Ошибку сети не показываем. */
export async function unregisterDevice(api: Api): Promise<void> {
  if (!lastToken) return;
  const token = lastToken;
  lastToken = null;
  await api(`/push/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => undefined);
  if (supported()) await Notifications.setBadgeCountAsync(0).catch(() => false);
}
