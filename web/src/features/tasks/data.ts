import { useMutation } from '@tanstack/react-query';
import type { Checkpoint, CheckpointStatus, TaskKind } from '@offix/core';
import { api } from '../../lib/api';
import { useInvalidateWork } from '../../lib/queries';
import type { Task } from '../../lib/types';

export interface NewTask {
  kind: TaskKind;
  title: string;
  description?: string | null;
  assignee_id: string | null;
  due_at?: string | null;
  checkpoints?: { title: string; due_at: string }[];
}

export const tasksApi = {
  create: (body: NewTask) => api<Task>('/tasks', { body }),
  archive: (id: string) => api<Task>(`/tasks/${id}/archive`, { body: {} }),
  unarchive: (id: string) => api<Task>(`/tasks/${id}/unarchive`, { body: {} }),
  thanks: (id: string, text?: string) => api<Task>(`/tasks/${id}/thanks`, { body: text ? { text } : {} }),
  addCheckpoint: (id: string, cp: { title: string; due_at: string }) => api<Checkpoint[]>(`/tasks/${id}/checkpoints`, { body: cp }),
  markCheckpoint: (id: string, cid: string, status: CheckpointStatus) => api<Checkpoint[]>(`/tasks/${id}/checkpoints/${cid}`, { method: 'PATCH', body: { status } }),
  removeCheckpoint: (id: string, cid: string) => api<void>(`/tasks/${id}/checkpoints/${cid}`, { method: 'DELETE' }),
  watchers: (id: string, user_ids: string[]) => api<Task>(`/tasks/${id}/watchers`, { method: 'PUT', body: { user_ids } }),
};

/** Любое действие с задачей: после него обновляем списки, карточку и входящие. */
export function useTaskAction<V, R>(fn: (v: V) => Promise<R>) {
  const invalidate = useInvalidateWork();
  return useMutation({ mutationFn: fn, onSuccess: invalidate });
}
