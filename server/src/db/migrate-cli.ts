import { loadConfig, loadDotEnv } from '../config';
import { migrate } from './migrate';
import { openDb } from './open';

loadDotEnv();
const db = await openDb(loadConfig().databaseUrl);
const applied = await migrate(db);
console.log(applied.length ? `Применены миграции: ${applied.join(', ')}` : 'База в актуальном состоянии');
await db.close();
