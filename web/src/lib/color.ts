/** Стабильный цвет аватара по имени — один человек всегда одного цвета. */
const HUES = [222, 262, 160, 28, 340, 196, 48, 290];
export function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}
