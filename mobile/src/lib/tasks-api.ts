import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Checkpoint, CheckpointStatus, FunctionDetail, Task, TaskKind } from '@offix/core';
import { useInvalidateWork } from './queries';
import { api } from './session';

/** Задачи и просьбы: те же запросы, что на сайте. */
export const tasksApi = {
  create: (body: { kind: TaskKind; title: string; description?: string | null; assignee_id: string | null; due_at?: string | null; checkpoints?: { title: string; due_at: string }[] }) => api<Task>('/tasks', { body }),
  archive: (id: string) => api<Task>(`/tasks/${id}/archive`, { body: {} }),
  unarchive: (id: string) => api<Task>(`/tasks/${id}/unarchive`, { body: {} }),
  thanks: (id: string, text?: string) => api<Task>(`/tasks/${id}/thanks`, { body: text ? { text } : {} }),
  addCheckpoint: (id: string, cp: { title: string; due_at: string }) => api<Checkpoint[]>(`/tasks/${id}/checkpoints`, { body: cp }),
  markCheckpoint: (id: string, cid: string, status: CheckpointStatus) => api<Checkpoint[]>(`/tasks/${id}/checkpoints/${cid}`, { method: 'PATCH', body: { status } }),
  removeCheckpoint: (id: string, cid: string) => api<void>(`/tasks/${id}/checkpoints/${cid}`, { method: 'DELETE' }),
  watchers: (id: string, user_ids: string[]) => api<Task>(`/tasks/${id}/watchers`, { method: 'PUT', body: { user_ids } }),
  start: (id: string) => api<Task>(`/tasks/${id}/status`, { body: { status: 'in_progress' } }),
};

/** Действие с задачей: потом обновляем списки, карточку и входящие. */
export function useTaskAction<V, R>(fn: (v: V) => Promise<R>) {
  const invalidate = useInvalidateWork();
  return useMutation({ mutationFn: fn, onSuccess: invalidate });
}

export interface FunctionsView {
  functions: FunctionDetail[];
  can_change: boolean;
  reason: string | null;
}

export const useMyFunctions = () => useQuery({ queryKey: ['functions', 'me'], queryFn: () => api<FunctionsView>('/functions/me') });
export const useUserFunctions = (id: string, enabled: boolean) => useQuery({ queryKey: ['functions', id], queryFn: () => api<FunctionsView>(`/functions/users/${id}`), enabled, retry: false });

export function useSetFunctions(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: Record<string, boolean | null>) => api<FunctionsView>(`/functions/users/${id}`, { method: 'PUT', body: { changes } }),
    onSuccess: (data) => qc.setQueryData(['functions', id], data),
  });
}
