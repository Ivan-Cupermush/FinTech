import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret } from '../src/services/secret-box';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('шифрование секретов интеграций', () => {
  it('туда и обратно; в шифре нет исходного текста', () => {
    const sealed = sealSecret('пароль-1С-2026')!;
    expect(sealed).toMatch(/^enc:v1:/);
    expect(sealed).not.toContain('2026');
    expect(openSecret(sealed)).toBe('пароль-1С-2026');
  });
  it('каждый раз новый шифр для того же пароля', () => {
    expect(sealSecret('same')).not.toBe(sealSecret('same'));
  });
  it('пусто остаётся пустым, старая открытая запись читается как есть', () => {
    expect(sealSecret('')).toBeNull();
    expect(sealSecret(null)).toBeNull();
    expect(openSecret(null)).toBeNull();
    expect(openSecret('plain-legacy')).toBe('plain-legacy');
  });
  it('явный ключ: другим ключом не расшифровать', () => {
    const env = { INTEGRATIONS_SECRET_KEY: KEY };
    const sealed = sealSecret('token', env)!;
    expect(openSecret(sealed, env)).toBe('token');
    expect(() => openSecret(sealed, { INTEGRATIONS_SECRET_KEY: Buffer.alloc(32, 8).toString('base64') })).toThrow();
    expect(() => openSecret(sealed, { JWT_SECRET: 'другой-секрет-приложения-длиной-32+' })).toThrow();
  });
  it('подменённый шифр не проходит проверку', () => {
    const sealed = sealSecret('token')!;
    const broken = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(() => openSecret(broken)).toThrow();
  });
  it('ключ неверной длины — понятная ошибка', () => {
    expect(() => sealSecret('x', { INTEGRATIONS_SECRET_KEY: 'c2hvcnQ=' })).toThrow(/32 байтами/);
  });
});
