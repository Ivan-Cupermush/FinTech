import { createServer } from 'node:http';
import { createApp } from './app';
import { loadConfig, loadDotEnv } from './config';
import { createRealtimeHub } from './realtime/hub';
import { attachSocket } from './realtime/socket';
import { messagePushHook, startScheduledLoop } from './services/chat-jobs';
import { startIntegrationLoop } from './services/integrations';
import { expoSender, startPushLoop } from './services/push';
import { smtpSender, startReportMailLoop } from './services/report-mail';
import { migrate } from './db/migrate';
import { createPgDb } from './db/pg';
import { createMediaStore } from './services/media';
import { aiProviderFromEnv } from './services/ai';
import { createKnowledgeService, startKnowledgeLoop } from './services/knowledge';

loadDotEnv();
const config = loadConfig();
const db = createPgDb(config.databaseUrl);
try {
  await migrate(db);
} catch (e) {
  // Служба перезапустит сервер; в журнале — понятная причина, а адрес базы — без пароля.
  console.error(`offix: нет связи с базой или миграция не применилась (${config.databaseUrl.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1***@')}): ${(e as Error).message}`);
  process.exit(1);
}
const realtime = createRealtimeHub();
const pushSender = config.push.enabled ? expoSender({ accessToken: config.push.accessToken }) : undefined;
const media = createMediaStore(config.uploads, config.jwtSecret);
const knowledge = createKnowledgeService(db, media, { provider: aiProviderFromEnv(), onError: (e) => console.error('knowledge:', e) });
const app = createApp({ db, config, realtime, messagePush: pushSender, media, knowledge });
// Документы, что не успели прочитать до перезапуска, и пересчёт векторов после смены модели.
startKnowledgeLoop(knowledge, { onError: (e) => console.error('knowledge:', e) });
if (pushSender) startPushLoop(db, pushSender, { onError: (e) => console.error('push:', e) });
if (config.mail.enabled && config.mail.smtpUrl && config.mail.from) {
  startReportMailLoop(db, smtpSender({ url: config.mail.smtpUrl, from: config.mail.from }), { appUrl: config.mail.appUrl, onError: (e) => console.error('report mail:', e) });
}
if (config.integrations.enabled) startIntegrationLoop(db, fetch, { onError: (e) => console.error('integrations:', e) });
startScheduledLoop(db, realtime, { store: media, now: () => new Date() }, { onMessage: pushSender ? messagePushHook(db, pushSender, realtime, () => new Date()) : undefined, onError: (e) => console.error('scheduled:', e) });
// Один HTTP-сервер на API и сокет: тот же порт и тот же прокси.
const server = createServer(app);
attachSocket(server, realtime, { db, secret: config.jwtSecret, corsOrigins: config.corsOrigins });
server.listen(config.port, config.host, async () => {
  console.log(`offix слушает ${config.host ?? '*'}:${config.port}${config.webDist ? ` — API и сайт из ${config.webDist}` : ' — только API'}`);
  if (!(await media.hasFfmpeg())) console.warn('ffmpeg не найден: у видео не будет обложки и длительности, голосовые из браузера не перекодируются');
});

// Остановка службы (systemd — SIGTERM, NSSM — Ctrl+C): дописываем начатые запросы,
// закрываем базу и выходим; через 15 с — выходим в любом случае.
let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`offix останавливается (${signal})`);
  setTimeout(() => process.exit(0), 15_000).unref();
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
  server.closeIdleConnections();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
