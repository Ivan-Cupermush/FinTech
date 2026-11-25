import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', () => ({ API_BASE: '/api/v1', ApiError: class extends Error {}, api: vi.fn(), tokenStore: { get: () => 'token' } }));

import { api } from '../src/lib/api';
import { usePreviewUrl } from '../src/lib/files';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const link = (exp: number) => `/api/v1/files/${id}/raw?e=${exp}&u=user&s=signed&preview=1`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
  vi.mocked(api).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('подписанные превью', () => {
  it('обновляет ссылку до истечения и скрывает превью после отзыва доступа', async () => {
    const now = Date.now();
    const old = link(Math.floor(now / 1000) + 70);
    const next = link(Math.floor(now / 1000) + 670);
    vi.mocked(api).mockResolvedValueOnce({ thumb_url: next });
    const { result } = renderHook(() => usePreviewUrl({ id, thumb_url: old }));
    expect(result.current).toBe(old);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(api).toHaveBeenCalledWith('/files/' + id);
    expect(result.current).toBe(next);
    vi.mocked(api).mockRejectedValueOnce(new Error('Доступ отозван'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(result.current).toBeUndefined();
  });

  it('старые публичные ссылки обновляются и смена вложения не показывает предыдущее', async () => {
    const second = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    vi.mocked(api).mockResolvedValueOnce({ thumb_url: link(Math.floor(Date.now() / 1000) + 600) });
    const { result, rerender } = renderHook(({ file }) => usePreviewUrl(file), { initialProps: { file: { id, thumb_url: '/api/v1/files/thumbs/old.jpg' } } });
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toContain(id);
    vi.mocked(api).mockImplementationOnce(() => new Promise(() => {}));
    rerender({ file: { id: second, thumb_url: '/api/v1/files/thumbs/old2.jpg' } });
    expect(result.current).toBeUndefined();
  });

  it('после временного сбоя повторяет запрос, при размонтировании останавливается', async () => {
    const next = link(Math.floor(Date.now() / 1000) + 600);
    vi.mocked(api).mockRejectedValueOnce(new Error('Нет сети')).mockResolvedValueOnce({ thumb_url: next });
    const { result, unmount } = renderHook(() => usePreviewUrl({ id, thumb_url: '/api/v1/files/thumbs/old.jpg' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current).toBe(next);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000_000); });
    expect(api).toHaveBeenCalledTimes(2);
  });
});
