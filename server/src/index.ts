import { createServer } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';
import { createRealtimeHub } from './realtime/hub';
import { attachSocket } from './realtime/socket';
import { messagePushHook, startScheduledLoop } from './services/chat-jobs';
import { startIntegrationLoop } from './services/integrations';
import { expoSender, startPushLoop } from './services/push';
import { smtpSender, startReportMailLoop } from './services/report-mail';
import { migrate } from './db/migrate';
import { createPgDb } from './db/pg';
import { createMediaStore } from './services/media';

const config = loadConfig();
const db = createPgDb(config.databaseUrl);
await migrate(db);
const realtime = createRealtimeHub();
const pushSender = config.push.enabled ? expoSender({ accessToken: config.push.accessToken }) : undefined;
const media = createMediaStore(config.uploads, config.jwtSecret);
const app = createApp({ db, config, realtime, messagePush: pushSender, media });
if (pushSender) startPushLoop(db, pushSender, { onError: (e) => console.error('push:', e) });
if (config.mail.enabled && config.mail.smtpUrl && config.mail.from) {
  startReportMailLoop(db, smtpSender({ url: config.mail.smtpUrl, from: config.mail.from }), { appUrl: config.mail.appUrl, onError: (e) => console.error('report mail:', e) });
}
if (config.integrations.enabled) startIntegrationLoop(db, fetch, { onError: (e) => console.error('integrations:', e) });
startScheduledLoop(db, realtime, { store: media, now: () => new Date() }, { onMessage: pushSender ? messagePushHook(db, pushSender, realtime, () => new Date()) : undefined, onError: (e) => console.error('scheduled:', e) });
// Один HTTP-сервер на API и сокет: тот же порт и тот же прокси.
const server = createServer(app);
attachSocket(server, realtime, { db, secret: config.jwtSecret, corsOrigins: config.corsOrigins });
server.listen(config.port, async () => {
  console.log(`offix API слушает порт ${config.port}`);
  if (!(await media.hasFfmpeg())) console.warn('ffmpeg не найден: у видео не будет обложки и длительности, голосовые из браузера не перекодируются');
});
