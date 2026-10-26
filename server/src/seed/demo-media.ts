import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { encodeWaveform } from '@offix/core';
import type { Db, Queryable } from '../db/db';
import type { MediaStore, ProcessedUpload } from '../services/media';
import type { DemoIds } from './demo';

/**
 * Файлы в демо: фото (рисуем их sharp из SVG — без чужих снимков), отчёт в
 * PDF, голосовое (синтезированный «голос») и карточка контакта. Сообщения
 * добавляются в конец лент, поэтому время — последние минуты.
 */
export async function seedDemoMedia(db: Db, store: MediaStore, demo: DemoIds, now = new Date()): Promise<void> {
  const u = demo.users;
  const c = demo.chats;
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  const tmp = async (name: string, data: Buffer) => {
    const p = join(store.tmpDir, `${randomBytes(8).toString('hex')}-${name}`);
    await fs.writeFile(p, data);
    return p;
  };
  const upload = async (name: string, data: Buffer, mime: string, extra: { special?: 'voice'; waveform?: string; duration?: number } = {}) => {
    const p = await tmp(name, data);
    try {
      return await store.process({ path: p, originalName: name, mime, size: data.length, ...extra });
    } finally {
      await fs.rm(p, { force: true });
    }
  };

  await db.tx(async (q) => {
    const say = async (chatId: string, sender: string, kind: string, text: string | null, min: number, files: ProcessedUpload[] = [], extra: { topic?: string; contact?: string } = {}) => {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO messages (chat_id, company_id, topic_id, kind, sender_id, text, contact_user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [chatId, demo.companyId, extra.topic ?? null, kind, sender, text, extra.contact ?? null, ago(min)],
      );
      for (const [i, f] of files.entries()) await insertAttachment(q, demo.companyId, sender, rows[0]!.id, i, f, ago(min));
      await q.query(`UPDATE chats SET updated_at = GREATEST(updated_at, $2) WHERE id = $1`, [chatId, ago(min)]);
      return rows[0]!.id;
    };
    const readUpTo = (chatId: string, userId: string) =>
      q.query(`UPDATE chat_members SET last_read_seq = (SELECT COALESCE(MAX(seq), 0) FROM messages WHERE chat_id = $1) WHERE chat_id = $1 AND user_id = $2`, [chatId, userId]);

    // Рабочая группа: альбом с выезда, отчёт и голосовое от Анны (директор ещё не слушал).
    const album = [
      await upload('доска-план.jpg', await whiteboard(), 'image/jpeg'),
      await upload('очередь-заявок.jpg', await paperStack(), 'image/jpeg'),
      await upload('дашборд-медиана.jpg', await dashboard(), 'image/jpeg'),
    ];
    await say(c.team, u.maria, 'media', 'С планёрки: доска с планом, стопка на проверку и дашборд по медиане', 16, album);
    const pdf = await upload('Время обработки заявок — неделя 42.pdf', reportPdf(), 'application/pdf');
    await say(c.team, u.sergey, 'media', 'Выгрузка за неделю — в PDF', 12, [pdf]);
    const { pcm, levels } = speechLike(7.2, 11);
    const voice = await upload('voice.wav', wav(pcm), 'audio/wav', { special: 'voice', waveform: encodeWaveform(levels), duration: 7.2 });
    await say(c.team, u.anna, 'voice', null, 6, [voice]);
    for (const who of [u.olga, u.maria, u.sergey, u.anna]) await readUpTo(c.team, who);

    // Личный чат с Ольгой: фото отчёта и контакт Анны.
    const chart = await upload('отчёт-октябрь.png', await reportChart(), 'image/png');
    await say(c.olga, u.olga, 'media', 'Сравнение с сентябрём — на втором графике', 33, [chart]);
    await say(c.olga, u.olga, 'contact', null, 31, [], { contact: u.anna });
    await readUpTo(c.olga, u.olga);

    // С Игорем — голосовое, уже прослушанное.
    const short = speechLike(3.4, 5);
    const igorVoice = await upload('voice.wav', wav(short.pcm), 'audio/wav', { special: 'voice', waveform: encodeWaveform(short.levels), duration: 3.4 });
    const vm = await say(c.igor, u.igor, 'voice', null, 60 * 18, [igorVoice]);
    await q.query(`INSERT INTO message_listens (message_id, user_id, listened_at) VALUES ($1, $2, $3)`, [vm, u.director, ago(60 * 17)]);
    await readUpTo(c.igor, u.director);
    await readUpTo(c.igor, u.igor);

    // Общий чат, тема «Аналитика»: график.
    const campus = await upload('кампус.jpg', await campusSunset(), 'image/jpeg');
    await say(c.campus, u.elena, 'media', 'Фото с дня открытых дверей — спасибо всем, кто пришёл!', 70, [campus], { topic: c.topics.news });
  });
}

