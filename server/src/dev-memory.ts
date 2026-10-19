// Запуск без установленного PostgreSQL: встроенная база в памяти с демо-данными.
// npm run dev:memory -w server
import { createApp } from './app';
import { loadConfig } from './config';
import { expoSender, startPushLoop } from './services/push';
import { migrate } from './db/migrate';
import { createPgliteDb } from './db/pglite';
import { DEMO_PASSWORD, seedDemo } from './seed/demo';

const config = loadConfig();
const db = await createPgliteDb();
await migrate(db);
await seedDemo(db);
if (config.push.enabled) startPushLoop(db, expoSender({ accessToken: config.push.accessToken }), { onError: (e) => console.error('push:', e) });
createApp({ db, config }).listen(config.port, () => {
  console.log(`offix API (демо в памяти) — http://localhost:${config.port}`);
  console.log(`Вход: director@offix.demo / ${DEMO_PASSWORD}`);
});
