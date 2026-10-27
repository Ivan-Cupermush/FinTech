import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPLOAD_MAX_MB_DEFAULT } from '@offix/core';
import { resolveWebDist } from './http/site';

/**
 * Настройки из server/.env (служба и npm-скрипты запускаются в папке server;
 * ENV_FILE — другой файл). Переменные окружения важнее файла.
 */
export function loadDotEnv(file = process.env.ENV_FILE ?? '.env'): boolean {
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

export interface Config {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  /** Адрес, на котором слушать: за прокси или туннелем — 127.0.0.1; по умолчанию все адреса. */
  host?: string;
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
  /**
   * Файлы: папка (UPLOADS_DIR, по умолчанию server/data/uploads), предел
   * одного файла (UPLOAD_MAX_MB, по умолчанию 200) и ffmpeg для видео и
   * голосовых: FFMPEG_DIR — папка с ffmpeg/ffprobe, FFMPEG=off — не искать.
   */
  uploads: UploadsConfig;
  /**
   * Собранный сайт (web/dist), который сервер отдаёт сам на том же порту, что и API.
   * WEB_DIST_DIR — путь или «off»; без него — web/dist, если NODE_ENV=production.
   * null — только API.
   */
  webDist: string | null;
  /** Дата «сегодня» для тестов и демо; в продакшене — системная. */
  now?: () => Date;
}

export interface UploadsConfig {
  dir: string;
  maxBytes: number;
  /** Путь к папке с ffmpeg; null — ffmpeg не используется; undefined — искать в PATH. */
  ffmpegDir?: string | null;
}

export const DEFAULT_UPLOADS_DIR = fileURLToPath(new URL('../data/uploads', import.meta.url));

export function loadUploadsConfig(env: NodeJS.ProcessEnv = process.env): UploadsConfig {
  const mb = Number(env.UPLOAD_MAX_MB);
  return {
    dir: resolve(env.UPLOADS_DIR?.trim() || DEFAULT_UPLOADS_DIR),
    maxBytes: Math.round((Number.isFinite(mb) && mb > 0 ? Math.min(mb, 4096) : UPLOAD_MAX_MB_DEFAULT) * 1024 * 1024),
    ffmpegDir: env.FFMPEG === 'off' ? null : env.FFMPEG_DIR?.trim() || undefined,
  };
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
    host: env.HOST?.trim() || undefined,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    push: { enabled: env.PUSH_ENABLED === '1', accessToken: env.EXPO_ACCESS_TOKEN || undefined },
    integrations: { enabled: env.INTEGRATIONS_ENABLED === '1' },
    uploads: loadUploadsConfig(env),
    webDist: resolveWebDist(env),
    mail: {
      enabled: env.REPORT_MAIL_ENABLED === '1' && !!env.SMTP_URL && !!env.MAIL_FROM,
      smtpUrl: env.SMTP_URL || undefined,
      from: env.MAIL_FROM || undefined,
      appUrl: env.APP_URL || undefined,
    },
  };
}
