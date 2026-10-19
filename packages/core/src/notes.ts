/**
 * Заметки и база знаний: страницы в markdown — к цели или для всей
 * компании. Регламенты, договорённости, «как мы считаем KPI». Разметка
 * простая и безопасная: заголовки, списки, цитаты, код, жирный, курсив,
 * ссылки. Разбор — в ядре, клиенты рисуют блоки сами, без вставки HTML.
 */

export const NOTE_LIMITS = { title: 200, body: 50_000 } as const;

export interface NoteInput {
  title?: unknown;
  body?: unknown;
}

export interface NoteSummary {
  id: string;
  title: string;
  excerpt: string;
  goal_id: string | null;
  goal_title: string | null;
  author_name: string;
  updated_at: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  goal_id: string | null;
  goal_title: string | null;
  author_id: string;
  author_name: string;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
}

export function validateNote(n: NoteInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = typeof n.title === 'string' ? n.title.trim() : '';
  if (!title) errors.title = 'Введите заголовок';
  else if (title.length > NOTE_LIMITS.title) errors.title = `Заголовок — не длиннее ${NOTE_LIMITS.title} символов`;
  if (n.body !== undefined && n.body !== null) {
    if (typeof n.body !== 'string') errors.body = 'Текст должен быть строкой';
    else if (n.body.length > NOTE_LIMITS.body) errors.body = 'Заметка слишком длинная';
  }
  return errors;
}

// ——— Разметка ———

export type Inline = { kind: 'text' | 'bold' | 'italic' | 'code'; text: string } | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'checklist'; items: { done: boolean; inline: Inline[] }[] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

/** Только http(s) и mailto: «javascript:» и прочее в ссылку не превращаем. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

/** Строка → кусочки: `код`, **жирный**, *курсив*, [ссылка](https://…). */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const push = (kind: 'text' | 'bold' | 'italic' | 'code', text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (kind === 'text' && last?.kind === 'text') last.text += text;
    else out.push({ kind, text });
  };
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let pos = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    push('text', src.slice(pos, m.index));
    if (m[1] !== undefined) push('code', m[1]);
    else if (m[2] !== undefined) push('bold', m[2]);
    else if (m[3] !== undefined) push('italic', m[3]);
    else if (m[4] !== undefined) push('italic', m[4]);
    else {
      const href = safeHref(m[6]!);
      if (href) out.push({ kind: 'link', text: m[5]!, href });
      else push('text', m[5]!);
    }
    pos = m.index + m[0].length;
  }
  push('text', src.slice(pos));
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', inline: parseInline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    if (t.startsWith('```')) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith('```'); i++) code.push(lines[i]!);
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(t);
    if (h) {
      flush();
      blocks.push({ kind: 'heading', level: h[1]!.length as 1 | 2 | 3, inline: parseInline(h[2]!.trim()) });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }
    if (t.startsWith('>')) {
      flush();
      const q: string[] = [];
      for (; i < lines.length && lines[i]!.trim().startsWith('>'); i++) q.push(lines[i]!.trim().replace(/^>\s?/, ''));
      i--;
      blocks.push({ kind: 'quote', inline: parseInline(q.join(' ')) });
      continue;
    }
    const check = /^[-*]\s+\[( |x|X)\]\s+(.*)$/;
    if (check.test(t)) {
      flush();
      const items: { done: boolean; inline: Inline[] }[] = [];
      for (; i < lines.length && check.test(lines[i]!.trim()); i++) {
        const m = check.exec(lines[i]!.trim())!;
        items.push({ done: m[1] !== ' ', inline: parseInline(m[2]!) });
      }
      i--;
      blocks.push({ kind: 'checklist', items });
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/;
    const num = /^\d+[.)]\s+(.*)$/;
    if (bullet.test(t) || num.test(t)) {
      flush();
      const ordered = num.test(t);
      const re = ordered ? num : bullet;
      const items: Inline[][] = [];
      for (; i < lines.length && re.test(lines[i]!.trim()) && !check.test(lines[i]!.trim()); i++) items.push(parseInline(re.exec(lines[i]!.trim())![1]!));
      i--;
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    para.push(t);
  }
  flush();
  return blocks;
}

/** Конец фразы: если блок не закончен знаком препинания — ставим точку, чтобы блоки не слипались. */
const terminate = (s: string) => {
  const t = s.trim();
  return !t || /[.!?:;…]$/.test(t) ? t : `${t}.`;
};

/**
 * Текст без разметки — для поиска, превью и push. Блоки не слипаются:
 * между ними — точка, если блок не закончен знаком препинания, пункты
 * списка разделены « · ».
 */
export function plainText(md: string): string {
  const inl = (x: Inline[]) => x.map((i) => i.text).join('').trim();
  const list = (items: string[]) => items.filter(Boolean).map((i) => i.replace(/[.;]$/, '')).join(' · ');
  const parts = parseMarkdown(md)
    .map((b) => {
      switch (b.kind) {
        case 'heading':
        case 'paragraph':
        case 'quote':
          return inl(b.inline);
        case 'list':
          return list(b.items.map(inl));
        case 'checklist':
          return list(b.items.map((x) => inl(x.inline)));
        case 'code':
          return b.text;
        default:
          return '';
      }
    })
    .filter(Boolean);
  // Точку ставим между блоками, а не в конце: «коротко» остаётся «коротко».
  return parts
    .map((t, i) => (i < parts.length - 1 ? terminate(t) : t))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Отрывок для списка. С поиском — кусок вокруг первого совпадения, чтобы
 * было видно, почему заметка нашлась.
 */
export function noteExcerpt(md: string, query = '', max = 160): string {
  const text = plainText(md);
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  const start = Math.max(0, i - Math.floor((max - q.length) / 2));
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Слова запроса для поиска: каждое должно встретиться в заголовке или тексте. */
export function searchWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[%_\\]/g, ''))
    .filter((w) => w.length > 0)
    .slice(0, 8);
}
