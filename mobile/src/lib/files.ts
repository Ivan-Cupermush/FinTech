import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { fileLinkFresh, safeFileName, type Attachment } from '@offix/core';
import { ApiError } from './client';
import { fileUri, parseUpload, type PickedFile } from './media';
import { api, currentSession } from './session';

/**
 * Загрузка и открытие файлов. Загрузка — через XMLHttpRequest: только он
 * показывает прогресс и на телефоне, и в веб-сборке.
 */

export const absUri = (url: string | null | undefined) => fileUri(currentSession().server, url);

export function uploadPicked<T = Attachment>(f: PickedFile, o: { path?: string; fields?: [string, string][]; onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    void (async () => {
      const { token, server } = currentSession();
      const form = new FormData();
      // Поля — до файла: сервер читает их, пока файл ещё идёт.
      for (const [k, v] of o.fields ?? []) form.append(k, v);
      if (Platform.OS === 'web') {
        const blob = f.file ?? (await (await fetch(f.uri)).blob());
        form.append('file', blob, f.name);
      } else {
        // В React Native файл в форме — это ссылка на него, а не содержимое.
        form.append('file', { uri: f.uri, name: f.name, type: f.mime } as unknown as Blob);
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${server}${o.path ?? '/files'}`);
      xhr.setRequestHeader('Accept', 'application/json');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && o.onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        try {
          resolve(parseUpload<T>(xhr.status, xhr.responseText));
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Нет связи с сервером. Проверьте интернет'));
      xhr.onabort = () => reject(new DOMException('Отменено', 'AbortError'));
      o.signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(form);
    })().catch(reject);
  });
}

/** Черновик, который не отправили: убираем с сервера сразу, не дожидаясь уборки. */
export const dropDraft = (id: string) => api(`/files/${id}`, { method: 'DELETE' }).catch(() => undefined);

const fresh = new Map<string, string>();

/** Подписанная ссылка живёт минуты: устаревшую тихо обновляем. */
export async function freshUrl(a: Pick<Attachment, 'id' | 'url'>): Promise<string> {
  const now = Date.now();
  if (fileLinkFresh(a.url, now)) return a.url;
  const cached = fresh.get(a.id);
  if (cached && fileLinkFresh(cached, now)) return cached;
  const next = await api<Attachment>(`/files/${a.id}`);
  fresh.set(a.id, next.url);
  return next.url;
}

/** Адрес для плеера и картинки во весь размер. */
export function useFileUri(a: Pick<Attachment, 'id' | 'url'> | null | undefined, enabled = true): string | undefined {
  const [url, setUrl] = useState<string | null>(() => (a && fileLinkFresh(a.url, Date.now()) ? a.url : null));
  const id = a?.id;
  const raw = a?.url;
  useEffect(() => {
    if (!id || !raw || !enabled) return;
    if (fileLinkFresh(raw, Date.now())) return setUrl(raw);
    let live = true;
    void freshUrl({ id, url: raw })
      .then((u) => live && setUrl(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, raw, enabled]);
  return url ? absUri(url) : undefined;
}

/**
 * Открыть файл: на телефоне — скачать во временную папку и отдать системе
 * («Сохранить в Файлы», «Открыть в…»), в веб-сборке — обычная загрузка.
 */
export async function openAttachment(a: Pick<Attachment, 'id' | 'url' | 'name' | 'mime'>) {
  const url = absUri(await freshUrl(a))!;
  if (Platform.OS === 'web') {
    await Linking.openURL(`${url}${url.includes('?') ? '&' : '?'}download=1`);
    return;
  }
  if (await Sharing.isAvailableAsync()) {
    const file = await FsFile.downloadFileAsync(url, new FsFile(Paths.cache, safeFileName(a.name)), { idempotent: true });
    await Sharing.shareAsync(file.uri, { mimeType: a.mime, dialogTitle: a.name });
    return;
  }
  await Linking.openURL(url);
}
