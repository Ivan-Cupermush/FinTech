import type { z } from 'zod';
import { ApiError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Некорректный формат (не тот тип, лишняя структура) — 400. Бизнес-правила — 422 отдельно. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] = 'Некорректное значение';
    throw new ApiError('BAD_REQUEST', 'Некорректный формат запроса', fields);
  }
  return r.data;
}

/** Параметр пути должен быть UUID, иначе — 404 (не раскрываем, что формат неверен). */
export function idParam(v: unknown): string {
  if (!isUuid(v)) throw new ApiError('NOT_FOUND', 'Не найдено');
  return v;
}
