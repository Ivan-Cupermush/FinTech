import { BookOpen, FileText, Info, Sparkles, ThumbsDown, ThumbsUp, Target } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { answerParts, type KnowledgeMessage, type KnowledgeSource } from '@offix/core';

/** Куда ведёт источник: статья — на статью, документ — на его страницу с текстом. */
export const sourceHref = (s: Pick<KnowledgeSource, 'kind' | 'id'>) => (s.id ? (s.kind === 'note' ? `/app/notes/${s.id}` : `/app/notes/docs/${s.id}`) : null);

function Cite({ n, source }: { n: number; source: KnowledgeSource | undefined }) {
  const href = source ? sourceHref(source) : null;
  if (!href) return <span className="kb-cite is-dead" aria-label={`Источник ${n} недоступен`}>{n}</span>;
  return (
    <Link className="kb-cite" to={href} aria-label={`Источник ${n}: ${source!.title}`} title={source!.title}>
      {n}
    </Link>
  );
}

/** Текст ответа: абзацы, а ссылки [n] — кнопки-источники. */
export function AnswerText({ content, sources }: { content: string; sources: KnowledgeSource[] }) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  return (
    <div className="kb-answer-text">
      {content
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i}>
            {answerParts(p).map((part, j) =>
              part.kind === 'text' ? (
                <Fragment key={j}>
                  {part.text.split('\n').map((line, k, all) => (
                    <Fragment key={k}>
                      {line}
                      {k < all.length - 1 && <br />}
                    </Fragment>
                  ))}
                </Fragment>
              ) : (
                <Cite key={j} n={part.n} source={byN.get(part.n)} />
              ),
            )}
          </p>
        ))}
    </div>
  );
}

export function SourceList({ sources }: { sources: KnowledgeSource[] }) {
  if (!sources.length) return null;
  return (
    <ol className="kb-sources" aria-label="Источники">
      {sources.map((s) => {
        const href = sourceHref(s);
        const Icon = s.kind === 'note' ? BookOpen : FileText;
        const body = (
          <>
            <span className="kb-src-n" aria-hidden>
              {s.n}
            </span>
            <span className="kb-src-body">
              <span className="kb-src-title">
                <Icon size={13} aria-hidden /> {s.title}
              </span>
              {s.goal_title && (
                <span className="kb-src-goal">
                  <Target size={11} aria-hidden /> {s.goal_title}
                </span>
              )}
              {s.excerpt && <span className="kb-src-excerpt">{s.excerpt}</span>}
            </span>
          </>
        );
        return (
          <li key={s.n}>
            {href ? (
              <Link to={href} className="kb-src">
                {body}
              </Link>
            ) : (
              <span className="kb-src is-dead">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const MODE_LABEL = { ai: 'Ответ ИИ по базе знаний — проверьте по источникам', extract: 'Цитаты из базы знаний', empty: null } as const;

/** Ответ помощника: текст со ссылками, источники, пометка, как получен, и оценка. */
export function AnswerCard({ message, onFeedback, busy }: { message: KnowledgeMessage; onFeedback?: (f: 'up' | 'down' | null) => void; busy?: boolean }) {
  const label = message.mode ? MODE_LABEL[message.mode] : null;
  return (
    <article className={`kb-a ${message.mode === 'empty' ? 'is-empty' : ''}`} aria-label="Ответ помощника">
      <span className="kb-orb" aria-hidden>
        <Sparkles size={15} />
      </span>
      <div className="kb-a-body">
        {label && <div className="kb-a-mode">{label}</div>}
        <AnswerText content={message.content} sources={message.sources} />
        {message.notice && (
          <div className="kb-a-notice" role="note">
            <Info size={14} aria-hidden /> {message.notice}
          </div>
        )}
        <SourceList sources={message.sources} />
        {onFeedback && message.mode !== 'empty' && (
          <div className="kb-a-foot">
            <span className="faint">Ответ помог?</span>
            <button type="button" className="kb-fb" aria-pressed={message.feedback === 'up'} aria-label="Полезный ответ" disabled={busy} onClick={() => onFeedback(message.feedback === 'up' ? null : 'up')}>
              <ThumbsUp size={15} />
            </button>
            <button type="button" className="kb-fb" aria-pressed={message.feedback === 'down'} aria-label="Ответ не помог" disabled={busy} onClick={() => onFeedback(message.feedback === 'down' ? null : 'down')}>
              <ThumbsDown size={15} />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
