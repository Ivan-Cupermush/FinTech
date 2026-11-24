import { createServer, type Server as HttpServer } from 'node:http';
import { once } from 'node:events';
import jwt from 'jsonwebtoken';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRealtimeHub, type RealtimeHub } from '../src/realtime/hub';
import { attachSocket } from '../src/realtime/socket';
import { issueToken, revokeSessions } from '../src/auth/auth';
import { setup, SECRET, type Ctx } from './helpers';

let ctx: Ctx;
let server: HttpServer;
let io: Server;
let hub: RealtimeHub;
let base: string;
let databaseUnavailable = false;
const clients: Socket[] = [];

function event(socket: Socket, name: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error('Не дождались события ' + name));
    }, 5000);
    const handler = (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args);
    };
    socket.once(name, handler);
  });
}

async function open(token: string) {
  const socket = connect(base, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: { token } });
  clients.push(socket);
  const ready = event(socket, 'online');
  socket.connect();
  await ready;
  return socket;
}

beforeAll(async () => {
  ctx = await setup();
});

beforeEach(async () => {
  databaseUnavailable = false;
  await ctx.db.query('UPDATE users SET active = true WHERE id = $1', [ctx.demo.users.anna]);
  server = createServer(ctx.app);
  hub = createRealtimeHub();
  io = attachSocket(server, hub, {
    db: {
      ...ctx.db,
      query: (sql, params) => {
        if (databaseUnavailable) return Promise.reject(new Error('database unavailable'));
        return ctx.db.query(sql, params);
      },
    },
    secret: SECRET, corsOrigins: [], revalidateMs: 100,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});

afterEach(async () => {
  clients.splice(0).forEach((client) => client.disconnect());
  await new Promise<void>((resolve) => io.close(() => resolve()));
});

afterAll(async () => {
  await ctx.db.close();
});

const annaToken = () => issueToken(ctx.db, SECRET, ctx.demo.users.anna, ctx.demo.companyId);

describe('действующие сокеты и отзыв доступа', () => {
  it('при недоступности проверки доступа закрывает поток, после восстановления можно войти заново', async () => {
    const token = await annaToken();
    const socket = await open(token);
    const closed = event(socket, 'disconnect');
    databaseUnavailable = true;
    await closed;
    databaseUnavailable = false;
    expect((await open(token)).connected).toBe(true);
  });

  it('обычный индикатор набора текста продолжает приходить участнику чата', async () => {
    const sender = await open(await annaToken());
    const recipient = await open(await issueToken(ctx.db, SECRET, ctx.demo.users.igor, ctx.demo.companyId));
    const received = event(recipient, 'typing');
    sender.emit('typing', { chat_id: ctx.demo.chats.team });
    expect((await received)[0]).toMatchObject({ chat_id: ctx.demo.chats.team, user_id: ctx.demo.users.anna });
  });

  it('отзыв версии токена закрывает открытый сокет и запрещает API и новое подключение', async () => {
    const token = await annaToken();
    const socket = await open(token);
    const closed = event(socket, 'disconnect');
    const revoked = event(socket, 'session_revoked');
    await revokeSessions(ctx.db, ctx.demo.users.anna);
    await revoked;
    await closed;
    expect(hub.isOnline(ctx.demo.companyId, ctx.demo.users.anna)).toBe(false);
    const res = await fetch(base + '/api/v1/users/me', { headers: { Authorization: 'Bearer ' + token } });
    expect(res.status).toBe(401);
    const denied = event(socket, 'connect_error');
    socket.connect();
    expect((await denied)[0]).toMatchObject({ message: 'UNAUTHORIZED' });
    const fresh = await open(await annaToken());
    expect(fresh.connected).toBe(true);
  });

  it('отключение в базе закрывает все вкладки, соединение другого сотрудника остаётся рабочим', async () => {
    const token = await annaToken();
    const a = await open(token);
    const b = await open(token);
    const other = await open(await issueToken(ctx.db, SECRET, ctx.demo.users.olga, ctx.demo.companyId));
    const closed = [event(a, 'disconnect'), event(b, 'disconnect')];
    await ctx.db.query('UPDATE users SET active = false WHERE id = $1', [ctx.demo.users.anna]);
    await Promise.all(closed);
    expect(other.connected).toBe(true);
    expect(hub.onlineIn(ctx.demo.companyId)).toEqual([ctx.demo.users.olga]);
  });

  it('истечение подписанного токена завершает сокет без запроса от клиента', async () => {
    const token = jwt.sign({ cid: ctx.demo.companyId, tv: (await ctx.db.query<{ token_version: number }>('SELECT token_version FROM users WHERE id = $1', [ctx.demo.users.anna])).rows[0]!.token_version }, SECRET, { subject: ctx.demo.users.anna, expiresIn: 2 });
    const socket = await open(token);
    await event(socket, 'disconnect');
    expect(socket.connected).toBe(false);
  });

  it('удаление членства прекращает получение событий', async () => {
    const socket = await open(await annaToken());
    const closed = event(socket, 'disconnect');
    const membership = (await ctx.db.query<{ role: string }>('SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2', [ctx.demo.companyId, ctx.demo.users.anna])).rows[0];
    try {
      await ctx.db.query('DELETE FROM company_members WHERE company_id = $1 AND user_id = $2', [ctx.demo.companyId, ctx.demo.users.anna]);
      await closed;
    } finally {
      await ctx.db.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)', [ctx.demo.companyId, ctx.demo.users.anna, membership!.role]);
    }
  });
});
