import { describe, expect, it } from 'vitest';
import {
  QR_LOGIN_TTL_SECONDS,
  contactBook,
  contactNameError,
  describeDevice,
  displayNameError,
  isQrLoginToken,
  nameFor,
  parseOffixLink,
  passwordError,
  passwordStrength,
  profileUrl,
  qrHole,
  qrLoginUrl,
  qrPaths,
  tempPassword,
} from '../src';

describe('пароль', () => {
  it('короткий, длинный и с пробелами по краям — нельзя', () => {
    expect(passwordError('1234567')).toMatch(/не короче 8/);
    expect(passwordError('x'.repeat(129))).toMatch(/не длиннее/);
    expect(passwordError(' пароль-фраза ')).toMatch(/пробелы/);
  });

  it('частые и однообразные пароли — нельзя', () => {
    expect(passwordError('12345678')).toMatch(/слишком простой/);
    expect(passwordError('Password')).toMatch(/слишком простой/);
    expect(passwordError('aaaaaaaaaa')).toMatch(/слишком простой/);
  });

  it('пароль не повторяет почту', () => {
    expect(passwordError('anna.koroleva-2026', { email: 'anna.koroleva@offix.demo' })).toMatch(/почту/);
    expect(passwordError('синий-кит-летит', { email: 'anna@offix.demo' })).toBeNull();
  });

  it('надёжность растёт с длиной и разнообразием', () => {
    expect(passwordStrength('1234')).toBe(0);
    expect(passwordStrength('abcdefgh1')).toBe(1);
    expect(passwordStrength('Abcdefgh1234')).toBe(3);
    expect(passwordStrength('синий кит летит над морем')).toBeGreaterThanOrEqual(2);
  });

  it('временный пароль: 12 знаков в трёх группах, без похожих символов', () => {
    let i = 0;
    const p = tempPassword((n) => (i++ * 7) % n);
    expect(p).toMatch(/^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/);
    expect(p).not.toMatch(/[01lIoO]/);
  });
});

describe('имя и свои имена для коллег', () => {
  it('имя обязательно и не длиннее 120', () => {
    expect(displayNameError('  ')).toBe('Как вас зовут?');
    expect(displayNameError('x'.repeat(121))).toMatch(/не длиннее/);
    expect(displayNameError('Анна Королёва')).toBeNull();
  });

  it('своё имя для коллеги видно вместо настоящего', () => {
    const book = contactBook([
      { user_id: 'u1', name: 'Аня из продаж' },
      { user_id: 'u2', name: '   ' },
    ]);
    expect(nameFor(book, 'u1', 'Анна Королёва')).toBe('Аня из продаж');
    expect(nameFor(book, 'u2', 'Игорь Лебедев')).toBe('Игорь Лебедев');
    expect(nameFor(book, null, 'Служба')).toBe('Служба');
    expect(contactNameError('x'.repeat(121))).toMatch(/не длиннее/);
    expect(contactNameError(5)).toBe('Введите имя');
  });
});

describe('QR', () => {
  const token = 'A'.repeat(32);

  it('код входа живёт полторы минуты', () => {
    expect(QR_LOGIN_TTL_SECONDS).toBe(90);
    expect(isQrLoginToken(token)).toBe(true);
    expect(isQrLoginToken('короткий')).toBe(false);
    expect(isQrLoginToken('a/b'.repeat(10))).toBe(false);
  });

  it('ссылки — обычные адреса сайта', () => {
    expect(qrLoginUrl('https://offix.example/', token)).toBe(`https://offix.example/qr/${token}`);
    expect(profileUrl('https://offix.example', '7f2c1c1e-1111-4222-8333-944444444444')).toBe('https://offix.example/app/people/7f2c1c1e-1111-4222-8333-944444444444');
  });

  it('разбор отсканированного: вход, профиль, ссылка, текст', () => {
    expect(parseOffixLink(`https://offix.example/qr/${token}`)).toEqual({ kind: 'qr_login', token });
    expect(parseOffixLink(`http://192.168.0.5:5173/qr/${token}?x=1`)).toEqual({ kind: 'qr_login', token });
    expect(parseOffixLink('https://offix.example/app/people/7F2C1C1E-1111-4222-8333-944444444444')).toEqual({ kind: 'profile', id: '7f2c1c1e-1111-4222-8333-944444444444' });
    expect(parseOffixLink('https://example.com/qr/короткий')).toEqual({ kind: 'url', url: 'https://example.com/qr/короткий' });
    expect(parseOffixLink('https://ya.ru')).toEqual({ kind: 'url', url: 'https://ya.ru' });
    expect(parseOffixLink('Wi-Fi: офис')).toEqual({ kind: 'text', text: 'Wi-Fi: офис' });
  });

  it('устройство по User-Agent', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36')).toEqual({ kind: 'desktop', label: 'Chrome на Windows' });
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15')).toEqual({ kind: 'desktop', label: 'Safari на Mac' });
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1').kind).toBe('phone');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/142.0 YaBrowser/25.10 Safari/537.36').label).toBe('Яндекс Браузер на Windows');
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0').label).toBe('Firefox на Linux');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 15; Tab) AppleWebKit/537.36 Chrome/142.0 Safari/537.36').kind).toBe('tablet');
    expect(describeDevice('')).toEqual({ kind: 'unknown', label: 'Неизвестное устройство' });
  });

  it('рисунок: вырез той же чётности, точки вне выреза и «глазков»', () => {
    expect(qrHole(25) % 2).toBe(1);
    expect(qrHole(30) % 2).toBe(0);
    // Матрица «всё тёмное»: точек — все модули кроме трёх глазков и выреза.
    const n = 25;
    const p = qrPaths({ size: n, dark: () => true }, 4);
    const dots = (p.dots.match(/M/g) ?? []).length;
    expect(dots).toBe(n * n - 3 * 49 - p.hole / 4 * (p.hole / 4));
    expect(p.size).toBe(100);
    expect((p.eyes.match(/M/g) ?? []).length).toBe(9);
    // Без выреза — точки и в центре.
    expect((qrPaths({ size: n, dark: () => true }, 4, 0).dots.match(/M/g) ?? []).length).toBe(n * n - 3 * 49);
  });
});
