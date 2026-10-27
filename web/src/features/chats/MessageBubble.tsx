import { CheckCircle2, CircleSlash, CornerUpLeft, Forward, MoreHorizontal, Pin, RotateCcw, SmilePlus, XCircle } from 'lucide-react';
import { memo, useState, type CSSProperties, type MouseEvent } from 'react';
import { REACTIONS, messageBody, moscowTime, type ChatMessage, type ChatPoll, type ContactCard } from '@offix/core';
import { avatarHue } from '../../lib/color';
import { Avatar } from '../../ui/Avatar';
import { Album, ContactView, FileRow, VideoNote, VoicePlayer, isVisual } from './media';
import { Popover, RichText, Ticks } from './parts';
import { NoteShareCardView } from '../my-notes/NoteDialogs';

const TOUCH = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches;

export interface BubbleActions {
  reply: (m: ChatMessage) => void;
  react: (m: ChatMessage, emoji: string | null) => void;
  menu: (m: ChatMessage, at: DOMRect | { x: number; y: number }) => void;
  jump: (messageId: string) => void;
  openExternal: (chatId: string, messageId: string) => void;
  toggleSelect: (m: ChatMessage) => void;
  vote: (m: ChatMessage, optionIds: string[]) => void;
  unvote: (m: ChatMessage) => void;
  closePoll: (m: ChatMessage) => void;
  voters: (m: ChatMessage) => void;
  retry: (m: ChatMessage) => void;
  /** Открыть фото или видео альбома во весь экран. */
  openMedia: (m: ChatMessage, index: number) => void;
  /** Голосовое или кружочек прослушаны впервые. */
  listen: (m: ChatMessage) => void;
  /** «Написать» на карточке контакта. */
  writeTo: (c: ContactCard) => void;
  /** Открыть отправленную в чат заметку. */
  openNote: (m: ChatMessage) => void;
}

