import { Download, FileText, Film, MessageCircle, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { albumLayout, decodeWaveform, fileExtension, formatBytes, formatClock, resample, type Attachment, type ContactCard } from '@offix/core';
import { fileSrc, freshUrl, openFile, useFileUrl } from '../../lib/files';
import { Avatar } from '../../ui/Avatar';
import './media.css';

/**
 * Вложения в пузыре: альбом из фото и видео по мозаике, файлы строками,
 * голосовое с волной, кружочек и карточка сотрудника. Превью приходят по
 * публичным случайным именам, оригиналы — по подписанным ссылкам.
 */

export const isVisual = (a: Attachment) => a.kind === 'photo' || a.kind === 'video';

const ALBUM_W = 400;
const ALBUM_H = 440;

/** Превью для сетки: у GIF — сам файл, чтобы двигался. */
function useCellSrc(a: Attachment) {
  const gif = a.mime === 'image/gif';
  const full = useFileUrl(a, gif || !a.thumb_url);
  return gif || !a.thumb_url ? (a.kind === 'photo' ? full : undefined) : fileSrc(a.thumb_url);
}

function AlbumCell({ a, style, onOpen, label }: { a: Attachment; style: CSSProperties; onOpen: () => void; label: string }) {
  const src = useCellSrc(a);
  const [loaded, setLoaded] = useState(false);
  return (
    <button type="button" className={`album-cell ${loaded ? 'is-loaded' : ''}`} style={style} onClick={(e) => (e.stopPropagation(), onOpen())} aria-label={label}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(true)} /> : <span className="album-blank">{a.kind === 'video' ? <Film size={28} /> : null}</span>}
      {a.kind === 'video' && (
        <>
          <span className="album-play" aria-hidden>
            <Play size={22} fill="currentColor" />
          </span>
          <span className="album-badge">{formatClock(a.duration)}</span>
        </>
      )}
    </button>
  );
}

export function Album({ items, onOpen }: { items: Attachment[]; onOpen: (index: number) => void }) {
  const layout = useMemo(() => albumLayout(items.map((a) => (a.width && a.height ? a.width / a.height : 1)), ALBUM_W, ALBUM_H, 3), [items]);
  return (
    <div className="album" style={{ '--w': `${Math.round(layout.width)}px`, '--ar': `${layout.width} / ${layout.height}` } as CSSProperties}>
      {items.map((a, i) => {
        const c = layout.cells[i]!;
        const style = { left: `${(c.x / layout.width) * 100}%`, top: `${(c.y / layout.height) * 100}%`, width: `${(c.w / layout.width) * 100}%`, height: `${(c.h / layout.height) * 100}%` };
        const label = `${a.kind === 'video' ? 'Видео' : 'Фото'}${items.length > 1 ? ` ${i + 1} из ${items.length}` : ''} — открыть`;
        return <AlbumCell key={a.id} a={a} style={style} onOpen={() => onOpen(i)} label={label} />;
      })}
    </div>
  );
}

/** Файл строкой: плитка с расширением (или превью), имя и размер; нажатие — скачать. */
export function FileRow({ a }: { a: Attachment }) {
  const ext = fileExtension(a.name).slice(0, 4).toUpperCase() || 'FILE';
  const [busy, setBusy] = useState(false);
  const download = async (e: MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await openFile(a, 'download');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="file-row">
      <button type="button" className={`file-tile ${a.thumb_url ? 'has-thumb' : ''}`} style={{ '--h': extHue(ext) } as CSSProperties} onClick={download} aria-label={`Скачать ${a.name}`} aria-busy={busy || undefined}>
        {a.thumb_url ? <img src={fileSrc(a.thumb_url)} alt="" loading="lazy" /> : <span className="file-ext">{ext}</span>}
        <span className="file-tile-dl" aria-hidden>
          <Download size={18} strokeWidth={2.4} />
        </span>
      </button>
      <span className="file-info">
        <button type="button" className="file-name clip" onClick={(e) => (e.stopPropagation(), void openFile(a, a.mime === 'application/pdf' || a.mime.startsWith('image/') ? 'open' : 'download'))} title={a.name}>
          {a.name}
        </button>
        <span className="file-meta">
          {formatBytes(a.size)} · {ext}
        </span>
      </span>
    </div>
  );
}

const extHue = (ext: string) => (/^(PDF)$/.test(ext) ? 4 : /^(DOC|DOCX|ODT|RTF|TXT)$/.test(ext) ? 220 : /^(XLS|XLSX|CSV|ODS)$/.test(ext) ? 145 : /^(PPT|PPTX|KEY|ODP)$/.test(ext) ? 24 : /^(ZIP|RAR|7Z|TAR|GZ)$/.test(ext) ? 280 : 250);

// ---------------------------------------------------------------- голосовое

let playing: HTMLMediaElement | null = null;
/** Одновременно звучит одна запись: новая останавливает прежнюю. */
function claim(el: HTMLMediaElement) {
  if (playing && playing !== el) playing.pause();
  playing = el;
}

