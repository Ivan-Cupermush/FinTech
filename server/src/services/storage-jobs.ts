import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/db';
import { isKusokKey, kusokId, kusokKey, loadKusok, reconcileRefs, sha256File, type KusokBundle, type KusokFsck, type KusokGc, type KusokModule, type ReconcileReport } from './blobs';
import type { MediaStore } from './media';

/**
 * Фоновые задачи хранилища файлов kusok:
 *
 *  - перенос старых оригиналов из files/ в kusok (понемногу, чтобы не
 *    занимать единственный процессор сервера);
 *  - ночью: сверка счётчиков ссылок с базой, сборка мусора и fsck;
 *  - копия хранилища в KUSOK_BACKUP_DIR: ночью и по просьбе backup.sh.
 *
 * Без kusok (UPLOADS_STORE=fs или не собран) ничего не делают.
 */

export interface MigrateReport {
  /** Ключей files/ перенесено в kusok. */
  moved: number;
  /** Файла на диске уже нет — строка осталась со старым ключом, отдать её всё равно нельзя. */
  missing: number;
  /** Перенос не удался (kusok вернул ошибку, SHA-256 не сошёлся) — попробуем в следующий раз. */
  failed: number;
  /** Остались ли ещё ключи files/ в базе. */
  more: boolean;
}

/**
 * Перенести до `limit` старых ключей files/ в kusok. Для каждого ключа:
 * положить файл в kusok, сверить SHA-256, одной транзакцией заменить ключ во
 * всех строках и выдать по ссылке на строку, потом удалить старый файл —
 * только если на него больше никто не ссылается. Ошибка на любом шаге —
 * строки остаются со старым ключом, ничего не теряется.
 */
export async function migrateLegacyFiles(db: Db, store: MediaStore, opts: { limit?: number; skip?: Set<string> } = {}): Promise<MigrateReport> {
  const ks = store.kusok;
  const report: MigrateReport = { moved: 0, missing: 0, failed: 0, more: false };
  if (!ks) return report;
  const limit = opts.limit ?? 20;
  const skip = opts.skip ?? new Set<string>();
  const { rows } = await db.query<{ storage_key: string }>(
    `SELECT DISTINCT storage_key FROM attachments WHERE storage_key LIKE 'files/%' AND NOT (storage_key = ANY($2::text[])) ORDER BY storage_key LIMIT $1`,
    [limit + 1, [...skip]],
  );
  report.more = rows.length > limit;
  for (const { storage_key: old } of rows.slice(0, limit)) {
    const path = store.pathOf(old);
    const exists = path ? await fs.stat(path).then((st) => st.isFile(), () => false) : false;
    if (!path || !exists) {
      // Файл пропал раньше (до kusok его ничто не проверяло) — не трогаем строку, просто не берём её снова.
      skip.add(old);
      report.missing++;
      continue;
    }
    let id: string;
    try {
      const [put, sha] = await Promise.all([ks.putFile(path), sha256File(path)]);
      if (put.id !== sha) {
        ks.unref(put.id);
        throw new Error(`SHA-256 не сошёлся: ${old}`);
      }
      id = put.id;
    } catch {
      skip.add(old);
      report.failed++;
      continue;
    }
    // put дал одну ссылку; на каждую строку нужна своя.
    const updated = await db.tx(async (q) => (await q.query<{ id: string }>(`UPDATE attachments SET storage_key = $2 WHERE storage_key = $1 RETURNING id`, [old, kusokKey(id)])).rows.length);
    if (updated === 0) ks.unref(id);
    for (let i = 1; i < updated; i++) ks.ref(id);
    // Пересылка могла скопировать строку со старым ключом, пока шёл перенос, — тогда файл ещё нужен.
    const still = (await db.query(`SELECT 1 FROM attachments WHERE storage_key = $1 LIMIT 1`, [old])).rows.length > 0;
    if (!still) await fs.rm(path, { force: true });
    else report.more = true;
    report.moved++;
  }
  ks.checkpoint();
  return report;
}

export interface NightlyReport {
  reconcile: ReconcileReport;
  gc: KusokGc;
  fsck: KusokFsck;
  /** fsck нашёл испорченные куски или файлы — нужен человек. */
  broken: boolean;
}

