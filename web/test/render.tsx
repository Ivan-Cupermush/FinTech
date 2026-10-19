import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes, createQueryClient } from '../src/App';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/ui/Toast';

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (call: Call) => unknown;

/**
 * Подменяет fetch: маршрут «METHOD /path» → данные. Неописанный запрос
 * падает с 404 — так тест сразу видит лишний или неожиданный вызов.
 */
export function mockApi(routes: Record<string, unknown | Handler>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '') + url.search;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call = { method, path, body };
    calls.push(call);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && (p === path || p === path.split('?')[0]);
    });
    if (!key) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `нет мока для ${method} ${path}` } }), { status: 404 });
    const r = routes[key];
    const data = typeof r === 'function' ? (r as Handler)(call) : r;
    if (data instanceof Response) return data;
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

export function apiError(status: number, message: string, fields: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { code: 'X', message, fields } }), { status });
}

export function renderApp(path: string, { token = 'test-token' }: { token?: string | null } = {}) {
  if (token) localStorage.setItem('offix.token', token);
  else localStorage.removeItem('offix.token');
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
