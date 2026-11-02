import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

/**
 * kusok — хранилище файлов с дедупликацией (native/kusok, C11, MIT).
 *
 * Оригиналы вложений лежат в нём под ключом `kusok:<SHA-256 содержимого>`:
 * одно и то же видео в пяти чатах занимает место один раз, похожие версии
 * документа делят общие куски, а `fsck` сверяет каждый кусок с его SHA-256.
 *
 * Счётчик ссылок в kusok = число строк `attachments` с этим ключом: загрузка
 * даёт +1 (`put`), пересылка — +1 на копию (`ref`), удаление строки — −1
 * (`unref`). Ночная сверка (`reconcileRefs`) чинит счётчики по базе, если
 * транзакция откатилась после `unref` или сервер упал посреди загрузки.
 */

export interface KusokPut {
  id: string;
  newBytes: number;
}

export interface KusokStat {
  files: number;
  chunks: number;
  logicalBytes: number;
  uniqueBytes: number;
  storedBytes: number;
  packs: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface KusokGc {
  packsRewritten: number;
  bytesBefore: number;
  bytesAfter: number;
  recordsDropped: number;
}

export interface KusokFsck {
  records: number;
  badRecords: number;
  files: number;
  brokenFiles: number;
  missingManifests: number;
  tailBytes: number;
}

export interface KusokBundle {
  files: number;
  chunks: number;
  skipped: number;
  bytes: number;
}

/** То, чем пользуется offix из привязки bindings/node (типы — в её index.d.ts). */
export interface KusokHandle {
  putFile(path: string): Promise<KusokPut>;
  read(id: string, offset?: number, length?: number): Promise<Buffer>;
  size(id: string): number;
  ref(id: string): number;
  unref(id: string): number;
  refs(id: string): number;
  stat(): KusokStat;
  list(): { id: string; size: number; refs: number }[];
  checkpoint(): void;
  gc(minGarbage?: number): Promise<KusokGc>;
  fsck(): Promise<KusokFsck>;
  /** id всех кусков и манифестов — что уже есть в копии. */
  ids(): string[];
  /** Пакет со всеми живыми файлами, кроме кусков из known (бэкап из процесса-писателя). */
  exportTo(path: string, known?: string[]): Promise<KusokBundle>;
  importFrom(path: string): Promise<KusokBundle>;
  close(): void;
}

export interface KusokModule {
  Kusok: new (dir: string, opts?: { sync?: boolean; compress?: number; readOnly?: boolean }) => KusokHandle;
  version: string;
}

export const KUSOK_KEY = /^kusok:([0-9a-f]{64})$/;
export const isKusokKey = (key: string | null | undefined): key is string => !!key && KUSOK_KEY.test(key);
export const kusokId = (key: string): string => KUSOK_KEY.exec(key)![1]!;
export const kusokKey = (id: string): string => `kusok:${id}`;

/**
 * Где лежит привязка: KUSOK_MODULE (путь к bindings/node/index.js), иначе
 * native/kusok/bindings/node в репозитории — ищем вверх от этого файла,
 * чтобы работало и из src (тесты, tsx), и из собранного dist.
 * Сам kusok.node ищет index.js: KUSOK_NODE_ADDON или native/kusok/build.
 */
export function findKusokModule(env: NodeJS.ProcessEnv = process.env, from = dirname(fileURLToPath(import.meta.url))): string | null {
  if (env.KUSOK_MODULE?.trim()) return resolve(env.KUSOK_MODULE.trim());
  let dir = from;
  for (let i = 0; i < 8; i++) {
    const root = join(dir, 'native', 'kusok');
    const index = join(root, 'bindings', 'node', 'index.js');
    if (existsSync(index)) {
      const addon = env.KUSOK_NODE_ADDON?.trim() ? resolve(env.KUSOK_NODE_ADDON.trim()) : null;
      const built = addon ? existsSync(addon) : ['build', 'build-rel', 'build-node'].some((b) => existsSync(join(root, b, 'kusok.node')));
      return built ? index : null;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

let cached: { module: KusokModule | null; error: string | null } | undefined;

/** Привязка kusok или null с причиной (не собрана, не та платформа). Загружается один раз. */
export function loadKusok(env: NodeJS.ProcessEnv = process.env): { module: KusokModule | null; error: string | null } {
  if (cached) return cached;
  const path = findKusokModule(env);
  if (!path) {
    cached = { module: null, error: 'kusok не собран: npm run kusok:build' };
    return cached;
  }
  try {
    cached = { module: createRequire(import.meta.url)(path) as KusokModule, error: null };
  } catch (e) {
    cached = { module: null, error: `kusok не загрузился: ${(e as Error).message}` };
  }
  return cached;
}

/** Какой режим хранения выбран: UPLOADS_STORE=kusok|fs|auto (по умолчанию auto). */
export type BlobMode = 'kusok' | 'fs' | 'auto';

export function parseBlobMode(v: string | undefined): BlobMode {
  const s = v?.trim().toLowerCase();
  return s === 'kusok' || s === 'fs' ? s : 'auto';
}

/** SHA-256 файла потоком — для проверки при переносе старых файлов. */
export function sha256File(path: string): Promise<string> {
  return new Promise((ok, fail) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('error', fail)
      .on('end', () => ok(h.digest('hex')));
  });
}

/** Кусок файла [start, end] включительно — поток по 256 КБ, без чтения всего файла в память. */
export function kusokStream(ks: KusokHandle, id: string, start: number, end: number, step = 256 * 1024): Readable {
  let pos = start;
  return new Readable({
    highWaterMark: step,
    async read() {
      try {
        if (pos > end) return void this.push(null);
        const n = Math.min(step, end - pos + 1);
        const buf = await ks.read(id, pos, n);
        if (!buf.length) return void this.push(null);
        pos += buf.length;
        this.push(buf);
      } catch (e) {
        this.destroy(e as Error);
      }
    },
  });
}

// ------------------------------------------------------- сверка ссылок с базой

export interface ReconcileReport {
  /** Сколько id в kusok. */
  ids: number;
  /** Счётчик был меньше числа строк в базе — подняли (иначе сборка мусора стёрла бы живой файл). */
  raised: number;
  /** Файл ни на что не ссылается уже две сверки подряд — отпустили. */
  released: number;
  /** Ни на что не ссылается впервые — отпустим в следующий раз, если так и останется. */
  pending: number;
  /** В базе есть ключ, а в kusok файла нет. */
  missing: string[];
}

/**
 * Привести счётчики kusok к базе. Поднимаем сразу: строка в базе — живой
 * файл. Опускаем осторожно: файл без строк мог только что загрузиться и ещё
 * не записаться в базу, поэтому отпускаем его, только если он был «сиротой»
 * и на прошлой сверке (список хранится в orphans.json рядом с хранилищем).
 */
export function reconcileRefs(ks: KusokHandle, rowsById: Map<string, number>, orphansFile: string): ReconcileReport {
  let previous = new Set<string>();
  try {
    const parsed = JSON.parse(readFileSync(orphansFile, 'utf8')) as unknown;
    if (Array.isArray(parsed)) previous = new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    // первой сверки ещё не было
  }
  const report: ReconcileReport = { ids: 0, raised: 0, released: 0, pending: 0, missing: [] };
  const orphans: string[] = [];
  const present = new Set<string>();
  for (const f of ks.list()) {
    report.ids++;
    present.add(f.id);
    const rows = rowsById.get(f.id) ?? 0;
    if (rows > f.refs) {
      for (let i = f.refs; i < rows; i++) ks.ref(f.id);
      report.raised++;
    } else if (rows === 0 && f.refs > 0) {
      if (previous.has(f.id)) {
        for (let i = 0; i < f.refs; i++) ks.unref(f.id);
        report.released++;
      } else {
        orphans.push(f.id);
        report.pending++;
      }
    }
  }
  // Файл без ссылок не виден в list(), но живёт до сборки мусора — его ещё можно вернуть.
  for (const [id, rows] of rowsById) {
    if (present.has(id)) continue;
    let refs: number;
    try {
      refs = ks.refs(id);
    } catch {
      report.missing.push(id);
      continue;
    }
    for (let i = refs; i < rows; i++) ks.ref(id);
    if (rows > refs) report.raised++;
  }
  ks.checkpoint();
  writeFileSync(orphansFile, JSON.stringify(orphans));
  return report;
}
