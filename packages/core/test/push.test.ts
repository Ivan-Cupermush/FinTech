import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUSH_SETTINGS,
  KIND_TOPIC,
  NOTIFICATION_KINDS,
  PUSH_TOPICS,
  isExpoPushToken,
  isQuietHour,
  moscowHour,
  parsePushSettings,
  pushMessage,
  pushRoute,
  shouldPush,
} from '../src';

const DAY = '2026-10-19T09:00:00.000Z'; // 12:00 по Москве
const NIGHT = '2026-10-19T21:30:00.000Z'; // 00:30 по Москве

describe('тихие часы', () => {
  it('час по Москве — UTC+3', () => {
    expect(moscowHour('2026-10-19T00:00:00.000Z')).toBe(3);
    expect(moscowHour('2026-10-19T22:00:00.000Z')).toBe(1);
  });
  it('с 22:00 до 08:00 по Москве', () => {
    expect(isQuietHour('2026-10-19T18:59:00.000Z')).toBe(false); // 21:59
    expect(isQuietHour('2026-10-19T19:00:00.000Z')).toBe(true); // 22:00
    expect(isQuietHour(NIGHT)).toBe(true);
    expect(isQuietHour('2026-10-19T04:59:00.000Z')).toBe(true); // 07:59
    expect(isQuietHour('2026-10-19T05:00:00.000Z')).toBe(false); // 08:00
  });
});

describe('shouldPush', () => {
  it('днём по умолчанию приходит всё', () => {
    for (const k of NOTIFICATION_KINDS) expect(shouldPush(k, DEFAULT_PUSH_SETTINGS, DAY)).toEqual({ send: true });
  });
  it('приглушённая тема не приходит', () => {
    expect(shouldPush('comment', { muted: ['comments'], quiet_hours: false }, DAY)).toEqual({ send: false, reason: 'muted' });
    expect(shouldPush('task_assigned', { muted: ['comments'], quiet_hours: false }, DAY)).toEqual({ send: true });
  });
  it('ночью ждёт утра, кроме блокера', () => {
    expect(shouldPush('task_assigned', DEFAULT_PUSH_SETTINGS, NIGHT)).toEqual({ send: false, reason: 'quiet_hours' });
    expect(shouldPush('task_blocked', DEFAULT_PUSH_SETTINGS, NIGHT)).toEqual({ send: true });
  });
  it('без тихих часов приходит и ночью', () => {
    expect(shouldPush('task_assigned', { muted: [], quiet_hours: false }, NIGHT)).toEqual({ send: true });
  });
  it('приглушённые блокеры не приходят даже ночью', () => {
    expect(shouldPush('task_blocked', { muted: ['blockers'], quiet_hours: true }, NIGHT)).toEqual({ send: false, reason: 'muted' });
  });
  it('неизвестный тип не шлём', () => {
    expect(shouldPush('something', DEFAULT_PUSH_SETTINGS, DAY)).toEqual({ send: false, reason: 'unknown_kind' });
  });
  it('у каждого типа есть тема', () => {
    for (const k of NOTIFICATION_KINDS) expect(PUSH_TOPICS).toContain(KIND_TOPIC[k]);
  });
});

describe('parsePushSettings', () => {
  it('пусто — значения по умолчанию', () => {
    expect(parsePushSettings(undefined)).toEqual({ muted: [], quiet_hours: true });
    expect(parsePushSettings(null)).toEqual(DEFAULT_PUSH_SETTINGS);
  });
  it('лишние темы отбрасываются, порядок — как в настройках', () => {
    expect(parsePushSettings({ muted: ['comments', 'x', 'tasks'], quiet_hours: false })).toEqual({ muted: ['tasks', 'comments'], quiet_hours: false });
  });
});

describe('isExpoPushToken', () => {
  it('оба формата Expo', () => {
    expect(isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[AbC_123-xyzQ]')).toBe(true);
  });
  it('мусор и чужие форматы — нет', () => {
    for (const t of ['', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'fcm:abc', 42, null, `ExponentPushToken[${'a'.repeat(300)}]`]) expect(isExpoPushToken(t)).toBe(false);
  });
});

describe('pushMessage', () => {
  const n = { id: 'n1', kind: 'task_assigned', title: 'Новая задача: «Сверка с реестром»', body: null, goal_id: 'g1', task_id: 't1' };
  it('заголовок, бейдж и данные для перехода', () => {
    expect(pushMessage('ExponentPushToken[abcdefgh]', n, 3)).toEqual({
      to: 'ExponentPushToken[abcdefgh]',
      title: 'Новая задача: «Сверка с реестром»',
      sound: 'default',
      badge: 3,
      channelId: 'default',
      priority: 'default',
      data: { notification_id: 'n1', kind: 'task_assigned', goal_id: 'g1', task_id: 't1' },
    });
  });
  it('блокер — срочный канал и высокий приоритет', () => {
    const m = pushMessage('t', { ...n, kind: 'task_blocked', body: 'Нет доступа к справочнику' }, 1);
    expect(m).toMatchObject({ channelId: 'urgent', priority: 'high', body: 'Нет доступа к справочнику' });
  });
  it('длинный текст обрезается с многоточием', () => {
    const m = pushMessage('t', { ...n, title: 'а'.repeat(300), body: 'б'.repeat(500) }, 0);
    expect(m.title).toHaveLength(120);
    expect(m.title.endsWith('…')).toBe(true);
    expect(m.body).toHaveLength(240);
  });
  it('отрицательный бейдж не уходит', () => {
    expect(pushMessage('t', n, -2).badge).toBe(0);
  });
});

describe('pushRoute', () => {
  it('задача, затем цель, иначе «Входящие»', () => {
    expect(pushRoute({ task_id: 't1', goal_id: 'g1' })).toBe('/task/t1');
    expect(pushRoute({ task_id: null, goal_id: 'g1' })).toBe('/goal/g1');
    expect(pushRoute({})).toBe('/inbox');
    expect(pushRoute(null)).toBe('/inbox');
  });
});
