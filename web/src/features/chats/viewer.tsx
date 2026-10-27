import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatBytes, moscowTime, type Attachment } from '@offix/core';
import { fileSrc, openFile, useFileUrl } from '../../lib/files';
import { Avatar } from '../../ui/Avatar';

export interface ViewerItem {
  attachment: Attachment;
  message_id: string;
  sender_id: string | null;
  sender_name: string | null;
  created_at: string;
  /** Подпись вместо автора — для файлов задачи. */
  title?: string;
}

const dateLabel = (iso: string) => `${new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })} в ${moscowTime(iso)}`;

/**
 * Просмотр фото и видео во весь экран: тёмное стекло поверх чата, стрелки,
 * клавиатура и свайп, лента миниатюр у альбома. Пока грузится оригинал,
 * видно размытое превью.
 */
export function MediaViewer({ items, index: start, onClose, onJump }: { items: ViewerItem[]; index: number; onClose: () => void; onJump?: (messageId: string) => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(0, start), items.length - 1));
  const item = items[index];
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const go = (d: number) => setIndex((i) => Math.min(items.length - 1, Math.max(0, i + d)));

  useEffect(() => {
    closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', key, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key, true);
      document.body.style.overflow = overflow;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;
  const a = item.attachment;
  const down = (e: PointerEvent) => (swipe.current = { x: e.clientX, y: e.clientY });
  const up = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) onClose();
  };

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={a.kind === 'video' ? 'Просмотр видео' : 'Просмотр фото'}>
      <div className="viewer-bg" style={a.thumb_url ? { backgroundImage: `url("${fileSrc(a.thumb_url)}")` } : undefined} aria-hidden />
      <header className="viewer-top">
        <button
          type="button"
          className="viewer-who"
          onClick={() => {
            if (!onJump) return;
            onClose();
            onJump(item.message_id);
          }}
          disabled={!onJump}
          aria-label={onJump ? 'Показать в чате' : undefined}
        >
          {!item.title && <Avatar name={item.sender_name ?? 'Удалённый аккаунт'} id={item.sender_id} size={36} />}
          <span className="viewer-who-text">
            <b className="clip">{item.title ?? item.sender_name ?? 'Удалённый аккаунт'}</b>
            <span className="clip">{dateLabel(item.created_at)}</span>
          </span>
        </button>
        <span className="viewer-count">{items.length > 1 ? `${index + 1} из ${items.length}` : ''}</span>
        <div className="viewer-actions">
          <button type="button" onClick={() => void openFile(a, 'download')} aria-label={`Скачать, ${formatBytes(a.size)}`} title={`Скачать · ${formatBytes(a.size)}`}>
            <Download size={20} />
          </button>
          <button type="button" ref={closeBtn} onClick={onClose} aria-label="Закрыть">
            <X size={22} />
          </button>
        </div>
      </header>
      <div className="viewer-stage" onPointerDown={down} onPointerUp={up} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <Stage key={a.id} a={a} />
      </div>
      {index > 0 && (
        <button type="button" className="viewer-nav is-prev" onClick={() => go(-1)} aria-label="Предыдущее">
          <ChevronLeft size={28} />
        </button>
      )}
      {index < items.length - 1 && (
        <button type="button" className="viewer-nav is-next" onClick={() => go(1)} aria-label="Следующее">
          <ChevronRight size={28} />
        </button>
      )}
      {items.length > 1 && (
        <div className="viewer-strip" role="tablist" aria-label="Все снимки">
          {items.map((it, i) => (
            <button key={it.attachment.id} type="button" role="tab" aria-selected={i === index} aria-label={`${i + 1}`} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}>
              {it.attachment.thumb_url ? <img src={fileSrc(it.attachment.thumb_url)} alt="" loading="lazy" /> : <span />}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

function Stage({ a }: { a: Attachment }) {
  const src = useFileUrl(a);
  const [loaded, setLoaded] = useState(false);
  const ratio = a.width && a.height ? `${a.width} / ${a.height}` : undefined;
  if (a.kind === 'video')
    return <video className="viewer-media" src={src} poster={fileSrc(a.thumb_url)} controls autoPlay playsInline style={{ aspectRatio: ratio }} />;
  return (
    <span className={`viewer-photo ${loaded ? 'is-loaded' : ''}`} style={{ aspectRatio: ratio }}>
      {a.thumb_url && !loaded && <img className="viewer-media is-preview" src={fileSrc(a.thumb_url)} alt="" aria-hidden />}
      {src && <img className="viewer-media" src={src} alt={a.name} onLoad={() => setLoaded(true)} draggable={false} />}
    </span>
  );
}
