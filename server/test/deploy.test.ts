import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig, loadDotEnv } from '../src/config';
import type { Db } from '../src/db/db';
import { resolveWebDist } from '../src/http/site';
import { buildVersion } from '../src/services/version';
import { SECRET, setup, type Ctx } from './helpers';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEPLOY = join(ROOT, 'deploy');

/** Собранный «сайт» во временной папке: index.html и файл сборки с хешем. */
function fakeSite(): string {
  const dir = mkdtempSync(join(tmpdir(), 'offix-site-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div><script type="module" src="/assets/index-abc123.js"></script>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("offix")');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return dir;
}

describe('проверка сервера (/health)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  });

  it('база, версия, последняя миграция и ffmpeg — на /api/health и /health', async () => {
    for (const path of ['/api/health', '/health']) {
      const r = await request(ctx.app).get(path);
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body).toMatchObject({ ok: true, status: 'ok', database: 'ok', site: false });
      expect(r.body.migration).toBe(readdirSync(join(ROOT, 'server/src/db/migrations')).filter((f) => f.endsWith('.sql')).sort().at(-1));
      expect(typeof r.body.version).toBe('string');
      expect(typeof r.body.media.ffmpeg).toBe('boolean');
    }
  });

  it('база не отвечает — 503, а не «живой» сервер', async () => {
    const broken = { query: async () => Promise.reject(new Error('connection refused')), tx: async () => Promise.reject(new Error('x')), close: async () => undefined } as unknown as Db;
    const app = createApp({ db: broken, config: { jwtSecret: SECRET, corsOrigins: [] }, rateLimit: false });
    const r = await request(app).get('/health');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, status: 'error', database: 'error', migration: null });
    // Причина сбоя наружу не уходит.
    expect(JSON.stringify(r.body)).not.toContain('refused');
  });
});

