import { useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Check, Clock3, NotebookPen, Paperclip, RefreshCw, Search, Send } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MESSAGE_MAX, formatDate, matchesQuery, noteTitle, sortChats, todayIso, type MyNote, type MyNoteSummary, type NoteShareCard, type NoteShareView } from '@offix/core';
import { ApiError } from '../../lib/api';
import { Button } from '../../ui/Button';
import { Dialog, Skeleton } from '../../ui/Misc';
import { Pill } from '../../ui/Pill';
import { useToast } from '../../ui/Toast';
import { ChatAvatar } from '../chats/parts';
import { ck, useChats } from '../chats/data';
import { AttachmentList } from '../files/Attachments';
import { Markdown } from '../notes/Markdown';
import './my-notes.css';
import { mk, myNotesApi, useMyNotes, useNoteRequest, useRefreshNotes, useSharedNote } from './data';

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось, попробуйте ещё раз');

/** Заметка в ленте чата: карточка со снимком — нажать, чтобы открыть. */
export function NoteShareCardView({ note, onOpen }: { note: NoteShareCard; onOpen: () => void }) {
  return (
    <button type="button" className="note-card" onClick={(e) => (e.stopPropagation(), onOpen())} aria-label={`Заметка «${noteTitle(note.title)}» — открыть`}>
      <span className="note-card-icon" aria-hidden>
        <NotebookPen size={18} />
      </span>
      <span className="note-card-text">
        <span className="note-card-eyebrow">Заметка</span>
        <b className="clip">{noteTitle(note.title)}</b>
        {note.excerpt && <span className="note-card-excerpt">{note.excerpt}</span>}
        {note.files_count > 0 && (
          <span className="note-card-files">
            <Paperclip size={12} aria-hidden /> {note.files_count}
          </span>
        )}
      </span>
    </button>
  );
}

/** Отправить свою заметку в чат: выбор чата и подпись. В чат уходит снимок. */
export function ShareNoteDialog({ note, onClose, onSent }: { note: Pick<MyNote, 'id' | 'title'>; onClose: () => void; onSent?: (chatId: string) => void }) {
  const chats = useChats();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = sortChats(chats.data ?? []).filter((c) => matchesQuery([c.title], q));
  const send = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await myNotesApi.share(note.id, target.id, { text });
      void qc.invalidateQueries({ queryKey: ck.list });
      toast(`Отправлено в «${target.title}»`);
      onClose();
      onSent?.(target.id);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Отправить заметку"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon={<Send size={15} />} disabled={!target || text.length > MESSAGE_MAX} loading={busy} onClick={() => void send()}>
            Отправить
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        «{noteTitle(note.title)}» уйдёт снимком: получатели увидят текст и файлы на эту минуту, а правки потом останутся у вас.
      </p>
      <input className="input" type="search" placeholder="Найти чат" aria-label="Найти чат" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="people-list mn-chat-list" role="listbox" aria-label="Чаты">
        {list.map((c) => (
          <button key={c.id} type="button" role="option" aria-selected={target?.id === c.id} className={`people-row ${target?.id === c.id ? 'is-on' : ''}`} onClick={() => setTarget({ id: c.id, title: c.title })}>
            <ChatAvatar title={c.title} group={c.type === 'group'} size={36} userId={c.peer?.id} />
            <span className="grow">
              <span className="clip people-name">{c.title}</span>
              <span className="clip faint">{c.type === 'group' ? `${c.members_count} участников` : (c.peer?.position ?? 'Личный чат')}</span>
            </span>
            {target?.id === c.id && <Check size={16} aria-hidden />}
          </button>
        ))}
        {chats.data && !list.length && <p className="faint">Чатов не нашлось</p>}
      </div>
      <textarea className="textarea" rows={2} aria-label="Подпись" placeholder="Подпись — необязательно" value={text} onChange={(e) => setText(e.target.value)} />
    </Dialog>
  );
}

