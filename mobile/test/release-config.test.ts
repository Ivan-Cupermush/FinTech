import { describe, expect, it } from 'vitest';
import type { ExpoConfig } from 'expo/config';
import appConfig, { releaseConfig } from '../app.config';
import app from '../app.json';
import eas from '../eas.json';

const BASE = app.expo as unknown as ExpoConfig;
const ID = '0f3e9a52-7c1d-4b8e-9a6f-2d5c8b1e4f70';

describe('сборка приложения (EAS)', () => {
  it('в разработке — как в app.json, без проекта EAS: push просто не включаются', () => {
    const c = releaseConfig(BASE, {});
    expect(c.extra?.apiUrl).toBe('http://localhost:4000/api/v1');
    expect(c.extra?.eas).toBeUndefined();
    expect(c.owner).toBeUndefined();
    expect(c.version).toBe(BASE.version);
    expect(c.android?.package).toBe('ru.offix.app');
  });

  it('ключ проекта, владелец, адрес сервера и версия — из окружения сборки', () => {
    const c = releaseConfig(BASE, { EAS_PROJECT_ID: ID, EXPO_OWNER: 'offix-team', EXPO_PUBLIC_API_URL: 'https://offix.example.ru', APP_VERSION: '1.2.0', EAS_BUILD_PROFILE: 'production' });
    expect(c.extra).toMatchObject({ apiUrl: 'https://offix.example.ru', eas: { projectId: ID } });
    expect(c.owner).toBe('offix-team');
    expect(c.version).toBe('1.2.0');
    // Остальное из app.json не теряется.
    expect(c.plugins).toEqual(BASE.plugins);
    expect(c.scheme).toBe('offix');
  });

  it('релизные сборки не собираются без https-адреса сервера', () => {
    for (const profile of ['preview', 'production']) {
      expect(() => releaseConfig(BASE, { EAS_BUILD_PROFILE: profile })).toThrow(/EXPO_PUBLIC_API_URL/);
      expect(() => releaseConfig(BASE, { EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: 'http://offix.example.ru' })).toThrow(/https/);
      expect(() => releaseConfig(BASE, { EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: 'https://localhost:4000' })).toThrow();
      expect(releaseConfig(BASE, { EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: 'https://offix.example.ru/api/v1' }).extra?.apiUrl).toBe('https://offix.example.ru/api/v1');
    }
    // Своя сборка для разработки с адресом в локальной сети — можно.
    expect(releaseConfig(BASE, { EAS_BUILD_PROFILE: 'development', EXPO_PUBLIC_API_URL: 'http://192.168.1.5:4000' }).extra?.apiUrl).toBe('http://192.168.1.5:4000');
  });

  it('ошибки в ключе проекта и версии видны сразу, а не в магазине', () => {
    expect(() => releaseConfig(BASE, { EAS_PROJECT_ID: 'my-project' })).toThrow(/UUID/);
    expect(() => releaseConfig(BASE, { APP_VERSION: '1.2' })).toThrow(/три числа/);
  });

  it('app.config.ts отдаёт Expo конфигурацию из app.json', () => {
    const c = appConfig({ config: BASE } as never);
    expect(c.slug).toBe('offix');
    expect(c.ios?.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it('eas.json: внутренний APK для проверки, пакет для магазина, без ключей в репозитории', () => {
    expect(eas.build.preview).toMatchObject({ distribution: 'internal', android: { buildType: 'apk' } });
    expect(eas.build.production).toMatchObject({ autoIncrement: true, android: { buildType: 'app-bundle' } });
    expect(eas.cli.appVersionSource).toBe('remote');
    const text = JSON.stringify({ eas, app });
    expect(text).not.toMatch(/projectId|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
