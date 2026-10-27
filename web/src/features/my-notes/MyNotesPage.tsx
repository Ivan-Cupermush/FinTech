import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Copy, Download, Eye, FileText, MoreHorizontal, NotebookPen, Paperclip, Pencil, Plus, Search, Send, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MY_NOTE_LIMITS, isBlankNote, monthOf, noteBadge, noteDayLabel, noteTitle, plural, todayIso, validateMyNote, type Attachment, type MyNoteSummary } from '@offix/core';
import { ApiError } from '../../lib/api';
import { dropDraft } from '../../lib/files';
import { useUploads } from '../../lib/useUploads';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Empty, Segmented, Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { Glass } from '../../ui/fx/Glass';
import { PageHero, type HeroStat } from '../../ui/fx/PageHero';
import { gradientCss, gradientLook } from '../../ui/fx/gradients';
import { useDarkTheme } from '../../ui/fx/support';
import { Menu } from '../chats/parts';
import { AttachButton, AttachmentList, PendingList, useDropZone } from '../files/Attachments';
import { Markdown } from '../notes/Markdown';
import { NoteCalendar } from './Calendar';
import { ShareNoteDialog } from './NoteDialogs';
import { myNotesApi, useMyNote, useMyNotes, useNoteDays, useRefreshNotes } from './data';
import './my-notes.css';

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не получилось, попробуйте ещё раз');

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Цифры шапки: сколько всего, сколько на сегодня и в избранном. */
export function myNotesHeroStats(all: MyNoteSummary[], today: string): HeroStat[] {
  return [
    { label: plural(all.length, ['заметка', 'заметки', 'заметок']), value: all.length },
    { label: 'на сегодня', value: all.filter((n) => n.note_date === today).length },
    { label: 'в избранном', value: all.filter((n) => n.is_favorite).length },
  ];
}

