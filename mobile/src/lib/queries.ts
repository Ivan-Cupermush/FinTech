import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dashboard, GoalSummary, Me, MetricsReport, Notification, Roadmap, Task, TaskDetail } from '@offix/core';
import { api } from './session';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/users/me'), staleTime: 60_000 });
export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });
export const useGoals = (filter: string) => useQuery({ queryKey: ['goals', filter], queryFn: () => api<GoalSummary[]>(`/goals?${filter}`) });
export const useRoadmap = (id: string) => useQuery({ queryKey: ['roadmap', id], queryFn: () => api<Roadmap>(`/goals/${id}/roadmap`) });
export const useTasks = (filter: string) => useQuery({ queryKey: ['tasks', filter], queryFn: () => api<Task[]>(`/tasks?${filter}`) });
export const useTask = (id: string) => useQuery({ queryKey: ['task', id], queryFn: () => api<TaskDetail>(`/tasks/${id}`) });
export const useMetrics = () => useQuery({ queryKey: ['metrics'], queryFn: () => api<MetricsReport>('/metrics'), staleTime: 30_000 });
export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api<Notification[]>('/notifications') });

export function useInvalidateWork() {
  const qc = useQueryClient();
  return () => Promise.all(['dashboard', 'goals', 'roadmap', 'tasks', 'task', 'notifications', 'metrics'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useTaskStatus() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (v: { id: string; status: string; blocked_reason?: string; blocked_note?: string; next_step?: string }) =>
      api<Task>(`/tasks/${v.id}/status`, { body: { status: v.status, blocked_reason: v.blocked_reason, blocked_note: v.blocked_note, next_step: v.next_step } }),
    onSuccess: invalidate,
  });
}
