import { describe, expect, it } from 'vitest';
import {
  ALBUM_MAX,
  albumLayout,
  avatarFor,
  buildAvatarDirectory,
  groupByDay,
  canEditMessage,
  dbToLevel,
  decodeWaveform,
  detectFileKind,
  encodeWaveform,
  extractLinks,
  fileExtension,
  fileLinkExpiry,
  fileLinkFresh,
  fileLinkPayload,
  formatBytes,
  formatClock,
  galleryTabOf,
  isBlockedFile,
  isMediaKind,
  isWaveform,
  linkHost,
  mediaLabel,
  messagePreview,
  parseFileLink,
  recordTimer,
  resample,
  safeFileName,
  summarizeAttachments,
  waveBars,
  WAVE_MAX,
  WAVE_SAMPLES,
} from '../src';

describe('вид файла', () => {
  it('расширение — в нижнем регистре, без точки и без пути', () => {
    expect(fileExtension('Отчёт.PDF')).toBe('pdf');
    expect(fileExtension('C:\\docs\\смета.xlsx')).toBe('xlsx');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
    expect(fileExtension('.bashrc')).toBe('');
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('file.')).toBe('');
    expect(fileExtension('x.verylongextension')).toBe('');
    expect(fileExtension(null)).toBe('');
  });

  it('страницы, скрипты и программы загрузить нельзя', () => {
    for (const name of ['page.html', 'logo.svg', 'a.JS', 'run.exe', 'setup.msi', 'x.bat', 'install.sh', 'feed.xml', 'virus.scr', 'macro.vbs'])
      expect(isBlockedFile(name), name).toBe(true);
    for (const name of ['photo.jpg', 'смета.xlsx', 'договор.docx', 'видео.mp4', 'голос.m4a', 'архив.zip', 'README', 'data.csv'])
      expect(isBlockedFile(name), name).toBe(false);
  });

  it('опасный тип ловится и без расширения', () => {
    expect(isBlockedFile('picture', 'image/svg+xml')).toBe(true);
    expect(isBlockedFile('page', 'text/html; charset=utf-8')).toBe(true);
    expect(isBlockedFile('notes', 'text/plain')).toBe(false);
  });

  it('фото, видео или документ — по типу и расширению', () => {
    expect(detectFileKind({ name: 'IMG_0001.JPG', mime: '' })).toBe('photo');
    expect(detectFileKind({ name: 'shot', mime: 'image/png' })).toBe('photo');
    expect(detectFileKind({ name: 'clip.mov' })).toBe('video');
    expect(detectFileKind({ name: 'clip', mime: 'video/mp4' })).toBe('video');
    expect(detectFileKind({ name: 'смета.xlsx', mime: 'application/vnd.ms-excel' })).toBe('file');
    expect(detectFileKind({ name: 'logo.svg', mime: 'image/svg+xml' })).toBe('file');
  });

  it('«отправить как файл» — всегда документ', () => {
    expect(detectFileKind({ name: 'IMG_0001.jpg', mime: 'image/jpeg' }, { asFile: true })).toBe('file');
    expect(detectFileKind({ name: 'clip.mp4', mime: 'video/mp4' }, { asFile: true })).toBe('file');
  });

  it('имя файла без пути и служебных символов', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\Анна\\отчёт.pdf')).toBe('отчёт.pdf');
    expect(safeFileName('a\u0000b<c>.txt')).toBe('abc.txt');
    expect(safeFileName('   ')).toBe('файл');
    expect(safeFileName('..')).toBe('файл');
    const long = safeFileName(`${'я'.repeat(400)}.docx`);
    expect(long.length).toBe(255);
    expect(long.endsWith('.docx')).toBe(true);
  });

  it('виды вложений', () => {
    expect(isMediaKind('voice')).toBe(true);
    expect(isMediaKind('sticker')).toBe(false);
    expect(galleryTabOf('photo')).toBe('media');
    expect(galleryTabOf('video')).toBe('media');
    expect(galleryTabOf('file')).toBe('files');
    expect(galleryTabOf('voice')).toBe('voice');
    expect(galleryTabOf('video_note')).toBe('voice');
  });
});

