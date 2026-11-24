import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { verifyToken } from '../auth/auth';
import type { Db } from '../db/db';
import { isUuid } from '../http/validate';
import { companyRoom, userRoom, type RealtimeHub } from './hub';

interface SocketUser {
  id: string;
  company_id: string;
  display_name: string;
}

const typingSchema = z.object({ chat_id: z.string().refine(isUuid), topic_id: z.string().refine(isUuid).nullable().optional() });

/**
 * Сокет поверх того же HTTP-сервера. Вход — тем же токеном, что и API, с
 * теми же проверками: человек активен и состоит в компании. Каждый сидит в
 * своей личной комнате и в комнате компании (там — кто в сети).
 * Клиент шлёт только «печатает»; всё остальное — обычными запросами.
 */
export function attachSocket(server: HttpServer, hub: RealtimeHub, opts: { db: Db; secret: string; corsOrigins: string[]; now?: () => Date; revalidateMs?: number }): Server {
  const now = opts.now ?? (() => new Date());
  const io = new Server(server, { path: '/socket.io', cors: { origin: opts.corsOrigins }, serveClient: false });
  hub.attach(io);

  io.use(async (socket, next) => {
    try {
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      // Те же проверки, что у API: подпись, активность и версия токена.
      const user = await verifyToken(opts.db, opts.secret, token);
      if (!user) throw new Error('UNAUTHORIZED');
      socket.data.user = { id: user.id, company_id: user.company_id, display_name: user.display_name } satisfies SocketUser;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user as SocketUser;
    const token = socket.handshake.auth.token as string;
    const revoke = () => {
      socket.emit('session_revoked', {});
      socket.disconnect(true);
    };
    const authorized = async () => {
      try {
        return !!(await verifyToken(opts.db, opts.secret, token));
      } catch {
        // При недоступности базы закрываем поток до нового подтверждения доступа.
        return false;
      }
    };
    // Повторная проверка закрывает и окно между handshake и входом в комнаты.
    if (!(await authorized()) || !socket.connected) {
      revoke();
      return;
    }
    await socket.join([userRoom(user.company_id, user.id), companyRoom(user.company_id)]);
    let timer: ReturnType<typeof setTimeout>;
    const revalidate = async () => {
      if (!socket.connected) return;
      if (!(await authorized())) {
        revoke();
        return;
      }
      if (socket.connected) timer = setTimeout(revalidate, opts.revalidateMs ?? 30_000);
    };
    timer = setTimeout(revalidate, opts.revalidateMs ?? 30_000);
    if (hub.connected(user.company_id, user.id)) hub.emitCompany(user.company_id, 'presence', { user_id: user.id, online: true, last_seen_at: null });
    socket.emit('online', { user_ids: hub.onlineIn(user.company_id) });

    const typing = (event: 'typing' | 'stop_typing') => async (raw: unknown) => {
      const p = typingSchema.safeParse(raw);
      if (!p.success) return;
      if (!(await authorized())) {
        revoke();
        return;
      }
      try {
        const { rows } = await opts.db.query<{ user_id: string }>(
          `SELECT cm.user_id FROM chat_members cm JOIN chat_members me ON me.chat_id = cm.chat_id AND me.user_id = $2
            JOIN chats c ON c.id = cm.chat_id WHERE cm.chat_id = $1 AND cm.user_id <> $2 AND c.company_id = $3`,
          [p.data.chat_id, user.id, user.company_id],
        );
        if (!socket.connected) return;
        hub.emit(
          user.company_id,
          rows.map((r) => r.user_id),
          event,
          { chat_id: p.data.chat_id, topic_id: p.data.topic_id ?? null, user_id: user.id, name: user.display_name },
        );
      } catch {
        revoke();
      }
    };
    socket.on('typing', typing('typing'));
    socket.on('stop_typing', typing('stop_typing'));

    socket.on('disconnect', async () => {
      clearTimeout(timer);
      if (!hub.disconnected(user.company_id, user.id)) return;
      const at = now().toISOString();
      await opts.db.query(`UPDATE users SET last_seen_at = $2 WHERE id = $1`, [user.id, at]).catch(() => undefined);
      hub.emitCompany(user.company_id, 'presence', { user_id: user.id, online: false, last_seen_at: at });
    });
  });
  return io;
}
