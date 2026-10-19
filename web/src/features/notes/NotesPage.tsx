import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Eye, Pencil, Plus, Search, Target, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatDate, NOTE_LIMITS, todayIso, validateNote, type Note, type NoteSummary } from '@offix/core';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Empty, Segmented, Skeleton } from '../../ui/Misc';
import { useToast } from '../../ui/Toast';
import { Markdown } from './Markdown';
import './notes.css';

type Scope = 'all' | 'company';

export const useNotes = (params: { q?: string; goal_id?: string; scope?: Scope }) => {
  const qs = new URLSearchParams();
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.goal_id) qs.set('goal_id', params.goal_id);
  if (params.scope === 'company') qs.set('scope', 'company');
  const s = qs.toString();
  return useQuery({ queryKey: ['notes', s], queryFn: () => api<NoteSummary[]>(`/notes${s ? `?${s}` : ''}`), placeholderData: (prev) => prev });
};

/** Задержка поиска: не дёргаем сервер на каждую букву. */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function NoteList({ items, today }: { items: NoteSummary[]; today: string }) {
  return (
    <div className="card card-tight list">
      {items.map((n) => (
        <Link key={n.id} to={`/app/notes/${n.id}`} className="list-row note-row">
          <span className="grow stack" style={{ '--gap': '3px', minWidth: 0 } as React.CSSProperties}>
            <span className="note-row-title">{n.title}</span>
            {n.excerpt && <span className="faint note-row-excerpt">{n.excerpt}</span>}
            <span className="faint note-row-meta">
              {n.goal_title ? (
                <>
                  <Target size={12} aria-hidden /> {n.goal_title} ·{' '}
                </>
              ) : null}
              {n.author_name} · {formatDate(n.updated_at.slice(0, 10), { short: true, today })}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/**
 * База знаний: регламенты, договорённости, «как считаем KPI». Общие заметки
 * видят все в компании, заметки цели — те, кто видит цель.
 */
export function NotesPage() {
  const navigate = useNavigate();
  const me = useMe();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const q = useNotes({ q: useDebounced(query), scope });
  const today = todayIso();
  const canWrite = me.data?.role !== 'observer';

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1>База знаний</h1>
          <p className="muted">Регламенты, договорённости и решения — рядом с целями, а не в переписке.</p>
        </div>
        {canWrite && (
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/app/notes/new')}>
            Новая заметка
          </Button>
        )}
      </div>
      <div className="row wrap" style={{ gap: 12, marginBottom: 16 }}>
        <div className="note-search grow">
          <Search size={16} className="faint" aria-hidden />
          <input className="input" type="search" aria-label="Поиск заметок" placeholder="Поиск по заголовку и тексту" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Segmented<Scope>
          label="Какие заметки"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'company', label: 'Общие' },
          ]}
        />
      </div>
      {q.isLoading ? (
        <Skeleton h={200} />
      ) : q.data?.length ? (
        <NoteList items={q.data} today={today} />
      ) : (
        <div className="card">
          <Empty icon={<BookOpen size={22} />} title={query.trim() ? 'Ничего не нашлось' : 'Заметок пока нет'} action={canWrite && !query.trim() ? <Button onClick={() => navigate('/app/notes/new')}>Написать первую</Button> : undefined}>
            {query.trim() ? 'Проверьте написание или поищите другое слово.' : 'Начните с того, что спрашивают чаще всего: как считаем KPI, кто согласует, где лежат шаблоны.'}
          </Empty>
        </div>
      )}
    </div>
  );
}

/** Заметка: чтение с разметкой; правка — заголовок и текст с предпросмотром. */
export function NotePage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [params] = useSearchParams();
  const goalId = params.get('goal');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayIso();
  const q = useQuery({ queryKey: ['note', id], queryFn: () => api<Note>(`/notes/${id}`), enabled: !isNew });
  const [editing, setEditing] = useState(isNew);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (q.data && !editing) {
      setTitle(q.data.title);
      setBody(q.data.body);
    }
  }, [q.data, editing]);

  const save = useMutation({
    mutationFn: () => (isNew ? api<Note>('/notes', { body: { title, body, goal_id: goalId } }) : api<Note>(`/notes/${id}`, { method: 'PATCH', body: { title, body } })),
    onSuccess: async (n) => {
      qc.setQueryData(['note', n.id], n);
      await qc.invalidateQueries({ queryKey: ['notes'] });
      toast('Заметка сохранена');
      setEditing(false);
      if (isNew) navigate(`/app/notes/${n.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fields);
      toast((e as Error).message, 'error');
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/notes/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['notes'] });
      toast('Заметка удалена');
      navigate(q.data?.goal_id ? `/app/goals/${q.data.goal_id}` : '/app/notes', { replace: true });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const submit = () => {
    const e = validateNote({ title, body });
    setErrors(e);
    if (!Object.keys(e).length) save.mutate();
  };

  const n = q.data;
  const back = n?.goal_id ? { to: `/app/goals/${n.goal_id}`, label: n.goal_title ?? 'Цель' } : goalId ? { to: `/app/goals/${goalId}`, label: 'Цель' } : { to: '/app/notes', label: 'База знаний' };

  if (!isNew && q.isLoading) return <div className="page"><Skeleton h={300} /></div>;
  if (!isNew && q.isError) {
    return (
      <div className="page">
        <div className="card">
          <Empty title="Заметка не найдена" action={<Button onClick={() => navigate('/app/notes')}>К базе знаний</Button>}>
            Её удалили, или у вас нет доступа к цели, к которой она относится.
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate(back.to)} style={{ marginLeft: -10, marginBottom: 8 }}>
        {back.label}
      </Button>
      {editing ? (
        <div className="card stack" style={{ '--gap': '16px' } as React.CSSProperties}>
          <Field label="Заголовок" required error={errors.title} counter={{ value: title.length, max: NOTE_LIMITS.title }}>
            {(p) => <input className="input" {...p} autoFocus value={title} maxLength={NOTE_LIMITS.title + 20} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Как мы считаем время обработки заявки" />}
          </Field>
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
            <textarea className="textarea note-editor" aria-label="Текст заметки" value={body} onChange={(e) => setBody(e.target.value)} placeholder={'# Заголовок\n\n- пункт списка\n- [ ] задача\n\n**жирный**, *курсив*, [ссылка](https://…)'} />
          )}
          {errors.body && <div className="field-error">{errors.body}</div>}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => (isNew ? navigate(back.to) : setEditing(false))}>
              Отмена
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Сохранить
            </Button>
          </div>
        </div>
      ) : (
        n && (
          <article className="card note-sheet" aria-label={n.title}>
            <header className="spread wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div>
                <h1 className="note-title">{n.title}</h1>
                <div className="faint note-row-meta">
                  {n.goal_title && (
                    <>
                      <Target size={12} aria-hidden /> <Link to={`/app/goals/${n.goal_id}`}>{n.goal_title}</Link> ·{' '}
                    </>
                  )}
                  {n.author_name} · обновлена {formatDate(n.updated_at.slice(0, 10), { today })}
                  {n.updated_by_name && n.updated_by_name !== n.author_name ? ` · ${n.updated_by_name}` : ''}
                </div>
              </div>
              {n.can_edit && (
                <div className="row" style={{ gap: 6 }}>
                  <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
                    Изменить
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label="Удалить заметку" onClick={() => setConfirm(true)} />
                </div>
              )}
            </header>
            <Markdown source={n.body} />
          </article>
        )
      )}
      {confirm && (
        <Dialog
          title="Удалить заметку?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Оставить
              </Button>
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                Удалить
              </Button>
            </>
          }
        >
          <p className="muted">Заметка исчезнет для всех, восстановить её не получится.</p>
        </Dialog>
      )}
    </div>
  );
}

/** Вкладка «Заметки» на карточке цели. */
export function GoalNotes({ goalId, canWrite }: { goalId: string; canWrite: boolean }) {
  const navigate = useNavigate();
  const q = useNotes({ goal_id: goalId });
  const today = todayIso();
  return (
    <section className="stack" style={{ '--gap': '12px', maxWidth: 760 } as React.CSSProperties} aria-label="Заметки цели">
      {canWrite && (
        <div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => navigate(`/app/notes/new?goal=${goalId}`)}>
            Заметка
          </Button>
        </div>
      )}
      {q.isLoading ? (
        <Skeleton h={120} />
      ) : q.data?.length ? (
        <NoteList items={q.data} today={today} />
      ) : (
        <div className="card">
          <Empty icon={<BookOpen size={22} />} title="Заметок по цели нет">
            Запишите договорённости, методику замера KPI и решения встреч — их увидят все, кто работает над целью.
          </Empty>
        </div>
      )}
    </section>
  );
}
