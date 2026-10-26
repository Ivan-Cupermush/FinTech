import { initials } from '@offix/core';
import { useState, type CSSProperties } from 'react';
import { useAvatarSrc } from '../lib/avatars';
import { avatarHue } from '../lib/color';

/** Фото, если человек его загрузил; иначе — инициалы его цвета. */
export function Avatar({ name, size = 28, title, id }: { name: string; size?: number; title?: string; id?: string | null }) {
  const src = useAvatarSrc(id, name);
  const [broken, setBroken] = useState<string | null>(null);
  const photo = src && broken !== src;
  return (
    <span className={`avatar ${photo ? 'has-photo' : ''}`} style={{ '--s': `${size}px`, '--h': avatarHue(name) } as CSSProperties} title={title ?? name} aria-hidden={!title}>
      {photo ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(src)} /> : initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 3, size = 26 }: { names: string[]; max?: number; size?: number }) {
  const shown = names.slice(0, max);
  return (
    <span className="avatar-stack" aria-label={names.join(', ')}>
      {shown.map((n) => (
        <Avatar key={n} name={n} size={size} />
      ))}
      {names.length > max && (
        <span className="avatar" style={{ '--s': `${size}px`, '--h': 0 } as CSSProperties}>
          +{names.length - max}
        </span>
      )}
    </span>
  );
}
