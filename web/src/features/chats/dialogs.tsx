import { useQueryClient } from '@tanstack/react-query';
import { Check, Clock3, Plus, Send, Trash2, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CHAT_NAME_MAX,
  CHAT_PERMISSION_LABELS,
  POLL_OPTIONS_MAX,
  TOPIC_COLORS,
  TOPIC_ICONS,
  TOPIC_NAME_MAX,
  matchesQuery,
  sortChats,
  validateChatName,
  validatePoll,
  validateScheduleAt,
  type ChatMember,
  type ChatPermission,
  type ChatTopic,
} from '@offix/core';
import { ApiError } from '../../lib/api';
import { useMe, useUsers } from '../../lib/queries';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Segmented } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { chatApi, ck, useChats, useScheduled, useVoters } from './data';
import { ChatAvatar } from './parts';

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось, попробуйте ещё раз');

/** Выбор людей из компании: поиск, отметки, уже добавленные — неактивны. */
function PeopleList({ selected, onToggle, exclude = [], single }: { selected: string[]; onToggle: (id: string) => void; exclude?: string[]; single?: boolean }) {
  const [q, setQ] = useState('');
  const users = useUsers();
  const me = useMe();
  const people = (users.data ?? []).filter((u) => u.active && u.id !== me.data?.id && matchesQuery([u.display_name, u.position], q));
  return (
    <div className="people">
      <input className="input" type="search" placeholder="Имя или должность" aria-label="Поиск сотрудника" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="people-list" role={single ? 'listbox' : 'group'} aria-label="Сотрудники">
        {people.map((u) => {
          const off = exclude.includes(u.id);
          const on = selected.includes(u.id) || off;
          return (
            <button key={u.id} type="button" className={`people-row ${on ? 'is-on' : ''}`} disabled={off} role={single ? 'option' : 'checkbox'} aria-checked={on} aria-selected={single ? on : undefined} onClick={() => onToggle(u.id)}>
              <Avatar name={u.display_name} size={36} />
              <span className="grow">
                <span className="clip people-name">{u.display_name}</span>
                <span className="clip faint">{off ? 'уже в чате' : (u.position ?? '')}</span>
              </span>
              {!single && <span className={`people-check ${on ? 'on' : ''}`}>{on && <Check size={14} />}</span>}
            </button>
          );
        })}
        {users.data && !people.length && <p className="faint">Никого не нашлось</p>}
      </div>
    </div>
  );
}

export function CreateChatDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [ids, setIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [topics, setTopics] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const nameErr = validateChatName(name);

  const open = async (fn: () => Promise<{ id: string }>) => {
    setBusy(true);
    try {
      const c = await fn();
      void qc.invalidateQueries({ queryKey: ck.list });
      onClose();
      navigate(`/app/chats/${c.id}`);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Новый чат"
      onClose={onClose}
      footer={
        tab === 'group' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                setTouched(true);
                if (!nameErr) void open(() => chatApi.createGroup({ name: name.trim(), member_ids: ids, supergroup: topics }));
              }}
            >
              Создать группу
            </Button>
          </>
        ) : undefined
      }
    >
      <Segmented
        label="Тип чата"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'direct', label: 'Личный' },
          { value: 'group', label: 'Группа' },
        ]}
      />
      {tab === 'group' && (
        <>
          <Field label="Название группы" required error={touched ? nameErr : null} counter={{ value: name.length, max: CHAT_NAME_MAX }}>
            {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Приёмная кампания»" autoFocus />}
          </Field>
          <label className="spread choice-line">
            <span>
              <b>С темами</b>
              <span className="faint"> — отдельные ветки для разных вопросов</span>
            </span>
            <input type="checkbox" className="switch" checked={topics} onChange={(e) => setTopics(e.target.checked)} aria-label="Группа с темами" />
          </label>
          <div className="faint">{ids.length ? `Участников: ${ids.length + 1}` : 'Добавьте коллег — или создайте и пригласите позже'}</div>
        </>
      )}
      <PeopleList
        single={tab === 'direct'}
        selected={ids}
        onToggle={(id) => {
          if (tab === 'direct') void open(() => chatApi.direct(id));
          else setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
        }}
      />
    </Dialog>
  );
}

