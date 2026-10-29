import { loadConfig, loadDotEnv } from '../config';
import { migrate } from '../db/migrate';
import { createPgDb } from '../db/pg';
import { DEMO_PASSWORD, seedDemo } from './demo';
import { seedDemoPersonal } from './demo-personal';
import { seedDemoTaskFlow } from './demo-task-flow';
import { seedDemoKnowledge } from './demo-knowledge';
import { seedDemoSales } from './demo-sales';
import { aiProviderFromEnv } from '../services/ai';
import { createKnowledgeService } from '../services/knowledge';
import { createMediaStore } from '../services/media';

loadDotEnv();
const config = loadConfig();
const db = createPgDb(config.databaseUrl);
await migrate(db);
const exists = await db.query(`SELECT 1 FROM users WHERE email = 'director@offix.demo'`);
if (exists.rows.length) {
  console.log('Демо-данные уже есть');
} else {
  const demo = await seedDemo(db);
  await seedDemoPersonal(db, demo);
  await seedDemoTaskFlow(db, demo);
  await seedDemoSales(db, demo);
  // Документы базы знаний — в ту же папку файлов, что у сервера (UPLOADS_DIR).
  const media = createMediaStore(config.uploads, config.jwtSecret);
  await seedDemoKnowledge(db, media, createKnowledgeService(db, media, { provider: aiProviderFromEnv() }), demo);
  console.log(`Демо готово. Вход: director@offix.demo / ${DEMO_PASSWORD} (и olga@, anna@, igor@, dima@, maria@, продажи — natalia@, pavel@, ksenia@ …)`);
}
await db.close();
