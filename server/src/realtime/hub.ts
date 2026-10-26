import type { Server } from 'socket.io';

/** Комнаты называются с компанией: один и тот же сервер обслуживает несколько компаний. */
export const userRoom = (companyId: string, userId: string) => `c:${companyId}:u:${userId}`;
export const companyRoom = (companyId: string) => `c:${companyId}`;

export type Payload = unknown | ((userId: string) => unknown);

/**
 * События в реальном времени. Маршруты знают только этот интерфейс: в тестах
 * его можно подменить записью событий, без сокетов — по умолчанию он молчит.
 * Сообщения уходят в личные комнаты участников: состав чата проверяется при
 * каждой рассылке, поэтому исключённый участник сразу перестаёт их получать.
 */
export interface Realtime {
  /** payload-функция — для событий, которые выглядят по-разному для разных людей (моя реакция, мой голос). */
  emit(companyId: string, userIds: readonly string[], event: string, payload: Payload): void;
  emitCompany(companyId: string, event: string, payload: unknown): void;
  isOnline(companyId: string, userId: string): boolean;
  /** Кто из компании сейчас в сети. */
  onlineIn(companyId: string): string[];
  /** Сеансы завершены (смена пароля, «выйти везде», отключение): сокеты человека закрываются. */
  disconnectUser(companyId: string, userId: string): void;
}

export const noRealtime: Realtime = { emit() {}, emitCompany() {}, isOnline: () => false, onlineIn: () => [], disconnectUser() {} };

export interface RealtimeHub extends Realtime {
  attach(io: Server): void;
  /** Учёт подключений: человек «в сети», пока открыта хотя бы одна вкладка или приложение. */
  connected(companyId: string, userId: string): boolean;
  disconnected(companyId: string, userId: string): boolean;
}

export function createRealtimeHub(): RealtimeHub {
  let io: Server | null = null;
  const online = new Map<string, number>();
  const key = (c: string, u: string) => `${c}:${u}`;
  return {
    attach(server) {
      io = server;
    },
    emit(companyId, userIds, event, payload) {
      if (!io) return;
      for (const uid of new Set(userIds)) io.to(userRoom(companyId, uid)).emit(event, typeof payload === 'function' ? (payload as (u: string) => unknown)(uid) : payload);
    },
    emitCompany(companyId, event, payload) {
      io?.to(companyRoom(companyId)).emit(event, payload);
    },
    disconnectUser(companyId, userId) {
      if (!io) return;
      io.to(userRoom(companyId, userId)).emit('session_revoked', {});
      io.in(userRoom(companyId, userId)).disconnectSockets(true);
    },
    isOnline: (c, u) => (online.get(key(c, u)) ?? 0) > 0,
    onlineIn: (c) => [...online.keys()].filter((k) => k.startsWith(`${c}:`)).map((k) => k.slice(c.length + 1)),
    connected(c, u) {
      const n = (online.get(key(c, u)) ?? 0) + 1;
      online.set(key(c, u), n);
      return n === 1;
    },
    disconnected(c, u) {
      const n = Math.max(0, (online.get(key(c, u)) ?? 0) - 1);
      if (n) online.set(key(c, u), n);
      else online.delete(key(c, u));
      return n === 0;
    },
  };
}
