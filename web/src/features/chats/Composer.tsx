import { ArrowUp, BarChart3, Clock3, CornerUpLeft, File as FileIcon, Forward, Image as ImageIcon, Mic, Pencil, Plus, Smile, UserRound, Video, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EMOJI_CATEGORIES, MESSAGE_MAX, messageBody, searchEmoji, type ChatMessage } from '@offix/core';
import { Menu, Popover } from './parts';
import { VideoNoteRecorder, VoiceRecorder, canRecord, type Recording } from './recorder';

export type ComposerMode = { kind: 'reply'; message: ChatMessage } | { kind: 'external'; message: ChatMessage; chatTitle: string } | { kind: 'edit'; message: ChatMessage } | null;

const draftKey = (chatId: string, topicId: string | null) => `offix.chat-draft.${chatId}.${topicId ?? 'main'}`;

function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(key: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    /* приватный режим — черновик живёт только на экране */
  }
}

/**
 * Поле ввода — парящая капсула из жидкого стекла над обоями чата.
 * Enter — отправить, Shift+Enter — новая строка, Esc — отменить ответ или
 * правку, ↑ в пустом поле — изменить своё последнее. Черновик хранится по
 * чату и теме и переживает перезагрузку.
 */
export function Composer({
  chatId,
  topicId,
  placeholder,
  mode,
  onCancelMode,
  onSend,
  onEdit,
  onEditLast,
  onTyping,
  onPoll,
  onSchedule,
  scheduledCount,
  onShowScheduled,
  onFiles,
  onContact,
  onRecorded,
  onError,
  busy,
}: {
  chatId: string;
  topicId: string | null;
  placeholder: string;
  mode: ComposerMode;
  onCancelMode: () => void;
  onSend: (text: string) => void;
  onEdit: (m: ChatMessage, text: string) => void;
  onEditLast: () => void;
  onTyping: (stop?: boolean) => void;
  onPoll: () => void;
  onSchedule: (text: string) => void;
  scheduledCount: number;
  onShowScheduled: () => void;
  /** Выбранные, вставленные или перетащенные файлы. */
  onFiles: (files: File[], asFile: boolean) => void;
  onContact: () => void;
  onRecorded: (kind: 'voice' | 'video_note', r: Recording) => void;
  onError: (message: string) => void;
  /** «Отправка голосового… 40%» — над полем ввода. */
  busy?: string | null;
}) {
  const key = draftKey(chatId, topicId);
  const [text, setText] = useState(() => readDraft(key));
  const area = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emoji, setEmoji] = useState<DOMRect | null>(null);
  const [more, setMore] = useState<DOMRect | null>(null);
  const [recording, setRecording] = useState<null | 'voice' | 'video_note'>(null);
  const photos = useRef<HTMLInputElement>(null);
  const docs = useRef<HTMLInputElement>(null);
  const editing = mode?.kind === 'edit';
  // Подпись альбома можно стереть совсем — фото останутся.
  const captionOnly = editing && mode.message.kind === 'media' && mode.message.attachments.length > 0;
  const mic = !text.trim() && !editing && canRecord();

  // Правка: в поле — текст сообщения; после правки возвращаем черновик.
  // Ответ набранное не трогает.
  const editId = editing ? mode.message.id : null;
  const editText = editing ? (mode.message.text ?? '') : '';
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editId) setText(editText);
    else if (wasEditing.current) setText(readDraft(key));
    wasEditing.current = !!editId;
    if (editId) area.current?.focus();
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode && !editing) area.current?.focus();
  }, [mode, editing]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const change = (v: string) => {
    setText(v);
    if (editing) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => writeDraft(key, v), 300);
    if (v.trim()) onTyping();
    else onTyping(true);
  };

  const clear = () => {
    setText('');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    writeDraft(key, '');
  };

  const tooLong = text.trim().length > MESSAGE_MAX;
  const submit = () => {
    const t = text.trim();
    if ((!t && !captionOnly) || tooLong) return;
    if (editing) {
      onEdit(mode.message, t);
      setText(readDraft(key));
      return;
    }
    onSend(t);
    onTyping(true);
    clear();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && mode) {
      e.preventDefault();
      onCancelMode();
    } else if (e.key === 'ArrowUp' && !text && !mode) {
      e.preventDefault();
      onEditLast();
    }
  };

  const insert = (s: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const v = text.slice(0, start) + s + text.slice(end);
    change(v);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + s.length, start + s.length);
    });
  };

  return (
    <div className="composer-wrap">
      {mode && (
        <div className="composer-mode">
          {mode.kind === 'edit' ? <Pencil size={16} aria-hidden /> : mode.kind === 'external' ? <Forward size={16} aria-hidden /> : <CornerUpLeft size={16} aria-hidden />}
          <div className="composer-mode-text">
            <b>{mode.kind === 'edit' ? (captionOnly ? 'Изменение подписи' : 'Изменение сообщения') : mode.kind === 'external' ? `Ответ на сообщение из «${mode.chatTitle}»` : `Ответ · ${mode.message.sender_name ?? 'удалённый аккаунт'}`}</b>
            <span className="clip">{messageBody(mode.message)}</span>
          </div>
          <button type="button" className="composer-icon" onClick={onCancelMode} aria-label="Отменить">
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="composer-mode composer-busy" role="status">
          <span className="composer-busy-spin" aria-hidden />
          <span className="clip">{busy}</span>
        </div>
      )}
      <div className="composer-glass wall-glass">
        {recording === 'voice' ? (
          <VoiceRecorder
            onCancel={() => setRecording(null)}
            onError={onError}
            onDone={(r) => {
              setRecording(null);
              onRecorded('voice', r);
            }}
          />
        ) : (
        <div className="composer">
          <button type="button" className="composer-icon" aria-label="Вложения" title="Фото, файл, контакт, опрос" onClick={(e) => setMore(e.currentTarget.getBoundingClientRect())} disabled={editing}>
            <Plus size={20} />
          </button>
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder={placeholder}
            aria-label="Сообщение"
            onChange={(e) => change(e.target.value)}
            onKeyDown={onKey}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (!files.length || editing) return;
              e.preventDefault();
              onFiles(files, false);
            }}
            onBlur={() => onTyping(true)}
            aria-invalid={tooLong}
          />
          {tooLong && <span className="composer-count">{text.trim().length}/{MESSAGE_MAX}</span>}
          {scheduledCount > 0 && !text && !mode && (
            <button type="button" className="composer-icon has-count" aria-label={`Отложенные: ${scheduledCount}`} title="Отложенные сообщения" onClick={onShowScheduled}>
              <Clock3 size={19} />
              <span>{scheduledCount}</span>
            </button>
          )}
          <button type="button" className="composer-icon" aria-label="Эмодзи" onClick={(e) => setEmoji(e.currentTarget.getBoundingClientRect())}>
            <Smile size={20} />
          </button>
          {mic ? (
            <button type="button" className="composer-send is-mic" aria-label="Записать голосовое" title="Записать голосовое" onClick={() => setRecording('voice')}>
              <Mic size={19} strokeWidth={2.2} />
            </button>
          ) : (
            <button type="button" className="composer-send" aria-label={editing ? 'Сохранить' : 'Отправить'} onClick={submit} disabled={(!text.trim() && !captionOnly) || tooLong}>
              <ArrowUp size={19} strokeWidth={2.4} />
            </button>
          )}
        </div>
        )}
      </div>
      {recording === 'video_note' && (
        <VideoNoteRecorder
          onCancel={() => setRecording(null)}
          onError={onError}
          onDone={(r) => {
            setRecording(null);
            onRecorded('video_note', r);
          }}
        />
      )}
      <input ref={photos} type="file" accept="image/*,video/*" multiple hidden aria-label="Фото или видео" onChange={(e) => (e.target.files?.length && onFiles(Array.from(e.target.files), false), (e.target.value = ''))} />
      <input ref={docs} type="file" multiple hidden aria-label="Файлы" onChange={(e) => (e.target.files?.length && onFiles(Array.from(e.target.files), true), (e.target.value = ''))} />
      {emoji && (
        <Popover anchor={emoji} onClose={() => setEmoji(null)} label="Эмодзи" className="emoji-pop">
          <EmojiPicker onPick={insert} />
        </Popover>
      )}
      {more && (
        <Menu
          anchor={more}
          align="start"
          label="Вложения"
          onClose={() => setMore(null)}
          items={[
            { label: 'Фото или видео', icon: <ImageIcon size={16} />, onSelect: () => photos.current?.click() },
            { label: 'Файл', icon: <FileIcon size={16} />, onSelect: () => docs.current?.click() },
            { label: 'Контакт', icon: <UserRound size={16} />, onSelect: onContact },
            canRecord() && { label: 'Видеосообщение', icon: <Video size={16} />, onSelect: () => setRecording('video_note') },
            { label: 'Опрос', icon: <BarChart3 size={16} />, onSelect: onPoll },
            { label: text.trim() ? 'Отправить позже…' : 'Запланировать сообщение…', icon: <Clock3 size={16} />, onSelect: () => onSchedule(text.trim()) },
            scheduledCount > 0 && { label: `Отложенные (${scheduledCount})`, icon: <Clock3 size={16} />, onSelect: onShowScheduled },
          ]}
        />
      )}
    </div>
  );
}

/** Эмодзи по разделам и поиск по русским словам. */
export function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(EMOJI_CATEGORIES[0]!.key);
  const list = q.trim() ? searchEmoji(q, 96) : (EMOJI_CATEGORIES.find((c) => c.key === cat)?.emojis ?? []);
  return (
    <div className="emoji">
      <input className="input emoji-search" type="search" placeholder="Найти: сердце, огонь, ура" aria-label="Найти эмодзи" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {!q.trim() && (
        <div className="emoji-cats" role="tablist" aria-label="Разделы эмодзи">
          {EMOJI_CATEGORIES.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={c.key === cat} title={c.label} aria-label={c.label} onClick={() => setCat(c.key)}>
              {c.emojis[0]}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-grid" role="listbox" aria-label="Эмодзи">
        {list.map((e) => (
          <button key={e} type="button" role="option" aria-selected={false} onClick={() => onPick(e)} aria-label={e}>
            {e}
          </button>
        ))}
        {!list.length && <p className="faint emoji-none">Ничего не нашлось</p>}
      </div>
    </div>
  );
}
