import { loadConfig, loadDotEnv } from '../config';
import { migrate } from './migrate';
import { createPgDb } from './pg';

loadDotEnv();
const db = createPgDb(loadConfig().databaseUrl);
const applied = await migrate(db);
console.log(applied.length ? `Применены миграции: ${applied.join(', ')}` : 'База в актуальном состоянии');
await db.close();
