import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeDocBusy, type KnowledgeAskResult, type KnowledgeDoc, type KnowledgeMessage, type KnowledgeSession, type KnowledgeStatus } from '@offix/core';
import { uploadPicked } from './files';
import { docUploadFields } from './knowledge';
import type { PickedFile } from './media';
import { api } from './session';

/** Ключи кэша помощника — те же, что на сайте. */
export const kk = {
  status: ['kb-status'] as const,
  docs: (goalId?: string) => ['kb-docs', goalId ?? 'all'] as const,
  doc: (id: string) => ['kb-doc', id] as const,
  sessions: ['kb-sessions'] as const,
  session: (id: string) => ['kb-session', id] as const,
};

type SessionData = { session: KnowledgeSession; messages: KnowledgeMessage[] };

export const useKnowledgeStatus = () => useQuery({ queryKey: kk.status, queryFn: () => api<KnowledgeStatus>('/knowledge/status'), staleTime: 30_000 });

/** Пока документ читается, список обновляем — статус сменится сам. */
export const useKnowledgeDocs = (goalId?: string) =>
  useQuery({
    queryKey: kk.docs(goalId),
    queryFn: () => api<KnowledgeDoc[]>(`/knowledge/docs${goalId ? `?goal_id=${goalId}` : ''}`),
    refetchInterval: (q) => (q.state.data?.some(knowledgeDocBusy) ? 2500 : false),
  });

export const useKnowledgeDoc = (id: string) =>
  useQuery({
    queryKey: kk.doc(id),
    queryFn: () => api<{ doc: KnowledgeDoc; chunks: { idx: number; content: string }[] }>(`/knowledge/docs/${id}/text`),
    refetchInterval: (q) => (q.state.data && knowledgeDocBusy(q.state.data.doc) ? 2500 : false),
  });

export const useKnowledgeSessions = () => useQuery({ queryKey: kk.sessions, queryFn: () => api<KnowledgeSession[]>('/knowledge/sessions') });

export const useKnowledgeSession = (id: string | undefined) => useQuery({ queryKey: kk.session(id ?? ''), queryFn: () => api<SessionData>(`/knowledge/sessions/${id}`), enabled: !!id });

/** Вопрос помощнику: ответ сразу кладём в кэш диалога. */
export function useAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { question: string; session_id?: string | null }) => api<KnowledgeAskResult>('/knowledge/ask', { body: { question: v.question, session_id: v.session_id ?? undefined } }),
    onSuccess: (r) => {
      qc.setQueryData<SessionData>(kk.session(r.session.id), (prev) => ({ session: r.session, messages: [...(prev?.messages ?? []), r.question, r.answer] }));
      void qc.invalidateQueries({ queryKey: kk.sessions });
    },
  });
}

export function useFeedback(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; feedback: 'up' | 'down' | null }) => api<KnowledgeMessage>(`/knowledge/messages/${v.id}/feedback`, { method: 'PUT', body: { feedback: v.feedback } }),
    onSuccess: (m) =>
      qc.setQueryData<SessionData>(kk.session(sessionId ?? ''), (prev) => (prev ? { ...prev, messages: prev.messages.map((x) => (x.id === m.id ? { ...x, feedback: m.feedback } : x)) } : prev)),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/knowledge/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: kk.session(id) });
      return qc.invalidateQueries({ queryKey: kk.sessions });
    },
  });
}

function useRefreshDocs() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['kb-docs'] }), qc.invalidateQueries({ queryKey: ['kb-doc'] }), qc.invalidateQueries({ queryKey: kk.status })]);
}

export function useReprocessDoc() {
  const refresh = useRefreshDocs();
  return useMutation({ mutationFn: (id: string) => api<KnowledgeDoc>(`/knowledge/docs/${id}/reprocess`, { method: 'POST' }), onSuccess: refresh });
}

export function useDeleteDoc() {
  const refresh = useRefreshDocs();
  return useMutation({ mutationFn: (id: string) => api(`/knowledge/docs/${id}`, { method: 'DELETE' }), onSuccess: refresh });
}

/** Загрузка документа с телефона: файл из «Файлов», название — из его имени. */
export function useUploadDoc(goalId?: string) {
  const refresh = useRefreshDocs();
  return useMutation({
    mutationFn: (v: { file: PickedFile; onProgress?: (p: number) => void }) =>
      uploadPicked<KnowledgeDoc>(v.file, { path: '/knowledge/docs', fields: docUploadFields(v.file.name, goalId), onProgress: v.onProgress }),
    onSuccess: refresh,
  });
}
