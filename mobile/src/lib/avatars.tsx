import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { avatarFor, buildAvatarDirectory, type AvatarDirectory, type AvatarEntry } from '@offix/core';
import { fileUri } from './media';
import { api, useSession } from './session';

const EMPTY: AvatarDirectory = { byId: new Map(), byName: new Map() };
const Ctx = createContext<AvatarDirectory>(EMPTY);
export const avatarsKey = ['avatars'] as const;

/** Фото коллег — одним списком на всё приложение, как на сайте. */
export function AvatarProvider({ children }: { children: ReactNode }) {
  const { token, server } = useSession();
  const q = useQuery({ queryKey: avatarsKey, queryFn: () => api<AvatarEntry[]>('/files/avatars'), enabled: !!token, staleTime: 5 * 60_000 });
  const value = useMemo(() => (q.data && token ? buildAvatarDirectory(q.data, (u) => fileUri(server, u)) : EMPTY), [q.data, token, server]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Фото по id, а где id нет — по имени (только если имя ни с кем не совпадает). */
export const useAvatarUri = (id?: string | null, name?: string | null) => avatarFor(useContext(Ctx), id, name);