async function insertAttachment(q: Queryable, companyId: string, by: string, messageId: string, position: number, f: ProcessedUpload, at: string) {
  await q.query(
    `INSERT INTO attachments (company_id, uploaded_by, owner_type, owner_id, position, kind, name, mime, size, storage_key, thumb_key, width, height, duration, waveform, created_at)
     VALUES ($1, $2, 'message', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [companyId, by, messageId, position, f.kind, f.name, f.mime, f.size, f.storage_key, f.thumb_key, f.width, f.height, f.duration, f.waveform, at],
  );
}

// ---------------------------------------------------------------- картинки

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const toJpeg = (s: Buffer) => sharp(s).jpeg({ quality: 88 }).toBuffer();

/** Простое «зерно», чтобы картинка выглядела снимком, а не плоской заливкой. */
function grain(w: number, h: number, n = 900, seed = 3): string {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let out = '';
  for (let i = 0; i < n; i++) out += `<circle cx="${(rnd() * w).toFixed(1)}" cy="${(rnd() * h).toFixed(1)}" r="${(rnd() * 1.6 + 0.3).toFixed(2)}" fill="#fff" opacity="${(rnd() * 0.08).toFixed(3)}"/>`;
  return out;
}

function whiteboard(): Promise<Buffer> {
  const notes = [
    ['#ffd166', 160, 170, -4], ['#8ecae6', 360, 150, 3], ['#ff99c8', 560, 180, -2], ['#b8f2a6', 760, 160, 5],
    ['#ffd166', 220, 400, 2], ['#cdb4ff', 440, 420, -5], ['#8ecae6', 660, 390, 4], ['#ff99c8', 880, 430, -3],
  ] as const;
  const body = `
    <defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dde6"/><stop offset="1" stop-color="#aeb6c6"/></linearGradient>
    <linearGradient id="board" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9edf3"/></linearGradient></defs>
    <rect width="1200" height="800" fill="url(#wall)"/>
    <rect x="80" y="70" width="1040" height="600" rx="10" fill="#8a93a6"/>
    <rect x="96" y="86" width="1008" height="568" rx="6" fill="url(#board)"/>
    <path d="M140 320 C 380 280, 640 360, 1040 300" stroke="#2f4bff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>
    ${notes.map(([c, x, y, r]) => `<g transform="rotate(${r} ${x + 60} ${y + 60})"><rect x="${x + 4}" y="${y + 6}" width="130" height="120" fill="#000" opacity=".12"/><rect x="${x}" y="${y}" width="130" height="120" fill="${c}"/>${[0, 1, 2].map((i) => `<rect x="${x + 16}" y="${y + 26 + i * 24}" width="${90 - i * 18}" height="7" rx="3" fill="#33384a" opacity=".55"/>`).join('')}</g>`).join('')}
    <rect x="80" y="670" width="1040" height="22" rx="4" fill="#6f7789"/>
    <rect x="420" y="660" width="70" height="14" rx="4" fill="#2f4bff"/><rect x="510" y="660" width="70" height="14" rx="4" fill="#ff5d73"/>
    ${grain(1200, 800, 700, 7)}`;
  return toJpeg(svg(1200, 800, body));
}

function paperStack(): Promise<Buffer> {
  const sheets = [0, 1, 2, 3].map(
    (i) => `<g transform="rotate(${[-6, 3, -2, 5][i]} 500 520)"><rect x="${300 + i * 6}" y="${190 + i * 8}" width="420" height="560" rx="6" fill="#000" opacity=".18" transform="translate(8 10)"/><rect x="${300 + i * 6}" y="${190 + i * 8}" width="420" height="560" rx="6" fill="#fbfaf6"/>
      ${Array.from({ length: 14 }, (_, k) => `<rect x="${340 + i * 6}" y="${250 + i * 8 + k * 32}" width="${k % 4 === 3 ? 180 : 330}" height="8" rx="4" fill="#9aa3b5" opacity=".6"/>`).join('')}</g>`,
  );
  const body = `
    <defs><radialGradient id="desk" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#c58b5a"/><stop offset="1" stop-color="#6e4428"/></radialGradient></defs>
    <rect width="1000" height="1000" fill="url(#desk)"/>
    ${sheets.join('')}
    <g transform="rotate(-14 610 640)"><circle cx="610" cy="640" r="74" fill="none" stroke="#2f4bff" stroke-width="10" opacity=".75"/><circle cx="610" cy="640" r="52" fill="none" stroke="#2f4bff" stroke-width="4" opacity=".6"/></g>
    <rect x="740" y="120" width="26" height="420" rx="12" fill="#1d2433" transform="rotate(28 753 330)"/>
    ${grain(1000, 1000, 900, 11)}`;
  return toJpeg(svg(1000, 1000, body));
}

function dashboard(): Promise<Buffer> {
  const bars = [41, 39, 40, 37, 36, 35, 34];
  const body = `
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1330"/><stop offset="1" stop-color="#1c1450"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#2f4bff"/><stop offset="1" stop-color="#2fc6d8"/></linearGradient>
    <radialGradient id="glow" cx=".8" cy=".1" r=".7"><stop offset="0" stop-color="#8a72ff" stop-opacity=".55"/><stop offset="1" stop-color="#8a72ff" stop-opacity="0"/></radialGradient></defs>
    <rect width="1280" height="800" fill="url(#bg)"/><rect width="1280" height="800" fill="url(#glow)"/>
    <rect x="80" y="80" width="1120" height="640" rx="28" fill="#ffffff" opacity=".07" stroke="#ffffff" stroke-opacity=".18"/>
    <rect x="130" y="130" width="260" height="22" rx="11" fill="#ffffff" opacity=".7"/>
    <rect x="130" y="170" width="160" height="14" rx="7" fill="#ffffff" opacity=".35"/>
    ${bars.map((v, i) => `<rect x="${170 + i * 140}" y="${640 - (v - 25) * 24}" width="80" height="${(v - 25) * 24}" rx="14" fill="url(#bar)" opacity="${0.6 + i * 0.06}"/>`).join('')}
    <path d="M 130 ${640 - (30 - 25) * 24} H 1150" stroke="#3fd6a0" stroke-width="4" stroke-dasharray="14 10"/>
    <circle cx="1100" cy="190" r="46" fill="#3fd6a0" opacity=".25"/><circle cx="1100" cy="190" r="22" fill="#3fd6a0"/>`;
  return toJpeg(svg(1280, 800, body));
}

function reportChart(): Promise<Buffer> {
  const sep = [44, 42, 43, 41, 40, 41, 39, 38];
  const oct = [41, 39, 38, 36, 35, 35, 34, 34];
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'} ${120 + i * 110} ${560 - (v - 30) * 30}`).join(' ');
  const body = `
    <rect width="1040" height="680" fill="#ffffff"/>
    <rect x="60" y="50" width="300" height="22" rx="11" fill="#1d2433" opacity=".85"/>
    <rect x="60" y="88" width="200" height="14" rx="7" fill="#8a93a6"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M 100 ${560 - i * 90} H 960" stroke="#e5e8ef" stroke-width="2"/>`).join('')}
    <path d="${line(sep)}" stroke="#b6bccb" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${line(oct)}" stroke="#2f4bff" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${oct.map((v, i) => `<circle cx="${120 + i * 110}" cy="${560 - (v - 30) * 30}" r="9" fill="#fff" stroke="#2f4bff" stroke-width="5"/>`).join('')}
    <rect x="720" y="610" width="40" height="10" rx="5" fill="#2f4bff"/><rect x="780" y="610" width="90" height="10" rx="5" fill="#8a93a6"/>
    <rect x="890" y="610" width="40" height="10" rx="5" fill="#b6bccb"/>`;
  return sharp(svg(1040, 680, body)).png().toBuffer();
}

function campusSunset(): Promise<Buffer> {
  let seed = 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const windows = Array.from({ length: 70 }, () => {
    const x = 180 + Math.floor(rnd() * 14) * 60;
    const y = 470 + Math.floor(rnd() * 5) * 52;
    return `<rect x="${x}" y="${y}" width="26" height="30" rx="3" fill="#ffd28a" opacity="${(0.55 + rnd() * 0.45).toFixed(2)}"/>`;
  }).join('');
  const body = `
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2a8f"/><stop offset=".45" stop-color="#e0607e"/><stop offset=".8" stop-color="#ffb547"/></linearGradient>
    <radialGradient id="sun" cx=".7" cy=".62" r=".25"><stop offset="0" stop-color="#fff3c4"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></radialGradient></defs>
    <rect width="1200" height="900" fill="url(#sky)"/><rect width="1200" height="900" fill="url(#sun)"/>
    <path d="M0 470 L120 470 L120 380 L300 380 L300 300 L360 250 L420 300 L420 380 L1020 380 L1020 430 L1200 430 L1200 900 L0 900 Z" fill="#1a1838"/>
    <rect x="130" y="440" width="900" height="300" fill="#231f4a"/>
    ${windows}
    <rect x="0" y="740" width="1200" height="160" fill="#14122b"/>
    ${[90, 330, 870, 1100].map((x) => `<circle cx="${x}" cy="700" r="70" fill="#0f1d1a"/><rect x="${x - 6}" y="700" width="12" height="60" fill="#0f1d1a"/>`).join('')}
    ${grain(1200, 900, 800, 17)}`;
  return toJpeg(svg(1200, 900, body));
}

// ---------------------------------------------------------------- PDF и звук

/** Маленький корректный PDF: заголовок и столбики — без шрифтов с кириллицей. */
export function reportPdf(): Buffer {
  const bars = [41, 39, 40, 37, 36, 35, 34];
  const content = [
    'BT /F1 22 Tf 56 770 Td (offix - Request handling time, week 42) Tj ET',
    'BT /F1 12 Tf 56 745 Td (Median: 34 min \\(was 41\\). Target: 30 min.) Tj ET',
    '0.18 0.29 1 rg',
    ...bars.map((v, i) => `${80 + i * 64} 420 40 ${(v - 25) * 16} re f`),
    '0.25 0.84 0.63 RG 2 w 60 500 m 540 500 l S',
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** «Речь»: гармоники основного тона, слоги с огибающей и паузы. Уровни — для волны. */
export function speechLike(seconds: number, seed = 1, rate = 16000): { pcm: Int16Array; levels: number[] } {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const n = Math.floor(seconds * rate);
  const pcm = new Int16Array(n);
  const sylls: { start: number; len: number; amp: number; f0: number }[] = [];
  let t = 0.15;
  while (t < seconds - 0.3) {
    const len = 0.12 + rnd() * 0.22;
    sylls.push({ start: t, len, amp: 0.25 + rnd() * 0.6, f0: 120 + rnd() * 70 });
    t += len + (rnd() < 0.18 ? 0.25 + rnd() * 0.35 : 0.03 + rnd() * 0.06);
  }
  for (const s of sylls) {
    const a = Math.floor(s.start * rate);
    const b = Math.min(n, Math.floor((s.start + s.len) * rate));
    for (let i = a; i < b; i++) {
      const p = (i - a) / (b - a);
      const env = Math.sin(Math.PI * p) ** 1.5;
      const tt = i / rate;
      const f = s.f0 * (1 + 0.04 * Math.sin(2 * Math.PI * 3 * tt));
      const v = Math.sin(2 * Math.PI * f * tt) * 0.6 + Math.sin(2 * Math.PI * 2 * f * tt) * 0.25 + Math.sin(2 * Math.PI * 3 * f * tt) * 0.12 + (rnd() - 0.5) * 0.04;
      pcm[i] = Math.max(-32767, Math.min(32767, Math.round(v * env * s.amp * 22000)));
    }
  }
  const chunk = Math.floor(n / 100);
  const levels: number[] = [];
  for (let i = 0; i + chunk <= n; i += chunk) {
    let sum = 0;
    for (let j = i; j < i + chunk; j++) sum += pcm[j]! * pcm[j]!;
    levels.push(Math.sqrt(sum / chunk) / 32768);
  }
  return { pcm, levels };
}

export function wav(pcm: Int16Array, rate = 16000): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
