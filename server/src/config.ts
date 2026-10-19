export interface Config {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  corsOrigins: string[];
  /** Дата «сегодня» для тестов и демо; в продакшене — системная. */
  now?: () => Date;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET ?? '';
  if (env.NODE_ENV === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET должен быть длиной не меньше 32 символов');
  }
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://offix:offix@localhost:5432/offix',
    jwtSecret: jwtSecret || 'dev-only-secret-change-me-dev-only-secret',
    port: Number(env.PORT ?? 4000),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