/** Ночная уборка: сверить ссылки с базой, собрать мусор, проверить всё по SHA-256. */
export async function nightlyStorage(db: Db, store: MediaStore, opts: { minGarbage?: number } = {}): Promise<NightlyReport | null> {
  const ks = store.kusok;
  if (!ks) return null;
  const { rows } = await db.query<{ storage_key: string; n: number | string }>(`SELECT storage_key, count(*) AS n FROM attachments WHERE storage_key LIKE 'kusok:%' GROUP BY storage_key`);
  const byId = new Map<string, number>();
  for (const r of rows) if (isKusokKey(r.storage_key)) byId.set(kusokId(r.storage_key), Number(r.n));
  const reconcile = reconcileRefs(ks, byId, join(store.root, 'kusok-orphans.json'));
  const gc = await ks.gc(opts.minGarbage ?? 0.3);
  const fsck = await ks.fsck();
  return { reconcile, gc, fsck, broken: fsck.badRecords > 0 || fsck.brokenFiles > 0 || fsck.missingManifests > 0 || reconcile.missing.length > 0 };
}

export interface BackupReport extends KusokBundle {
  /** Сколько файлов копия приняла как новые. */
  imported: number;
  at: string;
}

/**
 * Копия kusok в `dir/store` — только новые куски. Снимает её сам сервер:
 * он держит хранилище на запись, а второй процесс (утилита kusok) открыть
 * его не может. Пакет пишется во временный файл в `dir`, а не в папку
 * загрузок, чтобы не занимать её диск; import сверяет SHA-256 каждого куска.
 * Итог — в `dir/last.json` (его проверяет backup.sh).
 */
export async function backupKusok(store: MediaStore, dir: string, opts: { module?: KusokModule | null; now?: () => Date } = {}): Promise<BackupReport | null> {
  const ks = store.kusok;
  const mod = opts.module === undefined ? loadKusok().module : opts.module;
  if (!ks || !mod) return null;
  await fs.mkdir(dir, { recursive: true });
  const bundle = join(dir, 'incoming.kb');
  const dst = new mod.Kusok(join(dir, 'store'), { compress: 1 });
  try {
    const exp = await ks.exportTo(bundle, dst.ids());
    const imp = await dst.importFrom(bundle);
    dst.checkpoint();
    const report: BackupReport = { ...exp, imported: imp.files, at: (opts.now?.() ?? new Date()).toISOString() };
    await fs.writeFile(join(dir, 'last.json'), JSON.stringify(report));
    return report;
  } finally {
    dst.close();
    await fs.rm(bundle, { force: true });
  }
}

/** backup.sh положил `dir/request` позже последней копии — пора снять новую. */
export async function backupRequested(dir: string): Promise<boolean> {
  const mtime = (f: string) => fs.stat(join(dir, f)).then((st) => st.mtimeMs, () => null);
  const [req, last] = await Promise.all([mtime('request'), mtime('last.json')]);
  return req !== null && (last === null || req > last);
}

/** Ночь по Москве: с 3:00 до 5:00 — меньше всего загрузок. */
export const isStorageNight = (at: Date) => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hourCycle: 'h23' }).format(at));
  return h >= 3 && h < 5;
};

const mskDay = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(at);

/**
 * Раз в 10 минут: перенос пачки старых файлов, пока они есть, и копия kusok,
 * если её попросил backup.sh; раз в сутки ночью — уборка и копия. Ошибки
 * уходят в журнал, сервер продолжает работать.
 */
export function startStorageLoop(
  db: Db,
  store: MediaStore,
  opts: {
    now?: () => Date;
    everyMs?: number;
    /** KUSOK_BACKUP_DIR: куда снимать копию kusok. */
    backupDir?: string;
    onError?: (e: unknown) => void;
    onReport?: (r: { migrate?: MigrateReport; nightly?: NightlyReport; backup?: BackupReport }) => void;
  } = {},
): () => void {
  if (!store.kusok) return () => undefined;
  const now = opts.now ?? (() => new Date());
  const skip = new Set<string>();
  let lastNight = '';
  let migrating = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (migrating) {
        const migrate = await migrateLegacyFiles(db, store, { skip });
        if (migrate.moved || migrate.missing || migrate.failed) opts.onReport?.({ migrate });
        migrating = migrate.more;
      }
      const at = now();
      if (isStorageNight(at) && mskDay(at) !== lastNight) {
        lastNight = mskDay(at);
        const nightly = await nightlyStorage(db, store);
        if (nightly) opts.onReport?.({ nightly });
        // Новые старые ключи могли появиться только из бэкапа — заодно проверим ещё раз.
        migrating = true;
        if (opts.backupDir) {
          const backup = await backupKusok(store, opts.backupDir, { now });
          if (backup) opts.onReport?.({ backup });
        }
      } else if (opts.backupDir && (await backupRequested(opts.backupDir))) {
        // backup.sh только что снял дамп базы — файлы копируем после него, чтобы в копии были все файлы из дампа.
        const backup = await backupKusok(store, opts.backupDir, { now });
        if (backup) opts.onReport?.({ backup });
      }
    } catch (e) {
      opts.onError?.(e);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(() => void tick(), 30_000);
  const timer = setInterval(() => void tick(), opts.everyMs ?? 10 * 60_000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
