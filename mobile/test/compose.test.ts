import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatPoll, ChatSummary } from '@offix/core';
import { emptyPoll, forwardable, forwardTargets, forwardTitle, nextSlot, optionTone, pollRequest, pollState, removePollOption, scheduleAt, scheduleDays, scheduleLabel, schedulePresets, scheduleTimes, voterWord } from '../src/lib/compose';

// Локальное время телефона: тесты считают в часах самой машины, как и экран.
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe('опрос: форма → запрос', () => {
  it('пустая форма — вопрос и два варианта обязательны', () => {
    const r = pollRequest(emptyPoll(), null);
    expect(r.errors.question).toBe('Задайте вопрос');
    expect(r.errors.options).toBe('Нужно хотя бы два варианта');
  });

  it('пустые строки вариантов не уходят, тема передаётся', () => {
    const r = pollRequest({ ...emptyPoll(), question: ' Когда созвон? ', options: ['Утром', '', ' Вечером '] }, 't1');
    expect(r.errors).toEqual({});
    expect(r.body).toEqual({ question: 'Когда созвон?', options: ['Утром', 'Вечером'], anonymous: true, multiple: false, quiz: false, correct_option: null, explanation: null, topic_id: 't1' });
  });

  it('викторина: правильный считается среди заполненных, несколько ответов выключаются', () => {
    const r = pollRequest({ ...emptyPoll(), question: '2+2?', options: ['3', '', '4'], quiz: true, multiple: true, correct: 2, explanation: ' Арифметика ' }, null);
    expect(r.errors).toEqual({});
    expect(r.body).toMatchObject({ multiple: false, quiz: true, correct_option: 1, explanation: 'Арифметика' });
  });

  it('викторина без отметки или с отметкой на пустой строке — ошибка', () => {
    expect(pollRequest({ ...emptyPoll(), question: '?', options: ['а', 'б'], quiz: true }, null).errors.correct_option).toBe('Отметьте правильный ответ');
    expect(pollRequest({ ...emptyPoll(), question: '?', options: ['а', 'б', ''], quiz: true, correct: 2 }, null).errors.correct_option).toBe('Отметьте правильный ответ');
  });

  it('повторяющиеся варианты — ошибка из общей проверки', () => {
    expect(pollRequest({ ...emptyPoll(), question: '?', options: ['Да', 'да'] }, null).errors.options).toBe('Варианты повторяются');
  });

  it('пояснение не уходит, если это не викторина', () => {
    expect(pollRequest({ ...emptyPoll(), question: '?', options: ['а', 'б'], explanation: 'x' }, null).body.explanation).toBeNull();
  });

  it('убрать вариант: отметка правильного едет вместе со своим вариантом', () => {
    const f = { ...emptyPoll(), options: ['а', 'б', 'в'], correct: 2 };
    expect(removePollOption(f, 0)).toMatchObject({ options: ['б', 'в'], correct: 1 });
    expect(removePollOption(f, 2)).toMatchObject({ options: ['а', 'б'], correct: null });
    expect(removePollOption(f, 1).correct).toBe(1);
    expect(removePollOption({ ...emptyPoll(), options: ['а', 'б'] }, 0).options).toEqual(['а', 'б']);
  });
});

const poll = (over: Partial<ChatPoll> = {}): ChatPoll => ({ id: 'p', question: '?', anonymous: true, multiple: false, quiz: false, closed: false, explanation: null, total_voters: 0, voted: false, options: [], ...over });

describe('опрос в пузыре', () => {
  it('до голоса — варианты, после — итоги и «отозвать»', () => {
    expect(pollState(poll(), { mine: false, canClose: false })).toMatchObject({ results: false, canUnvote: false, canClose: false, footer: 'Пока никто не голосовал' });
    expect(pollState(poll({ voted: true, total_voters: 3 }), { mine: false, canClose: false })).toMatchObject({ results: true, canUnvote: true, footer: '3 голоса' });
  });

  it('в викторине голос не отозвать, закрытый опрос не закрыть ещё раз', () => {
    expect(pollState(poll({ quiz: true, voted: true }), { mine: true, canClose: true }).canUnvote).toBe(false);
    expect(pollState(poll({ closed: true }), { mine: true, canClose: true })).toMatchObject({ results: true, canClose: false });
  });

  it('закрыть может автор или админ с правом удалять', () => {
    expect(pollState(poll(), { mine: true, canClose: false }).canClose).toBe(true);
    expect(pollState(poll(), { mine: false, canClose: true }).canClose).toBe(true);
  });

  it('кто как голосовал — только в открытом опросе с голосами', () => {
    expect(pollState(poll({ anonymous: false, total_voters: 2 }), { mine: false, canClose: false }).canSeeVoters).toBe(true);
    expect(pollState(poll({ anonymous: true, total_voters: 2 }), { mine: false, canClose: false }).canSeeVoters).toBe(false);
    expect(pollState(poll({ anonymous: false, total_voters: 0 }), { mine: false, canClose: false }).canSeeVoters).toBe(false);
  });

  it('подпись вида опроса', () => {
    expect(pollState(poll({ multiple: true, anonymous: false }), { mine: false, canClose: false }).kind).toBe('Открытый опрос · несколько ответов');
    expect(pollState(poll({ quiz: true, closed: true }), { mine: false, canClose: false }).kind).toBe('Викторина · закрыт');
  });

  it('склонение «голос»', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map(voterWord)).toEqual(['голос', 'голоса', 'голосов', 'голосов', 'голосов', 'голос', 'голоса', 'голосов', 'голосов']);
  });

  it('тон итога в викторине', () => {
    expect(optionTone({ correct: true, voted: false })).toBe('correct');
    expect(optionTone({ correct: false, voted: true })).toBe('wrong');
    expect(optionTone({ correct: false, voted: false })).toBeNull();
    expect(optionTone({ voted: true })).toBeNull();
  });
});

