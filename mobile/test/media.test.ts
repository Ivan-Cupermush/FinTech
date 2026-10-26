import { describe, expect, it } from 'vitest';
import { ALBUM_MAX, decodeWaveform, isWaveform, type Attachment, type ChatHistory, type ChatMessage } from '@offix/core';
import { applyChatEvent, optimisticMessage } from '../src/lib/chat-logic';
import { ApiError } from '../src/lib/client';
import {
  albumBatches,
  checkPicked,
  fileUri,
  fromDocumentAsset,
  fromImageAsset,
  gridCell,
  guessMime,
  isVisual,
  LevelTrack,
  mediaLine,
  nextRate,
  parseUpload,
  pickedKind,
  progressOf,
  rateLabel,
  uploadFields,
  viewerItems,
  type PickedFile,
} from '../src/lib/media';

const NOW = '2026-10-19T12:00:00.000Z';

const att = (id: string, over: Partial<Attachment> = {}): Attachment => ({
  id,
  kind: 'photo',
  name: `${id}.jpg`,
  mime: 'image/jpeg',
  size: 120_000,
  width: 1600,
  height: 1200,
  duration: null,
  waveform: null,
  url: `/api/v1/files/${id}/raw?e=1&u=u1&s=x`,
  thumb_url: `/api/v1/files/thumbs/${id}.jpg`,
  uploaded_by: 'u-anna',
  created_at: NOW,
  ...over,
});

const msg = (id: string, seq: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  chat_id: 'c1',
  seq,
  topic_id: null,
  kind: 'text',
  sender_id: 'u-anna',
  sender_name: 'Анна Королёва',
  text: null,
  created_at: NOW,
  edited_at: null,
  deleted: false,
  pinned: false,
  client_id: null,
  reply_to: null,
  external_reply: null,
  forwarded_from: null,
  reactions: [],
  poll: null,
  read: true,
  attachments: [],
  contact: null,
  listened: false,
  ...over,
});

const picked = (name: string, mime: string, size: number | null = 1000): PickedFile => ({ key: name, uri: `file:///cache/${name}`, name, mime, size });