export const Bubble = memo(function Bubble({
  m,
  meId,
  group,
  first,
  last,
  selecting,
  selected,
  flash,
  highlight,
  canClosePoll,
  actions,
}: {
  m: ChatMessage & { failed?: boolean };
  meId: string;
  group: boolean;
  first: boolean;
  last: boolean;
  selecting: boolean;
  selected: boolean;
  flash: boolean;
  highlight?: string;
  canClosePoll: boolean;
  actions: BubbleActions;
}) {
  const [react, setReact] = useState<DOMRect | null>(null);
  if (m.kind === 'service') {
    return (
      <div className="msg-service" id={`m-${m.id}`}>
        <span>{m.text}</span>
      </div>
    );
  }
  const mine = m.sender_id === meId;
  const local = m.id.startsWith('local-');
  const name = m.sender_name ?? 'Удалённый аккаунт';
  const showName = group && !mine && first;
  const onBubbleClick = (e: MouseEvent) => {
    if (selecting) {
      e.preventDefault();
      actions.toggleSelect(m);
      return;
    }
    // На сенсорных экранах наведения нет: касание пузыря открывает меню действий.
    if (!local && TOUCH() && !(e.target as HTMLElement).closest('a, button')) actions.menu(m, { x: e.clientX, y: e.clientY });
  };
  const onContext = (e: MouseEvent) => {
    if (local) return;
    e.preventDefault();
    actions.menu(m, { x: e.clientX, y: e.clientY });
  };
  const myReaction = m.reactions.find((r) => r.mine)?.emoji ?? null;
  const visual = m.attachments.filter(isVisual);
  const files = m.attachments.filter((a) => a.kind === 'file');
  const sound = m.kind === 'voice' || m.kind === 'video_note' ? (m.attachments[0] ?? null) : null;
  const round = m.kind === 'video_note' && !!sound;
  const header = showName || !!m.forwarded_from || !!m.reply_to || !!m.external_reply;
  const caption = !!m.text?.trim();
  const textBlock = m.kind === 'text' || ((m.kind === 'media' || m.kind === 'note') && caption);
  const overPhoto = visual.length > 0 && !caption && !files.length;
  const bubbleCls = [
    'bubble',
    m.poll && 'has-poll',
    visual.length && 'has-album',
    overPhoto && !header && 'is-media-only',
    round && 'is-round',
    // У голосового время — в строке с длительностью, как в Telegram.
    m.kind === 'voice' ? 'is-voice' : !textBlock && !overPhoto && 'meta-block',
    overPhoto && 'meta-over',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      id={`m-${m.id}`}
      className={`msg ${mine ? 'is-mine' : 'is-theirs'} ${first ? 'is-first' : ''} ${last ? 'is-last' : ''} ${selected ? 'is-selected' : ''} ${flash ? 'is-flash' : ''}`}
      onClick={onBubbleClick}
      onContextMenu={onContext}
      onDoubleClick={() => !selecting && !local && actions.reply(m)}
      data-seq={m.seq}
    >
      {selecting && <span className={`msg-check ${selected ? 'on' : ''}`} role="checkbox" aria-checked={selected} aria-label="Выбрать сообщение" />}
      {group && !mine && <span className="msg-ava">{last ? <Avatar name={name} size={32} id={m.sender_id} /> : null}</span>}
      <div className="msg-col">
        <div className={bubbleCls}>
          {showName && (
            <div className="bubble-name" style={{ '--h': avatarHue(name) } as CSSProperties}>
              {name}
            </div>
          )}
          {m.forwarded_from && (
            <div className="bubble-fwd">
              <Forward size={13} aria-hidden /> Переслано от <b>{m.forwarded_from.sender_name ?? 'Удалённый аккаунт'}</b>
              {m.forwarded_from.chat_title ? ` · ${m.forwarded_from.chat_title}` : ''}
            </div>
          )}
          {m.reply_to && (
            <button type="button" className="bubble-quote" onClick={(e) => (e.stopPropagation(), actions.jump(m.reply_to!.id))} style={{ '--h': avatarHue(m.reply_to.sender_name ?? '') } as CSSProperties}>
              <b>{m.reply_to.sender_name ?? 'Удалённый аккаунт'}</b>
              <span className="clip">{messageBody(m.reply_to)}</span>
            </button>
          )}
          {m.external_reply && (
            <button type="button" className="bubble-quote is-external" onClick={(e) => (e.stopPropagation(), actions.openExternal(m.external_reply!.chat_id, m.external_reply!.id))}>
              <b>
                {m.external_reply.sender_name ?? 'Удалённый аккаунт'} · {m.external_reply.chat_title}
              </b>
              <span className="clip">{messageBody(m.external_reply)}</span>
            </button>
          )}
          {m.poll && <PollView m={m} poll={m.poll} canClose={canClosePoll || mine} actions={actions} />}
          {visual.length > 0 && <Album items={visual} onOpen={(i) => !selecting && actions.openMedia(m, i)} />}
          {files.length > 0 && (
            <div className="bubble-files">
              {files.map((a) => (
                <FileRow key={a.id} a={a} />
              ))}
            </div>
          )}
          {sound && m.kind === 'voice' && <VoicePlayer a={sound} listened={m.listened} mine={mine} onListen={() => actions.listen(m)} />}
          {round && sound && <VideoNote a={sound} listened={m.listened} mine={mine} onListen={() => actions.listen(m)} />}
          {m.contact && <ContactView c={m.contact} onWrite={actions.writeTo} />}
          {m.note && <NoteShareCardView note={m.note} onOpen={() => !selecting && actions.openNote(m)} />}
          {textBlock && (
            <div className="bubble-text">
              <RichText text={m.text ?? ''} highlight={highlight} />
              <span className="bubble-meta-spacer" aria-hidden style={{ '--meta-w': `${40 + (mine ? 18 : 0) + (m.edited_at ? 62 : 0) + (m.pinned ? 14 : 0)}px` } as CSSProperties} />
            </div>
          )}
          <span className="bubble-meta">
            {m.pinned && <Pin size={11} aria-label="Закреплено" />}
            {m.edited_at && <span>изменено</span>}
            <time dateTime={m.created_at}>{moscowTime(m.created_at)}</time>
            {mine && <Ticks read={m.read} sending={local && !m.failed} failed={m.failed} />}
          </span>
        </div>
        {m.reactions.length > 0 && (
          <div className="msg-reactions">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`reaction ${r.mine ? 'is-mine' : ''}`}
                onClick={(e) => (e.stopPropagation(), actions.react(m, r.mine ? null : r.emoji))}
                title={r.people.join(', ')}
                aria-label={`${r.emoji} ${r.count}${r.mine ? ', ваша реакция' : ''}`}
                aria-pressed={r.mine}
              >
                <span>{r.emoji}</span>
                {r.count}
              </button>
            ))}
          </div>
        )}
        {m.failed && (
          <button type="button" className="msg-retry" onClick={() => actions.retry(m)}>
            <RotateCcw size={13} /> Не отправлено — повторить
          </button>
        )}
      </div>
      {!selecting && !local && (
        <div className="msg-tools" aria-label="Действия с сообщением">
          <button type="button" aria-label="Поставить реакцию" onClick={(e) => (e.stopPropagation(), setReact(e.currentTarget.getBoundingClientRect()))}>
            <SmilePlus size={16} />
          </button>
          <button type="button" aria-label="Ответить" onClick={(e) => (e.stopPropagation(), actions.reply(m))}>
            <CornerUpLeft size={16} />
          </button>
          <button type="button" aria-label="Ещё" onClick={(e) => (e.stopPropagation(), actions.menu(m, e.currentTarget.getBoundingClientRect()))}>
            <MoreHorizontal size={16} />
          </button>
        </div>
      )}
      {react && (
        <Popover anchor={react} onClose={() => setReact(null)} label="Реакции" align={mine ? 'end' : 'start'} className="reaction-pop">
          <div className="reaction-grid">
            {REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                className={myReaction === e ? 'is-mine' : ''}
                aria-label={`Реакция ${e}`}
                onClick={() => {
                  setReact(null);
                  actions.react(m, myReaction === e ? null : e);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
});

/** Опрос в пузыре: до голоса — выбор, после — полосы с процентами; у викторины — правильный ответ. */
function PollView({ m, poll, canClose, actions }: { m: ChatMessage; poll: ChatPoll; canClose: boolean; actions: BubbleActions }) {
  const [picked, setPicked] = useState<string[]>([]);
  const results = poll.voted || poll.closed;
  const kind = poll.quiz ? 'Викторина' : poll.anonymous ? 'Анонимный опрос' : 'Открытый опрос';
  return (
    <div className="poll">
      <div className="poll-q">{poll.question}</div>
      <div className="poll-kind">
        {kind}
        {poll.multiple ? ' · несколько ответов' : ''}
        {poll.closed ? ' · закрыт' : ''}
      </div>
      <div className="poll-options" role={results ? undefined : poll.multiple ? 'group' : 'radiogroup'} aria-label={poll.question}>
        {poll.options.map((o) => {
          const pct = poll.total_voters ? Math.round((o.votes / poll.total_voters) * 100) : 0;
          if (results) {
            const tone = o.correct === true ? 'is-correct' : o.correct === false && o.voted ? 'is-wrong' : '';
            return (
              <div key={o.id} className={`poll-result ${o.voted ? 'is-voted' : ''} ${tone}`} style={{ '--p': `${pct}%` } as CSSProperties}>
                <span className="poll-pct">{pct}%</span>
                <span className="poll-text">
                  {o.text}
                  {o.correct === true && <CheckCircle2 size={14} aria-label="Правильный ответ" />}
                  {o.correct === false && o.voted && <XCircle size={14} aria-label="Неверно" />}
                </span>
                <span className="poll-bar" aria-hidden />
              </div>
            );
          }
          const on = picked.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              role={poll.multiple ? 'checkbox' : 'radio'}
              aria-checked={on}
              className={`poll-option ${on ? 'is-on' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (poll.multiple) setPicked((p) => (on ? p.filter((x) => x !== o.id) : [...p, o.id]));
                else actions.vote(m, [o.id]);
              }}
            >
              <span className={`poll-mark ${poll.multiple ? 'is-square' : ''}`} aria-hidden />
              {o.text}
            </button>
          );
        })}
      </div>
      {results && poll.explanation && <div className="poll-explain">💡 {poll.explanation}</div>}
      <div className="poll-foot">
        <span className="faint">
          {poll.total_voters ? `${poll.total_voters} ${voterWord(poll.total_voters)}` : 'Пока никто не голосовал'}
        </span>
        <span className="poll-actions">
          {!results && poll.multiple && (
            <button type="button" className="poll-link" disabled={!picked.length} onClick={(e) => (e.stopPropagation(), actions.vote(m, picked))}>
              Голосовать
            </button>
          )}
          {poll.voted && !poll.closed && !poll.quiz && (
            <button type="button" className="poll-link" onClick={(e) => (e.stopPropagation(), actions.unvote(m))}>
              Отозвать голос
            </button>
          )}
          {!poll.anonymous && poll.total_voters > 0 && (
            <button type="button" className="poll-link" onClick={(e) => (e.stopPropagation(), actions.voters(m))}>
              Кто как проголосовал
            </button>
          )}
          {canClose && !poll.closed && (
            <button type="button" className="poll-link" onClick={(e) => (e.stopPropagation(), actions.closePoll(m))}>
              <CircleSlash size={13} aria-hidden /> Закрыть
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function voterWord(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'голос';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'голоса';
  return 'голосов';
}
