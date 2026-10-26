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

const config = loadConfig();
const db = await createPgliteDb();
await migrate(db);
await seedDemo(db);
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
startScheduledLoop(db, realtime, { onMessage: pushSender ? messagePushHook(db, pushSender, realtime, () => new Date()) : undefined, onError: (e) => console.error('scheduled:', e) });
const server = createServer(createApp({ db, config, integrationFetch, realtime, messagePush: pushSender }));
attachSocket(server, realtime, { db, secret: config.jwtSecret, corsOrigins: config.corsOrigins });
server.listen(config.port, () => {
  console.log(`offix API (демо в памяти) — http://localhost:${config.port}`);
  console.log(`Вход: director@offix.demo / ${DEMO_PASSWORD}`);
});
