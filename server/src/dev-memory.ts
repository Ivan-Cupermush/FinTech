// Запуск без установленного PostgreSQL: встроенная база в памяти с демо-данными.
// npm run dev:memory -w server
import { createApp } from './app';
import { loadConfig } from './config';
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
if (config.push.enabled) startPushLoop(db, expoSender({ accessToken: config.push.accessToken }), { onError: (e) => console.error('push:', e) });
if (config.mail.enabled && config.mail.smtpUrl && config.mail.from) {
  startReportMailLoop(db, smtpSender({ url: config.mail.smtpUrl, from: config.mail.from }), { appUrl: config.mail.appUrl, onError: (e) => console.error('report mail:', e) });
}
// В демо 1С и Moodle поддельные: подключения работают без сети и настоящих систем.
const integrationFetch = fakeSystemsFetch();
if (config.integrations.enabled) startIntegrationLoop(db, integrationFetch, { onError: (e) => console.error('integrations:', e) });
createApp({ db, config, integrationFetch }).listen(config.port, () => {
  console.log(`offix API (демо в памяти) — http://localhost:${config.port}`);
  console.log(`Вход: director@offix.demo / ${DEMO_PASSWORD}`);
});