export function MyNoteRow({ n, today, onFavorite }: { n: MyNoteSummary; today: string; onFavorite?: (n: MyNoteSummary) => void }) {
  return (
    <div className="mn-row">
      <Link to={`/app/my-notes/${n.id}`} className="mn-row-link">
        <span className="mn-row-date" aria-hidden>
          <b>{noteBadge(n.note_date).day}</b>
          <span>{noteBadge(n.note_date).month}</span>
        </span>
        <span className="mn-row-text">
          <span className="mn-row-title clip">{noteTitle(n.title)}</span>
          {n.excerpt && <span className="mn-row-excerpt faint">{n.excerpt}</span>}
          <span className="mn-row-meta faint">
            {noteDayLabel(n.note_date, today)}
            {n.files_count > 0 && (
              <>
                {' · '}
                <Paperclip size={12} aria-hidden /> {n.files_count}
              </>
            )}
          </span>
        </span>
      </Link>
      {onFavorite && (
        <button type="button" className={`mn-star ${n.is_favorite ? 'is-on' : ''}`} aria-pressed={n.is_favorite} aria-label={n.is_favorite ? 'Убрать из избранного' : 'В избранное'} onClick={() => onFavorite(n)}>
          <Star size={17} fill={n.is_favorite ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );
}

type View = 'all' | 'favorite';

/**
 * Мои заметки: личный ежедневник. Слева календарь — точки там, где есть
 * записи; справа заметки выбранного дня, избранное или поиск.
 */
export function MyNotesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshNotes();
  const dark = useDarkTheme();
  const today = todayIso();
  const [params, setParams] = useSearchParams();
  const selected = params.get('date');
  const [month, setMonth] = useState(() => monthOf(selected ?? today));
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const q = useDebounced(query);
  const searching = !!q.trim();
  const list = useMyNotes({ date: searching ? null : selected, favorite: view === 'favorite', q });
  const all = useMyNotes({});
  const days = useNoteDays(month);

  const select = (date: string | null) => {
    const next = new URLSearchParams(params);
    if (date) next.set('date', date);
    else next.delete('date');
    setParams(next, { replace: true });
  };
  const favorite = async (n: MyNoteSummary) => {
    try {
      await myNotesApi.update(n.id, { is_favorite: !n.is_favorite });
      await refresh();
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const newHref = `/app/my-notes/new${selected ? `?date=${selected}` : ''}`;
  const heading = searching ? 'Найдено' : view === 'favorite' ? 'Избранное' : selected ? noteDayLabel(selected, today) : 'Все заметки';
  const look = gradientLook('notes', dark);

  return (
    <div className="page mn-page">
      <PageHero
        variant="notes"
        icon={NotebookPen}
        title="Мои заметки"
        subtitle="Личный ежедневник: видите только вы. Захотите поделиться — отправьте заметку в чат."
        stats={all.data ? myNotesHeroStats(all.data, today) : undefined}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate(newHref)}>
            Новая заметка
          </Button>
        }
      />
      <div className="mn-layout">
        <aside className="mn-side" style={{ background: gradientCss(look) }}>
          <Glass className="mn-cal-glass" radius={24} overLight={false} elasticity={0} displacement={36} blur={0.3} clip>
            <NoteCalendar month={month} today={today} selected={selected} days={days.data ?? []} onMonth={setMonth} onSelect={select} />
          </Glass>
          <div className="mn-side-foot">
            <button
              type="button"
              className="mn-today"
              onClick={() => {
                setMonth(monthOf(today));
                select(today);
              }}
            >
              <CalendarDays size={15} aria-hidden /> Сегодня
            </button>
            {selected && (
              <button type="button" className="mn-today" onClick={() => select(null)}>
                Все дни
              </button>
            )}
          </div>
        </aside>
        <section className="mn-main" aria-label="Заметки">
          <div className="mn-tools">
            <div className="note-search grow">
              <Search size={16} className="faint" aria-hidden />
              <input className="input" type="search" aria-label="Поиск по моим заметкам" placeholder="Поиск по заголовку и тексту" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Segmented<View>
              label="Какие заметки"
              value={view}
              onChange={setView}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'favorite', label: <><Star size={13} /> Избранное</> },
              ]}
            />
          </div>
          <div className="mn-heading">
            <h2>{heading}</h2>
            {list.data && <span className="faint">{list.data.length ? `${list.data.length} ${plural(list.data.length, ['заметка', 'заметки', 'заметок'])}` : ''}</span>}
          </div>
          {list.isLoading ? (
            <Skeleton h={220} r={20} />
          ) : list.data?.length ? (
            <div className="mn-list">
              {list.data.map((n) => (
                <MyNoteRow key={n.id} n={n} today={today} onFavorite={(x) => void favorite(x)} />
              ))}
            </div>
          ) : (
            <div className="card">
              <Empty
                icon={<NotebookPen size={22} />}
                title={searching ? 'Ничего не нашлось' : view === 'favorite' ? 'В избранном пусто' : selected ? 'В этот день заметок нет' : 'Заметок пока нет'}
                action={!searching && view === 'all' ? <Button onClick={() => navigate(newHref)}>{selected ? 'Записать на этот день' : 'Написать первую'}</Button> : undefined}
              >
                {searching
                  ? 'Проверьте написание или поищите другое слово.'
                  : view === 'favorite'
                    ? 'Отмечайте звёздочкой то, к чему возвращаетесь чаще всего.'
                    : 'Планы на день, мысли со встречи, черновик письма — всё, что не для общей базы знаний.'}
              </Empty>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Одна заметка: чтение с разметкой, правка, файлы, PDF и отправка в чат. */
export function MyNotePage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshNotes();
  const today = todayIso();
  const q = useMyNote(isNew ? null : id!);
  const [editing, setEditing] = useState(isNew);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [date, setDate] = useState(() => params.get('date') ?? today);
  const [favorite, setFavorite] = useState(false);
  const [drafts, setDrafts] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<'delete' | 'share' | null>(null);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const up = useUploads();
  const sent = useRef(false);
  const n = q.data;

  useEffect(() => {
    if (n && !editing) {
      setTitle(n.title);
      setBody(n.body);
      setDate(n.note_date);
      setFavorite(n.is_favorite);
    }
  }, [n, editing]);
  // Ушли со страницы новой заметки, не сохранив, — черновики файлов не нужны.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => () => void (!sent.current && draftsRef.current.forEach((a) => void dropDraft(a.id))), []);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return myNotesApi.create({ title, body, note_date: date, is_favorite: favorite, attachment_ids: drafts.map((a) => a.id) });
      return myNotesApi.update(id!, { title, body, note_date: date });
    },
    onSuccess: async (note) => {
      sent.current = true;
      await refresh(note);
      toast('Заметка сохранена');
      setEditing(false);
      if (isNew) navigate(`/app/my-notes/${note.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fields);
      toast(errText(e), 'error');
    },
  });
  const remove = useMutation({
    mutationFn: () => myNotesApi.remove(id!),
    onSuccess: async () => {
      await refresh();
      toast('Заметка удалена');
      navigate(`/app/my-notes?date=${n?.note_date ?? today}`, { replace: true });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const files = isNew ? drafts : (n?.attachments ?? []);
  const left = MY_NOTE_LIMITS.files - files.length;
  const attach = async (list: File[]) => {
    if (list.length > left) {
      toast(`К заметке — не больше ${MY_NOTE_LIMITS.files} файлов`, 'error');
      list = list.slice(0, Math.max(0, left));
    }
    if (!list.length) return;
    const atts = await up.upload(list);
    if (!atts.length) return;
    if (isNew) {
      setDrafts((d) => [...d, ...atts]);
      return;
    }
    try {
      await refresh(await myNotesApi.attach(id!, atts.map((a) => a.id)));
      toast(atts.length > 1 ? `Прикреплено файлов: ${atts.length}` : 'Файл прикреплён');
    } catch (e) {
      atts.forEach((a) => void dropDraft(a.id));
      toast(errText(e), 'error');
    }
  };
  const detach = async (a: Attachment) => {
    if (isNew) {
      setDrafts((d) => d.filter((x) => x.id !== a.id));
      void dropDraft(a.id);
      return;
    }
    try {
      await myNotesApi.detach(id!, a.id);
      await refresh();
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const drop = useDropZone((l) => void attach(l));
  const toggleFavorite = async () => {
    if (isNew) return setFavorite((f) => !f);
    try {
      await refresh(await myNotesApi.update(id!, { is_favorite: !favorite }));
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const pdf = async () => {
    if (!n) return;
    setPdfBusy(true);
    try {
      await myNotesApi.pdf(n.id, n.title);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setPdfBusy(false);
    }
  };
  const duplicate = async () => {
    try {
      const copy = await myNotesApi.duplicate(id!);
      await refresh(copy);
      toast('Копия создана');
      navigate(`/app/my-notes/${copy.id}`);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const submit = () => {
    const e = validateMyNote({ title, body, note_date: date });
    if (isBlankNote({ title, body, files: files.length })) e.body = 'Напишите что-нибудь или прикрепите файл';
    setErrors(e);
    if (!Object.keys(e).length) save.mutate();
  };
  const cancel = () => {
    if (isNew) navigate(`/app/my-notes${params.get('date') ? `?date=${params.get('date')}` : ''}`);
    else setEditing(false);
  };

  const back = (
    <Link to={`/app/my-notes${n ? `?date=${n.note_date}` : ''}`}>
      <ArrowLeft size={15} aria-hidden /> Мои заметки
    </Link>
  );
  if (!isNew && q.isLoading) return <div className="page"><Skeleton h={300} /></div>;
  if (!isNew && q.isError) {
    return (
      <div className="page">
        <div className="card">
          <Empty title="Заметка не найдена" action={<Button onClick={() => navigate('/app/my-notes')}>К моим заметкам</Button>}>
            Возможно, вы её удалили. Чужие личные заметки не открываются никому — даже администратору.
          </Empty>
        </div>
      </div>
    );
  }

  const star = (
    <button type="button" className={`mn-star is-hero ${favorite ? 'is-on' : ''}`} aria-pressed={favorite} aria-label={favorite ? 'Убрать из избранного' : 'В избранное'} onClick={() => void toggleFavorite()}>
      <Star size={18} fill={favorite ? 'currentColor' : 'none'} />
    </button>
  );

  return (
    <div className="page mn-page" style={{ maxWidth: 980 }}>
      <PageHero
        variant="notes"
        icon={NotebookPen}
        compact
        back={back}
        eyebrow={isNew ? 'Новая заметка' : `${noteDayLabel(n!.note_date, today)} · видите только вы`}
        title={isNew ? 'Новая заметка' : editing ? 'Правка заметки' : noteTitle(n!.title)}
        subtitle={isNew ? 'Запишите, пока не забылось. Дата — день в календаре, его можно поменять.' : n!.files_count ? `Файлов: ${n!.files_count}` : undefined}
        actions={
          <>
            {star}
            {!editing && n && (
              <>
                <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
                  Изменить
                </Button>
                <Button size="sm" icon={<Send size={14} />} onClick={() => setDialog('share')}>
                  В чат
                </Button>
                <Button size="sm" icon={<Download size={14} />} loading={pdfBusy} onClick={() => void pdf()}>
                  PDF
                </Button>
                <Button size="sm" variant="ghost" icon={<MoreHorizontal size={16} />} aria-label="Ещё" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())} />
              </>
            )}
          </>
        }
      />
      <div className={`mn-sheet-wrap ${drop.over ? 'is-over' : ''}`} {...drop.props}>
        {editing ? (
          <div className="card stack mn-editor" style={{ '--gap': '16px' } as React.CSSProperties}>
            <div className="mn-editor-top">
              <Field label="Заголовок" error={errors.title} counter={{ value: title.length, max: MY_NOTE_LIMITS.title }}>
                {(p) => <input className="input" {...p} autoFocus value={title} maxLength={MY_NOTE_LIMITS.title + 20} onChange={(e) => setTitle(e.target.value)} placeholder="Без названия" />}
              </Field>
              <Field label="День" error={errors.note_date}>
                {(p) => <input className="input" {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
              </Field>
            </div>
            <div className="spread">
              <span className="field-label">Текст</span>
              <Segmented
                label="Режим"
                value={preview ? 'preview' : 'write'}
                onChange={(v) => setPreview(v === 'preview')}
                options={[
                  { value: 'write', label: <><Pencil size={13} /> Текст</> },
                  { value: 'preview', label: <><Eye size={13} /> Просмотр</> },
                ]}
              />
            </div>
            {preview ? (
              <div className="note-preview">
                <Markdown source={body} />
              </div>
            ) : (
              <textarea className="textarea note-editor" aria-label="Текст заметки" value={body} onChange={(e) => setBody(e.target.value)} placeholder={'Что важно сегодня?\n\n- [ ] позвонить в бухгалтерию\n- [ ] отправить отчёт\n\n**жирный**, *курсив*, [ссылка](https://…)'} />
            )}
            {errors.body && <div className="field-error">{errors.body}</div>}
            <FilesBlock files={files} left={left} onAttach={(l) => void attach(l)} onRemove={(a) => void detach(a)} pending={up.items} onDismiss={up.dismiss} />
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={cancel}>
                Отмена
              </Button>
              <Button variant="primary" loading={save.isPending} disabled={up.running} onClick={submit}>
                Сохранить
              </Button>
            </div>
          </div>
        ) : (
          n && (
            <article className="card note-sheet mn-sheet" aria-label={noteTitle(n.title)}>
              {n.body.trim() ? <Markdown source={n.body} /> : <p className="faint">Без текста — только файлы.</p>}
              <FilesBlock files={files} left={left} onAttach={(l) => void attach(l)} onRemove={(a) => void detach(a)} pending={up.items} onDismiss={up.dismiss} />
            </article>
          )
        )}
      </div>
      {menu && n && (
        <Menu
          anchor={menu}
          label="Действия с заметкой"
          onClose={() => setMenu(null)}
          items={[
            { label: 'Сделать копию', icon: <Copy size={16} />, onSelect: () => void duplicate() },
            { label: 'Открыть PDF', icon: <FileText size={16} />, onSelect: () => void pdf() },
            { label: 'Удалить', icon: <Trash2 size={16} />, danger: true, onSelect: () => setDialog('delete') },
          ]}
        />
      )}
      {dialog === 'share' && n && <ShareNoteDialog note={n} onClose={() => setDialog(null)} onSent={(chatId) => navigate(`/app/chats/${chatId}`)} />}
      {dialog === 'delete' && (
        <Dialog
          title="Удалить заметку?"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Оставить
              </Button>
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                Удалить
              </Button>
            </>
          }
        >
          <p className="muted">Заметка и её файлы удалятся. Копии, которые вы уже отправили в чаты, останутся у получателей.</p>
        </Dialog>
      )}
    </div>
  );
}

function FilesBlock({ files, left, onAttach, onRemove, pending, onDismiss }: { files: Attachment[]; left: number; onAttach: (f: File[]) => void; onRemove: (a: Attachment) => void; pending: ReturnType<typeof useUploads>['items']; onDismiss: (key: string) => void }) {
  return (
    <section className="mn-files" aria-label="Файлы заметки">
      <div className="spread">
        <div className="eyebrow">Файлы{files.length ? ` · ${files.length}` : ''}</div>
        <AttachButton onFiles={onAttach} disabled={left <= 0} />
      </div>
      {files.length ? <AttachmentList items={files} canRemove={() => true} onRemove={onRemove} /> : !pending.length && <p className="faint mn-files-empty">Перетащите сюда скан, фото доски или документ — до {MY_NOTE_LIMITS.files} файлов.</p>}
      <PendingList items={pending} onDismiss={onDismiss} />
    </section>
  );
}

