import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, tokenStore } from './api';

interface AuthState {
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { company_name: string; display_name: string; email: string; password: string }) => Promise<void>;
  logout: () => void;
  /** Вход по QR и новый токен после смены пароля: сеанс уже выдан сервером. */
  applyToken: (token: string) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => tokenStore.get());
  const qc = useQueryClient();
  const apply = useCallback(
    (t: string | null) => {
      tokenStore.set(t);
      setToken(t);
      qc.clear();
    },
    [qc],
  );
  useEffect(() => onUnauthorized(() => apply(null)), [apply]);
  const value = useMemo<AuthState>(
    () => ({
      token,
      login: async (email, password) => {
        const r = await api<{ token: string }>('/auth/login', { body: { email, password } });
        apply(r.token);
      },
      register: async (data) => {
        const r = await api<{ token: string }>('/auth/register', { body: data });
        apply(r.token);
      },
      logout: () => apply(null),
      applyToken: (t) => apply(t),
    }),
    [token, apply],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