describe('сайт с того же сервера', () => {
  let ctx: Ctx;
  let site: string;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    ctx = await setup();
    site = fakeSite();
    app = createApp({ db: ctx.db, config: { jwtSecret: SECRET, corsOrigins: [], webDist: site }, rateLimit: false, media: ctx.store, knowledge: ctx.knowledge });
  });

  it('главная и любой адрес сайта — index.html без кэша и со своей политикой безопасности', async () => {
    for (const path of ['/', '/app/goals', '/app/sales/people/u1?month=2026-10']) {
      const r = await request(app).get(path).set('Accept', 'text/html');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/html/);
      expect(r.text).toContain('id="root"');
      expect(r.headers['cache-control']).toBe('no-cache');
      const csp = r.headers['content-security-policy'];
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("default-src 'none'");
    }
    expect((await request(app).get('/health')).body.site).toBe(true);
  });

  it('файлы сборки — с кэшем на год; потерянный файл — 404, а не страница', async () => {
    const js = await request(app).get('/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const lost = await request(app).get('/assets/index-old999.js').set('Accept', 'text/html,*/*');
    expect(lost.status).toBe(404);
    expect(lost.text).not.toContain('id="root"');
    const icon = await request(app).get('/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('API не подменяется страницей: неизвестный метод — JSON 404, вход работает', async () => {
    const r = await request(app).get('/api/nope').set('Accept', 'text/html');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'olga@offix.demo', password: 'offix-demo' });
    expect(login.status).toBe(200);
  });

  it('не-страницы не получают index.html: POST и запросы JSON', async () => {
    expect((await request(app).post('/app/goals').send({})).status).toBe(404);
    const json = await request(app).get('/app/goals').set('Accept', 'application/json');
    expect(json.status).toBe(404);
    expect(json.text).not.toContain('id="root"');
  });

  it('путь наружу из папки сайта не открывается', async () => {
    const r = await request(app).get('/..%2f..%2fpackage.json');
    expect(r.text).not.toContain('"workspaces"');
  });

  it('без сайта сервер отдаёт только API', async () => {
    expect((await request(ctx.app).get('/').set('Accept', 'text/html')).status).toBe(404);
  });
});

describe('настройки развёртывания', () => {
  it('где сайт: WEB_DIST_DIR, «off», в разработке — нет, в продакшене — собранный web/dist', () => {
    const built = fakeSite();
    const empty = mkdtempSync(join(tmpdir(), 'offix-nosite-'));
    expect(resolveWebDist({ WEB_DIST_DIR: 'off', NODE_ENV: 'production' }, [built])).toBeNull();
    expect(resolveWebDist({ WEB_DIST_DIR: built }, [])).toBe(built);
    expect(resolveWebDist({ NODE_ENV: 'development' }, [built])).toBeNull();
    expect(resolveWebDist({ NODE_ENV: 'production' }, [empty, built])).toBe(built);
    expect(resolveWebDist({ NODE_ENV: 'production' }, [empty])).toBeNull();
  });

  it('HOST и пустые значения из .env', () => {
    const c = loadConfig({ HOST: ' 127.0.0.1 ', PORT: '4100', WEB_DIST_DIR: 'off', UPLOADS_DIR: '', FFMPEG_DIR: '' });
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(4100);
    expect(c.webDist).toBeNull();
    expect(c.uploads.ffmpegDir).toBeUndefined();
    expect(loadConfig({ HOST: '' }).host).toBeUndefined();
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow(/32/);
  });

  it('server/.env читается при запуске, но окружение службы важнее файла', () => {
    const dir = mkdtempSync(join(tmpdir(), 'offix-dotenv-'));
    writeFileSync(join(dir, '.env'), 'OFFIX_T_A=из файла # комментарий\nOFFIX_T_B=из файла\n');
    process.env.OFFIX_T_B = 'из окружения';
    try {
      expect(loadDotEnv(join(dir, '.env'))).toBe(true);
      expect(process.env.OFFIX_T_A).toBe('из файла');
      expect(process.env.OFFIX_T_B).toBe('из окружения');
      expect(loadDotEnv(join(dir, 'нет.env'))).toBe(false);
    } finally {
      delete process.env.OFFIX_T_A;
      delete process.env.OFFIX_T_B;
    }
  });

  it('версия: OFFIX_VERSION, иначе файл VERSION, иначе dev', () => {
    const dir = mkdtempSync(join(tmpdir(), 'offix-ver-'));
    writeFileSync(join(dir, 'VERSION'), 'a1b2c3d\n');
    expect(buildVersion({ OFFIX_VERSION: 'v9' }, join(dir, 'VERSION'))).toBe('v9');
    expect(buildVersion({}, join(dir, 'VERSION'))).toBe('a1b2c3d');
    expect(buildVersion({}, join(dir, 'nope'))).toBe('dev');
  });

  it('.env.example называет все настройки, которые читает сервер', () => {
    const example = readFileSync(join(ROOT, 'server/.env.example'), 'utf8');
    for (const key of ['NODE_ENV', 'DATABASE_URL', 'JWT_SECRET', 'PORT', 'HOST', 'WEB_DIST_DIR', 'CORS_ORIGINS', 'UPLOADS_DIR', 'UPLOAD_MAX_MB', 'FFMPEG_DIR', 'PUSH_ENABLED', 'REPORT_MAIL_ENABLED', 'INTEGRATIONS_ENABLED', 'INTEGRATIONS_SECRET_KEY', 'KNOWLEDGE_AI']) {
      expect(example).toMatch(new RegExp(`^${key}=`, 'm'));
    }
  });
});

describe('скрипты развёртывания', () => {
  const sh = ['linux/common.sh', 'linux/install.sh', 'linux/update.sh', 'linux/rollback.sh', 'linux/backup.sh', 'vps/setup.sh', 'measure/measure.sh'];
  const ps = ['common.ps1', 'install-service.ps1', 'update.ps1', 'rollback.ps1', 'backup.ps1', 'install-tunnel.ps1', 'diagnose.ps1'].map((f) => `windows/${f}`).concat('measure/measure.ps1');

  it('bash-скрипты разбираются без ошибок', () => {
    for (const f of sh) {
      const r = spawnSync('bash', ['-n', join(DEPLOY, f)], { encoding: 'utf8' });
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
  });

  it('PowerShell-скрипты в UTF-8 с BOM (иначе Windows PowerShell 5.1 портит кириллицу)', () => {
    for (const f of ps) {
      const buf = readFileSync(join(DEPLOY, f));
      expect([...buf.subarray(0, 3)], f).toEqual([0xef, 0xbb, 0xbf]);
      const text = buf.toString('utf8');
      expect(text, f).not.toMatch(/mesNation|offixcrm|com\.mesnation/);
      // Скобки сбалансированы — грубая проверка, что файл не обрезан.
      expect(text.split('{').length, f).toBe(text.split('}').length);
    }
  });

  it('скрипты обновления собирают то, что потом запускает служба', () => {
    const update = readFileSync(join(DEPLOY, 'windows/update.ps1'), 'utf8');
    expect(update).toContain("'-w', 'web', '--', '--outDir', 'dist-next'");
    expect(update).toContain("'-w', 'server', '--', '--outdir', 'dist-next'");
    expect(readFileSync(join(DEPLOY, 'windows/install-service.ps1'), 'utf8')).toContain("'dist\\index.js'");
    expect(readFileSync(join(DEPLOY, 'linux/install.sh'), 'utf8')).toContain('dist/index.js');
    expect(readFileSync(join(ROOT, 'server/package.json'), 'utf8')).toContain('"start": "node dist/index.js"');
  });

  it('Caddy для VPS: HTTPS на доменах, туннель или сервер рядом, своя страница при недоступности', () => {
    const caddy = (...args: string[]) => execFileSync('bash', [join(DEPLOY, 'vps/setup.sh'), '--print-caddyfile', '--email', 'admin@example.ru', ...args], { encoding: 'utf8' });
    const tunnel = caddy('--domains', 'offix.example.ru, www.offix.example.ru');
    expect(tunnel).toContain('email admin@example.ru');
    expect(tunnel).toContain('offix.example.ru, www.offix.example.ru {');
    expect(tunnel).toContain('reverse_proxy 127.0.0.1:15000');
    expect(tunnel).toContain('Сервер компании временно недоступен');
    expect(tunnel).toContain('@api path /api/* /socket.io/*');
    const local = caddy('--domains', 'offix.example.ru', '--upstream', 'local', '--local-port', '4100');
    expect(local).toContain('reverse_proxy 127.0.0.1:4100');
    expect(local).toContain('на этом же сервере');
  });

  it('VPS: лишнее в доменах и почте не попадает в конфигурацию', () => {
    for (const args of [
      ['--domains', 'a.ru;respond 200', '--email', 'a@b.ru'],
      ['--domains', 'a.ru {', '--email', 'a@b.ru'],
      ['--domains', 'a.ru', '--email', 'a b@c.ru'],
      ['--domains', 'a.ru', '--email', 'a@b.ru', '--upstream', 'other'],
    ]) {
      const r = spawnSync('bash', [join(DEPLOY, 'vps/setup.sh'), '--print-caddyfile', ...args], { encoding: 'utf8' });
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.stdout).toBe('');
    }
  });

  it('Linux: .env читается как у сервера, адрес базы разбирается, пароль скрывается', () => {
    const dir = mkdtempSync(join(tmpdir(), 'offix-env-'));
    const env = join(dir, '.env');
    writeFileSync(env, ['# комментарий', 'PORT=4100 # порт', 'DATABASE_URL="postgres://offix:p%40ss%23w@db.local:6432/offix_prod"', "APP_URL='https://x.ru/#a'", 'export HOST=127.0.0.1', 'EMPTY='].join('\n'));
    const run = (script: string) => execFileSync('bash', ['-c', `. "${join(DEPLOY, 'linux/common.sh')}"; ${script}`], { encoding: 'utf8' });
    expect(run(`env_get "${env}" PORT`)).toBe('4100');
    expect(run(`env_get "${env}" APP_URL`)).toBe('https://x.ru/#a');
    expect(run(`env_get "${env}" HOST`)).toBe('127.0.0.1');
    expect(run(`env_get "${env}" EMPTY; echo "[$(env_get "${env}" MISSING)]"`)).toBe('[]\n');
    expect(run(`db_parts "$(env_get "${env}" DATABASE_URL)"; echo "$DB_USER|$DB_PASSWORD|$DB_HOST|$DB_PORT|$DB_NAME"`)).toBe('offix|p@ss#w|db.local|6432|offix_prod\n');
    expect(run(`db_parts "postgres://u:x@localhost/db"; echo "$DB_PORT"`)).toBe('5432\n');
    expect(run(`hide_password "postgres://offix:secret@db:5432/offix"`)).toBe('postgres://offix:***@db:5432/offix\n');
  });
});

