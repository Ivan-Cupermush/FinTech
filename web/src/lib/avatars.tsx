import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { avatarFor, buildAvatarDirectory, type AvatarDirectory, type AvatarEntry } from '@offix/core';
import { api } from './api';
import { fileSrc } from './files';

const EMPTY: AvatarDirectory = { byId: new Map(), byName: new Map() };
const Ctx = createContext<AvatarDirectory>(EMPTY);
export const avatarsKey = ['avatars'] as const;

export const buildDirectory = (list: AvatarEntry[]): AvatarDirectory => buildAvatarDirectory(list, fileSrc);

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
  return avatarFor(useContext(Ctx), id, name);
}
