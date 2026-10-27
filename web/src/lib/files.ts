import { useEffect, useState } from 'react';
import { fileLinkFresh, type Attachment, type KnowledgeDoc } from '@offix/core';
import { API_BASE, ApiError, api, tokenStore } from './api';

/**
 * Файлы: загрузка с прогрессом, свежие подписанные ссылки, скачивание.
 * Сервер отдаёт адреса вида /api/v1/files/…; если API на другом домене,
 * дописываем его origin.
 */
export function fileSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|blob:|data:)/.test(url)) return url;
  const origin = /^https?:\/\//.test(API_BASE) ? API_BASE.replace(/\/api\/v1\/?$/, '') : '';
  return origin + url;
}

export interface UploadOptions {
  /** Имя файла — для записи с микрофона или вставки из буфера. */
  name?: string;
  fields?: Record<string, string | number | boolean | null | undefined>;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** multipart через XMLHttpRequest: у fetch нет прогресса отправки. */
function send<T>(path: string, file: Blob, opts: UploadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const form = new FormData();
    // Поля — до файла: сервер читает их, пока файл ещё идёт.
    for (const [k, v] of Object.entries(opts.fields ?? {})) if (v !== undefined && v !== null && v !== false) form.append(k, v === true ? '1' : String(v));
    form.append('file', file, opts.name ?? (file instanceof File ? file.name : 'file'));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      let json: { data?: T; error?: { code?: string; message?: string; fields?: Record<string, string> } } | null = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1);
        resolve((json?.data ?? json) as T);
        return;
      }
      const err = json?.error ?? {};
      reject(new ApiError(xhr.status, err.code ?? 'UNKNOWN', err.message ?? 'Не удалось загрузить файл', err.fields ?? {}));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Нет связи с сервером — файл не загрузился, попробуйте ещё раз'));
    xhr.onabort = () => reject(new DOMException('Загрузка отменена', 'AbortError'));
    if (opts.signal) {
      if (opts.signal.aborted) return xhr.onabort?.(new ProgressEvent('abort'));
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/** Загрузить вложение: появится черновик, его забирает сообщение, задача или комментарий. */
export const uploadFile = (file: Blob, opts: UploadOptions = {}) => send<Attachment>('/files', file, opts);
export const uploadAvatar = (file: Blob, opts: UploadOptions = {}) => send<{ avatar_url: string }>('/files/avatar', file, opts);
/** Документ в базу знаний: сервер прочитает его в фоне. */
export const uploadKnowledgeDoc = (file: Blob, opts: UploadOptions = {}) => send<KnowledgeDoc>('/knowledge/docs', file, opts);
export const dropDraft = (id: string) => api(`/files/${id}`, { method: 'DELETE' }).catch(() => undefined);

const fresh = new Map<string, string>();

/** Живая ссылка на файл: подписанная живёт 10–20 минут, потом просим новую. */
export async function freshUrl(att: Pick<Attachment, 'id' | 'url'>): Promise<string> {
  const now = Date.now();
  if (fileLinkFresh(att.url, now)) return att.url;
  const cached = fresh.get(att.id);
  if (cached && fileLinkFresh(cached, now)) return cached;
  const next = await api<Attachment>(`/files/${att.id}`);
  fresh.set(att.id, next.url);
  return next.url;
}

/** Адрес для <img>, <video>, <audio>: устаревшую ссылку тихо обновляем. */
export function useFileUrl(att: Pick<Attachment, 'id' | 'url'> | null | undefined, enabled = true): string | undefined {
  const [url, setUrl] = useState<string | null>(() => (att && fileLinkFresh(att.url, Date.now()) ? att.url : null));
  const id = att?.id;
  const raw = att?.url;
  useEffect(() => {
    if (!id || !raw || !enabled) return;
    if (fileLinkFresh(raw, Date.now())) {
      setUrl(raw);
      return;
    }
    let live = true;
    void freshUrl({ id, url: raw })
      .then((u) => live && setUrl(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, raw, enabled]);
  return url ? fileSrc(url) : undefined;
}

/** Скачать или открыть файл: ссылку освежаем, если пора. */
export async function openFile(att: Pick<Attachment, 'id' | 'url' | 'name'>, how: 'download' | 'open' = 'download') {
  const url = fileSrc(await freshUrl(att))!;
  const a = document.createElement('a');
  a.href = how === 'download' ? `${url}${url.includes('?') ? '&' : '?'}download=1` : url;
  a.rel = 'noopener';
  if (how === 'open') a.target = '_blank';
  else a.download = att.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
