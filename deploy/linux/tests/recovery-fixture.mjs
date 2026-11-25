// Synthetic PGlite data only. The module path is supplied by the test operator.
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [mode, dir] = process.argv.slice(2);
if (!['create', 'verify'].includes(mode) || !dir) throw new Error('create|verify directory');
if (!process.env.PGLITE_MODULE) throw new Error('PGLITE_MODULE must point to the PGlite module');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const file = join(dir, 'uploads', 'files', 'synthetic.txt');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const db = new PGlite(join(dir, 'pgdata'));
await db.waitReady;
try {
  if (mode === 'create') {
    await mkdir(join(dir, 'uploads', 'files'), { recursive: true });
    const bytes = Buffer.from('Synthetic attachment for recovery test\n');
    await writeFile(file, bytes);
    await db.exec('CREATE TABLE recovery_fixture (title text NOT NULL, sha256 text NOT NULL)');
    await db.query('INSERT INTO recovery_fixture VALUES ($1, $2)', ['Synthetic meeting', digest(bytes)]);
  } else {
    const rows = (await db.query('SELECT title, sha256 FROM recovery_fixture')).rows;
    if (rows.length !== 1 || rows[0].title !== 'Synthetic meeting' || rows[0].sha256 !== digest(await readFile(file))) {
      throw new Error('Database or file mismatch');
    }
    console.log(`Verified synthetic PGlite record and attachment SHA-256 ${rows[0].sha256}`);
  }
} finally {
  await db.close();
}
