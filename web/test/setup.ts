import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { sockets } from './fake-socket';

// В jsdom нет WebGL: эффекты уходят в CSS-режим, а не шумят в консоль.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

// Настоящий сокет в тестах не нужен: события сервера тест присылает сам.
vi.mock('../src/lib/socket', async () => {
  const { FakeSocket, sockets } = await import('./fake-socket');
  return {
    socketOrigin: () => 'http://localhost',
    connectChatSocket: (token: string) => {
      const s = new FakeSocket(token);
      sockets.push(s);
      return s;
    },
  };
});

afterEach(() => {
  sockets.length = 0;
});
