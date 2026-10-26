// Сборка сервера в один файл: ядро @offix/core встраивается, остальные зависимости — внешние.
import { build } from 'esbuild';
import { cpSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@offix/core');

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  sourcemap: true,
  external,
});
cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
// Шрифт для PDF заметок: встроенные шрифты PDF не знают кириллицы.
cpSync('assets', 'dist/assets', { recursive: true });
console.log('server → dist/index.js');
