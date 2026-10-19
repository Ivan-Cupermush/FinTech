import type { ErrorRequestHandler } from 'express';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const badRequest = (m = 'Некорректный запрос') => new ApiError('BAD_REQUEST', m);
export const forbidden = (m = 'Недостаточно прав') => new ApiError('FORBIDDEN', m);
/** «Не найдено» и для чужих объектов: знание UUID не даёт даже подтверждения, что объект есть. */
export const notFound = (m = 'Не найдено') => new ApiError('NOT_FOUND', m);
export const conflict = (m: string) => new ApiError('CONFLICT', m);
export const invalid = (message: string, fields: Record<string, string>) => new ApiError('VALIDATION_ERROR', message, fields);

/** Структурированные ошибки без SQL-деталей и стека. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Некорректный JSON в теле запроса' } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'BAD_REQUEST', message: 'Слишком большой запрос' } });
    return;
  }
  if (process.env.NODE_ENV !== 'test') console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } });
};
