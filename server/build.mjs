// Сборка сервера в один файл: ядро @offix/core встраивается, остальные зависимости — внешние.
//   node build.mjs                 → dist/
//   node build.mjs --outdir dist-next   (скрипты обновления собирают рядом и подменяют папку)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@offix/core');
const flag = process.argv.indexOf('--outdir');
const outdir = flag > 0 && process.argv[flag + 1] ? process.argv[flag + 1] : 'dist';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(outdir, 'index.js'),
  sourcemap: true,
  external,
});
cpSync('src/db/migrations', join(outdir, 'migrations'), { recursive: true });
// Шрифт для PDF заметок: встроенные шрифты PDF не знают кириллицы.
cpSync('assets', join(outdir, 'assets'), { recursive: true });
// Версия для /health: OFFIX_VERSION или короткий хеш коммита.
let version = process.env.OFFIX_VERSION?.trim();
if (!version) {
  try {
    version = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    version = 'dev';
  }
}
writeFileSync(join(outdir, 'VERSION'), `${version}\n`);
console.log(`server → ${outdir}/index.js (версия ${version})`);
