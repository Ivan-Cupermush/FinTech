import { ArrowLeft, ArrowUp, MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { KNOWLEDGE_LIMITS, KNOWLEDGE_SUGGESTIONS, formatDate, todayIso, validateQuestion, type KnowledgeMessage, type KnowledgeStatus } from '@offix/core';
import { api } from '../../lib/api';
import { PageHero } from '../../ui/fx/PageHero';
import { Button } from '../../ui/Button';
import { Empty, Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { AnswerCard } from './Answer';
import { useAsk, useFeedback, useKnowledgeSession, useKnowledgeSessions, useKnowledgeStatus } from './data';
import './knowledge.css';

/** Как сейчас отвечает помощник — одной фразой под заголовком. */
export function statusLine(st: KnowledgeStatus | undefined): string {
  if (!st) return 'Ищет по статьям и документам, которые вам доступны, и отвечает со ссылками на источники.';
  if (st.mode === 'ai' && st.ready) return 'ИИ отвечает по статьям и документам, которые вам доступны, — со ссылками на источники.';
  if (st.mode === 'ai') return 'ИИ сейчас недоступен — помощник отвечает цитатами из базы знаний.';
  return 'Ищет по смыслу в статьях и документах, которые вам доступны, и отвечает цитатами со ссылками.';
}

function QuestionBubble({ text }: { text: string }) {
  return (
    <div className="kb-q" aria-label="Ваш вопрос">
      <p>{text}</p>
    </div>
  );
}

function Thinking() {
  return (
    <div className="kb-a is-thinking" role="status" aria-label="Помощник ищет ответ">
      <span className="kb-orb" aria-hidden>
        <Sparkles size={15} />
      </span>
      <div className="kb-a-body">
        <span className="kb-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="faint">Ищу в базе знаний…</span>
      </div>
    </div>
  );
}

/**
 * Помощник базы знаний: вопрос — ответ со ссылками [n] на статьи и
 * документы. Диалоги свои у каждого; уточняющий вопрос ищется вместе с прошлым.
 */
export function AskPage() {
  const { sid } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useKnowledgeStatus();
  const sessions = useKnowledgeSessions();
  const session = useKnowledgeSession(sid);
  const ask = useAsk();
  const feedback = useFeedback(sid);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const autoAsked = useRef(false);
  const today = todayIso();

  const send = (question: string) => {
    const err = validateQuestion(question);
    setError(err);
    if (err || ask.isPending) return;
    const q = question.trim();
    setPending(q);
    setText('');
    ask.mutate(
      { question: q, session_id: sid },
      {
        onSuccess: (r) => {
          if (r.session.id !== sid) navigate(`/app/notes/ask/${r.session.id}`, { replace: !!params.get('q') });
        },
        onError: (e) => {
          setText(q);
          toast((e as Error).message, 'error');
        },
        onSettled: () => setPending(null),
      },
    );
  };

  // Вопрос из строки «Спросить» на главной базы знаний.
  useEffect(() => {
    const q = params.get('q');
    if (q && !autoAsked.current && !sid) {
      autoAsked.current = true;
      setParams({}, { replace: true });
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messages: KnowledgeMessage[] = sid ? (session.data?.messages ?? []) : [];
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [messages.length, pending]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  const removeSession = async (id: string) => {
    try {
      await api(`/knowledge/sessions/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['kb-sessions'] });
      if (id === sid) navigate('/app/notes/ask', { replace: true });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const empty = !messages.length && !pending;

  return (
    <div className="page kb-ask-page" style={{ maxWidth: 1120 }}>
      <PageHero
        variant="assistant"
        icon={Sparkles}
        compact
        back={
          <Link to="/app/notes">
            <ArrowLeft size={15} aria-hidden /> База знаний
          </Link>
        }
        eyebrow="Помощник"
        title={session.data?.session.title ?? 'Спросить базу знаний'}
        subtitle={statusLine(status.data)}
        actions={
          sid && (
            <Button size="sm" icon={<MessageSquarePlus size={14} />} onClick={() => navigate('/app/notes/ask')}>
              Новый вопрос
            </Button>
          )
        }
      />
      <div className="kb-ask-layout">
        <aside className="kb-history card card-tight" aria-label="Мои вопросы">
          <div className="kb-history-head">
            <b>Мои вопросы</b>
          </div>
          {sessions.isLoading ? (
            <Skeleton h={80} />
          ) : sessions.data?.length ? (
            <ul>
              {sessions.data.map((s) => (
                <li key={s.id} className={s.id === sid ? 'is-active' : ''}>
                  <Link to={`/app/notes/ask/${s.id}`} aria-current={s.id === sid ? 'page' : undefined}>
                    <span className="kb-history-title">{s.title}</span>
                    <span className="faint kb-history-meta">
                      {formatDate(s.updated_at.slice(0, 10), { short: true, today })} · {s.questions} {s.questions === 1 ? 'вопрос' : s.questions < 5 ? 'вопроса' : 'вопросов'}
                    </span>
                  </Link>
                  <button type="button" className="kb-history-del" aria-label={`Удалить диалог «${s.title}»`} onClick={() => void removeSession(s.id)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="faint kb-history-empty">Здесь появятся ваши вопросы. Их видите только вы.</p>
          )}
        </aside>
        <section className="kb-thread" aria-label="Диалог с помощником">
          {sid && session.isLoading ? (
            <Skeleton h={240} />
          ) : sid && session.isError ? (
            <div className="card">
              <Empty title="Диалог не найден" action={<Button onClick={() => navigate('/app/notes/ask')}>Задать новый вопрос</Button>}>
                Его удалили, или он принадлежит другому сотруднику.
              </Empty>
            </div>
          ) : empty ? (
            <div className="kb-welcome">
              <span className="kb-orb is-big" aria-hidden>
                <Sparkles size={26} />
              </span>
              <h2>Спросите — найду в базе знаний</h2>
              <p className="muted">
                Отвечаю по статьям и документам, которые вам доступны, и ставлю ссылку на каждый источник. Не нашлось — так и скажу.
              </p>
              <div className="kb-suggest" aria-label="Примеры вопросов">
                {KNOWLEDGE_SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="kb-chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
              {status.data && (
                <p className="faint kb-welcome-stat">
                  В базе: {status.data.notes} {status.data.notes === 1 ? 'статья' : 'статей'} и {status.data.docs.ready} {status.data.docs.ready === 1 ? 'документ' : 'документов'}
                  {status.data.docs.processing ? ` · ещё ${status.data.docs.processing} читается` : ''}
                </p>
              )}
            </div>
          ) : (
            <div className="kb-messages">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <QuestionBubble key={m.id} text={m.content} />
                ) : (
                  <AnswerCard key={m.id} message={m} busy={feedback.isPending} onFeedback={(f) => feedback.mutate({ id: m.id, feedback: f })} />
                ),
              )}
              {pending && (
                <>
                  <QuestionBubble text={pending} />
                  <Thinking />
                </>
              )}
              <div ref={bottom} />
            </div>
          )}
          <form className="kb-composer" onSubmit={submit}>
            <textarea
              ref={input}
              rows={1}
              aria-label="Вопрос"
              placeholder={sid ? 'Уточните или спросите ещё…' : 'Например: кто согласует командировку?'}
              value={text}
              maxLength={KNOWLEDGE_LIMITS.question + 50}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
            <button type="submit" className="kb-send" aria-label="Спросить" disabled={!text.trim() || ask.isPending}>
              <ArrowUp size={18} />
            </button>
          </form>
          {error && <div className="field-error">{error}</div>}
        </section>
      </div>
    </div>
  );
}
