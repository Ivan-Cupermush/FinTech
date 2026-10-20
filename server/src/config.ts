export interface Config {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  corsOrigins: string[];
  /** Push на телефоны через Expo. Выключен, пока не задан PUSH_ENABLED=1. */
  push: { enabled: boolean; accessToken?: string };
  /**
   * Отчёт руководству на почту по расписанию. Включён, только если задан
   * REPORT_MAIL_ENABLED=1 и есть SMTP_URL и MAIL_FROM; иначе ничего не шлётся.
   */
  mail: { enabled: boolean; smtpUrl?: string; from?: string; appUrl?: string };
  /** Синхронизация интеграций с 1С и Moodle по расписанию. Выключена, пока не задан INTEGRATIONS_ENABLED=1. */
  integrations: { enabled: boolean };
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
    push: { enabled: env.PUSH_ENABLED === '1', accessToken: env.EXPO_ACCESS_TOKEN || undefined },
    integrations: { enabled: env.INTEGRATIONS_ENABLED === '1' },
    mail: {
      enabled: env.REPORT_MAIL_ENABLED === '1' && !!env.SMTP_URL && !!env.MAIL_FROM,
      smtpUrl: env.SMTP_URL || undefined,
      from: env.MAIL_FROM || undefined,
      appUrl: env.APP_URL || undefined,
    },
  };
}
