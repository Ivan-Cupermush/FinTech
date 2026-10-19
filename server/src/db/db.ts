/**
 * Тонкий слой над PostgreSQL. В продакшене — пул `pg`, в тестах — PGlite
 * (настоящий Postgres в WebAssembly), поэтому SQL, ограничения, триггеры и
 * транзакции проверяются тестами по-настоящему.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** timestamptz → ISO-строка в UTC; разные драйверы отдают разный текстовый формат. */
export function normalizeTimestamp(value: string): string {
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** Парсеры по OID типов: DATE — строкой, NUMERIC и BIGINT — числом, время — ISO. */
export const TYPE_PARSERS: Record<number, (v: string) => unknown> = {
  1082: (v) => v,
  1700: (v) => Number(v),
  20: (v) => Number(v),
  1184: (v) => normalizeTimestamp(v),
  1114: (v) => normalizeTimestamp(`${v}+00`),
};
