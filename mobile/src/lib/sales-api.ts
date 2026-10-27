import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SaleEntry, SalesEmployee, SalesMonth, SalesPlan, SalesReportImport, SalesTeam } from '@offix/core';
import { uploadPicked } from './files';
import type { PickedFile } from './media';
import { salesQs, sk } from './sales';
import { api } from './session';

export const useSalesMonth = (month: string, user?: string) => useQuery({ queryKey: sk.month(month, user), queryFn: () => api<SalesMonth>(`/sales/month${salesQs({ user, month })}`) });
export const useSalesTeam = (month: string, enabled: boolean) => useQuery({ queryKey: sk.team(month), queryFn: () => api<SalesTeam>(`/sales/team${salesQs({ month })}`), enabled });
export const useSalesEmployee = (id: string, month: string) => useQuery({ queryKey: sk.employee(id, month), queryFn: () => api<SalesEmployee>(`/sales/people/${id}${salesQs({ month })}`) });
export const useSalesEntries = (month: string, user: string | undefined, enabled = true) =>
  useQuery({ queryKey: sk.entries(month, user), queryFn: () => api<SaleEntry[]>(`/sales/entries${salesQs({ user, month })}`), enabled });

/** Любая правка в продажах меняет месяц, команду и связанные KPI целей. */
export function useSalesRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: sk.all }), qc.invalidateQueries({ queryKey: ['goals'] }), qc.invalidateQueries({ queryKey: ['goal'] })]);
}

export function useSalesMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const refresh = useSalesRefresh();
  return useMutation({ mutationFn: fn, onSuccess: () => refresh() });
}

export const salesApi = {
  setFact: (id: string, fact: number) => api<SalesPlan>(`/sales/plans/${id}`, { method: 'PATCH', body: { fact } }),
  addEntry: (body: Record<string, unknown>) => api<SaleEntry>('/sales/entries', { body }),
  deleteEntry: (id: string) => api(`/sales/entries/${id}`, { method: 'DELETE' }),
  uploadReport: (f: PickedFile, onProgress?: (p: number) => void) => uploadPicked<SalesReportImport>(f, { path: '/sales/reports', onProgress }),
};
