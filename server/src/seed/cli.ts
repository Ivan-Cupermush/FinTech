import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createPgDb } from '../db/pg';
import { DEMO_PASSWORD, seedDemo } from './demo';
import { seedDemoPersonal } from './demo-personal';
import { seedDemoTaskFlow } from './demo-task-flow';

const db = createPgDb(loadConfig().databaseUrl);
await migrate(db);
const exists = await db.query(`SELECT 1 FROM users WHERE email = 'director@offix.demo'`);
if (exists.rows.length) {
  console.log('Демо-данные уже есть');
} else {
  const demo = await seedDemo(db);
  await seedDemoPersonal(db, demo);
  await seedDemoTaskFlow(db, demo);
  console.log(`Демо готово. Вход: director@offix.demo / ${DEMO_PASSWORD} (и olga@, anna@, igor@, dima@, maria@ …)`);
}
await db.close();