export function AddMembersDialog({ chatId, members, onClose }: { chatId: string; members: string[]; onClose: () => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Dialog
      title="Добавить участников"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          disabled={!ids.length}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await chatApi.addMembers(chatId, ids);
              void qc.invalidateQueries({ queryKey: ck.detail(chatId) });
              toast(ids.length === 1 ? 'Участник добавлен' : 'Участники добавлены');
              onClose();
            } catch (e) {
              toast(errText(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Добавить{ids.length ? ` (${ids.length})` : ''}
        </Button>
      }
    >
      <PeopleList selected={ids} exclude={members} onToggle={(id) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))} />
    </Dialog>
  );
}

/** Выбор чата: переслать или ответить в другом чате. */
export function ChatPickerDialog({ title, exclude, onPick, onClose }: { title: string; exclude?: string; onPick: (chatId: string, title: string) => void; onClose: () => void }) {
  const chats = useChats();
  const [q, setQ] = useState('');
  const list = sortChats(chats.data ?? []).filter((c) => c.id !== exclude && matchesQuery([c.title], q));
  return (
    <Dialog title={title} onClose={onClose}>
      <input className="input" type="search" placeholder="Найти чат" aria-label="Найти чат" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="people-list" role="listbox" aria-label="Чаты">
        {list.map((c) => (
          <button key={c.id} type="button" role="option" aria-selected={false} className="people-row" onClick={() => onPick(c.id, c.title)}>
            <ChatAvatar title={c.title} group={c.type === 'group'} size={36} />
            <span className="grow">
              <span className="clip people-name">{c.title}</span>
              <span className="clip faint">{c.type === 'group' ? `${c.members_count} участников` : (c.peer?.position ?? 'Личный чат')}</span>
            </span>
          </button>
        ))}
        {chats.data && !list.length && <p className="faint">Чатов не нашлось</p>}
      </div>
    </Dialog>
  );
}

export function PollDialog({ chatId, topicId, onClose, onCreated }: { chatId: string; topicId: string | null; onClose: () => void; onCreated: () => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [anonymous, setAnonymous] = useState(true);
  const [multiple, setMultiple] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [correct, setCorrect] = useState<number | null>(null);
  const [explanation, setExplanation] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const filled = options.map((o) => o.trim()).filter(Boolean);
  // Номер правильного среди заполненных вариантов.
  const correctIndex = correct === null || !options[correct]?.trim() ? null : options.slice(0, correct).filter((o) => o.trim()).length;
  const errors = validatePoll({ question, options, anonymous, multiple, quiz, correct_option: correctIndex, explanation });
  const show = (k: string) => (touched ? (errors[k] ?? null) : null);

  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      await chatApi.createPoll(chatId, { question: question.trim(), options: filled, anonymous, multiple: quiz ? false : multiple, quiz, correct_option: quiz ? correctIndex : null, explanation: quiz ? explanation.trim() || null : null, topic_id: topicId });
      onCreated();
      onClose();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Опрос"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Отправить опрос
          </Button>
        </>
      }
    >
      <Field label="Вопрос" required error={show('question')}>
        {(p) => <input {...p} className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Когда удобнее созвониться?" autoFocus />}
      </Field>
      <div className="field">
        <div className="field-label">Варианты ответа{quiz ? ' — отметьте правильный' : ''}</div>
        <div className="poll-edit">
          {options.map((o, i) => (
            <div key={i} className="poll-edit-row">
              {quiz && <input type="radio" name="correct" aria-label={`Правильный ответ — вариант ${i + 1}`} checked={correct === i} onChange={() => setCorrect(i)} />}
              <input className="input" value={o} aria-label={`Вариант ${i + 1}`} placeholder={`Вариант ${i + 1}`} onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? e.target.value : y)))} />
              {options.length > 2 && (
                <Button variant="ghost" size="sm" icon={<X size={14} />} aria-label={`Убрать вариант ${i + 1}`} onClick={() => setOptions((x) => x.filter((_, j) => j !== i))} />
              )}
            </div>
          ))}
          {options.length < POLL_OPTIONS_MAX && (
            <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setOptions((x) => [...x, ''])}>
              Добавить вариант
            </Button>
          )}
        </div>
        {(show('options') || show('correct_option')) && (
          <div className="field-error" role="alert">
            {show('options') ?? show('correct_option')}
          </div>
        )}
      </div>
      <label className="spread choice-line">
        <span>Анонимный</span>
        <input type="checkbox" className="switch" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} aria-label="Анонимный" />
      </label>
      <label className="spread choice-line">
        <span>Несколько ответов</span>
        <input type="checkbox" className="switch" checked={multiple && !quiz} disabled={quiz} onChange={(e) => setMultiple(e.target.checked)} aria-label="Несколько ответов" />
      </label>
      <label className="spread choice-line">
        <span>Викторина — с правильным ответом</span>
        <input type="checkbox" className="switch" checked={quiz} onChange={(e) => setQuiz(e.target.checked)} aria-label="Викторина" />
      </label>
      {quiz && (
        <Field label="Пояснение после ответа" error={show('explanation')}>
          {(p) => <input {...p} className="input" value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Необязательно" />}
        </Field>
      )}
    </Dialog>
  );
}