describe('выбранные файлы', () => {
  it('фото из галереи: имя, тип и длительность видео в секундах', () => {
    const photo = fromImageAsset({ uri: 'file:///DCIM/IMG_0042.HEIC', fileName: 'IMG_0042.HEIC', type: 'image', width: 4032, height: 3024, fileSize: 2_000_000 }, 0);
    expect(photo).toMatchObject({ name: 'IMG_0042.HEIC', mime: 'image/heic', size: 2_000_000, width: 4032, height: 3024, duration: null });
    const video = fromImageAsset({ uri: 'file:///cache/ABC.mov', type: 'video', duration: 12_345 }, 1);
    expect(video).toMatchObject({ name: 'ABC.mov', mime: 'video/quicktime', duration: 12.3 });
    expect(video.key).not.toBe(photo.key);
  });

  it('без имени файла — понятное имя по порядку, у blob: имени не ищем', () => {
    expect(fromImageAsset({ uri: 'blob:http://localhost/1f2e', type: 'image' }, 2).name).toBe('photo-3.jpg');
    expect(fromImageAsset({ uri: 'content://media/external/video/91', type: 'video' }, 0)).toMatchObject({ name: 'video-1.mp4', mime: 'video/mp4' });
    expect(fromImageAsset({ uri: 'file:///x/%D1%81%D0%BC%D0%B5%D1%82%D0%B0.png' }, 0).name).toBe('смета.png');
  });

  it('документ: тип из ответа или по расширению', () => {
    expect(fromDocumentAsset({ uri: 'file:///Docs/a.xlsx', name: 'Отчёт.xlsx', size: 5000 }, 0)).toMatchObject({ name: 'Отчёт.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 5000 });
    expect(fromDocumentAsset({ uri: 'file:///Docs/b', name: 'b.pdf', mimeType: 'application/pdf' }, 0).mime).toBe('application/pdf');
    expect(guessMime('архив.неизвестно')).toBe('application/octet-stream');
  });

  it('запрещённые и слишком большие файлы не уходят, остальные — да', () => {
    const r = checkPicked([picked('скрипт.exe', 'application/x-msdownload'), picked('видео.mp4', 'video/mp4', 300 * 1024 * 1024), picked('акт.pdf', 'application/pdf')], 200);
    expect(r.ok.map((f) => f.name)).toEqual(['акт.pdf']);
    expect(r.problems).toEqual(['«скрипт.exe»: такой тип файла отправить нельзя', '«видео.mp4» больше 200 МБ']);
    // Размер неизвестен — решит сервер.
    expect(checkPicked([picked('a.jpg', 'image/jpeg', null)]).ok).toHaveLength(1);
  });

  it('«как файл» превращает фото в документ', () => {
    expect(pickedKind(picked('a.jpg', 'image/jpeg'))).toBe('photo');
    expect(pickedKind(picked('a.jpg', 'image/jpeg'), true)).toBe('file');
    expect(pickedKind(picked('b.mp4', 'video/mp4'))).toBe('video');
    expect(pickedKind(picked('c.docx', 'application/msword'))).toBe('file');
  });
});

describe('загрузка', () => {
  it('поля формы — как у сайта', () => {
    expect(uploadFields()).toEqual([]);
    expect(uploadFields({ asFile: true })).toEqual([['as_file', '1']]);
    expect(uploadFields({ kind: 'voice', waveform: '0,5,31', duration: 7.26, asFile: false })).toEqual([
      ['kind', 'voice'],
      ['waveform', '0,5,31'],
      ['duration', '7.3'],
    ]);
    expect(uploadFields({ kind: 'video_note', duration: Number.NaN, waveform: null })).toEqual([['kind', 'video_note']]);
  });

  it('ответ сервера разбирается из конверта, ошибки — понятным текстом', () => {
    expect(parseUpload<Attachment>(201, JSON.stringify({ data: att('a1') })).id).toBe('a1');
    const fail = (status: number, body: string) => {
      try {
        parseUpload(status, body);
      } catch (e) {
        return e as ApiError;
      }
      throw new Error('ожидали ошибку');
    };
    expect(fail(400, JSON.stringify({ error: { code: 'BLOCKED_TYPE', message: 'Такой тип файла отправить нельзя' } }))).toMatchObject({ status: 400, code: 'BLOCKED_TYPE', message: 'Такой тип файла отправить нельзя' });
    expect(fail(413, '<html>nginx</html>')).toMatchObject({ status: 413, message: 'Файл слишком большой' });
    expect(fail(0, '').isNetwork).toBe(true);
    expect(fail(500, '')).toMatchObject({ message: 'Файл не загрузился, попробуйте ещё раз' });
  });

  it('больше 10 файлов — несколько альбомов, подпись у последнего', () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const b = albumBatches(items, '  С объекта  ');
    expect(b.map((x) => x.items.length)).toEqual([ALBUM_MAX, ALBUM_MAX, 3]);
    expect(b.map((x) => x.caption)).toEqual(['', '', 'С объекта']);
    expect(albumBatches([], 'x')).toEqual([]);
  });

  it('адрес файла дополняется сервером из настроек входа', () => {
    expect(fileUri('http://192.168.1.5:4000/api/v1', '/api/v1/files/thumbs/a.jpg')).toBe('http://192.168.1.5:4000/api/v1/files/thumbs/a.jpg');
    expect(fileUri('https://offix.example/api/v1', 'https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
    expect(fileUri('https://offix.example/api/v1', 'file:///cache/a.jpg')).toBe('file:///cache/a.jpg');
    expect(fileUri('https://offix.example/api/v1', null)).toBeUndefined();
  });
});

describe('лента и просмотр', () => {
  const album = msg('m1', 1, { kind: 'media', attachments: [att('a1'), att('a2'), att('v1', { kind: 'video', mime: 'video/mp4' })] });
  const file = msg('m2', 2, { kind: 'media', attachments: [att('f1', { kind: 'file', name: 'акт.pdf' })] });
  const note = msg('m3', 3, { kind: 'video_note', attachments: [att('n1', { kind: 'video_note' })] });
  const gone = msg('m4', 4, { kind: 'media', deleted: true, attachments: [att('x1')] });
  const shot = msg('m5', 5, { kind: 'media', sender_name: 'Ольга', attachments: [att('p5')] });

  it('просмотр листает все фото и видео ленты; кружочки, файлы и удалённое — мимо', () => {
    const v = viewerItems([album, file, note, gone, shot], 'm1', 1);
    expect(v.items.map((i) => i.attachment.id)).toEqual(['a1', 'a2', 'v1', 'p5']);
    expect(v.index).toBe(1);
    expect(viewerItems([album, shot], 'm5', 0)).toMatchObject({ index: 3 });
    expect(v.items[3]).toMatchObject({ message_id: 'm5', sender_name: 'Ольга' });
    expect(isVisual(att('n', { kind: 'video_note' }))).toBe(false);
  });

  it('своё медиа видно сразу: вид сообщения — по вложению', () => {
    const base = { chatId: 'c1', topicId: null, me: { id: 'u-dir', name: 'Алексей' }, text: '', clientId: 'k', now: NOW };
    expect(optimisticMessage({ ...base, attachments: [att('a1')] })).toMatchObject({ kind: 'media', attachments: [{ id: 'a1' }], listened: false });
    expect(optimisticMessage({ ...base, attachments: [att('v', { kind: 'voice' })] }).kind).toBe('voice');
    expect(optimisticMessage({ ...base, attachments: [att('n', { kind: 'video_note' })] }).kind).toBe('video_note');
    expect(optimisticMessage({ ...base, contact: { id: 'u2', display_name: 'Ольга', position: null, avatar_url: null } })).toMatchObject({ kind: 'contact', contact: { id: 'u2' } });
    expect(optimisticMessage({ ...base, text: 'Привет' }).kind).toBe('text');
  });

  it('ответ на голосовое несёт подпись вложения', () => {
    const voice = msg('m6', 6, { kind: 'voice', attachments: [att('v', { kind: 'voice', name: 'voice.m4a' })] });
    const local = optimisticMessage({ chatId: 'c1', topicId: null, me: { id: 'u-dir', name: 'Алексей' }, text: 'Да', clientId: 'k2', now: NOW, replyTo: voice });
    expect(local.reply_to?.media).toEqual({ kind: 'voice', count: 1, name: 'voice.m4a' });
  });

  it('«прослушано» приходит событием, только если касается меня', () => {
    const h: ChatHistory = { messages: [msg('m1', 1, { kind: 'voice' }), msg('m2', 2, { kind: 'voice', sender_id: 'u-dir' })], has_before: false, has_after: false, my_last_read_seq: 2, others_read_seq: 2 };
    // Анна послушала моё — у меня отметка.
    const mine = applyChatEvent(h, null, 'message_listened', { chat_id: 'c1', message_id: 'm2', user_id: 'u-anna', sender_id: 'u-dir' }, 'u-dir');
    expect(mine.messages[1]!.listened).toBe(true);
    // Я послушал с другого устройства.
    expect(applyChatEvent(h, null, 'message_listened', { message_id: 'm1', user_id: 'u-dir', sender_id: 'u-anna' }, 'u-dir').messages[0]!.listened).toBe(true);
    // Чужое прослушивание чужого — не про меня.
    expect(applyChatEvent(h, null, 'message_listened', { message_id: 'm1', user_id: 'u-olga', sender_id: 'u-anna' }, 'u-dir')).toBe(h);
    expect(applyChatEvent(h, null, 'message_listened', { message_id: 'm1', user_id: 'u-olga', sender_id: 'u-anna' })).toBe(h);
  });
});

describe('голосовые', () => {
  it('скорость по кругу и подпись с запятой', () => {
    expect([nextRate(1), nextRate(1.5), nextRate(2), nextRate(3)]).toEqual([1.5, 2, 1, 1]);
    expect(rateLabel(1.5)).toBe('1,5×');
    expect(rateLabel(2)).toBe('2×');
  });

  it('прогресс не выходит за 0..1', () => {
    expect(progressOf(3, 6)).toBe(0.5);
    expect(progressOf(9, 6)).toBe(1);
    expect(progressOf(-1, 6)).toBe(0);
    expect(progressOf(3, 0)).toBe(0);
  });

  it('волна записи: громкость с микрофона → строка, которую примет сервер', () => {
    const t = new LevelTrack();
    for (const db of [-160, -50, -30, -5, null, undefined, -20]) t.push(db);
    expect(t.tail(4)).toHaveLength(4);
    expect(t.tail(10).slice(0, 3)).toEqual([0, 0, 0]);
    const wave = t.encode();
    expect(isWaveform(wave)).toBe(true);
    expect(Math.max(...decodeWaveform(wave))).toBe(1);
    expect(new LevelTrack().encode()).toBe('');
  });

  it('длинная запись сжимается до 100 столбиков', () => {
    const t = new LevelTrack();
    for (let i = 0; i < 1200; i++) t.push(-40 + (i % 30));
    expect(t.encode().split(',')).toHaveLength(100);
  });
});

describe('галерея', () => {
  it('плитки по три в ряд без дробных пикселей', () => {
    expect(gridCell(358, 3, 3)).toBe(117);
    expect(gridCell(0)).toBe(0);
  });

  it('строка «Медиа и файлы» в карточке чата', () => {
    const zero = { photos: 0, videos: 0, files: 0, voice: 0, video_notes: 0, links: 0, bytes: 0 };
    expect(mediaLine(zero)).toBe('Пока ничего — фото и файлы из переписки соберутся здесь');
    expect(mediaLine({ ...zero, photos: 10, videos: 2, files: 3, voice: 1, video_notes: 1, links: 21, bytes: 1_468_006 })).toBe('12 фото и видео · 3 файла · 2 голосовых · 21 ссылка · 1,4 МБ');
    expect(mediaLine({ ...zero, files: 1, voice: 1, bytes: 2048 })).toBe('1 файл · 1 голосовое · 2 КБ');
  });
});
