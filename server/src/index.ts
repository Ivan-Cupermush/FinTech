import { createServer } from 'node:http';
import { createApp } from './app';
import { loadConfig, loadDotEnv } from './config';
import { createRealtimeHub } from './realtime/hub';
import { attachSocket } from './realtime/socket';
import { messagePushHook, startScheduledLoop } from './services/chat-jobs';
import { startIntegrationLoop } from './services/integrations';
import { expoSender, startPushLoop } from './services/push';
import { smtpSender, startReportMailLoop } from './services/report-mail';
import { migrate } from './db/migrate';
import { openDb, safeDbUrl } from './db/open';
import { fakeSystemsFetch } from './seed/fake-systems';
import { SANDBOX_SEATS, seedSandbox } from './seed/sandbox';
import { createMediaStore } from './services/media';
import { startStorageLoop } from './services/storage-jobs';
import { loadKusok } from './services/blobs';
import { aiProviderFromEnv } from './services/ai';
import { createKnowledgeService, startKnowledgeLoop } from './services/knowledge';

loadDotEnv();
const config = loadConfig();
let db: Awaited<ReturnType<typeof openDb>>;
try {
  db = await openDb(config.databaseUrl);
  await migrate(db);
} catch (e) {
  // Служба перезапустит сервер; в журнале — понятная причина, а адрес базы — без пароля.
  console.error(`offix: нет связи с базой или миграция не применилась (${safeDbUrl(config.databaseUrl)}): ${(e as Error).message}`);
  process.exit(1);
}
const realtime = createRealtimeHub();
const pushSender = config.push.enabled ? expoSender({ accessToken: config.push.accessToken }) : undefined;
let media: ReturnType<typeof createMediaStore>;
try {
  media = createMediaStore(config.uploads, config.jwtSecret);
} catch (e) {
  console.error(`offix: хранилище файлов не открылось: ${(e as Error).message}`);
  process.exit(1);
}
if (media.blobs === 'kusok') console.log(`Файлы: kusok ${loadKusok().module?.version ?? ''} (дедупликация, проверка SHA-256)`);
else console.log(`Файлы: папка files/${config.uploads.store === 'fs' ? '' : ` — ${loadKusok().error}`}`);
const knowledge = createKnowledgeService(db, media, { provider: aiProviderFromEnv(), onError: (e) => console.error('knowledge:', e) });
if (config.sandbox) {
  // Песочница заводится один раз; при следующих запусках данные уже в базе.
  if (await seedSandbox(db, media, knowledge)) console.log(`Песочница готова: входы ${SANDBOX_SEATS.map((s) => s.login).join(', ')} (пароль = логин)`);
}
// В песочнице интеграции ходят только в поддельные 1С и Moodle: наружу сервер не обращается.
const integrationFetch = config.sandbox ? fakeSystemsFetch() : fetch;
const app = createApp({ db, config, realtime, messagePush: pushSender, media, knowledge, integrationFetch });
// Документы, что не успели прочитать до перезапуска, и пересчёт векторов после смены модели.
startKnowledgeLoop(knowledge, { onError: (e) => console.error('knowledge:', e) });
if (pushSender) startPushLoop(db, pushSender, { onError: (e) => console.error('push:', e) });
if (config.mail.enabled && config.mail.smtpUrl && config.mail.from) {
  startReportMailLoop(db, smtpSender({ url: config.mail.smtpUrl, from: config.mail.from }), { appUrl: config.mail.appUrl, onError: (e) => console.error('report mail:', e) });
}
if (config.integrations.enabled || config.sandbox) startIntegrationLoop(db, integrationFetch, { onError: (e) => console.error('integrations:', e) });
// Старые файлы — в kusok понемногу; ночью — сверка ссылок, сборка мусора и fsck.
startStorageLoop(db, media, {
  backupDir: config.uploads.kusokBackupDir,
  onError: (e) => console.error('storage:', e),
  onReport: ({ migrate, nightly, backup }) => {
    if (backup) console.log(`storage: копия kusok — новых файлов ${backup.imported}, кусков ${backup.chunks}, ${backup.bytes} Б`);
    if (migrate) console.log(`storage: перенесено в kusok ${migrate.moved}, нет на диске ${migrate.missing}, не удалось ${migrate.failed}`);
    if (nightly) {
      const line = `storage: сборка мусора ${nightly.gc.bytesBefore} → ${nightly.gc.bytesAfter} Б, fsck: файлов ${nightly.fsck.files}, испорчено ${nightly.fsck.brokenFiles}, сверка: +${nightly.reconcile.raised} −${nightly.reconcile.released}`;
      if (nightly.broken) console.error(`${line} — НУЖНА ПРОВЕРКА: испорченных записей ${nightly.fsck.badRecords}, нет манифестов ${nightly.fsck.missingManifests}, файлов из базы нет в kusok ${nightly.reconcile.missing.length}`);
      else console.log(line);
    }
  },
});
startScheduledLoop(db, realtime, { store: media, now: () => new Date() }, { onMessage: pushSender ? messagePushHook(db, pushSender, realtime, () => new Date()) : undefined, onError: (e) => console.error('scheduled:', e) });
// Один HTTP-сервер на API и сокет: тот же порт и тот же прокси.
const server = createServer(app);
attachSocket(server, realtime, { db, secret: config.jwtSecret, corsOrigins: config.corsOrigins });
server.listen(config.port, config.host, async () => {
  console.log(`offix слушает ${config.host ?? '*'}:${config.port}${config.webDist ? ` — API и сайт из ${config.webDist}` : ' — только API'}`);
  if (!(await media.hasFfmpeg())) console.warn('ffmpeg не найден: у видео не будет обложки и длительности, голосовые из браузера не перекодируются');
});

// Остановка службы (systemd — SIGTERM, NSSM — Ctrl+C): дописываем начатые запросы,
// закрываем базу и выходим; через 15 с — выходим в любом случае.
let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`offix останавливается (${signal})`);
  setTimeout(() => process.exit(0), 15_000).unref();
  server.close(() => {
    try {
      media.close();
    } catch (e) {
      console.error('storage: kusok не закрылся', e);
    }
    db.close().finally(() => process.exit(0));
  });
  server.closeIdleConnections();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
