import { Paperclip, Play, X } from 'lucide-react';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { formatBytes, formatClock, type Attachment } from '@offix/core';
import { fileSrc } from '../../lib/files';
import type { PendingUpload } from '../../lib/useUploads';
import { FileRow, isVisual } from '../chats/media';
import { MediaViewer, type ViewerItem } from '../chats/viewer';
import './files.css';

/**
 * Вложения задачи или комментария: фото и видео — плиткой с просмотром во
 * весь экран, остальное — строками со скачиванием. Удаление — по праву.
 */
export function AttachmentList({ items, author, canRemove, onRemove, size = 'md' }: { items: Attachment[]; author?: { id: string | null; name: string }; canRemove?: (a: Attachment) => boolean; onRemove?: (a: Attachment) => void; size?: 'sm' | 'md' }) {
  const [view, setView] = useState<number | null>(null);
  const visual = items.filter(isVisual);
  const files = items.filter((a) => !isVisual(a));
  const viewer: ViewerItem[] = visual.map((a) => ({ attachment: a, message_id: a.id, sender_id: author?.id ?? null, sender_name: author?.name ?? null, created_at: a.created_at, title: author ? undefined : a.name }));
  if (!items.length) return null;
  const remove = (a: Attachment) =>
    onRemove && canRemove?.(a) ? (
      <button type="button" className="att-remove" onClick={() => onRemove(a)} aria-label={`Убрать ${a.name}`} title="Убрать файл">
        <X size={14} />
      </button>
    ) : null;
  return (
    <div className={`att-list is-${size}`}>
      {visual.length > 0 && (
        <div className="att-thumbs">
          {visual.map((a, i) => (
            <span key={a.id} className="att-thumb-wrap">
              <button type="button" className="att-thumb" onClick={() => setView(i)} aria-label={`${a.kind === 'video' ? 'Видео' : 'Фото'} ${a.name} — открыть`}>
                {a.thumb_url ? <img src={fileSrc(a.thumb_url)} alt="" loading="lazy" /> : <span className="att-thumb-blank" />}
                {a.kind === 'video' && (
                  <span className="album-badge">
                    <Play size={9} fill="currentColor" /> {formatClock(a.duration)}
                  </span>
                )}
              </button>
              {remove(a)}
            </span>
          ))}
        </div>
      )}
      {files.map((a) => (
        <div key={a.id} className="att-file">
          <FileRow a={a} />
          {remove(a)}
        </div>
      ))}
      {view !== null && <MediaViewer items={viewer} index={view} onClose={() => setView(null)} />}
    </div>
  );
}

/** Загружается: имя, размер и полоса прогресса; ошибку можно убрать. */
export function PendingList({ items, onDismiss }: { items: PendingUpload[]; onDismiss: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="att-pending" aria-label="Загрузка файлов">
      {items.map((x) => (
        <li key={x.key} className={x.error ? 'is-error' : ''} style={{ '--p': x.progress } as CSSProperties}>
          <span className="clip">{x.name}</span>
          <span className={x.error ? 'att-err' : 'faint num'}>{x.error ?? `${formatBytes(x.size)} · ${Math.round(x.progress * 100)}%`}</span>
          {x.error ? (
            <button type="button" onClick={() => onDismiss(x.key)} aria-label={`Убрать ${x.name}`}>
              <X size={13} />
            </button>
          ) : (
            <i aria-hidden />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Кнопка «Прикрепить» со скрытым выбором файлов; файлы можно и перетащить в зону. */
export function AttachButton({ onFiles, label = 'Прикрепить', disabled, children, variant = 'ghost' }: { onFiles: (files: File[]) => void; label?: string; disabled?: boolean; children?: ReactNode; variant?: 'ghost' | 'icon' }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={`att-add ${variant === 'icon' ? 'is-icon' : ''}`} onClick={() => input.current?.click()} disabled={disabled} aria-label={label} title={label}>
        <Paperclip size={16} aria-hidden />
        {variant !== 'icon' && (children ?? label)}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label={`${label}: выбор файлов`}
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (list.length) onFiles(list);
        }}
      />
    </>
  );
}

/** Зона, куда можно бросить файлы. */
export function useDropZone(onFiles: (files: File[]) => void, enabled = true) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  if (!enabled) return { over: false, props: {} };
  const has = (e: React.DragEvent) => !!e.dataTransfer?.types?.includes('Files');
  return {
    over,
    props: {
      onDragEnter: (e: React.DragEvent) => {
        if (!has(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (has(e)) e.preventDefault();
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (!files.length) return;
        e.preventDefault();
        onFiles(files);
      },
    },
  };
}
