import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Настройки сборки приложения для EAS из окружения, без настоящих ключей в репозитории.
 *
 *   EAS_PROJECT_ID       — UUID проекта на expo.dev (печатает `eas init`); без него push не включаются.
 *   EXPO_OWNER           — аккаунт или организация на expo.dev, если проект не личный.
 *   EXPO_PUBLIC_API_URL  — адрес сервера компании по умолчанию (https://…); человек может сменить его при входе.
 *   APP_VERSION          — версия для магазинов (иначе из app.json).
 *   EAS_BUILD_PROFILE    — профиль сборки, его задаёт сам EAS.
 *
 * Сборки preview и production без https-адреса сервера не собираются: релизные
 * Android и iOS не ходят по http, и приложение молча не открыло бы ни одного экрана.
 */
export type ReleaseEnv = Partial<Record<'EAS_PROJECT_ID' | 'EXPO_OWNER' | 'EXPO_PUBLIC_API_URL' | 'APP_VERSION' | 'EAS_BUILD_PROFILE', string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RELEASE_PROFILES = ['preview', 'production'] as const;

export function releaseConfig(base: ExpoConfig, env: ReleaseEnv): ExpoConfig {
  const profile = env.EAS_BUILD_PROFILE?.trim();
  const projectId = env.EAS_PROJECT_ID?.trim();
  const apiUrl = env.EXPO_PUBLIC_API_URL?.trim() || (base.extra?.apiUrl as string | undefined);
  if (projectId && !UUID.test(projectId)) throw new Error('EAS_PROJECT_ID должен быть UUID проекта с expo.dev (его печатает `eas init`)');
  if (profile && (RELEASE_PROFILES as readonly string[]).includes(profile)) {
    if (!apiUrl || !/^https:\/\/[^/\s]+/.test(apiUrl) || /\/\/(localhost|127\.0\.0\.1)\b/.test(apiUrl)) {
      throw new Error(`Сборка «${profile}»: задайте EXPO_PUBLIC_API_URL — https-адрес сервера компании (например, https://offix.example.ru)`);
    }
  }
  const version = env.APP_VERSION?.trim();
  if (version && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('APP_VERSION — три числа через точку, например 1.2.0');
  const extra = { ...base.extra, apiUrl, ...(projectId ? { eas: { ...(base.extra?.eas as object | undefined), projectId } } : {}) };
  return {
    ...base,
    ...(env.EXPO_OWNER?.trim() ? { owner: env.EXPO_OWNER.trim() } : {}),
    ...(version ? { version } : {}),
    extra,
  };
}

// Основа — app.json; ключ проекта EAS и адрес сервера приходят из окружения сборки (docs/DEPLOY.md, раздел «Приложение»).
// Логика в этом же файле: Expo читает app.config.ts сам и не подключает другие .ts-файлы.
export default ({ config }: ConfigContext): ExpoConfig => releaseConfig(config as ExpoConfig, process.env as ReleaseEnv);
