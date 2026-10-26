import type { ChatSocket } from '../src/lib/socket';

type Fn = (payload: never) => void;

/** Сокет без сети: тест сам «присылает» события сервера и видит, что ушло от клиента. */
export class FakeSocket implements ChatSocket {
  connected = false;
  sent: { event: string; payload: unknown }[] = [];
  private handlers = new Map<string, Set<Fn>>();
  constructor(readonly token: string) {}
  on(event: string, fn: Fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
  }
  off(event: string, fn?: Fn) {
    if (fn) this.handlers.get(event)?.delete(fn);
    else this.handlers.delete(event);
  }
  emit(event: 'typing' | 'stop_typing', payload: { chat_id: string; topic_id?: string | null }) {
    this.sent.push({ event, payload });
  }
  disconnect() {
    this.connected = false;
    this.handlers.clear();
  }
  /** Событие от сервера. */
  receive(event: string, payload?: unknown) {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const fn of [...(this.handlers.get(event) ?? [])]) (fn as (p: unknown) => void)(payload);
  }
}

export const sockets: FakeSocket[] = [];

/** Последний открытый сокет — тот, что слушает приложение. */
export function lastSocket(): FakeSocket {
  const s = sockets[sockets.length - 1];
  if (!s) throw new Error('сокет не открывался');
  return s;
}
