import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useMemo } from 'react';
import { Linking, Platform } from 'react-native';
import {
  contactBook,
  notePdfName,
  type AccountProfile,
  type ChatMessage,
  type ContactName,
  type MyNote,
  type MyNoteDay,
  type MyNoteSummary,
  type NoteRequestState,
  type NoteRequestView,
  type NoteShareView,
  type PersonCard,
  type PersonGroup,
  type QrLoginInfo,
} from '@offix/core';
import { ApiError, newIdempotencyKey } from './client';
import { api, currentSession } from './session';

/** Ключи кэша личного пространства — те же, что на сайте. */
export const mk = {
  all: ['my-notes'] as const,
  list: (qs: string) => ['my-notes', 'list', qs] as const,
  days: (month: string) => ['my-notes', 'days', month] as const,
  note: (id: string) => ['my-note', id] as const,
  shared: (id: string) => ['note-share', id] as const,
  request: (id: string) => ['note-request', id] as const,
  profile: ['account'] as const,
  names: ['contact-names'] as const,
  person: (id: string) => ['person', id] as const,
  groups: (id: string) => ['person-groups', id] as const,
};

export const useMyNotes = (qs: string) => useQuery({ queryKey: mk.list(qs), queryFn: () => api<MyNoteSummary[]>(`/my-notes${qs ? `?${qs}` : ''}`), placeholderData: keepPreviousData });
export const useNoteDays = (month: string) => useQuery({ queryKey: mk.days(month), queryFn: () => api<MyNoteDay[]>(`/my-notes/days?month=${month}`), placeholderData: keepPreviousData });
export const useMyNote = (id: string | null) => useQuery({ queryKey: mk.note(id ?? ''), queryFn: () => api<MyNote>(`/my-notes/${id}`), enabled: !!id });
export const useSharedNote = (id: string) => useQuery({ queryKey: mk.shared(id), queryFn: () => api<NoteShareView>(`/my-notes/shared/${id}`) });
export const useNoteRequest = (id: string) => useQuery({ queryKey: mk.request(id), queryFn: () => api<NoteRequestView>(`/my-notes/requests/${id}`) });
export const useProfile = () => useQuery({ queryKey: mk.profile, queryFn: () => api<AccountProfile>('/account') });
export const usePerson = (id: string) => useQuery({ queryKey: mk.person(id), queryFn: () => api<PersonCard>(`/contacts/${id}`) });
export const usePersonGroups = (id: string, enabled: boolean) => useQuery({ queryKey: mk.groups(id), queryFn: () => api<PersonGroup[]>(`/contacts/${id}/groups`), enabled });

/** Мои имена для коллег — одна выборка на всё приложение. */
export function useContactBook() {
  const q = useQuery({ queryKey: mk.names, queryFn: () => api<ContactName[]>('/contacts/names'), staleTime: 60_000 });
  return useMemo(() => contactBook(q.data ?? []), [q.data]);
}

/** После правки — списки, точки календаря и сама заметка. */
export function useRefreshNotes() {
  const qc = useQueryClient();
  return (note?: MyNote) => {
    if (note) qc.setQueryData(mk.note(note.id), note);
    return qc.invalidateQueries({ queryKey: mk.all });
  };
}

export const myNotesApi = {
  create: (body: { title: string; body: string; note_date: string; is_favorite?: boolean; attachment_ids?: string[] }) => api<MyNote>('/my-notes', { body }),
  update: (id: string, body: Partial<{ title: string; body: string; note_date: string; is_favorite: boolean }>) => api<MyNote>(`/my-notes/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`/my-notes/${id}`, { method: 'DELETE' }),
  duplicate: (id: string) => api<MyNote>(`/my-notes/${id}/duplicate`, { body: {} }),
  attach: (id: string, ids: string[]) => api<MyNote>(`/my-notes/${id}/files`, { body: { attachment_ids: ids } }),
  detach: (id: string, fileId: string) => api(`/my-notes/${id}/files/${fileId}`, { method: 'DELETE' }),
  share: (id: string, chatId: string, o: { text?: string; topicId?: string | null } = {}) =>
    api<ChatMessage>(`/my-notes/${id}/share`, { body: { chat_id: chatId, topic_id: o.topicId ?? null, text: o.text ?? '', client_id: newIdempotencyKey() } }),
  accept: (shareId: string) => api<MyNote>(`/my-notes/shared/${shareId}/accept`, { body: {} }),
  request: (shareId: string) => api<NoteRequestState & { already: boolean }>(`/my-notes/shared/${shareId}/request`, { body: {} }),
  approve: (requestId: string) => api<NoteRequestView>(`/my-notes/requests/${requestId}/approve`, { body: {} }),
  decline: (requestId: string) => api<NoteRequestView>(`/my-notes/requests/${requestId}/decline`, { body: {} }),
};

export const accountApi = {
  rename: (display_name: string) => api<AccountProfile>('/account', { method: 'PATCH', body: { display_name } }),
  password: (current_password: string, new_password: string) => api<{ token: string }>('/account/password', { body: { current_password, new_password } }),
  logoutAll: (keep_current: boolean) => api<{ token: string | null }>('/account/logout-all', { body: { keep_current } }),
  contactName: (userId: string, name: string) => api<ContactName>(`/contacts/${userId}/name`, { method: 'PUT', body: { name } }),
  qrInfo: (token: string) => api<QrLoginInfo>(`/account/qr/${token}`),
  qrApprove: (token: string) => api<QrLoginInfo>(`/account/qr/${token}/approve`, { body: {} }),
  qrDecline: (token: string) => api<QrLoginInfo>(`/account/qr/${token}/decline`, { body: {} }),
};

/**
 * PDF заметки: качаем с токеном в заголовке (ссылкой его не передать)
 * и отдаём системе — «Сохранить в Файлы», почта, мессенджер.
 */
export async function shareNotePdf(note: Pick<MyNote, 'id' | 'title'>) {
  const { token, server } = currentSession();
  const url = `${server}/my-notes/${note.id}/pdf?download=1`;
  const name = notePdfName(note.title);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new ApiError(res.status, 'PDF', 'PDF не получился, попробуйте ещё раз');
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return;
  }
  const file = await FsFile.downloadFileAsync(url, new FsFile(Paths.cache, name), { headers, idempotent: true });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: name, UTI: 'com.adobe.pdf' });
  else await Linking.openURL(file.uri);
}
