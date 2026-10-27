import { MessageSquare, Reply, Send, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildThread,
  COMMENT_FILES_MAX,
  COMMENT_MAX,
  formatDate,
  insertMention,
  mentionQuery,
  mentionSuggestions,
  splitMentions,
  todayIso,
  validateComment,
  type Discussion as DiscussionData,
  type DiscussionComment,
  type DiscussionEntity,
  type DiscussionSummary,
  type Attachment,
} from '@offix/core';
import { api } from '../../lib/api';
import { dropDraft } from '../../lib/files';
import { useUploads } from '../../lib/useUploads';
import { AttachButton, AttachmentList, PendingList, useDropZone } from '../files/Attachments';
import { useMe, useUsers } from '../../lib/queries';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Empty, Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import './discussion.css';

const key = (type: DiscussionEntity, id: string) => ['discussion', type, id] as const;
const summaryKey = (type: DiscussionEntity, id: string) => ['discussion-summary', type, id] as const;

/** Счётчик для вкладки: сколько новых комментариев. */
export function useDiscussionSummary(type: DiscussionEntity, id: string) {
  return useQuery({ queryKey: summaryKey(type, id), queryFn: () => api<DiscussionSummary>(`/discussions/${type}/${id}/summary`), staleTime: 15_000 });
}

const when = (iso: string, today: string) => {
  const time = new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return iso.slice(0, 10) === today ? time : `${formatDate(iso.slice(0, 10), { short: true, today })}, ${time}`;
};

/**
 * Обсуждение цели или задачи: ветки с ответами одним уровнем, @упоминания
 * с подсказкой, «Новые» — с того места, где человек остановился.
 * Открыли — значит прочитали: отметка уходит на сервер сразу.
 */
