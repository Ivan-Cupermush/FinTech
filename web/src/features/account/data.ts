import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { contactBook, type AccountProfile, type ContactName, type PersonCard, type PersonGroup, type QrLoginInfo } from '@offix/core';
import { api } from '../../lib/api';

export const ak = {
  profile: ['account'] as const,
  names: ['contact-names'] as const,
  person: (id: string) => ['person', id] as const,
  groups: (id: string) => ['person-groups', id] as const,
  qr: (token: string) => ['qr-login', token] as const,
};

export const useProfile = () => useQuery({ queryKey: ak.profile, queryFn: () => api<AccountProfile>('/account') });
export const usePerson = (id: string) => useQuery({ queryKey: ak.person(id), queryFn: () => api<PersonCard>(`/contacts/${id}`) });
export const usePersonGroups = (id: string, enabled = true) => useQuery({ queryKey: ak.groups(id), queryFn: () => api<PersonGroup[]>(`/contacts/${id}/groups`), enabled });

/** Мои имена для коллег — одна выборка на всё приложение. */
export function useContactBook(enabled = true) {
  const q = useQuery({ queryKey: ak.names, queryFn: () => api<ContactName[]>('/contacts/names'), enabled, staleTime: 60_000 });
  return useMemo(() => contactBook(q.data ?? []), [q.data]);
}

export const accountApi = {
  rename: (display_name: string) => api<AccountProfile>('/account', { method: 'PATCH', body: { display_name } }),
  email: (email: string, password: string) => api<AccountProfile>('/account/email', { body: { email, password } }),
  password: (current_password: string, new_password: string) => api<{ token: string }>('/account/password', { body: { current_password, new_password } }),
  logoutAll: (keep_current: boolean) => api<{ token: string | null }>('/account/logout-all', { body: { keep_current } }),
  contactName: (userId: string, name: string) => api<ContactName>(`/contacts/${userId}/name`, { method: 'PUT', body: { name } }),
  qrInfo: (token: string) => api<QrLoginInfo>(`/account/qr/${token}`),
  qrApprove: (token: string) => api<QrLoginInfo>(`/account/qr/${token}/approve`, { body: {} }),
  qrDecline: (token: string) => api<QrLoginInfo>(`/account/qr/${token}/decline`, { body: {} }),
  resetPassword: (userId: string, password?: string) => api<{ password: string | null }>(`/users/${userId}/reset-password`, { body: password ? { password } : {} }),
};
