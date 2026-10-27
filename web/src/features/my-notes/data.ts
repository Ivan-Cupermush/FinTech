import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, MyNote, MyNoteDay, MyNoteSummary, NoteRequestState, NoteRequestView, NoteShareView } from '@offix/core';
import { api, apiBlob, newIdempotencyKey, saveBlob } from '../../lib/api';
import { notePdfName } from '@offix/core';

/** Ключи кэша личных заметок. */
export const mk = {
  all: ['my-notes'] as const,
  list: (filter: string) => ['my-notes', 'list', filter] as const,
  days: (month: string) => ['my-notes', 'days', month] as const,
  note: (id: string) => ['my-note', id] as const,
  shared: (id: string) => ['note-share', id] as const,
  request: (id: string) => ['note-request', id] as const,
};

export interface MyNotesFilter {
  date?: string | null;
  month?: string | null;
  favorite?: boolean;
  q?: string;
}

export function filterQuery(f: MyNotesFilter): string {
  const qs = new URLSearchParams();
  if (f.date) qs.set('date', f.date);
  else if (f.month) qs.set('month', f.month);
  if (f.favorite) qs.set('favorite', '1');
  if (f.q?.trim()) qs.set('q', f.q.trim());
  return qs.toString();
}

export const useMyNotes = (f: MyNotesFilter) => {
  const s = filterQuery(f);
  return useQuery({ queryKey: mk.list(s), queryFn: () => api<MyNoteSummary[]>(`/my-notes${s ? `?${s}` : ''}`), placeholderData: (prev) => prev });
};
export const useNoteDays = (month: string) => useQuery({ queryKey: mk.days(month), queryFn: () => api<MyNoteDay[]>(`/my-notes/days?month=${month}`), placeholderData: (prev) => prev });
export const useMyNote = (id: string | null) => useQuery({ queryKey: mk.note(id ?? ''), queryFn: () => api<MyNote>(`/my-notes/${id}`), enabled: !!id });
export const useSharedNote = (id: string | null) => useQuery({ queryKey: mk.shared(id ?? ''), queryFn: () => api<NoteShareView>(`/my-notes/shared/${id}`), enabled: !!id });
export const useNoteRequest = (id: string | null) => useQuery({ queryKey: mk.request(id ?? ''), queryFn: () => api<NoteRequestView>(`/my-notes/requests/${id}`), enabled: !!id });

export const myNotesApi = {
  create: (body: { title: string; body: string; note_date: string; is_favorite?: boolean; attachment_ids?: string[] }) => api<MyNote>('/my-notes', { body }),
  update: (id: string, body: Partial<{ title: string; body: string; note_date: string; is_favorite: boolean }>) => api<MyNote>(`/my-notes/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`/my-notes/${id}`, { method: 'DELETE' }),
  duplicate: (id: string, note_date?: string) => api<MyNote>(`/my-notes/${id}/duplicate`, { body: note_date ? { note_date } : {} }),
  attach: (id: string, ids: string[]) => api<MyNote>(`/my-notes/${id}/files`, { body: { attachment_ids: ids } }),
  detach: (id: string, fileId: string) => api(`/my-notes/${id}/files/${fileId}`, { method: 'DELETE' }),
  share: (id: string, chatId: string, opts: { text?: string; topicId?: string | null } = {}) =>
    api<ChatMessage>(`/my-notes/${id}/share`, { body: { chat_id: chatId, topic_id: opts.topicId ?? null, text: opts.text ?? '', client_id: newIdempotencyKey() } }),
  accept: (shareId: string) => api<MyNote>(`/my-notes/shared/${shareId}/accept`, { body: {} }),
  request: (shareId: string) => api<NoteRequestState & { already: boolean }>(`/my-notes/shared/${shareId}/request`, { body: {} }),
  approve: (requestId: string) => api<NoteRequestView>(`/my-notes/requests/${requestId}/approve`, { body: {} }),
  decline: (requestId: string) => api<NoteRequestView>(`/my-notes/requests/${requestId}/decline`, { body: {} }),
  /** PDF скачивается с токеном: ссылкой его не поделиться. */
  pdf: async (id: string, title: string) => saveBlob(await apiBlob(`/my-notes/${id}/pdf?download=1`), notePdfName(title)),
};

/** После правки — список, точки календаря и сама заметка. */
export function useRefreshNotes() {
  const qc = useQueryClient();
  return (note?: MyNote) => {
    if (note) qc.setQueryData(mk.note(note.id), note);
    return qc.invalidateQueries({ queryKey: mk.all });
  };
}