describe('размер и длительность', () => {
  it('размер по-русски', () => {
    expect(formatBytes(0)).toBe('0 Б');
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1536)).toBe('1,5 КБ');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 МБ');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1,3 ГБ');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 МБ');
    expect(formatBytes(-5)).toBe('0 Б');
  });

  it('длительность записи', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5.4)).toBe('0:05');
    expect(formatClock(750)).toBe('12:30');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(null)).toBe('0:00');
  });

  it('таймер записи с десятыми', () => {
    expect(recordTimer(0)).toBe('0:00,0');
    expect(recordTimer(5_340)).toBe('0:05,3');
    expect(recordTimer(65_000)).toBe('1:05,0');
    expect(recordTimer(-10)).toBe('0:00,0');
  });
});

describe('волна голосового', () => {
  it('громкость в дБ → 0..1', () => {
    expect(dbToLevel(-160)).toBe(0);
    expect(dbToLevel(-50)).toBe(0);
    expect(dbToLevel(-5)).toBe(1);
    expect(dbToLevel(0)).toBe(1);
    expect(dbToLevel(Number.NaN)).toBe(0);
    expect(dbToLevel(-27.5)).toBeCloseTo(0.5);
  });

  it('пересэмплирование сохраняет пики', () => {
    expect(resample([0, 1, 0, 0, 0, 0], 3)).toEqual([1, 0, 0]);
    expect(resample([0.2, 0.4], 4)).toEqual([0.2, 0.2, 0.4, 0.4]);
    expect(resample([], 3)).toEqual([0, 0, 0]);
    expect(resample([1], 0)).toEqual([]);
  });

  it('кодирование: до 100 столбиков 0..31, по пику', () => {
    const raw = encodeWaveform(Array.from({ length: 500 }, (_, i) => (i % 50) / 100));
    const parts = raw.split(',').map(Number);
    expect(parts).toHaveLength(WAVE_SAMPLES);
    expect(Math.max(...parts)).toBe(WAVE_MAX);
    expect(Math.min(...parts)).toBeGreaterThanOrEqual(0);
    expect(isWaveform(raw)).toBe(true);
  });

  it('тишина не раздувается до полной громкости', () => {
    const raw = encodeWaveform([0.01, 0.02, 0.01]);
    expect(Math.max(...raw.split(',').map(Number))).toBeLessThan(WAVE_MAX / 2);
  });

  it('мусор в уровнях не ломает кодирование', () => {
    expect(encodeWaveform([])).toBe('');
    expect(encodeWaveform([Number.NaN, 2, -1])).toBe('0,31,0');
  });

  it('туда и обратно', () => {
    const levels = [0, 0.25, 0.5, 1];
    const back = decodeWaveform(encodeWaveform(levels));
    expect(back).toHaveLength(4);
    back.forEach((v, i) => expect(v).toBeCloseTo(levels[i]!, 1));
  });

  it('без волны — своя спокойная волна у каждого сообщения', () => {
    const a = decodeWaveform(null, 'msg-1');
    const b = decodeWaveform('', 'msg-1');
    const c = decodeWaveform(null, 'msg-2');
    expect(a).toHaveLength(48);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(Math.max(...a)).toBeLessThanOrEqual(0.4);
  });

  it('проверка волны от клиента', () => {
    expect(isWaveform('0,5,31')).toBe(true);
    expect(isWaveform('0,5,32')).toBe(false);
    expect(isWaveform('0,,1')).toBe(false);
    expect(isWaveform('1,2,abc')).toBe(false);
    expect(isWaveform(Array(101).fill(1).join(','))).toBe(false);
    expect(isWaveform('')).toBe(false);
    expect(isWaveform(5)).toBe(false);
    expect(decodeWaveform('0,99,1', 's')).toHaveLength(48);
  });

  it('столбиков — по ширине', () => {
    expect(waveBars(200)).toBe(40);
    expect(waveBars(10)).toBe(8);
    expect(waveBars(5000)).toBe(WAVE_SAMPLES);
  });
});

