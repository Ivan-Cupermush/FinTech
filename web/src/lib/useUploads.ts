import { useCallback, useRef, useState } from 'react';
import { isBlockedFile, type Attachment } from '@offix/core';
import { ApiError } from './api';
import { uploadFile } from './files';

export interface PendingUpload {
  key: string;
  name: string;
  size: number;
  progress: number;
  error: string | null;
}

let seq = 0;

/**
 * Загрузка нескольких файлов с прогрессом — для задач и комментариев.
 * Возвращает успешно загруженные черновики; ошибки остаются в списке,
 * пока человек их не уберёт или не начнёт новую загрузку.
 */
export function useUploads(parallel = 3) {
  const [items, setItems] = useState<PendingUpload[]>([]);
  const busy = useRef(0);
  const [running, setRunning] = useState(false);

  const patch = (key: string, p: Partial<PendingUpload>) => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const upload = useCallback(async (files: File[]): Promise<Attachment[]> => {
    const jobs = files.map((f) => ({ f, key: `u${++seq}` }));
    setItems((list) => [...list.filter((x) => !x.error), ...jobs.map(({ f, key }) => ({ key, name: f.name, size: f.size, progress: 0, error: isBlockedFile(f.name, f.type) ? 'Такой тип файла загрузить нельзя' : null }))]);
    busy.current += 1;
    setRunning(true);
    const out: (Attachment | null)[] = new Array(jobs.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const i = next++;
        const { f, key } = jobs[i]!;
        if (isBlockedFile(f.name, f.type)) continue;
        try {
          out[i] = await uploadFile(f, { onProgress: (p) => patch(key, { progress: p }) });
          setItems((list) => list.filter((x) => x.key !== key));
        } catch (e) {
          patch(key, { error: e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не удалось загрузить' });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
    busy.current -= 1;
    if (!busy.current) setRunning(false);
    return out.filter((x): x is Attachment => !!x);
  }, [parallel]);

  const dismiss = (key: string) => setItems((list) => list.filter((x) => x.key !== key));
  return { items, upload, running, dismiss };
}
