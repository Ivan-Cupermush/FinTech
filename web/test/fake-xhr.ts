import { vi } from 'vitest';

export interface Upload {
  path: string;
  headers: Record<string, string>;
  fields: Record<string, string>;
  file: File | null;
}

type Reply = { status?: number; data?: unknown; error?: { message: string; fields?: Record<string, string> } };

/**
 * Загрузка файлов идёт через XMLHttpRequest (ради прогресса). Подмена
 * записывает, что ушло, и отвечает тем, что вернул обработчик теста.
 */
export function mockUploads(reply: (u: Upload, n: number) => Reply | Promise<Reply>) {
  const uploads: Upload[] = [];
  class FakeXHR {
    status = 0;
    responseText = '';
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private path = '';
    private headers: Record<string, string> = {};
    private aborted = false;
    open(_m: string, url: string) {
      this.path = new URL(url, 'http://localhost').pathname.replace(/^\/api\/v1/, '');
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
    send(form: FormData) {
      const fields: Record<string, string> = {};
      let file: File | null = null;
      form.forEach((v, k) => {
        if (typeof v === 'string') fields[k] = v;
        else file = v as File;
      });
      const u = { path: this.path, headers: this.headers, fields, file };
      uploads.push(u);
      const n = uploads.length;
      void (async () => {
        const size = (file as File | null)?.size ?? 1;
        this.upload.onprogress?.({ lengthComputable: true, loaded: size / 2, total: size });
        const r = await reply(u, n);
        if (this.aborted) return;
        this.status = r.status ?? 201;
        this.responseText = JSON.stringify(r.error ? { error: { code: 'X', message: r.error.message, fields: r.error.fields ?? {} } } : { data: r.data });
        this.onload?.();
      })();
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  return uploads;
}