export function Discussion({ type, id, compact }: { type: DiscussionEntity; id: string; compact?: boolean }) {
  const qc = useQueryClient();
  const me = useMe();
  const q = useQuery({ queryKey: key(type, id), queryFn: () => api<DiscussionData>(`/discussions/${type}/${id}`) });
  // Граница «новых» — по первому открытию, чтобы она не прыгала после отметки «прочитано».
  const [readMark, setReadMark] = useState<string | null | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<DiscussionComment | null>(null);
  const today = todayIso();

  useEffect(() => {
    if (!q.data || readMark !== undefined) return;
    setReadMark(q.data.last_read_at);
    if (q.data.unread > 0) {
      void api(`/discussions/${type}/${id}/read`, { method: 'POST' })
        .then(() => {
          qc.setQueryData<DiscussionSummary>(summaryKey(type, id), (s) => (s ? { ...s, unread: 0 } : s));
        })
        .catch(() => undefined);
    }
  }, [q.data, readMark, type, id, qc]);

  const thread = useMemo(() => buildThread(q.data?.comments ?? []), [q.data]);
  const people = q.data?.people ?? [];
  const isNew = (c: DiscussionComment) => readMark !== undefined && c.author_id !== me.data?.id && (!readMark || c.created_at > readMark);
  const firstNew = q.data?.comments.find(isNew)?.id;

  const renderComment = (c: DiscussionComment, reply: boolean) => (
    <article key={c.id} className={`dsc-comment ${reply ? 'reply' : ''}`} aria-label={`${c.author_name}: ${c.body.slice(0, 60) || c.attachments.map((a) => a.name).join(', ')}`}>
      {c.id === firstNew && (
        <div className="dsc-new" role="separator">
          Новые
        </div>
      )}
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <Avatar name={c.author_name} size={reply ? 26 : 30} id={c.author_id} />
        <div className="grow stack" style={{ '--gap': '2px', minWidth: 0 } as React.CSSProperties}>
          <span className="dsc-meta">
            <b>{c.author_name}</b> <span className="faint num">{when(c.created_at, today)}</span>
          </span>
          {c.body && (
            <p className="dsc-body">
              {splitMentions(c.body, people).map((s, i) =>
                s.mention ? (
                  <span key={i} className={`dsc-mention ${s.mention === me.data?.id ? 'me' : ''}`}>
                    {s.text}
                  </span>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )}
            </p>
          )}
          {c.attachments?.length > 0 && <AttachmentList items={c.attachments} author={{ id: c.author_id, name: c.author_name }} size="sm" />}
          {q.data?.can_comment && (
            <button type="button" className="dsc-reply-btn" onClick={() => setReplyTo(c)}>
              <Reply size={13} aria-hidden /> Ответить
            </button>
          )}
        </div>
      </div>
    </article>
  );

  return (
    <section className={`dsc ${compact ? 'compact' : 'card'}`} aria-label="Обсуждение">
      {q.isLoading ? (
        <Skeleton h={80} />
      ) : thread.length ? (
        <div className="dsc-list">
          {thread.map((n) => (
            <div key={n.comment.id} className="dsc-node">
              {renderComment(n.comment, false)}
              {n.replies.length > 0 && <div className="dsc-replies">{n.replies.map((r) => renderComment(r, true))}</div>}
            </div>
          ))}
        </div>
      ) : (
        !compact && (
          <Empty icon={<MessageSquare size={22} />} title="Обсуждения пока нет">
            Вопросы лучше задавать здесь, а не в мессенджере: контекст останется рядом с {type === 'goal' ? 'целью' : 'задачей'}. Упомяните коллегу через @ — он получит уведомление.
          </Empty>
        )
      )}
      {q.data?.can_comment && (
        <Composer
          type={type}
          id={id}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSent={async () => {
            setReplyTo(null);
            await qc.invalidateQueries({ queryKey: key(type, id) });
            await qc.invalidateQueries({ queryKey: summaryKey(type, id) });
          }}
        />
      )}
    </section>
  );
}

function Composer({ type, id, replyTo, onCancelReply, onSent }: { type: DiscussionEntity; id: string; replyTo: DiscussionComment | null; onCancelReply: () => void; onSent: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const up = useUploads();
  const ref = useRef<HTMLTextAreaElement>(null);
  const placeCaret = useRef<number | null>(null);
  const toast = useToast();
  const m = mentionQuery(text, caret);
  const users = useUsers(m ? m.query.split(' ')[0] ?? '' : '');
  const suggestions = m ? mentionSuggestions((users.data ?? []).filter((u) => u.active), m.query) : [];
  const open = !!m && suggestions.length > 0;

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);
  useEffect(() => setActive(0), [m?.query]);

  const pick = (name: string) => {
    const r = insertMention(text, caret, name);
    setText(r.text);
    setCaret(r.caret);
    placeCaret.current = r.caret;
  };
  // Курсор после имени ставим сразу после отрисовки, до следующего ввода:
  // с отложенной установкой быстро набранные буквы уезжали за курсор.
  useLayoutEffect(() => {
    if (placeCaret.current === null) return;
    ref.current?.focus();
    ref.current?.setSelectionRange(placeCaret.current, placeCaret.current);
    placeCaret.current = null;
  });

  // С файлами текст необязателен.
  const empty = files.length ? text.trim().length > COMMENT_MAX : !!validateComment(text);
  const attach = async (list: File[]) => {
    const room = COMMENT_FILES_MAX - files.length;
    if (list.length > room) toast(`К комментарию — не больше ${COMMENT_FILES_MAX} файлов`, 'error');
    const got = await up.upload(list.slice(0, Math.max(0, room)));
    setFiles((f) => [...f, ...got]);
  };
  const drop = useDropZone((l) => void attach(l));

  const send = async () => {
    if (empty || sending || up.running) return;
    setSending(true);
    try {
      await api(`/discussions/${type}/${id}`, { body: { body: text, parent_id: replyTo?.parent_id ?? replyTo?.id ?? null, attachment_ids: files.length ? files.map((f) => f.id) : undefined } });
      setText('');
      setCaret(0);
      setFiles([]);
      await onSent();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`dsc-composer ${drop.over ? 'is-over' : ''}`} {...drop.props}>
      {replyTo && (
        <div className="dsc-replying">
          <Reply size={13} aria-hidden />
          <span className="grow clip">
            Ответ: <b>{replyTo.author_name}</b> — {replyTo.body}
          </span>
          <button type="button" aria-label="Отменить ответ" onClick={onCancelReply}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="row" style={{ alignItems: 'flex-end', gap: 8, position: 'relative' }}>
        <textarea
          ref={ref}
          className="textarea grow"
          rows={2}
          aria-label="Комментарий"
          placeholder="Написать комментарий… @ — упомянуть коллегу"
          value={text}
          maxLength={COMMENT_MAX}
          aria-autocomplete="list"
          aria-expanded={open}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onPaste={(e) => {
            const list = Array.from(e.clipboardData?.files ?? []);
            if (!list.length) return;
            e.preventDefault();
            void attach(list);
          }}
          onKeyDown={(e) => {
            if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
            } else if (open && (e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              pick(suggestions[active]!.display_name);
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <AttachButton variant="icon" label="Прикрепить файл" onFiles={(l) => void attach(l)} disabled={files.length >= COMMENT_FILES_MAX} />
        <Button variant="primary" icon={<Send size={15} />} loading={sending} disabled={empty || up.running} onClick={() => void send()} aria-label="Отправить" />
        {open && (
          <div className="dsc-suggest" role="listbox" aria-label="Кого упомянуть">
            {suggestions.map((u, i) => (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(u.display_name);
                }}
              >
                <Avatar name={u.display_name} size={22} id={u.id} />
                <span className="dsc-suggest-name">{u.display_name}</span>
                {u.position && <span className="faint clip dsc-suggest-pos">{u.position}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {files.length > 0 && (
        <AttachmentList
          items={files}
          size="sm"
          canRemove={() => true}
          onRemove={(a) => {
            setFiles((f) => f.filter((x) => x.id !== a.id));
            void dropDraft(a.id);
          }}
        />
      )}
      <PendingList items={up.items} onDismiss={up.dismiss} />
      <div className="faint dsc-hint">Ctrl + Enter — отправить</div>
    </div>
  );
}
