import { createApp } from './app';
import { loadConfig } from './config';
import { expoSender, startPushLoop } from './services/push';
import { migrate } from './db/migrate';
import { createPgDb } from './db/pg';

const config = loadConfig();
const db = createPgDb(config.databaseUrl);
await migrate(db);
const app = createApp({ db, config });
if (config.push.enabled) startPushLoop(db, expoSender({ accessToken: config.push.accessToken }), { onError: (e) => console.error('push:', e) });
app.listen(config.port, () => console.log(`offix API слушает порт ${config.port}`));
