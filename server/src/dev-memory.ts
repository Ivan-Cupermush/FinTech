// Запуск без установленного PostgreSQL: встроенная база в памяти с демо-данными.
// npm run dev:memory -w server
import { createApp } from './app';
import { loadConfig } from './config';
import { migrate } from './db/migrate';
import { createPgliteDb } from './db/pglite';
import { DEMO_PASSWORD, seedDemo } from './seed/demo';

const config = loadConfig();
const db = await createPgliteDb();
await migrate(db);
await seedDemo(db);
createApp({ db, config }).listen(config.port, () => {
  console.log(`offix API (демо в памяти) — http://localhost:${config.port}`);
  console.log(`Вход: director@offix.demo / ${DEMO_PASSWORD}`);
});
