/**
 * HTTP-клиент приложения. Без зависимостей от React Native — тестируется
 * обычным vitest. Хранилище токена и fetch передаются снаружи.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export interface ClientOptions {
  baseUrl: () => string;
  token: () => string | null;
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

/** Убираем хвостовой слеш и пробелы; добавляем /api/v1, если человек ввёл только адрес сервера. */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/\/api\/v\d+$/.test(url)) url = `${url}/api/v1`;
  return url;
}

export function createClient(o: ClientOptions) {
  return async function api<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = o.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
    let res: Response;
    try {
      res = await (o.fetch ?? fetch)(`${o.baseUrl()}${path}`, {
        method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Нет связи с сервером. Проверьте интернет и адрес сервера');
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string; fields?: Record<string, string> } } | null;
    if (!res.ok) {
      const err = json?.error ?? {};
      if (res.status === 401 && token) o.onUnauthorized?.();
      throw new ApiError(res.status, err.code ?? 'UNKNOWN', err.message ?? 'Что-то пошло не так', err.fields ?? {});
    }
    return (json?.data ?? json) as T;
  };
}

export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c && 'randomUUID' in c ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
