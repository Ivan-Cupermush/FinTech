/**
 * Обсуждение цели и задачи: ветка комментариев с ответами и @упоминаниями.
 * Упоминание хранится обычным текстом «@Имя Фамилия» — так комментарий
 * читается в push, письме и «Входящих» без разметки. Кого упомянули, сервер
 * определяет сам по списку сотрудников, поэтому подделать упоминание
 * человека, который не видит цель, нельзя: его просто не уведомят.
 */

export const DISCUSSION_ENTITIES = ['goal', 'task'] as const;
export type DiscussionEntity = (typeof DISCUSSION_ENTITIES)[number];

export function isDiscussionEntity(v: unknown): v is DiscussionEntity {
  return (DISCUSSION_ENTITIES as readonly unknown[]).includes(v);
}

export const COMMENT_MAX = 4000;

export interface DiscussionComment {
  id: string;
  parent_id: string | null;
  body: string;
  author_id: string;
  author_name: string;
  mention_ids: string[];
  created_at: string;
}

export interface Discussion {
  comments: DiscussionComment[];
  /** Сколько чужих комментариев появилось после последнего прочтения. */
  unread: number;
  last_read_at: string | null;
  can_comment: boolean;
  /** Кого упомянули — для подсветки «@Имя». */
  people: { id: string; display_name: string }[];
}

export interface DiscussionSummary {
  total: number;
  unread: number;
}

export function validateComment(body: unknown): string | null {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return 'Напишите комментарий';
  if (text.length > COMMENT_MAX) return `Комментарий — не длиннее ${COMMENT_MAX} символов`;
  return null;
}

/** Буква, цифра или дефис: «@Анна» в «@Анне» не считаем упоминанием «Анна». */
const WORD = /[\p{L}\p{N}_-]/u;

/**
 * Кого упомянули: ищем «@Имя Фамилия» по списку людей. Длинные имена —
 * раньше коротких, чтобы «@Анна Королёва» не стала упоминанием «Анна».
 */
export function extractMentions(body: string, people: readonly { id: string; display_name: string }[]): string[] {
  const ids: string[] = [];
  for (const s of splitMentions(body, people)) if (s.mention && !ids.includes(s.mention)) ids.push(s.mention);
  return ids;
}

export type MentionSegment = { text: string; mention?: string };

/** Текст на куски: обычный и «@Имя» — для подсветки упоминаний при показе. */
export function splitMentions(body: string, people: readonly { id: string; display_name: string }[]): MentionSegment[] {
  const lower = body.toLowerCase();
  const hits: { start: number; end: number; id: string }[] = [];
  const sorted = [...people].filter((p) => p.display_name.trim()).sort((a, b) => b.display_name.length - a.display_name.length);
  for (const p of sorted) {
    const needle = `@${p.display_name.trim().toLowerCase()}`;
    let from = 0;
    for (let i = lower.indexOf(needle, from); i >= 0; i = lower.indexOf(needle, from)) {
      const end = i + needle.length;
      from = end;
      const before = i > 0 ? lower[i - 1]! : ' ';
      const after = end < lower.length ? lower[end]! : ' ';
      if (WORD.test(before) || WORD.test(after) || hits.some((h) => i < h.end && end > h.start)) continue;
      hits.push({ start: i, end, id: p.id });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: MentionSegment[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) out.push({ text: body.slice(pos, h.start) });
    out.push({ text: body.slice(h.start, h.end), mention: h.id });
    pos = h.end;
  }
  if (pos < body.length) out.push({ text: body.slice(pos) });
  return out;
}

/**
 * Что человек набирает после «@» у курсора: «@Ол» → «Ол». Нужен, чтобы
 * показать подсказку с сотрудниками. null — подсказка не нужна.
 */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const head = text.slice(0, caret);
  const at = head.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && WORD.test(head[at - 1]!)) return null;
  const query = head.slice(at + 1);
  // Имя и фамилия — до двух слов; перевод строки или третий пробел закрывают подсказку.
  if (/\n/.test(query) || query.split(' ').length > 2 || query.length > 40) return null;
  return { query, start: at };
}

/** Подставить «@Имя Фамилия » вместо набранного «@Ол». */
export function insertMention(text: string, caret: number, name: string): { text: string; caret: number } {
  const m = mentionQuery(text, caret);
  if (!m) return { text, caret };
  const insert = `@${name} `;
  const next = text.slice(0, m.start) + insert + text.slice(caret).replace(/^ /, '');
  return { text: next, caret: m.start + insert.length };
}

/** Подсказка: сотрудники, чьё имя или фамилия начинается с набранного. */
export function mentionSuggestions<T extends { display_name: string }>(people: readonly T[], query: string, limit = 6): T[] {
  const q = query.trim().toLowerCase().replace(/ё/g, 'е');
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
  return people
    .filter((p) => {
      if (!q) return true;
      const name = norm(p.display_name);
      return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
    })
    .slice(0, limit);
}

export interface ThreadNode {
  comment: DiscussionComment;
  replies: DiscussionComment[];
}

/**
 * Ветка: комментарии верхнего уровня по времени, ответы — под своим
 * комментарием одним уровнем (ответ на ответ попадает к корню), как в
 * обсуждениях на работе, а не бесконечной лесенкой.
 */
export function buildThread(comments: readonly DiscussionComment[]): ThreadNode[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: DiscussionComment): string => {
    let cur = c;
    const seen = new Set<string>();
    while (cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_id)!;
    }
    return cur.id;
  };
  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const nodes = new Map<string, ThreadNode>();
  for (const c of sorted) {
    const root = rootOf(c);
    if (root === c.id) nodes.set(c.id, { comment: c, replies: [] });
  }
  for (const c of sorted) {
    const root = rootOf(c);
    if (root !== c.id) nodes.get(root)?.replies.push(c);
  }
  return [...nodes.values()];
}

/** Новые для человека: чужие комментарии после последнего прочтения. */
export function unreadCount(comments: readonly Pick<DiscussionComment, 'author_id' | 'created_at'>[], me: string, lastReadAt: string | null): number {
  return comments.filter((c) => c.author_id !== me && (!lastReadAt || c.created_at > lastReadAt)).length;
}

/** Короткая цитата комментария для уведомления и push. */
export function commentPreview(body: string, max = 180): string {
  const one = body.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}