describe('отправить позже', () => {
  it('утром — через час, вечером сегодня и завтра утром', () => {
    const now = at(2026, 10, 27, 10, 20); // вторник
    expect(schedulePresets(now).map((p) => p.label)).toEqual(['Через час', 'Сегодня в 18:00', 'Завтра в 9:00']);
    expect(schedulePresets(now)[2]!.at).toEqual(at(2026, 10, 28, 9));
  });

  it('после 17:00 «сегодня вечером» не предлагаем', () => {
    expect(schedulePresets(at(2026, 10, 27, 17, 30)).map((p) => p.label)).toEqual(['Через час', 'Завтра в 9:00']);
  });

  it('в пятницу — ещё «в понедельник утром»', () => {
    const p = schedulePresets(at(2026, 10, 30, 11)); // пятница
    expect(p.at(-1)).toEqual({ label: 'В понедельник в 9:00', at: at(2026, 11, 2, 9) });
    expect(schedulePresets(at(2026, 11, 1, 11)).at(-1)!.at).toEqual(at(2026, 11, 2, 9)); // воскресенье
  });

  it('дни: сегодня, завтра, затем день недели и дата', () => {
    const d = scheduleDays(at(2026, 10, 30, 11), 4);
    expect(d.map((x) => x.label)).toEqual(['Сегодня', 'Завтра', 'вс', 'пн']);
    expect(d[3]!.sub).toBe('2 ноя');
    expect(d[0]!.key).toBe('2026-10-30');
  });

  it('время с шагом в четверть часа', () => {
    const t = scheduleTimes(8, 10);
    expect(t.map((x) => x.label)).toEqual(['08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30', '09:45']);
  });

  it('прошедшее время — ошибка, будущее — нет', () => {
    const now = at(2026, 10, 27, 12, 0);
    expect(scheduleAt(now, 11, 0, now).error).toBe('Время отправки — хотя бы через минуту');
    const ok = scheduleAt(at(2026, 10, 28, 0), 9, 30, now);
    expect(ok.error).toBeNull();
    expect(ok.at).toEqual(at(2026, 10, 28, 9, 30));
  });

  it('подпись времени отправки', () => {
    const now = at(2026, 10, 27, 12);
    expect(scheduleLabel(at(2026, 10, 27, 18), now)).toBe('сегодня в 18:00');
    expect(scheduleLabel(at(2026, 10, 28, 9, 5), now)).toBe('завтра в 09:05');
    expect(scheduleLabel(at(2026, 10, 31, 9), now)).toBe('31 октября в 09:00');
    expect(scheduleLabel(at(2027, 1, 3, 9), now)).toBe('3 января 2027 в 09:00');
  });

  it('ближайшая клетка: следующая четверть часа не раньше чем через 15 минут', () => {
    expect(nextSlot(at(2026, 10, 27, 12, 2))).toEqual({ day: 0, h: 12, m: 30 });
    expect(nextSlot(at(2026, 10, 27, 12, 0))).toEqual({ day: 0, h: 12, m: 15 });
    expect(nextSlot(at(2026, 10, 27, 23, 50))).toEqual({ day: 1, h: 0, m: 15 });
  });
});

const message = (over: Partial<ChatMessage> = {}) => ({ id: 'm1', kind: 'text', deleted: false, ...over }) as ChatMessage;
const chat = (id: string, title: string, over: Partial<ChatSummary> = {}) => ({ id, title, peer: null, pinned: false, activity_at: '2026-10-27T09:00:00Z', ...over }) as ChatSummary;

describe('переслать', () => {
  it('служебные, опросы, удалённые и ещё не отправленные — нельзя', () => {
    expect(forwardable(message())).toBe(true);
    expect(forwardable(message({ kind: 'media' }))).toBe(true);
    expect(forwardable(message({ kind: 'service' }))).toBe(false);
    expect(forwardable(message({ kind: 'poll' }))).toBe(false);
    expect(forwardable(message({ deleted: true }))).toBe(false);
    expect(forwardable(message({ id: 'local-1' }))).toBe(false);
  });

  it('куда: поиск по названию и должности, закреплённые сверху', () => {
    const list = [chat('a', 'Заявки за 30 минут', { activity_at: '2026-10-27T10:00:00Z' }), chat('b', 'Ольга Смирнова', { peer: { position: 'Методист' } as ChatSummary['peer'] }), chat('c', 'Избранное', { pinned: true })];
    expect(forwardTargets(list, '').map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(forwardTargets(list, 'метод').map((c) => c.id)).toEqual(['b']);
    expect(forwardTargets(list, 'pfzdrb').map((c) => c.id)).toEqual(['a']); // неверная раскладка
  });

  it('заголовок шторки', () => {
    expect([1, 2, 5, 21].map(forwardTitle)).toEqual(['Переслать сообщение', 'Переслать 2 сообщения', 'Переслать 5 сообщений', 'Переслать 21 сообщение']);
  });
});
