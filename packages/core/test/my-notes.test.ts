import { describe, expect, it } from 'vitest';
import {
  MY_NOTE_LIMITS,
  addMonths,
  freeCopyTitle,
  isBlankNote,
  isIsoDay,
  isIsoMonth,
  messageBody,
  messagePreview,
  monthGrid,
  monthTitle,
  myNoteSummary,
  noteDayLabel,
  notePdfName,
  noteTitle,
  validateMyNote,
} from '../src';

describe('личные заметки: проверка', () => {
  it('заголовок не обязателен, но не длиннее предела', () => {
    expect(validateMyNote({ title: '', body: 'текст' })).toEqual({});
    expect(validateMyNote({ title: 'x'.repeat(MY_NOTE_LIMITS.title + 1) }).title).toMatch(/не длиннее/);
  });

  it('слишком длинный текст и не строка — ошибки', () => {
    expect(validateMyNote({ body: 'x'.repeat(MY_NOTE_LIMITS.body + 1) }).body).toBe('Заметка слишком длинная');
    expect(validateMyNote({ body: 42 }).body).toBe('Текст должен быть строкой');
    expect(validateMyNote({ title: 42 }).title).toBe('Заголовок должен быть строкой');
  });

  it('день — настоящая дата календаря', () => {
    expect(validateMyNote({ note_date: '2026-10-26' })).toEqual({});
    expect(validateMyNote({ note_date: '2026-02-30' }).note_date).toBe('Выберите день в календаре');
    expect(validateMyNote({ note_date: '26.10.2026' }).note_date).toBeTruthy();
    expect(isIsoDay('2028-02-29')).toBe(true);
    expect(isIsoDay('2027-02-29')).toBe(false);
  });

  it('месяц: ГГГГ-ММ с месяцем 1–12', () => {
    expect(isIsoMonth('2026-10')).toBe(true);
    expect(isIsoMonth('2026-13')).toBe(false);
    expect(isIsoMonth('2026-1')).toBe(false);
  });

  it('пустая заметка — без заголовка, текста и файлов', () => {
    expect(isBlankNote({ title: '  ', body: '\n' })).toBe(true);
    expect(isBlankNote({ title: '', body: '', files: 1 })).toBe(false);
    expect(isBlankNote({ title: 'План' })).toBe(false);
  });

  it('без заголовка — «Без названия»', () => {
    expect(noteTitle('')).toBe('Без названия');
    expect(noteTitle('  План  ')).toBe('План');
  });

  it('карточка списка: отрывок без разметки', () => {
    const s = myNoteSummary({ id: '1', title: 'План', body: '# Утро\n\n- позвонить\n- **отчёт**', note_date: '2026-10-26', is_favorite: true, files_count: 2, updated_at: '2026-10-26T10:00:00Z' });
    expect(s).toMatchObject({ excerpt: 'Утро. позвонить · отчёт', is_favorite: true, files_count: 2 });
  });
});

describe('копия заметки: свободное имя', () => {
  it('имя свободно — как есть', () => {
    expect(freeCopyTitle('План', ['Отчёт'])).toBe('План');
  });

  it('занято — «(2)», затем «(3)»', () => {
    expect(freeCopyTitle('План', ['План'])).toBe('План (2)');
    expect(freeCopyTitle('План', ['План', 'План (2)'])).toBe('План (3)');
  });

  it('пустое имя — «Без названия», и копия тоже нумеруется', () => {
    expect(freeCopyTitle('', [''])).toBe('Без названия (2)');
  });

  it('длинное имя укорачивается, номер помещается в предел', () => {
    const long = 'а'.repeat(MY_NOTE_LIMITS.title);
    const copy = freeCopyTitle(long, [long]);
    expect(copy.length).toBeLessThanOrEqual(MY_NOTE_LIMITS.title);
    expect(copy.endsWith(' (2)')).toBe(true);
  });
});

describe('календарь', () => {
  it('октябрь 2026: шесть недель с понедельника', () => {
    const g = monthGrid('2026-10', { today: '2026-10-26', selected: '2026-10-12', counts: [{ date: '2026-10-12', count: 3 }] });
    expect(g).toHaveLength(6);
    expect(g.every((w) => w.length === 7)).toBe(true);
    // 1 октября 2026 — четверг: первая неделя начинается 28 сентября.
    expect(g[0]![0]).toMatchObject({ date: '2026-09-28', outside: true });
    expect(g[0]![3]).toMatchObject({ date: '2026-10-01', outside: false, day: 1 });
    const flat = g.flat();
    expect(flat.find((c) => c.date === '2026-10-26')).toMatchObject({ today: true, weekend: false });
    expect(flat.find((c) => c.date === '2026-10-12')).toMatchObject({ selected: true, count: 3, weekend: false });
    expect(flat.find((c) => c.date === '2026-10-25')!.weekend).toBe(true);
  });

  it('месяц, начинающийся с понедельника, — без дней прошлого месяца в начале', () => {
    expect(monthGrid('2026-06')[0]![0]).toMatchObject({ date: '2026-06-01', outside: false });
  });

  it('счётчики можно передать словарём', () => {
    expect(monthGrid('2026-10', { counts: { '2026-10-05': 2 } }).flat().find((c) => c.date === '2026-10-05')!.count).toBe(2);
  });

  it('листание месяцев через год', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', -22)).toBe('2024-12');
    expect(monthTitle('2026-10')).toBe('Октябрь 2026');
  });

  it('подпись дня', () => {
    expect(noteDayLabel('2026-10-26', '2026-10-26')).toBe('Сегодня');
    expect(noteDayLabel('2026-10-25', '2026-10-26')).toBe('Вчера');
    expect(noteDayLabel('2026-10-27', '2026-10-26')).toBe('Завтра');
    expect(noteDayLabel('2026-10-12', '2026-10-26')).toBe('12 октября');
    expect(noteDayLabel('2025-03-01', '2026-10-26')).toBe('1 марта 2025');
  });
});

describe('PDF и чат', () => {
  it('имя PDF без запрещённых символов', () => {
    expect(notePdfName('План: неделя 42 / итог?')).toBe('План неделя 42 итог.pdf');
    expect(notePdfName('')).toBe('Без названия.pdf');
  });

  it('заметка в превью чата — «📝 Название»', () => {
    const m = { kind: 'note' as const, text: null, deleted: false, sender_id: 'u1', sender_name: 'Анна Королёва', note: { title: 'План на неделю' } };
    expect(messageBody(m)).toBe('📝 План на неделю');
    expect(messagePreview(m, 'u1', true)).toBe('Вы: 📝 План на неделю');
    expect(messagePreview({ ...m, text: 'посмотри' }, 'u2', true)).toBe('Анна: 📝 План на неделю, посмотри');
    expect(messageBody({ ...m, note: { title: '' } })).toBe('📝 Заметка');
  });
});
