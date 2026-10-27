import { io } from 'socket.io-client';
import { API_BASE } from './api';

/** То, что приложению нужно от сокета: подписка, «печатает» и отключение. */
export interface ChatSocket {
  on(event: string, fn: (payload: never) => void): void;
  off(event: string, fn?: (payload: never) => void): void;
  emit(event: 'typing' | 'stop_typing', payload: { chat_id: string; topic_id?: string | null }): void;
  readonly connected: boolean;
  disconnect(): void;
}

/**
 * Сокет живёт на том же сервере, что и API: при API на другом адресе
 * (VITE_API_URL) подключаемся туда, иначе — к своему адресу через прокси.
 */
export function socketOrigin(apiBase = API_BASE, here = typeof location !== 'undefined' ? location.origin : 'http://localhost'): string {
  try {
    return new URL(apiBase, here).origin;
  } catch {
    return here;
  }
}

export function connectChatSocket(token: string): ChatSocket {
  return io(socketOrigin(), { path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 10_000 }) as unknown as ChatSocket;
}