/** Из чата: выбрать свою заметку и отправить сюда. */
export function NotePickerDialog({ chatId, topicId, onClose, onSent }: { chatId: string; topicId?: string | null; onClose: () => void; onSent?: () => void }) {
  const [q, setQ] = useState('');
  const list = useMyNotes({ q });
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayIso();
  const send = async (n: MyNoteSummary) => {
    setBusy(n.id);
    try {
      await myNotesApi.share(n.id, chatId, { topicId });
      void qc.invalidateQueries({ queryKey: ck.list });
      onClose();
      onSent?.();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog title="Отправить заметку" onClose={onClose}>
      <div className="note-search">
        <Search size={16} className="faint" aria-hidden />
        <input className="input" type="search" placeholder="Найти в моих заметках" aria-label="Найти в моих заметках" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="people-list" role="listbox" aria-label="Мои заметки">
        {list.isLoading && <Skeleton h={120} />}
        {list.data?.map((n) => (
          <button key={n.id} type="button" role="option" aria-selected={false} className="people-row" disabled={!!busy} onClick={() => void send(n)}>
            <span className="note-card-icon is-sm" aria-hidden>
              <NotebookPen size={16} />
            </span>
            <span className="grow">
              <span className="clip people-name">{noteTitle(n.title)}</span>
              <span className="clip faint">
                {formatDate(n.note_date, { today })}
                {n.excerpt ? ` · ${n.excerpt}` : ''}
              </span>
            </span>
            {busy === n.id && <Clock3 size={15} aria-hidden />}
          </button>
        ))}
        {list.data && !list.data.length && <p className="faint">{q.trim() ? 'Ничего не нашлось' : 'Личных заметок пока нет — их пишут в разделе «Мои заметки»'}</p>}
      </div>
    </Dialog>
  );
}

function requestLine(v: NoteShareView): string | null {
  const r = v.my_request;
  if (!r) return null;
  if (r.status === 'pending') return 'Запрос отправлен — ждём ответа автора';
  if (r.status === 'declined') return 'Автор не стал делиться новой версией';
  return 'Автор поделился свежей версией — она в ваших заметках';
}

/**
 * Заметка из чата: текст и файлы снимка. Получатель сохраняет её к себе или
 * просит у автора свежую версию; автор открывает свою заметку.
 */
export function SharedNoteDialog({ shareId, onClose }: { shareId: string; onClose: () => void }) {
  const q = useSharedNote(shareId);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const refresh = useRefreshNotes();
  const [busy, setBusy] = useState<'accept' | 'request' | null>(null);
  const v = q.data;
  const reload = () => qc.invalidateQueries({ queryKey: mk.shared(shareId) });
  const open = (id: string) => {
    onClose();
    navigate(`/app/my-notes/${id}`);
  };
  const accept = async () => {
    setBusy('accept');
    try {
      const n = await myNotesApi.accept(shareId);
      await Promise.all([refresh(n), reload()]);
      toast('Заметка сохранена в «Мои заметки»');
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const request = async () => {
    setBusy('request');
    try {
      const r = await myNotesApi.request(shareId);
      await reload();
      toast(r.already ? 'Запрос уже у автора' : 'Попросили автора поделиться свежей версией');
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const canRequest = !!v && !v.is_owner && v.original_exists && v.my_request?.status !== 'pending';
  return (
    <Dialog
      title={v ? noteTitle(v.title) : 'Заметка'}
      wide
      onClose={onClose}
      footer={
        v && (
          <>
            {canRequest && (
              <Button icon={<RefreshCw size={15} />} loading={busy === 'request'} onClick={() => void request()}>
                Запросить свежую версию
              </Button>
            )}
            {v.is_owner ? (
              v.original_note_id && (
                <Button variant="primary" icon={<NotebookPen size={15} />} onClick={() => open(v.original_note_id!)}>
                  Открыть мою заметку
                </Button>
              )
            ) : v.accepted_note_id ? (
              <Button variant="primary" icon={<NotebookPen size={15} />} onClick={() => open(v.accepted_note_id!)}>
                Открыть у себя
              </Button>
            ) : (
              <Button variant="primary" icon={<BookmarkPlus size={15} />} loading={busy === 'accept'} onClick={() => void accept()}>
                Сохранить к себе
              </Button>
            )}
          </>
        )
      }
    >
      {q.isLoading && <Skeleton h={180} />}
      {q.isError && <p className="muted">Заметку больше нельзя открыть: сообщение удалили или вы вышли из чата.</p>}
      {v && (
        <>
          <div className="faint mn-shared-meta">
            {v.is_owner ? 'Вы отправили' : `${v.sender_name ?? 'Удалённый аккаунт'} отправил(а)`} · {formatDate(v.created_at.slice(0, 10), { today: todayIso() })}
            {!v.original_exists && ' · автор удалил оригинал'}
          </div>
          <div className="mn-shared-body">{v.body.trim() ? <Markdown source={v.body} /> : <p className="faint">Без текста — только файлы.</p>}</div>
          {v.attachments.length > 0 && <AttachmentList items={v.attachments} author={{ id: v.sender_id, name: v.sender_name ?? '' }} />}
          {requestLine(v) && (
            <div className={`mn-request-line is-${v.my_request!.status}`} role="status">
              {requestLine(v)}
              {v.my_request!.status === 'approved' && v.my_request!.result_note_id && (
                <button type="button" className="mn-link" onClick={() => open(v.my_request!.result_note_id!)}>
                  Открыть
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/** Запрос свежей версии: автор видит, чем поделится, и отвечает. */
export function NoteRequestDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const q = useNoteRequest(requestId);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const v = q.data;
  const answer = async (how: 'approve' | 'decline') => {
    setBusy(how);
    try {
      const next = how === 'approve' ? await myNotesApi.approve(requestId) : await myNotesApi.decline(requestId);
      qc.setQueryData(mk.request(requestId), next);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      toast(how === 'approve' ? `Свежая версия у ${next.requester.name.split(' ')[0]}` : 'Отказали — запросивший узнает');
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const pending = v?.status === 'pending';
  return (
    <Dialog
      title="Запрос свежей версии"
      onClose={onClose}
      footer={
        v?.is_owner && pending ? (
          <>
            <Button variant="ghost" loading={busy === 'decline'} disabled={!!busy} onClick={() => void answer('decline')}>
              Отказать
            </Button>
            <Button variant="primary" icon={<Send size={15} />} loading={busy === 'approve'} disabled={!!busy || !v.note} onClick={() => void answer('approve')}>
              Поделиться
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Закрыть</Button>
        )
      }
    >
      {q.isLoading && <Skeleton h={140} />}
      {q.isError && <p className="muted">Запрос не найден.</p>}
      {v && (
        <>
          <p style={{ margin: 0 }}>
            {v.is_owner ? (
              <>
                <b>{v.requester.name}</b> просит свежую версию заметки «{v.shared.title}», которую вы отправили {formatDate(v.shared.created_at.slice(0, 10), { today: todayIso() })}.
              </>
            ) : (
              <>
                Вы попросили у <b>{v.owner.name}</b> свежую версию заметки «{v.shared.title}».
              </>
            )}
          </p>
          {v.is_owner && v.note && (
            <div className="mn-request-preview">
              <div className="spread">
                <b className="clip">{v.note.title}</b>
                <Pill tone={v.note.changed_since_share ? 'info' : 'neutral'}>{v.note.changed_since_share ? 'Есть изменения' : 'Без изменений'}</Pill>
              </div>
              {v.note.preview && <p className="faint mn-request-text">{v.note.preview}</p>}
              {!!v.note.files_count && (
                <span className="faint">
                  <Paperclip size={12} aria-hidden /> файлов: {v.note.files_count}
                </span>
              )}
            </div>
          )}
          {v.is_owner && !v.note && <p className="muted">Вы удалили эту заметку — делиться нечем.</p>}
          {!pending && (
            <div className={`mn-request-line is-${v.status}`} role="status">
              {v.status === 'approved' ? (v.is_owner ? 'Вы поделились свежей версией' : 'Автор поделился — копия в ваших заметках') : v.is_owner ? 'Вы отказали' : 'Автор не стал делиться'}
              {!v.is_owner && v.result_note_id && (
                <button
                  type="button"
                  className="mn-link"
                  onClick={() => {
                    onClose();
                    navigate(`/app/my-notes/${v.result_note_id}`);
                  }}
                >
                  Открыть
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
