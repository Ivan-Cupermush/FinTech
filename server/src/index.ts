import { createApp } from './app';
import { loadConfig } from './config';
import { startIntegrationLoop } from './services/integrations';
import { expoSender, startPushLoop } from './services/push';
import { smtpSender, startReportMailLoop } from './services/report-mail';
import { migrate } from './db/migrate';
import { createPgDb } from './db/pg';

const config = loadConfig();
const db = createPgDb(config.databaseUrl);
await migrate(db);
const app = createApp({ db, config });
if (config.push.enabled) startPushLoop(db, expoSender({ accessToken: config.push.accessToken }), { onError: (e) => console.error('push:', e) });
if (config.mail.enabled && config.mail.smtpUrl && config.mail.from) {
  startReportMailLoop(db, smtpSender({ url: config.mail.smtpUrl, from: config.mail.from }), { appUrl: config.mail.appUrl, onError: (e) => console.error('report mail:', e) });
}
if (config.integrations.enabled) startIntegrationLoop(db, fetch, { onError: (e) => console.error('integrations:', e) });
app.listen(config.port, () => console.log(`offix API слушает порт ${config.port}`));