describe('раскладка альбома', () => {
  const inside = (l: ReturnType<typeof albumLayout>, W: number) => {
    for (const c of l.cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(W + 0.5);
      expect(c.y + c.h).toBeLessThanOrEqual(l.height + 0.5);
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
    }
  };

  it('пусто', () => {
    expect(albumLayout([], 400, 400)).toEqual({ cells: [], width: 0, height: 0 });
  });

  it('один снимок — по своим пропорциям, высокий ограничен', () => {
    expect(albumLayout([2], 400, 400)).toEqual({ cells: [{ x: 0, y: 0, w: 400, h: 200 }], width: 400, height: 200 });
    const tall = albumLayout([0.5], 400, 420);
    expect(tall.height).toBe(420);
    expect(tall.width).toBeCloseTo(220);
  });

  it('два: рядом одной высоты, широкие — друг под другом', () => {
    const side = albumLayout([1, 1], 402, 400);
    expect(side.cells).toHaveLength(2);
    expect(side.cells[0]!.h).toBe(side.cells[1]!.h);
    expect(side.cells[1]!.x).toBe(side.cells[0]!.w + 2);
    inside(side, 402);
    const stacked = albumLayout([2, 2], 400, 600);
    expect(stacked.cells[1]!.y).toBeGreaterThan(stacked.cells[0]!.y);
    expect(stacked.cells[0]!.w).toBe(400);
  });

  it('три — большой слева и два справа', () => {
    const l = albumLayout([1, 1, 1], 400, 400);
    expect(l.cells[0]!.h).toBe(l.height);
    expect(l.cells[1]!.x).toBe(l.cells[2]!.x);
    inside(l, 400);
  });

  it('четыре — 2×2, десять — строками, всё внутри', () => {
    const four = albumLayout([1, 1, 1, 1], 400, 400);
    expect(new Set(four.cells.map((c) => c.y)).size).toBe(2);
    for (let n = 4; n <= ALBUM_MAX; n++) {
      const l = albumLayout(Array(n).fill(1.3), 400, 600);
      expect(l.cells).toHaveLength(n);
      inside(l, 400);
    }
  });

  it('странные пропорции не ломают сетку', () => {
    const l = albumLayout([0, Number.NaN, 50], 300, 300);
    expect(l.cells).toHaveLength(3);
    inside(l, 300);
  });
});

describe('подписанные ссылки', () => {
  const id = '0b8d9c52-1111-4222-8333-944455556666';

  it('строка для подписи включает файл, срок и человека', () => {
    expect(fileLinkPayload(id, 1700000000, 'u1')).toBe(`file:${id}:1700000000:u1`);
  });

  it('срок — на границе десятиминутки, от 10 до 20 минут вперёд', () => {
    const now = Date.parse('2026-10-19T12:03:00Z');
    const exp = fileLinkExpiry(now);
    expect(exp % 600).toBe(0);
    expect(exp * 1000 - now).toBeGreaterThanOrEqual(600_000);
    expect(exp * 1000 - now).toBeLessThanOrEqual(1_200_000);
    // В пределах одной десятиминутки ссылка одна и та же — браузер её кэширует.
    expect(fileLinkExpiry(now + 60_000)).toBe(exp);
  });

  it('разбор и свежесть', () => {
    const url = `/api/v1/files/${id}/raw?e=1700000600&u=u1&s=abc`;
    expect(parseFileLink(url)).toEqual({ id, exp: 1700000600 });
    expect(parseFileLink(`https://offix.example${url}`)).toEqual({ id, exp: 1700000600 });
    expect(parseFileLink('/api/v1/files/avatars/x.jpg')).toBeNull();
    expect(parseFileLink(null)).toBeNull();
    expect(fileLinkFresh(url, 1700000000_000)).toBe(true);
    expect(fileLinkFresh(url, 1700000560_000)).toBe(false); // меньше минуты запаса
    expect(fileLinkFresh('/api/v1/files/thumbs/abc.jpg', Date.now())).toBe(true);
    expect(fileLinkFresh(null, Date.now())).toBe(false);
  });
});

