import { addDays, todayIso } from '@offix/core';
import type { FetchLike } from '../services/integrations';

/**
 * Поддельные 1С и Moodle для демо и тестов: отвечают так же, как настоящие
 * публикации, но без сети. Любой логин подходит, кроме пароля «wrong»;
 * токен Moodle «bad» — недействительный.
 *
 *  - 1С: документ Document_ДоговорКонтрагента, поля Date и СрокСогласования —
 *    по два-три договора в рабочий день за последние 60 дней, срок
 *    согласования постепенно снижается с 12 до 8 дней.
 *  - Moodle: курс 101 «Цифровая грамотность», 40 слушателей и 2
 *    преподавателя, курс завершили 26 слушателей.
 */
export const DEMO_1C_URL = 'https://1c.demo.offix.ru/univ';
export const DEMO_MOODLE_URL = 'https://lms.demo.offix.ru';

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function contracts(now: Date) {
  const today = todayIso(now);
  const out: { Ref_Key: string; Date: string; Number: string; СрокСогласования: number }[] = [];
  for (let back = 60; back >= 0; back--) {
    const day = addDays(today, -back);
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const trend = 8 + (4 * back) / 60;
    const count = 2 + (back % 2);
    for (let k = 0; k < count; k++) {
      // Разброс ±1 день вокруг тренда, без случайности — данные одинаковые при каждом запуске.
      const value = Math.round((trend + ((k * 7 + back * 3) % 5) / 2 - 1) * 10) / 10;
      out.push({ Ref_Key: `c-${day}-${k}`, Date: `${day}T${String(10 + k * 3).padStart(2, '0')}:00:00`, Number: `Д-${out.length + 1}`, СрокСогласования: value });
    }
  }
  return out;
}

export function fakeSystemsFetch(now: () => Date = () => new Date()): FetchLike {
  return async (raw, init) => {
    const url = new URL(raw);
    if (`${url.origin}${url.pathname}`.startsWith(`${DEMO_1C_URL}/odata/standard.odata/`)) {
      const auth = init?.headers?.Authorization ?? '';
      const [, pass] = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString().split(':');
      if (!auth || pass === 'wrong') return json(401, { 'odata.error': { message: { value: 'Unauthorized' } } });
      const entity = decodeURIComponent(url.pathname.split('/').at(-1)!);
      if (entity !== 'Document_ДоговорКонтрагента') return json(404, { 'odata.error': { code: '14', message: { value: `Не найден ${entity}` } } });
      let rows = contracts(now());
      const since = /Date ge datetime'([^']+)'/.exec(url.searchParams.get('$filter') ?? '')?.[1];
      if (since) rows = rows.filter((r) => r.Date >= since);
      return json(200, { 'odata.metadata': `${DEMO_1C_URL}/odata/standard.odata/$metadata#Document_ДоговорКонтрагента`, value: rows });
    }
    if (`${url.origin}${url.pathname}` === `${DEMO_MOODLE_URL}/webservice/rest/server.php`) {
      if (url.searchParams.get('wstoken') === 'bad') return json(200, { exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token - token not found' });
      const course = Number(url.searchParams.get('courseid'));
      if (course !== 101) return json(200, { exception: 'dml_missing_record_exception', errorcode: 'invalidrecord', message: 'Can not find data record in database table course.' });
      const fn = url.searchParams.get('wsfunction');
      if (fn === 'core_enrol_get_enrolled_users') {
        const students = Array.from({ length: 40 }, (_, i) => ({ id: 1000 + i, fullname: `Слушатель ${i + 1}`, roles: [{ roleid: 5, shortname: 'student' }] }));
        const teachers = [1, 2].map((i) => ({ id: 10 + i, fullname: `Преподаватель ${i}`, roles: [{ roleid: 3, shortname: 'editingteacher' }] }));
        return json(200, [...teachers, ...students]);
      }
      if (fn === 'core_completion_get_course_completion_status') {
        const user = Number(url.searchParams.get('userid'));
        return json(200, { completionstatus: { completed: user - 1000 < 26, aggregation: 1, completions: [] }, warnings: [] });
      }
      return json(200, { exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
    }
    throw new TypeError('fetch failed: getaddrinfo ENOTFOUND');
  };
}
