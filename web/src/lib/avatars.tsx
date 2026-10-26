import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AvatarEntry } from '@offix/core';
import { api } from './api';
import { fileSrc } from './files';

interface Directory {
  byId: ReadonlyMap<string, string>;
  /** Только однозначные имена: у двух тёзок фото по имени не угадываем. */
  byName: ReadonlyMap<string, string>;
}

const EMPTY: Directory = { byId: new Map(), byName: new Map() };
const Ctx = createContext<Directory>(EMPTY);
export const avatarsKey = ['avatars'] as const;

export function buildDirectory(list: AvatarEntry[]): Directory {
  const byId = new Map<string, string>();
  const names = new Map<string, string | null>();
  for (const a of list) {
    const src = fileSrc(a.avatar_url);
    if (!src) continue;
    byId.set(a.id, src);
    const key = a.display_name.trim().toLowerCase();
    names.set(key, names.has(key) ? null : src);
  }
  const byName = new Map<string, string>();
  for (const [k, v] of names) if (v) byName.set(k, v);
  return { byId, byName };
}

/**
 * Фото коллег — одним списком на всё приложение. Аватар везде рисуется
 * по id, а там, где id нет (подписи из старых данных), — по имени.
 */
export function AvatarProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const q = useQuery({ queryKey: avatarsKey, queryFn: () => api<AvatarEntry[]>('/files/avatars'), enabled, staleTime: 5 * 60_000 });
  const value = useMemo(() => (q.data ? buildDirectory(q.data) : EMPTY), [q.data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAvatarSrc(id?: string | null, name?: string | null): string | undefined {
  const dir = useContext(Ctx);
  if (id) return dir.byId.get(id);
  return name ? dir.byName.get(name.trim().toLowerCase()) : undefined;
}
