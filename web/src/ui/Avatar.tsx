import { initials } from '@offix/core';
import type { CSSProperties } from 'react';
import { avatarHue } from '../lib/color';

export function Avatar({ name, size = 28, title }: { name: string; size?: number; title?: string }) {
  return (
    <span className="avatar" style={{ '--s': `${size}px`, '--h': avatarHue(name) } as CSSProperties} title={title ?? name} aria-hidden={!title}>
      {initials(name)}
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