/** Локальное время для поля datetime-local. */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function presets(now: Date): { label: string; at: Date }[] {
  const at = (days: number, h: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const out = [{ label: 'Через час', at: new Date(now.getTime() + 3_600_000) }];
  if (now.getHours() < 17) out.push({ label: 'Сегодня в 18:00', at: at(0, 18) });
  out.push({ label: 'Завтра в 9:00', at: at(1, 9) });
  return out;
}

export function ScheduleDialog({ chatId, topicId, initialText, onClose, onDone }: { chatId: string; topicId: string | null; initialText: string; onClose: () => void; onDone: () => void }) {
  const now = useMemo(() => new Date(), []);
  const [text, setText] = useState(initialText);
  const [when, setWhen] = useState(localInput(new Date(now.getTime() + 3_600_000)));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const iso = when ? new Date(when).toISOString() : '';
  const whenErr = validateScheduleAt(iso, new Date().toISOString());
  const textErr = text.trim() ? null : 'Напишите сообщение';
  const submit = async () => {
    setTouched(true);
    if (whenErr || textErr) return;
    setBusy(true);
    try {
      await chatApi.schedule(chatId, { text: text.trim(), send_at: iso, topic_id: topicId });
      toast(`Отправим ${new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`);
      onDone();
      onClose();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Отправить позже"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon={<Clock3 size={16} />} loading={busy} onClick={submit}>
            Запланировать
          </Button>
        </>
      }
    >
      <Field label="Сообщение" required error={touched ? textErr : null}>
        {(p) => <textarea {...p} className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus={!initialText} />}
      </Field>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {presets(now).map((p) => (
          <button key={p.label} type="button" className={`chip-btn ${localInput(p.at) === when ? 'is-on' : ''}`} onClick={() => setWhen(localInput(p.at))}>
            {p.label}
          </button>
        ))}
      </div>
      <Field label="Когда отправить" required error={touched ? whenErr : null}>
        {(p) => <input {...p} className="input" type="datetime-local" value={when} min={localInput(now)} onChange={(e) => setWhen(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

export function ScheduledDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const list = useScheduled(chatId);
  const qc = useQueryClient();
  const toast = useToast();
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ck.scheduled(chatId) });
      toast(ok);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  return (
    <Dialog title="Отложенные сообщения" onClose={onClose}>
      {list.data && !list.data.length && <p className="faint">Запланированных сообщений нет</p>}
      <div className="sched-list">
        {list.data?.map((s) => (
          <div key={s.id} className="sched">
            <div className="sched-when">
              <Clock3 size={14} aria-hidden /> {new Date(s.send_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="sched-text">{s.text}</div>
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" variant="secondary" icon={<Send size={14} />} onClick={() => act(() => chatApi.sendScheduled(chatId, s.id), 'Отправлено')}>
                Отправить сейчас
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => act(() => chatApi.dropScheduled(chatId, s.id), 'Удалено')}>
                Удалить
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function VotersDialog({ messageId, options, onClose }: { messageId: string; options: { id: string; text: string }[]; onClose: () => void }) {
  const voters = useVoters(messageId);
  return (
    <Dialog title="Кто как проголосовал" onClose={onClose}>
      {voters.data?.map((v) => {
        const opt = options.find((o) => o.id === v.option_id);
        return (
          <section key={v.option_id} className="voters">
            <div className="voters-title">
              {opt?.text} <span className="faint">· {v.people.length}</span>
            </div>
            {v.people.map((p) => (
              <div key={p.id} className="row" style={{ gap: 10 }}>
                <Avatar name={p.display_name} size={28} />
                <span>{p.display_name}</span>
              </div>
            ))}
            {!v.people.length && <p className="faint">Никто</p>}
          </section>
        );
      })}
    </Dialog>
  );
}

export function TopicDialog({ chatId, topic, onClose }: { chatId: string; topic?: ChatTopic; onClose: () => void }) {
  const [name, setName] = useState(topic?.name ?? '');
  const [icon, setIcon] = useState<string>(topic?.icon ?? TOPIC_ICONS[0]);
  const [color, setColor] = useState<string>(topic?.color ?? TOPIC_COLORS[0]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const err = !name.trim() ? 'Назовите тему' : name.trim().length > TOPIC_NAME_MAX ? `Не длиннее ${TOPIC_NAME_MAX} символов` : null;
  const submit = async () => {
    setTouched(true);
    if (err) return;
    setBusy(true);
    try {
      if (topic) await chatApi.editTopic(chatId, topic.id, { name: name.trim(), icon, color });
      else await chatApi.createTopic(chatId, { name: name.trim(), icon, color });
      void qc.invalidateQueries({ queryKey: ck.detail(chatId) });
      onClose();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={topic ? 'Тема' : 'Новая тема'}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} onClick={submit}>
          {topic ? 'Сохранить' : 'Создать тему'}
        </Button>
      }
    >
      <div className="topic-preview" style={{ '--c': color } as React.CSSProperties}>
        <span className="topic-icon">{icon}</span>
        <b>{name.trim() || 'Название темы'}</b>
      </div>
      <Field label="Название" required error={touched ? err : null} counter={{ value: name.length, max: TOPIC_NAME_MAX }}>
        {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
      </Field>
      <div className="field">
        <div className="field-label">Значок</div>
        <div className="topic-icons" role="radiogroup" aria-label="Значок темы">
          {TOPIC_ICONS.map((i) => (
            <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)}>
              {i}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <div className="field-label">Цвет</div>
        <div className="topic-colors" role="radiogroup" aria-label="Цвет темы">
          {TOPIC_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} style={{ '--c': c } as React.CSSProperties} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** Права администратора: выдать можно только то, что есть у самого. */
export function AdminDialog({ chatId, member, mine, onClose }: { chatId: string; member: ChatMember; mine: ChatPermission[]; onClose: () => void }) {
  const [perms, setPerms] = useState<ChatPermission[]>(member.role === 'admin' ? member.permissions : mine.filter((p) => p !== 'add_admins'));
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Dialog
      title={`Права: ${member.display_name}`}
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await chatApi.setAdmin(chatId, member.id, perms);
              void qc.invalidateQueries({ queryKey: ck.detail(chatId) });
              toast(member.role === 'admin' ? 'Права сохранены' : `${member.display_name.split(' ')[0]} — администратор`);
              onClose();
            } catch (e) {
              toast(errText(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          {member.role === 'admin' ? 'Сохранить' : 'Назначить администратором'}
        </Button>
      }
    >
      {(Object.keys(CHAT_PERMISSION_LABELS) as ChatPermission[]).map((p) => (
        <label key={p} className="spread choice-line">
          <span>{CHAT_PERMISSION_LABELS[p]}</span>
          <input
            type="checkbox"
            className="switch"
            aria-label={CHAT_PERMISSION_LABELS[p]}
            disabled={!mine.includes(p)}
            checked={perms.includes(p)}
            onChange={(e) => setPerms((x) => (e.target.checked ? [...x, p] : x.filter((y) => y !== p)))}
          />
        </label>
      ))}
    </Dialog>
  );
}

export function ConfirmDialog({ title, children, action, danger, onConfirm, onClose }: { title: string; children: ReactNode; action: string; danger?: boolean; onConfirm: () => Promise<unknown> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                toast(errText(e), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {action}
          </Button>
        </>
      }
    >
      <div>{children}</div>
    </Dialog>
  );
}

