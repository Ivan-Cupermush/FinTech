// Запуск без установленного PostgreSQL: встроенная база в памяти с демо-данными.
// npm run dev:memory -w server
import { createServer } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';
import { createRealtimeHub } from './realtime/hub';
import { attachSocket } from './realtime/socket';
import { messagePushHook, startScheduledLoop } from './services/chat-jobs';
import { expoSender, startPushLoop } from './services/push';
import { smtpSender, startReportMailLoop } from './services/report-mail';
import { migrate } from './db/migrate';
import { createPgliteDb } from './db/pglite';
import { DEMO_PASSWORD, seedDemo } from './seed/demo';
import { fakeSystemsFetch } from './seed/fake-systems';
import { startIntegrationLoop } from './services/integrations';
import { createMediaStore } from './services/media';
import { seedDemoMedia } from './seed/demo-media';
import { seedDemoPersonal } from './seed/demo-personal';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const config = loadConfig();
const db = await createPgliteDb();
await migrate(db);
const demo = await seedDemo(db);
// База в памяти — и файлы демо во временной папке: после остановки ничего не остаётся.
const media = createMediaStore({ ...config.uploads, dir: process.env.UPLOADS_DIR || mkdtempSync(join(tmpdir(), 'offix-demo-uploads-')) }, config.jwtSecret);
await seedDemoMedia(db, media, demo);
await seedDemoPersonal(db, demo);
const realtime = createRealtimeHub();
const pushSender = config.push.enabled ? expoSender({ accessToken: config.push.accessToken }) : undefined;
if (pushSender) startPushLoop(db, pushSender, { onError: (e) => console.error('push:', e) });
if (config.mail.enabled && config.mail.smtpUrl && config.mail.from) {
  startReportMailLoop(db, smtpSender({ url: config.mail.smtpUrl, from: config.mail.from }), { appUrl: config.mail.appUrl, onError: (e) => console.error('report mail:', e) });
}
// В демо 1С и Moodle поддельные: подключения работают без сети и настоящих систем.
const integrationFetch = fakeSystemsFetch();
// Расписание в демо включено всегда: системы поддельные, ничего наружу не уходит.
startIntegrationLoop(db, integrationFetch, { onError: (e) => console.error('integrations:', e) });
startScheduledLoop(db, realtime, { store: media, now: () => new Date() }, { onMessage: pushSender ? messagePushHook(db, pushSender, realtime, () => new Date()) : undefined, onError: (e) => console.error('scheduled:', e) });
const server = createServer(createApp({ db, config, integrationFetch, realtime, messagePush: pushSender, media }));
attachSocket(server, realtime, { db, secret: config.jwtSecret, corsOrigins: config.corsOrigins });
server.listen(config.port, () => {
  console.log(`offix API (демо в памяти) — http://localhost:${config.port}`);
  console.log(`Вход: director@offix.demo / ${DEMO_PASSWORD}`);
});
