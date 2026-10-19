import { parseMarkdown, type Inline } from '@offix/core';

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((i, k) => {
        switch (i.kind) {
          case 'bold':
            return <strong key={k}>{i.text}</strong>;
          case 'italic':
            return <em key={k}>{i.text}</em>;
          case 'code':
            return <code key={k}>{i.text}</code>;
          case 'link':
            return (
              <a key={k} href={i.href} target="_blank" rel="noopener noreferrer">
                {i.text}
              </a>
            );
          default:
            return <span key={k}>{i.text}</span>;
        }
      })}
    </>
  );
}

/** Заметка в markdown: блоки разбирает ядро, HTML из текста не вставляется никогда. */
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  if (!blocks.length) return <p className="faint">Пустая заметка.</p>;
  return (
    <div className="md">
      {blocks.map((b, k) => {
        switch (b.kind) {
          case 'heading': {
            const H = (`h${b.level + 1}` as 'h2' | 'h3' | 'h4');
            return (
              <H key={k}>
                <Inlines items={b.inline} />
              </H>
            );
          }
          case 'paragraph':
            return (
              <p key={k}>
                <Inlines items={b.inline} />
              </p>
            );
          case 'quote':
            return (
              <blockquote key={k}>
                <Inlines items={b.inline} />
              </blockquote>
            );
          case 'code':
            return (
              <pre key={k}>
                <code>{b.text}</code>
              </pre>
            );
          case 'rule':
            return <hr key={k} />;
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul';
            return (
              <L key={k}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inlines items={it} />
                  </li>
                ))}
              </L>
            );
          }
          case 'checklist':
            return (
              <ul key={k} className="md-check">
                {b.items.map((it, j) => (
                  <li key={j} className={it.done ? 'done' : ''}>
                    <span className="md-box" aria-label={it.done ? 'Сделано' : 'Не сделано'} role="img" />
                    <span>
                      <Inlines items={it.inline} />
                    </span>
                  </li>
                ))}
              </ul>
            );
        }
      })}
    </div>
  );
}
