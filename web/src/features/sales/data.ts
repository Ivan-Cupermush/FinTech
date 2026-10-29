import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KpiFilePreview,
  KpiFileResult,
  SaleEntry,
  SalesAlias,
  SalesClientPattern,
  SalesEmployee,
  SalesGoalLink,
  SalesImportPreview,
  SalesMonth,
  SalesPerson,
  SalesPlan,
  SalesReportImport,
  SalesReportInfo,
  SalesTeam,
  SalesUnmatched,
  EntryMapping,
} from '@offix/core';
import { api } from '../../lib/api';
import { uploadSalesFile, type UploadOptions } from '../../lib/files';

/** Все ключи раздела начинаются с 'sales': после любой загрузки обновляем раздел целиком. */
const qs = (o: Record<string, string | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v);
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')}` : '';
};

export const useSalesMonth = (month: string, user?: string) =>
  useQuery({ queryKey: ['sales', 'month', user ?? 'me', month], queryFn: () => api<SalesMonth>(`/sales/month${qs({ user, month })}`) });

export const useSalesTeam = (month: string, enabled: boolean) =>
  useQuery({ queryKey: ['sales', 'team', month], queryFn: () => api<SalesTeam>(`/sales/team${qs({ month })}`), enabled });

export const useSalesEmployee = (id: string, month: string) =>
  useQuery({ queryKey: ['sales', 'employee', id, month], queryFn: () => api<SalesEmployee>(`/sales/people/${id}${qs({ month })}`) });

export type SalesFnName = 'sales_assign' | 'sales_files' | 'sales_reports';
export const useSalesPeople = (fn: SalesFnName, enabled = true) =>
  useQuery({ queryKey: ['sales', 'people', fn], queryFn: () => api<SalesPerson[]>(`/sales/people?for=${fn}`), enabled, staleTime: 60_000 });

export const useSalesEntries = (month: string, user?: string) =>
  useQuery({ queryKey: ['sales', 'entries', user ?? 'me', month], queryFn: () => api<SaleEntry[]>(`/sales/entries${qs({ user, month })}`) });

export const useSalesReports = (enabled: boolean) => useQuery({ queryKey: ['sales', 'reports'], queryFn: () => api<SalesReportInfo[]>('/sales/reports'), enabled });
export const useUnmatched = (enabled: boolean) => useQuery({ queryKey: ['sales', 'unmatched'], queryFn: () => api<SalesUnmatched[]>('/sales/unmatched'), enabled });
export const useAliases = (enabled: boolean) => useQuery({ queryKey: ['sales', 'aliases'], queryFn: () => api<SalesAlias[]>('/sales/aliases'), enabled });
export const useClientLists = () => useQuery({ queryKey: ['sales', 'lists'], queryFn: () => api<{ key: SalesClientPattern[]; merge: SalesClientPattern[] }>('/sales/lists') });

export interface SalesClient {
  name: string;
  revenue: number;
  managers: string[];
  key: string | null;
  merge: string | null;
  key_hint: boolean;
}
export const useSalesClients = (month: string, search: string, enabled: boolean) =>
  useQuery({ queryKey: ['sales', 'clients', month, search], queryFn: () => api<SalesClient[]>(`/sales/clients${qs({ month, q: search })}`), enabled });

export const useSalesGroups = (month: string, enabled: boolean) =>
  useQuery({ queryKey: ['sales', 'groups', month], queryFn: () => api<{ path: string; name: string; depth: number; revenue: number }[]>(`/sales/groups${qs({ month })}`), enabled, staleTime: 60_000 });

export const useGoalLinks = () => useQuery({ queryKey: ['sales', 'goal-links'], queryFn: () => api<SalesGoalLink[]>('/sales/goal-links') });
export interface GoalLinkTargets {
  metrics: { metric_id: string; metric_name: string; unit: string; goal_id: string; goal_title: string }[];
  units: { id: string; name: string }[];
  company?: boolean;
}
export const useGoalLinkTargets = (enabled: boolean) => useQuery({ queryKey: ['sales', 'goal-targets'], queryFn: () => api<GoalLinkTargets>('/sales/goal-links/targets'), enabled });

/** Любая правка в продажах меняет месяц, команду и связанные KPI: обновляем раздел и цели. */
export function useSalesRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['sales'] }), qc.invalidateQueries({ queryKey: ['goals'] }), qc.invalidateQueries({ queryKey: ['goal'] })]);
}

export function useSalesMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const refresh = useSalesRefresh();
  return useMutation({ mutationFn: fn, onSuccess: () => refresh() });
}

export const salesApi = {
  createPlan: (body: Record<string, unknown>) => api<SalesPlan>('/sales/plans', { body }),
  updatePlan: (id: string, body: Record<string, unknown>) => api<SalesPlan>(`/sales/plans/${id}`, { method: 'PATCH', body }),
  deletePlan: (id: string) => api(`/sales/plans/${id}`, { method: 'DELETE' }),
  addEntry: (body: Record<string, unknown>) => api<SaleEntry>('/sales/entries', { body }),
  deleteEntry: (id: string) => api(`/sales/entries/${id}`, { method: 'DELETE' }),
  importEntries: (file: File, user?: string, opts: UploadOptions = {}) => uploadSalesFile<SalesImportPreview>('/entries/import', file, { ...opts, fields: { user_id: user } }),
  confirmImport: (id: string, body: { mapping: EntryMapping; plan_id?: string | null; dry_run?: boolean }) =>
    api<{ preview: SalesImportPreview; imported: number; skipped: number }>(`/sales/entries/import/${id}`, { body }),
  cancelImport: (id: string) => api(`/sales/entries/import/${id}`, { method: 'DELETE' }).catch(() => undefined),
  uploadReport: (file: File, opts: UploadOptions = {}) => uploadSalesFile<SalesReportImport>('/reports', file, opts),
  deleteReport: (id: string) => api(`/sales/reports/${id}`, { method: 'DELETE' }),
  previewKpi: (file: File) => uploadSalesFile<KpiFilePreview>('/kpi-files', file, { fields: { dry_run: true } }),
  saveKpi: (file: File, fields: { user_id?: string; month?: string }) => uploadSalesFile<{ results: KpiFileResult[] }>('/kpi-files', file, { fields }),
  addAlias: (name: string, userId: string) => api<{ months: number; lines: number; plans_updated: number; goals_updated: number }>('/sales/aliases', { body: { name, user_id: userId } }),
  deleteAlias: (id: string) => api(`/sales/aliases/${id}`, { method: 'DELETE' }),
  addPatterns: (kind: 'key' | 'merge', text: string) => api<{ added: number; skipped: number; plans_updated: number }>('/sales/lists', { body: { kind, text } }),
  uploadPatterns: (kind: 'key' | 'merge', file: File) => uploadSalesFile<{ added: number; skipped: number; plans_updated: number }>('/lists/file', file, { fields: { kind } }),
  deletePattern: (id: string) => api(`/sales/lists/${id}`, { method: 'DELETE' }),
  linkGoal: (body: { metric_id: string; measure: SalesGoalLink['measure']; unit_id: string | null }) => api<{ metric_id: string; goals_updated: number }>('/sales/goal-links', { body }),
  unlinkGoal: (metricId: string) => api(`/sales/goal-links/${metricId}`, { method: 'DELETE' }),
};

export const TEMPLATE_NAMES = { report: 'Образец отчёта о продажах 1С.xlsx', kpi: 'Образец файла KPI.xlsx', entries: 'Образец продаж.xlsx' } as const;
