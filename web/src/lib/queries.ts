import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Dashboard, GoalCard, GoalSummary, Me, Member, MetricsReport, Notification, OrgUnitRow, Roadmap, Task, TaskDetail } from './types';

export const qk = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  goals: (filter: string) => ['goals', filter] as const,
  goal: (id: string) => ['goal', id] as const,
  roadmap: (id: string) => ['roadmap', id] as const,
  tasks: (filter: string) => ['tasks', filter] as const,
  task: (id: string) => ['task', id] as const,
  users: (search: string) => ['users', search] as const,
  units: ['units'] as const,
  notifications: ['notifications'] as const,
  metrics: ['metrics'] as const,
};

export const useMe = (enabled = true) => useQuery({ queryKey: qk.me, queryFn: () => api<Me>('/users/me'), enabled, staleTime: 60_000 });
export const useDashboard = () => useQuery({ queryKey: qk.dashboard, queryFn: () => api<Dashboard>('/dashboard') });
export const useGoals = (filter = 'scope=top') => useQuery({ queryKey: qk.goals(filter), queryFn: () => api<GoalSummary[]>(`/goals?${filter}`) });
export const useGoal = (id: string) => useQuery({ queryKey: qk.goal(id), queryFn: () => api<GoalCard>(`/goals/${id}`) });
export const useRoadmap = (id: string) => useQuery({ queryKey: qk.roadmap(id), queryFn: () => api<Roadmap>(`/goals/${id}/roadmap`) });
export const useTasks = (filter = 'mine=1') => useQuery({ queryKey: qk.tasks(filter), queryFn: () => api<Task[]>(`/tasks?${filter}`) });
export const useTask = (id: string | null) => useQuery({ queryKey: qk.task(id ?? ''), queryFn: () => api<TaskDetail>(`/tasks/${id}`), enabled: !!id });
export const useUsers = (search = '') => useQuery({ queryKey: qk.users(search), queryFn: () => api<Member[]>(`/users?search=${encodeURIComponent(search)}`), staleTime: 30_000 });
export const useUnits = () => useQuery({ queryKey: qk.units, queryFn: () => api<OrgUnitRow[]>('/org/units'), staleTime: 30_000 });
export const useMetrics = () => useQuery({ queryKey: qk.metrics, queryFn: () => api<MetricsReport>('/metrics'), staleTime: 30_000 });
export const useNotifications = () => useQuery({ queryKey: qk.notifications, queryFn: () => api<Notification[]>('/notifications') });

/** После изменения — обновляем всё, что зависит от целей и задач. */
export function useInvalidateWork() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['dashboard', 'goals', 'goal', 'roadmap', 'tasks', 'task', 'notifications', 'metrics'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
}

export function useTaskStatus() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (v: { id: string; status: string; blocked_reason?: string; blocked_note?: string; next_step?: string }) =>
      api<Task>(`/tasks/${v.id}/status`, { body: { status: v.status, blocked_reason: v.blocked_reason, blocked_note: v.blocked_note, next_step: v.next_step } }),
    onSuccess: invalidate,
  });
}

export function useRecordObservation(goalId: string) {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (v: { metricId: string; value: number; note?: string }) => api(`/goals/${goalId}/metrics/${v.metricId}/observations`, { body: { value: v.value, note: v.note } }),
    onSuccess: invalidate,
  });
}
