import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Пароли и токены внешних систем храним в базе зашифрованными (AES-256-GCM):
 * выгрузка базы без ключа не раскрывает доступ к 1С и Moodle. Ключ —
 * INTEGRATIONS_SECRET_KEY (32 байта в base64); если он не задан, ключ
 * выводится из JWT_SECRET, чтобы шифрование работало и без лишней настройки.
 */

const PREFIX = 'enc:v1:';

let cached: { source: string; key: Buffer } | null = null;

function keyFrom(env: NodeJS.ProcessEnv): Buffer {
  const explicit = env.INTEGRATIONS_SECRET_KEY;
  const source = explicit ? `k:${explicit}` : `j:${env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret'}`;
  if (cached?.source === source) return cached.key;
  let key: Buffer;
  if (explicit) {
    key = Buffer.from(explicit, 'base64');
    if (key.length !== 32) throw new Error('INTEGRATIONS_SECRET_KEY должен быть 32 байтами в base64');
  } else {
    key = Buffer.from(hkdfSync('sha256', source.slice(2), 'offix', 'integration-secrets', 32));
  }
  cached = { source, key };
  return key;
}

export function sealSecret(plain: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!plain) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(env), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

/** Значение без префикса — старая открытая запись: отдаём как есть, при следующем сохранении зашифруется. */
export function openSecret(stored: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const [iv, tag, data] = stored.slice(PREFIX.length).split('.').map((s) => Buffer.from(s, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Повреждённый секрет интеграции');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(env), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
