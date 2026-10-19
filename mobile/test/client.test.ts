import { describe, expect, it, vi } from 'vitest';
import { ApiError, createClient, newIdempotencyKey, normalizeBaseUrl } from '../src/lib/client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('normalizeBaseUrl', () => {
  it('достраивает схему и /api/v1, убирает слеши', () => {
    expect(normalizeBaseUrl('offix.example.ru')).toBe('http://offix.example.ru/api/v1');
    expect(normalizeBaseUrl(' https://offix.example.ru/ ')).toBe('https://offix.example.ru/api/v1');
    expect(normalizeBaseUrl('http://10.0.2.2:4000/api/v1/')).toBe('http://10.0.2.2:4000/api/v1');
  });
  it('пустая строка остаётся пустой', () => {
    expect(normalizeBaseUrl('   ')).toBe('');
  });
});

describe('createClient', () => {
  const make = (res: Response | Error, token: string | null = 't1') => {
    const fetchMock = vi.fn(async () => {
      if (res instanceof Error) throw res;
      return res;
    });
    const onUnauthorized = vi.fn();
    const api = createClient({ baseUrl: () => 'http://s/api/v1', token: () => token, onUnauthorized, fetch: fetchMock as unknown as typeof fetch });
    return { api, fetchMock, onUnauthorized };
  };

  it('GET с токеном возвращает data', async () => {
    const { api, fetchMock } = make(json(200, { data: { ok: 1 } }));
    expect(await api('/x')).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://s/api/v1/x');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t1');
  });
  it('тело → POST с JSON и ключом идемпотентности', async () => {
    const { api, fetchMock } = make(json(201, { data: { id: 'g' } }));
    await api('/goals', { body: { title: 'A' }, idempotencyKey: 'k1' });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"title":"A"}');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('k1');
  });
  it('ошибка сервера → ApiError с полями', async () => {
    const { api } = make(json(422, { error: { code: 'VALIDATION', message: 'Не удалось', fields: { title: 'Введите название' } } }));
    const e = (await api('/goals', { body: {} }).catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(422);
    expect(e.fields.title).toBe('Введите название');
  });
  it('401 с токеном разлогинивает, без токена — нет', async () => {
    const a = make(json(401, { error: { message: 'x' } }));
    await a.api('/me').catch(() => undefined);
    expect(a.onUnauthorized).toHaveBeenCalledOnce();
    const b = make(json(401, { error: { message: 'Неверная почта или пароль' } }), null);
    await b.api('/auth/login', { body: {} }).catch(() => undefined);
    expect(b.onUnauthorized).not.toHaveBeenCalled();
  });
  it('нет сети → понятная ошибка с isNetwork', async () => {
    const { api } = make(new TypeError('Network request failed'));
    const e = (await api('/x').catch((x) => x)) as ApiError;
    expect(e.isNetwork).toBe(true);
    expect(e.message).toMatch(/Нет связи/);
  });
  it('204 — undefined без разбора тела', async () => {
    const { api } = make(new Response(null, { status: 204 }));
    expect(await api('/notifications/read', { body: {} })).toBeUndefined();
  });
  it('непарсимый ответ с ошибкой — общее сообщение', async () => {
    const { api } = make(new Response('<html>', { status: 502 }));
    const e = (await api('/x').catch((x) => x)) as ApiError;
    expect(e.status).toBe(502);
    expect(e.message).toBe('Что-то пошло не так');
  });
});

it('ключи идемпотентности уникальны', () => {
  expect(new Set(Array.from({ length: 50 }, newIdempotencyKey)).size).toBe(50);
});
