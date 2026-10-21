import { useEffect, useState } from 'react';

/**
 * Эффекты (WebGL-градиент, 3D, жидкое стекло) — украшение, а не функция.
 * Если браузер не тянет WebGL или человек просит меньше движения,
 * показываем тот же образ статично: CSS-градиент и плоский знак.
 */
export function canUseWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function query(q: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : null;
}

export function useMediaQuery(q: string): boolean {
  const [match, setMatch] = useState(() => query(q)?.matches ?? false);
  useEffect(() => {
    const mq = query(q);
    if (!mq) return;
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [q]);
  return match;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** Тёмная ли сейчас тема с учётом ручного переключателя в приложении. */
export function useDarkTheme(): boolean {
  const system = useMediaQuery('(prefers-color-scheme: dark)');
  const [attr, setAttr] = useState(() => (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null));
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const el = document.documentElement;
    const mo = new MutationObserver(() => setAttr(el.getAttribute('data-theme')));
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return attr === 'dark' || (attr !== 'light' && system);
}

export type FxLevel = 'full' | 'calm' | 'static';

/**
 * full — всё живое; calm — WebGL есть, но без анимации (просьба о меньшем движении);
 * static — без WebGL, только CSS.
 */
export function fxLevel(webgl: boolean, reducedMotion: boolean): FxLevel {
  if (!webgl) return 'static';
  return reducedMotion ? 'calm' : 'full';
}

export function useFxLevel(): FxLevel {
  const reduced = useReducedMotion();
  const [webgl] = useState(canUseWebGL);
  return fxLevel(webgl, reduced);
}
