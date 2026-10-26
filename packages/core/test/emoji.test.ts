import { describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES, deleteLastSymbol, searchEmoji } from '../src/emoji';

describe('эмодзи', () => {
  it('разделы без повторов и пустых значков', () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThan(5);
    for (const c of EMOJI_CATEGORIES) {
      expect(c.emojis.length).toBeGreaterThan(0);
      expect(new Set(c.emojis).size).toBe(c.emojis.length);
      expect(c.emojis.every(Boolean)).toBe(true);
    }
  });

  it('поиск по-русски, начало слова, «ё» как «е»', () => {
    expect(searchEmoji('сердц')).toContain('❤️');
    expect(searchEmoji('огонь')).toContain('🔥');
    expect(searchEmoji('  ')).toEqual([]);
    expect(searchEmoji('е', 5)).toHaveLength(5);
  });

  it('стирание: составной эмодзи — целиком', () => {
    expect(deleteLastSymbol('ок 👍🏽')).toBe('ок ');
    expect(deleteLastSymbol('семья 👨‍👩‍👧')).toBe('семья ');
    expect(deleteLastSymbol('флаг 🇷🇺')).toBe('флаг ');
    expect(deleteLastSymbol('текст')).toBe('текс');
    expect(deleteLastSymbol('')).toBe('');
  });
});
