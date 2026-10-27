import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { createClient, normalizeBaseUrl } from './client';
import { unregisterDevice } from './push';

const TOKEN = 'offix.token';
const SERVER = 'offix.server';
const DEFAULT_SERVER = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000');

/** SecureStore на телефоне (Keychain / Keystore), localStorage — в веб-сборке. */
const store = {
  async get(k: string) {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(k) ?? null;
    return SecureStore.getItemAsync(k);
  },
  async set(k: string, v: string | null) {
    if (Platform.OS === 'web') return v === null ? globalThis.localStorage?.removeItem(k) : globalThis.localStorage?.setItem(k, v);
    return v === null ? SecureStore.deleteItemAsync(k) : SecureStore.setItemAsync(k, v);
  },
};

let current = { token: null as string | null, server: DEFAULT_SERVER };
let onLogout: () => void = () => undefined;

/** Токен и сервер прямо сейчас — для загрузки файлов, которая идёт мимо fetch-клиента. */
export const currentSession = () => ({ token: current.token, server: current.server });

export const api = createClient({ baseUrl: () => current.server, token: () => current.token, onUnauthorized: () => onLogout() });

interface Session {
  ready: boolean;
  token: string | null;
  server: string;
  login: (email: string, password: string, server?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Новый токен после смены пароля или «выйти на остальных»: этот телефон остаётся в offix. */
  applyToken: (token: string) => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [server, setServer] = useState(DEFAULT_SERVER);

  useEffect(() => {
    void (async () => {
      const [t, s] = await Promise.all([store.get(TOKEN), store.get(SERVER)]);
      current = { token: t, server: s ?? DEFAULT_SERVER };
      setToken(t);
      setServer(current.server);
      setReady(true);
    })();
  }, []);

  const logout = useCallback(async () => {
    // Пока токен входа жив — отвязываем телефон, чтобы чужие push сюда не шли.
    await unregisterDevice(api);
    current.token = null;
    setToken(null);
    qc.clear();
    await store.set(TOKEN, null);
  }, [qc]);

  useEffect(() => {
    onLogout = () => void logout();
  }, [logout]);

  const login = useCallback(async (email: string, password: string, srv?: string) => {
    if (srv) current.server = normalizeBaseUrl(srv);
    const r = await api<{ token: string }>('/auth/login', { body: { email: email.trim(), password } });
    current.token = r.token;
    await Promise.all([store.set(TOKEN, r.token), store.set(SERVER, current.server)]);
    setServer(current.server);
    setToken(r.token);
  }, []);

  const applyToken = useCallback(async (t: string) => {
    current.token = t;
    await store.set(TOKEN, t);
    setToken(t);
  }, []);

  const value = useMemo(() => ({ ready, token, server, login, logout, applyToken }), [ready, token, server, login, logout, applyToken]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession вне SessionProvider');
  return s;
}
