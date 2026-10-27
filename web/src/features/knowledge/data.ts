import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KnowledgeAskResult, KnowledgeDoc, KnowledgeMessage, KnowledgeSession, KnowledgeStatus } from '@offix/core';
import { api } from '../../lib/api';

/** Документ ещё читается — список обновляем, пока не станет готов. */
export const docBusy = (d: Pick<KnowledgeDoc, 'status'>) => d.status === 'pending' || d.status === 'processing';

export const useKnowledgeStatus = () => useQuery({ queryKey: ['kb-status'], queryFn: () => api<KnowledgeStatus>('/knowledge/status'), staleTime: 30_000 });

export const useKnowledgeDocs = (goalId?: string) =>
  useQuery({
    queryKey: ['kb-docs', goalId ?? 'all'],
    queryFn: () => api<KnowledgeDoc[]>(`/knowledge/docs${goalId ? `?goal_id=${goalId}` : ''}`),
    refetchInterval: (q) => (q.state.data?.some(docBusy) ? 2000 : false),
  });

export const useKnowledgeDoc = (id: string | undefined) =>
  useQuery({
    queryKey: ['kb-doc', id],
    queryFn: () => api<{ doc: KnowledgeDoc; chunks: { idx: number; content: string }[] }>(`/knowledge/docs/${id}/text`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && docBusy(q.state.data.doc) ? 2000 : false),
  });

export const useKnowledgeSessions = () => useQuery({ queryKey: ['kb-sessions'], queryFn: () => api<KnowledgeSession[]>('/knowledge/sessions') });

export const useKnowledgeSession = (id: string | undefined) =>
  useQuery({
    queryKey: ['kb-session', id],
    queryFn: () => api<{ session: KnowledgeSession; messages: KnowledgeMessage[] }>(`/knowledge/sessions/${id}`),
    enabled: !!id,
  });

/** Вопрос помощнику: ответ кладём в кэш диалога сразу — без лишнего запроса. */
export function useAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { question: string; session_id?: string | null }) => api<KnowledgeAskResult>('/knowledge/ask', { body: { question: v.question, session_id: v.session_id ?? undefined } }),
    onSuccess: (r) => {
      qc.setQueryData<{ session: KnowledgeSession; messages: KnowledgeMessage[] }>(['kb-session', r.session.id], (prev) => ({
        session: r.session,
        messages: [...(prev?.messages ?? []), r.question, r.answer],
      }));
      void qc.invalidateQueries({ queryKey: ['kb-sessions'] });
    },
  });
}

export function useFeedback(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; feedback: 'up' | 'down' | null }) => api<KnowledgeMessage>(`/knowledge/messages/${v.id}/feedback`, { method: 'PUT', body: { feedback: v.feedback } }),
    onSuccess: (m) =>
      qc.setQueryData<{ session: KnowledgeSession; messages: KnowledgeMessage[] }>(['kb-session', sessionId], (prev) =>
        prev ? { ...prev, messages: prev.messages.map((x) => (x.id === m.id ? { ...x, feedback: m.feedback } : x)) } : prev,
      ),
  });
}

export const docTypeLabel = (t: KnowledgeDoc['type']) => (t === 'pdf' ? 'PDF' : t === 'docx' ? 'DOCX' : 'Текст');
