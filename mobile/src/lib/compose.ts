import { matchesQuery, sortChats, validatePoll, validateScheduleAt, type ChatMessage, type ChatPoll, type ChatSummary } from '@offix/core';

/**
 * Чистая логика «написать иначе» на телефоне: опрос, отложенное сообщение и
 * пересылка. Без React Native — экраны только рисуют, правила проверяются
 * тестами и совпадают с сайтом (валидация общая, из core).
 */

// ---------------------------------------------------------------- опрос

export interface PollForm {
  question: string;
  options: string[];
  anonymous: boolean;
  multiple: boolean;
  quiz: boolean;
  /** Номер правильного среди всех строк формы, включая пустые. */
  correct: number | null;
  explanation: string;
}

export const emptyPoll = (): PollForm => ({ question: '', options: ['', ''], anonymous: true, multiple: false, quiz: false, correct: null, explanation: '' });

/**
 * Форма → тело запроса и ошибки. Пустые строки вариантов не уходят на сервер,
 * поэтому номер правильного ответа пересчитывается среди заполненных.
 */
export function pollRequest(f: PollForm, topicId: string | null): { errors: Record<string, string>; body: Record<string, unknown> } {
  const filled = f.options.map((o) => o.trim()).filter(Boolean);
  const correctIndex = f.correct === null || !f.options[f.correct]?.trim() ? null : f.options.slice(0, f.correct).filter((o) => o.trim()).length;
  const multiple = f.quiz ? false : f.multiple;
  const errors = validatePoll({ question: f.question, options: f.options, anonymous: f.anonymous, multiple, quiz: f.quiz, correct_option: correctIndex, explanation: f.explanation });
  return {
    errors,
    body: {
      question: f.question.trim(),
      options: filled,
      anonymous: f.anonymous,
      multiple,
      quiz: f.quiz,
      correct_option: f.quiz ? correctIndex : null,
      explanation: f.quiz ? f.explanation.trim() || null : null,
      topic_id: topicId,
    },
  };
}

/** Убрать строку варианта: отметка правильного едет вместе со своим вариантом. */
export function removePollOption(f: PollForm, index: number): PollForm {
  if (f.options.length <= 2) return f;
  const options = f.options.filter((_, i) => i !== index);
  const correct = f.correct === null || f.correct === index ? null : f.correct > index ? f.correct - 1 : f.correct;
  return { ...f, options, correct };
}

/** Что показать в опросе: варианты для голоса или итоги, и какие действия доступны. */
export function pollState(poll: ChatPoll, o: { mine: boolean; canClose: boolean }) {
  const results = poll.voted || poll.closed;
  return {
    results,
    kind: `${poll.quiz ? 'Викторина' : poll.anonymous ? 'Анонимный опрос' : 'Открытый опрос'}${poll.multiple ? ' · несколько ответов' : ''}${poll.closed ? ' · закрыт' : ''}`,
    canUnvote: poll.voted && !poll.closed && !poll.quiz,
    canSeeVoters: !poll.anonymous && poll.total_voters > 0,
    canClose: (o.canClose || o.mine) && !poll.closed,
    footer: poll.total_voters ? `${poll.total_voters} ${voterWord(poll.total_voters)}` : 'Пока никто не голосовал',
  };
}

export function voterWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'голос';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'голоса';
  return 'голосов';
}

/** Тон строки итогов в викторине: правильный — зелёный, мой неверный — красный. */
export function optionTone(o: { correct?: boolean; voted: boolean }): 'correct' | 'wrong' | null {
  if (o.correct === true) return 'correct';
  if (o.correct === false && o.voted) return 'wrong';
  return null;
}

// ---------------------------------------------------------------- отправить позже

export interface SchedulePreset {
  label: string;
  at: Date;
}

const atHour = (now: Date, days: number, h: number, min = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(h, min, 0, 0);
  return d;
};

/** Быстрые варианты — те же, что на сайте: через час, сегодня вечером, завтра утром. */
export function schedulePresets(now: Date): SchedulePreset[] {
  const out: SchedulePreset[] = [{ label: 'Через час', at: new Date(now.getTime() + 3_600_000) }];
  if (now.getHours() < 17) out.push({ label: 'Сегодня в 18:00', at: atHour(now, 0, 18) });
  out.push({ label: 'Завтра в 9:00', at: atHour(now, 1, 9) });
  // В пятницу и выходные — ещё «в понедельник утром».
  const dow = now.getDay();
  if (dow === 5 || dow === 6 || dow === 0) out.push({ label: 'В понедельник в 9:00', at: atHour(now, ((8 - dow) % 7) || 7, 9) });
  return out;
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Дни для выбора: сегодня, завтра и ещё неделя вперёд. */
export function scheduleDays(now: Date, count = 9): { key: string; label: string; sub: string; date: Date }[] {
  return Array.from({ length: count }, (_, i) => {
    const d = atHour(now, i, 0);
    return {
      key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      label: i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : WEEKDAYS[d.getDay()]!,
      sub: `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`,
      date: d,
    };
  });
}

/** Время с шагом в 15 минут: 08:00 … 21:45 — рабочий день с запасом. */
export function scheduleTimes(from = 7, to = 22, step = 15): { h: number; m: number; label: string }[] {
  const out: { h: number; m: number; label: string }[] = [];
  for (let h = from; h < to; h++) for (let m = 0; m < 60; m += step) out.push({ h, m, label: `${pad(h)}:${pad(m)}` });
  return out;
}

/** День + время → момент; ошибка — та же проверка, что и на сервере. */
export function scheduleAt(day: Date, h: number, m: number, now: Date): { at: Date; error: string | null } {
  const at = new Date(day);
  at.setHours(h, m, 0, 0);
  return { at, error: validateScheduleAt(at.toISOString(), now.toISOString()) };
}

/** «сегодня в 18:00», «завтра в 09:00», «31 октября в 09:00» — по часам телефона. */
export function scheduleLabel(at: Date | string, now: Date): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day0 = atHour(now, 0, 0).getTime();
  const dayD = atHour(d, 0, 0).getTime();
  const diff = Math.round((dayD - day0) / 86_400_000);
  if (diff === 0) return `сегодня в ${time}`;
  if (diff === 1) return `завтра в ${time}`;
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''} в ${time}`;
}

/** Ближайшая подходящая клетка времени: следующая четверть часа, но не раньше чем через 15 минут. */
export function nextSlot(now: Date): { day: number; h: number; m: number } {
  const t = new Date(now.getTime() + 15 * 60_000);
  const q = Math.ceil(t.getMinutes() / 15) * 15;
  t.setMinutes(q, 0, 0);
  const day = Math.round((atHour(t, 0, 0).getTime() - atHour(now, 0, 0).getTime()) / 86_400_000);
  return { day, h: t.getHours(), m: t.getMinutes() };
}

// ---------------------------------------------------------------- переслать

/** Переслать можно обычное сообщение, но не служебное, не опрос и не отправляемое. */
export const forwardable = (m: ChatMessage) => m.kind !== 'service' && m.kind !== 'poll' && !m.id.startsWith('local-') && !m.deleted;

/** Куда переслать: поиск по названию, закреплённые сверху, сам чат — тоже можно (как в Telegram). */
export function forwardTargets(chats: ChatSummary[], q: string): ChatSummary[] {
  return sortChats(chats.filter((c) => matchesQuery([c.title, c.peer?.position], q)));
}

export function forwardTitle(n: number): string {
  if (n <= 1) return 'Переслать сообщение';
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'сообщение' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'сообщения' : 'сообщений';
  return `Переслать ${n} ${word}`;
}