describe('подписи вложений', () => {
  it('одно и несколько', () => {
    expect(mediaLabel({ kind: 'photo', count: 1, name: 'a.jpg' })).toBe('📷 Фото');
    expect(mediaLabel({ kind: 'photo', count: 3, name: 'a.jpg' })).toBe('🖼 3 фото');
    expect(mediaLabel({ kind: 'video', count: 1, name: 'a.mp4' })).toBe('🎬 Видео');
    expect(mediaLabel({ kind: 'file', count: 1, name: 'смета.xlsx' })).toBe('📎 смета.xlsx');
    expect(mediaLabel({ kind: 'file', count: 4, name: 'a' })).toBe('📎 4 файла');
    expect(mediaLabel({ kind: 'file', count: 5, name: 'a' })).toBe('📎 5 файлов');
    expect(mediaLabel({ kind: 'voice', count: 1, name: null })).toBe('🎤 Голосовое сообщение');
    expect(mediaLabel({ kind: 'video_note', count: 1, name: null })).toBe('⚪ Видеосообщение');
    expect(mediaLabel({ kind: 'contact', count: 1, name: 'Анна Смирнова' })).toBe('👤 Анна Смирнова');
  });

  it('сводка альбома', () => {
    expect(summarizeAttachments([])).toBeNull();
    expect(summarizeAttachments([{ kind: 'photo', name: 'a.jpg' }, { kind: 'photo', name: 'b.jpg' }])).toEqual({ kind: 'photo', count: 2, name: 'a.jpg' });
    expect(summarizeAttachments([{ kind: 'photo', name: 'a.jpg' }, { kind: 'video', name: 'b.mp4' }])).toEqual({ kind: 'video', count: 2, name: 'a.jpg' });
    expect(summarizeAttachments([{ kind: 'photo', name: 'a.jpg' }, { kind: 'file', name: 'b.pdf' }])?.kind).toBe('file');
  });

  it('превью в списке чатов', () => {
    const base = { kind: 'media' as const, text: null, deleted: false, sender_id: 'u2', sender_name: 'Анна Смирнова' };
    expect(messagePreview({ ...base, media: { kind: 'photo', count: 1, name: 'a.jpg' } }, 'u1', false)).toBe('📷 Фото');
    expect(messagePreview({ ...base, text: 'Смета на ноябрь', media: { kind: 'photo', count: 1, name: 'a.jpg' } }, 'u1', false)).toBe('📷 Смета на ноябрь');
    expect(messagePreview({ ...base, text: 'С выезда', media: { kind: 'photo', count: 3, name: 'a.jpg' } }, 'u1', true)).toBe('Анна: 🖼 3 фото, С выезда');
    expect(messagePreview({ ...base, kind: 'voice', media: { kind: 'voice', count: 1, name: null } }, 'u2', false)).toBe('Вы: 🎤 Голосовое сообщение');
    expect(messagePreview({ ...base, kind: 'contact', media: { kind: 'contact', count: 1, name: 'Игорь' } }, 'u1', false)).toBe('👤 Игорь');
    expect(messagePreview({ ...base, deleted: true, media: { kind: 'photo', count: 1, name: null } }, 'u1', false)).toBe('Сообщение удалено');
  });

  it('подпись к медиа можно поправить, голосовое — нет', () => {
    const now = '2026-10-19T12:00:00Z';
    const m = { sender_id: 'u1', deleted: false, created_at: '2026-10-19T11:00:00Z' };
    expect(canEditMessage({ ...m, kind: 'media' }, 'u1', now)).toBe(true);
    expect(canEditMessage({ ...m, kind: 'voice' }, 'u1', now)).toBe(false);
    expect(canEditMessage({ ...m, kind: 'contact' }, 'u1', now)).toBe(false);
  });
});