const RATES = [1, 1.5, 2] as const;
const readRate = () => {
  try {
    const v = Number(localStorage.getItem('offix.voice-rate'));
    return (RATES as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
};

const BARS = 38;

export function Waveform({ levels, progress, onSeek, label }: { levels: number[]; progress: number; onSeek?: (f: number) => void; label: string }) {
  const bars = useMemo(() => resample(levels, BARS), [levels]);
  const seek = (e: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  return (
    <div
      className="wave"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={onSeek ? 0 : -1}
      onPointerDown={seek}
      onKeyDown={(e) => {
        if (!onSeek) return;
        if (e.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.05));
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.05));
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {bars.map((v, i) => (
        <i key={i} className={(i + 0.5) / BARS <= progress ? 'on' : ''} style={{ height: `${Math.round(3 + v * 21)}px` }} />
      ))}
    </div>
  );
}

export function VoicePlayer({ a, listened, mine, onListen }: { a: Attachment; listened: boolean; mine: boolean; onListen?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(readRate);
  const total = a.duration ?? 0;
  const levels = useMemo(() => decodeWaveform(a.waveform, a.id), [a.waveform, a.id]);
  const progress = total ? Math.min(1, time / total) : 0;

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);

  const play = async (from?: number) => {
    const el = audio.current;
    if (!el) return;
    const src = fileSrc(await freshUrl(a).catch(() => a.url))!;
    if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    if (from !== undefined && total) el.currentTime = from * total;
    el.playbackRate = rate;
    claim(el);
    try {
      await el.play();
    } catch {
      setOn(false);
      return;
    }
    if (!mine && !listened) onListen?.();
  };
  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (on) audio.current?.pause();
    else void play();
  };
  const nextRate = (e: MouseEvent) => {
    e.stopPropagation();
    const r = RATES[(RATES.indexOf(rate as (typeof RATES)[number]) + 1) % RATES.length]!;
    setRate(r);
    try {
      localStorage.setItem('offix.voice-rate', String(r));
    } catch {
      /* без сохранения */
    }
  };

  return (
    <div className={`voice ${on ? 'is-on' : ''}`}>
      <button type="button" className="voice-play" onClick={toggle} aria-label={on ? 'Пауза' : 'Слушать голосовое'}>
        {on ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
      <div className="voice-body">
        <Waveform levels={levels} progress={progress} label="Перемотка голосового" onSeek={(f) => (on && audio.current && total ? (audio.current.currentTime = f * total) : void play(f))} />
        <div className="voice-meta">
          <span>{on || time > 0 ? formatClock(time) : formatClock(total)}</span>
          {!listened && !mine && <span className="voice-dot" aria-label="Не прослушано" />}
          {on && (
            <button type="button" className="voice-rate" onClick={nextRate} aria-label={`Скорость ${rate}×`}>
              {String(rate).replace('.', ',')}×
            </button>
          )}
        </div>
      </div>
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setOn(true)}
        onPause={() => setOn(false)}
        onEnded={() => {
          setOn(false);
          setTime(0);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      />
    </div>
  );
}

// ---------------------------------------------------------------- кружочек

export function VideoNote({ a, listened, mine, onListen }: { a: Attachment; listened: boolean; mine: boolean; onListen?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const src = useFileUrl(a);
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const total = a.duration ?? 0;

  const start = async (e: MouseEvent) => {
    e.stopPropagation();
    const el = video.current;
    if (!el) return;
    if (active) {
      if (el.paused) {
        claim(el);
        void el.play();
      } else el.pause();
      return;
    }
    setActive(true);
    el.muted = false;
    el.loop = false;
    el.currentTime = 0;
    claim(el);
    try {
      await el.play();
      if (!mine && !listened) onListen?.();
    } catch {
      stop();
    }
  };
  const stop = () => {
    const el = video.current;
    setActive(false);
    setProgress(0);
    if (!el) return;
    el.muted = true;
    el.loop = true;
    void el.play().catch(() => undefined);
  };

  const R = 48;
  const C = 2 * Math.PI * R;
  return (
    <button type="button" className={`vnote ${active ? 'is-active' : ''}`} onClick={start} aria-label={active ? 'Пауза' : 'Смотреть видеосообщение'}>
      <video
        ref={video}
        src={src}
        poster={fileSrc(a.thumb_url)}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => active && total && setProgress(e.currentTarget.currentTime / total)}
        onEnded={stop}
      />
      <svg className="vnote-ring" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={R} style={{ strokeDasharray: C, strokeDashoffset: C * (1 - progress) }} />
      </svg>
      {!active && (
        <span className="vnote-badge">
          {formatClock(total)}
          {!listened && !mine && <span className="voice-dot" />}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- контакт

export function ContactView({ c, onWrite }: { c: ContactCard; onWrite: (c: ContactCard) => void }) {
  return (
    <div className="contact">
      <div className="contact-who">
        <Avatar name={c.display_name} id={c.id} size={46} />
        <span className="contact-text">
          <b className="clip">{c.display_name}</b>
          <span className="clip">{c.position ?? 'Сотрудник'}</span>
        </span>
      </div>
      <button type="button" className="contact-write" onClick={(e) => (e.stopPropagation(), onWrite(c))}>
        <MessageCircle size={15} aria-hidden /> Написать
      </button>
    </div>
  );
}

export function FileIcon({ name }: { name: string }) {
  const ext = fileExtension(name).slice(0, 4).toUpperCase();
  return (
    <span className="file-tile is-static" style={{ '--h': extHue(ext) } as CSSProperties} aria-hidden>
      {ext ? <span className="file-ext">{ext}</span> : <FileText size={20} />}
    </span>
  );
}
