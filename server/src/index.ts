import { createApp } from './app';
import { loadConfig } from './config';
import { migrate } from './db/migrate';
import { createPgDb } from './db/pg';

const config = loadConfig();
const db = createPgDb(config.databaseUrl);
await migrate(db);
const app = createApp({ db, config });
app.listen(config.port, () => console.log(`offix API слушает порт ${config.port}`));