describe('ссылки в тексте', () => {
  it('находит и чистит хвост', () => {
    expect(extractLinks('Смотри https://offix.ru/plan, и http://example.com/a?b=1.')).toEqual(['https://offix.ru/plan', 'http://example.com/a?b=1']);
    expect(extractLinks('(https://ru.wikipedia.org/wiki/KPI_(значения))')).toEqual(['https://ru.wikipedia.org/wiki/KPI_(значения)']);
    expect(extractLinks('«https://offix.ru/x»')).toEqual(['https://offix.ru/x']);
    expect(extractLinks('два раза https://a.ru/1 и https://a.ru/1')).toEqual(['https://a.ru/1']);
    expect(extractLinks('нет ссылок, ftp://x.ru')).toEqual([]);
    expect(extractLinks(null)).toEqual([]);
  });

  it('домен ссылки', () => {
    expect(linkHost('https://www.offix.ru/plan?x=1')).toBe('offix.ru');
    expect(linkHost('http://user:pw@Docs.Example.com:8080/a')).toBe('docs.example.com');
    expect(linkHost('не ссылка')).toBe('не ссылка');
  });
});

describe('справочник фото', () => {
  const list = [
    { id: 'u1', display_name: 'Анна Смирнова', avatar_url: '/api/v1/files/avatars/1.jpg' },
    { id: 'u2', display_name: 'анна смирнова ', avatar_url: '/api/v1/files/avatars/2.jpg' },
    { id: 'u3', display_name: 'Олег Ким', avatar_url: '/api/v1/files/avatars/3.jpg' },
    { id: 'u4', display_name: 'Без фото', avatar_url: '' },
  ];

  it('по id — всегда, по имени — только у единственного носителя', () => {
    const dir = buildAvatarDirectory(list);
    expect(avatarFor(dir, 'u2')).toBe('/api/v1/files/avatars/2.jpg');
    expect(avatarFor(dir, null, 'Анна Смирнова')).toBeUndefined();
    expect(avatarFor(dir, null, ' олег КИМ ')).toBe('/api/v1/files/avatars/3.jpg');
    expect(avatarFor(dir, 'u4', 'Без фото')).toBeUndefined();
    // Если id известен, имя не подменяет его чужим фото.
    expect(avatarFor(dir, 'u9', 'Олег Ким')).toBeUndefined();
  });

  it('адрес можно дополнить сервером', () => {
    const dir = buildAvatarDirectory(list, (u) => `https://offix.example${u}`);
    expect(dir.byId.get('u3')).toBe('https://offix.example/api/v1/files/avatars/3.jpg');
  });
});

describe('галерея по дням', () => {
  it('группирует подряд идущие элементы одного московского дня', () => {
    const now = '2026-10-19T12:00:00.000Z';
    const items = [
      { id: 'a', created_at: '2026-10-19T09:00:00.000Z' },
      { id: 'b', created_at: '2026-10-18T22:30:00.000Z' }, // 01:30 по Москве — уже 19-е
      { id: 'c', created_at: '2026-10-18T10:00:00.000Z' },
      { id: 'd', created_at: '2025-03-02T10:00:00.000Z' },
    ];
    const g = groupByDay(items, now);
    expect(g.map((x) => [x.label, x.items.map((i) => i.id).join('')])).toEqual([
      ['Сегодня', 'ab'],
      ['Вчера', 'c'],
      ['2 марта 2025', 'd'],
    ]);
    expect(groupByDay([], now)).toEqual([]);
  });
});
