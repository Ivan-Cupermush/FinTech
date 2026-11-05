import { describe, expect, it } from 'vitest';
import {
  anonymizedName,
  auditDetails,
  auditGroup,
  auditGroupTypes,
  auditLabel,
  deviceLabel,
  isAnonymizedEmail,
  lockout,
  lockoutWait,
  securityAdvice,
  toCsv,
  ANONYMIZED_EMAIL_DOMAIN,
  LOCKOUT_ATTEMPTS,
} from '../src';

const at = (min: number) => new Date(Date.UTC(2026, 10, 2, 12, min));

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Chrome на Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari на Mac'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari на iPhone'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'Chrome на Android'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 YaBrowser/24.10 Safari/537.36', 'Яндекс Браузер на Windows'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0', 'Edge на Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox на Linux'],
    ['offix/1.0 CFNetwork/1568 Darwin/24.0', 'Приложение offix'],
    ['okhttp/4.12.0', 'Приложение offix'],
    ['curl/8.5.0', 'Программа'],
  ])('%s → %s', (ua, want) => {
    expect(deviceLabel(ua)).toBe(want);
  });

  it('пусто — «Неизвестное устройство»', () => {
    expect(deviceLabel(null)).toBe('Неизвестное устройство');
    expect(deviceLabel('   ')).toBe('Неизвестное устройство');
    expect(deviceLabel('что-то странное')).toBe('Неизвестное устройство');
  });
});

describe('lockout: защита от подбора пароля', () => {
  const fails = (n: number, from = 0) => Array.from({ length: n }, (_, i) => at(from + i));

  it('меньше порога — открыт, видно, сколько попыток осталось', () => {
    const r = lockout(fails(LOCKOUT_ATTEMPTS - 1), null, at(10));
    expect(r.locked).toBe(false);
    expect(r.left).toBe(1);
  });

  it('порог за окно — закрыт до «последняя неудача + 15 минут»', () => {
    const r = lockout(fails(LOCKOUT_ATTEMPTS), null, at(10));
    expect(r.locked).toBe(true);
    expect(r.until).toEqual(at(LOCKOUT_ATTEMPTS - 1 + 15));
  });

  it('старые неудачи за окном не считаются', () => {
    expect(lockout(fails(LOCKOUT_ATTEMPTS), null, at(40)).locked).toBe(false);
  });

  it('удачный вход обнуляет счёт', () => {
    expect(lockout(fails(LOCKOUT_ATTEMPTS), at(5), at(10)).locked).toBe(false);
    expect(lockout(fails(LOCKOUT_ATTEMPTS), at(5), at(10)).left).toBe(6);
  });

  it('свои порог и окно', () => {
    expect(lockout(fails(3), null, at(3), { attempts: 3, windowMin: 5 }).locked).toBe(true);
    expect(lockout(fails(3), null, at(8), { attempts: 3, windowMin: 5 }).locked).toBe(false);
  });

  it('lockoutWait склоняет минуты', () => {
    expect(lockoutWait(at(1), at(0))).toBe('через 1 минуту');
    expect(lockoutWait(at(3), at(0))).toBe('через 3 минуты');
    expect(lockoutWait(at(12), at(0))).toBe('через 12 минут');
    expect(lockoutWait(at(21), at(0))).toBe('через 21 минуту');
    // Уже прошло — всё равно «через 1 минуту», а не ноль.
    expect(lockoutWait(at(0), at(2))).toBe('через 1 минуту');
  });
});

describe('журнал событий', () => {
  it('подписи по-русски, неизвестное — как есть', () => {
    expect(auditLabel('member.password_reset')).toBe('Сбросил пароль сотруднику');
    expect(auditLabel('account.data_exported')).toBe('Скачал свои данные');
    expect(auditLabel('something.new')).toBe('something.new');
  });

  it('группы', () => {
    expect(auditGroup('account.logout_all')).toBe('security');
    expect(auditGroup('login.locked')).toBe('security');
    expect(auditGroup('member.anonymized')).toBe('security');
    expect(auditGroup('member.updated')).toBe('security');
    expect(auditGroup('member.invited')).toBe('people');
    expect(auditGroup('company.modules_changed')).toBe('people');
    expect(auditGroup('task.created')).toBe('work');
    expect(auditGroupTypes('all')).toBeNull();
    // Каждая группа на сервере ловит те же события, что auditGroup.
    for (const t of ['account.renamed', 'login.qr', 'member.password_reset', 'member.updated', 'user.functions_changed', 'goal.created', 'metric.synced']) {
      const g = auditGroup(t);
      const f = auditGroupTypes(g)!;
      expect(f.exact.includes(t) || f.prefixes.some((p) => t.startsWith(p))).toBe(true);
    }
  });

  it('что изменилось — роль и доступ по-русски, секретов нет', () => {
    expect(auditDetails({ role: 'member', active: true }, { role: 'manager', active: false })).toBe('роль: сотрудник → руководитель; доступ: включён → отключён');
    expect(auditDetails(null, { ip: '10.0.0.1', user_agent: 'curl/8' })).toBe('IP: 10.0.0.1; устройство: Программа');
    expect(auditDetails({ password_hash: 'x' }, { password: 'y', token: 'z' })).toBe('');
    expect(auditDetails({ role: 'member' }, { role: 'member' })).toBe('');
    expect(auditDetails('мусор', 42)).toBe('');
  });
});

describe('советы администратору', () => {
  const base = { logins_7d: 10, failures_7d: 0, lockouts_7d: 0, dormant: 0, to_anonymize: 0, default_passwords: 0 };
  it('всё спокойно — один зелёный совет', () => {
    expect(securityAdvice(base)).toEqual([{ tone: 'ok', text: expect.stringContaining('Подбора паролей нет') }]);
  });
  it('подбор — первым и красным', () => {
    const a = securityAdvice({ ...base, lockouts_7d: 2, dormant: 3, to_anonymize: 1 });
    expect(a[0]!.tone).toBe('bad');
    expect(a.map((x) => x.tone)).toEqual(['bad', 'warn', 'warn']);
  });
  it('числа склоняются', () => {
    const t = (o: Partial<typeof base>) => securityAdvice({ ...base, ...o }).map((x) => x.text);
    expect(t({ to_anonymize: 1 })[0]).toMatch(/^1 отключённый сотрудник с персональными/);
    expect(t({ default_passwords: 3 })[0]).toBe('3 сотрудника не сменили выданный пароль');
    expect(t({ dormant: 11 })[0]).toMatch(/^11 сотрудников не входили/);
    expect(t({ lockouts_7d: 2 })[0]).toMatch(/закрывался 2 раза после/);
  });
});

describe('обезличивание и CSV', () => {
  it('имя и почта обезличенного', () => {
    expect(anonymizedName(3)).toBe('Бывший сотрудник 3');
    expect(isAnonymizedEmail(`x1@${ANONYMIZED_EMAIL_DOMAIN}`)).toBe(true);
    expect(isAnonymizedEmail('anna@example.ru')).toBe(false);
  });
  it('toCsv: BOM, «;», кавычки и защита от формул', () => {
    const csv = toCsv([
      ['Когда', 'Что'],
      ['=HYPERLINK("x")', 'a;b'],
      [1.5, null],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿Когда;Что\r\n"\'=HYPERLINK(""x"")";"a;b"\r\n1,5;\r\n');
  });
});
