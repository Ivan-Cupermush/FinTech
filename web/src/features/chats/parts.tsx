import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { highlightRanges, initials } from '@offix/core';
import { useAvatarSrc } from '../../lib/avatars';
import { avatarHue } from '../../lib/color';

/** Аватар чата: человек — его фото или инициалы его цвета, группа — стеклянная плитка с градиентом. */
export function ChatAvatar({ title, group, online, size = 48, icon, userId }: { title: string; group?: boolean; online?: boolean; size?: number; icon?: ReactNode; userId?: string | null }) {
  const hue = avatarHue(title);
  const src = useAvatarSrc(group || icon ? null : userId, group || icon ? null : title);
  return (
    <span className={`chat-ava ${group ? 'is-group' : ''} ${src ? 'has-photo' : ''}`} style={{ '--s': `${size}px`, '--h': hue } as CSSProperties} aria-hidden>
      <span className="chat-ava-face">{icon ?? (src ? <img src={src} alt="" loading="lazy" decoding="async" /> : initials(title))}</span>
      {online && <span className="chat-ava-online" />}
    </span>
  );
}

/** Галочки своего сообщения: отправляется, доставлено, прочитано, не ушло. */
export function Ticks({ read, sending, failed }: { read: boolean; sending?: boolean; failed?: boolean }) {
  if (failed) return <AlertCircle size={14} className="tick tick-failed" aria-label="Не отправлено" />;
  if (sending) return <Clock size={13} className="tick" aria-label="Отправляется" />;
  return read ? <CheckCheck size={15} className="tick tick-read" aria-label="Прочитано" /> : <Check size={15} className="tick" aria-label="Отправлено" />;
}

const URL_RE = /(https?:\/\/[^\s<>«»"]+[^\s<>«»".,;:!?)\]])/g;

/** Текст сообщения: ссылки кликабельны, найденное подсвечено. HTML не исполняется — только текст. */
export function RichText({ text, highlight }: { text: string; highlight?: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{highlight ? <Highlighted text={p} q={highlight} /> : p}</Fragment>
        ),
      )}
    </>
  );
}

export function Highlighted({ text, q }: { text: string; q: string }) {
  const ranges = highlightRanges(text, q);
  if (!ranges.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * Всплывающее меню у кнопки или у точки клика. Рисуется в body поверх всего —
 * поэтому плотное, а не стеклянное: размытие внутри стеклянного окна не работает.
 */
export function Popover({ anchor, onClose, children, align = 'end', label, className = '' }: { anchor: DOMRect | { x: number; y: number }; onClose: () => void; children: ReactNode; align?: 'start' | 'end'; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = 'width' in anchor ? anchor : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    let left = align === 'end' ? r.right - w : r.left;
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    left = Math.min(Math.max(8, left), vw - w - 8);
    setPos({ left, top });
  }, [anchor, align]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', down), 0);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', onClose);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className={`chat-pop ${className}`} role="dialog" aria-label={label} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

export function Menu({ items, ...rest }: { items: (MenuItem | false | null | undefined)[]; anchor: DOMRect | { x: number; y: number }; onClose: () => void; label: string; align?: 'start' | 'end' }) {
  const list = items.filter(Boolean) as MenuItem[];
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <Popover {...rest} className="chat-menu">
      <div role="menu" aria-label={rest.label}>
        {list.map((it, i) => (
          <button
            key={it.label}
            ref={i === 0 ? first : undefined}
            type="button"
            role="menuitem"
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              rest.onClose();
              it.onSelect();
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}

/** «Печатает…» — три точки волной. */
export function TypingDots() {
  return (
    <span className="typing-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

