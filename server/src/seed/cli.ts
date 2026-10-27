import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createPgDb } from '../db/pg';
import { DEMO_PASSWORD, seedDemo } from './demo';
import { seedDemoPersonal } from './demo-personal';

const db = createPgDb(loadConfig().databaseUrl);
await migrate(db);
const exists = await db.query(`SELECT 1 FROM users WHERE email = 'director@offix.demo'`);
if (exists.rows.length) {
  console.log('Демо-данные уже есть');
} else {
  await seedDemoPersonal(db, await seedDemo(db));
  console.log(`Демо готово. Вход: director@offix.demo / ${DEMO_PASSWORD} (и olga@, anna@, igor@, dima@, maria@ …)`);
}
await db.close();
