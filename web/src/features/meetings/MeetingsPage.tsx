import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { meetingInstant, meetingTime, type Meeting, type MeetingInput, type Meetings } from '@offix/core';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog, Empty, Segmented, Skeleton } from '../../ui/Misc';
import { PageHero } from '../../ui/fx/PageHero';
import { PeopleList } from '../chats/dialogs';

const key = ['meetings'] as const;
const periods = [{ value: 'upcoming', label: 'Предстоящие' }, { value: 'past', label: 'Прошедшие' }] as const;

function MeetingCard({ meeting }: { meeting: Meeting }) {
  return (
    <article className="card card-tight stack" style={{ '--gap': '8px' } as React.CSSProperties}>
      <h3>{meeting.title}</h3>
      <p>{meetingTime(meeting.starts_at)} — {meetingTime(meeting.ends_at)}</p>
      {meeting.location && <p className="muted">{meeting.location}</p>}
      {meeting.agenda && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{meeting.agenda}</p>}
      <p className="faint">Участники: {meeting.participants.map((person) => person.display_name).join(', ')}</p>
    </article>
  );
}

function ScheduleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submission = useRef<{ body: string; key: string }>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const starts_at = meetingInstant(String(form.get('starts_at') ?? ''));
    const ends_at = meetingInstant(String(form.get('ends_at') ?? ''));
    if (!starts_at || !ends_at || ends_at <= starts_at) {
      setError('Укажите время начала и окончания. Окончание должно быть позже начала.');
      return;
    }
    const body: MeetingInput = {
      title: String(form.get('title') ?? '').trim(),
      agenda: String(form.get('agenda') ?? '').trim(),
      location: String(form.get('location') ?? '').trim(),
      starts_at,
      ends_at,
      participant_ids: [...selected].sort(),
    };
    const serialized = JSON.stringify(body);
    if (submission.current?.body !== serialized) submission.current = { body: serialized, key: newIdempotencyKey() };
    setPending(true);
    setError('');
    try {
      await api<Meeting>('/meetings', { body, idempotencyKey: submission.current.key });
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Не удалось назначить совещание');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title="Назначить совещание" onClose={() => { if (!pending) onClose(); }}>
      <form className="stack" onSubmit={submit}>
        <Field label="Тема" required>{(p) => <input {...p} className="input" name="title" required maxLength={150} />}</Field>
        <Field label="Начало" required>{(p) => <input {...p} className="input" name="starts_at" type="datetime-local" required />}</Field>
        <Field label="Окончание" required>{(p) => <input {...p} className="input" name="ends_at" type="datetime-local" required />}</Field>
        <Field label="Место или ссылка">{(p) => <input {...p} className="input" name="location" maxLength={300} />}</Field>
        <Field label="Повестка">{(p) => <textarea {...p} className="input" name="agenda" rows={3} maxLength={2000} />}</Field>
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <h3>Участники</h3>
          <PeopleList selected={selected} onToggle={(id) => setSelected((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])} />
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" disabled={pending} onClick={onClose}>Отмена</Button>
          <Button type="submit" disabled={pending}>{pending ? 'Сохраняем…' : 'Назначить совещание'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function MeetingsPage() {
  const qc = useQueryClient();
  const me = useMe();
  const q = useQuery({ queryKey: key, queryFn: () => api<Meetings>('/meetings') });
  const [period, setPeriod] = useState<keyof Meetings>('upcoming');
  const [showForm, setShowForm] = useState(false);
  const items = q.data?.[period] ?? [];
  return (
    <div className="page">
      <PageHero variant="tasks" icon={CalendarDays} title="Совещания" actions={me.data && me.data.role !== 'observer' && (
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setShowForm(true)}>Назначить совещание</Button>
      )} />
      <div style={{ marginBottom: 16 }}>
        <Segmented label="Период совещаний" options={[...periods]} value={period} onChange={setPeriod} />
      </div>
      <div className="stack">
        {q.isPending ? <Skeleton h={120} /> : q.isError && !q.data ? (
          <div className="card"><Empty title="Не удалось загрузить совещания" action={<Button onClick={() => q.refetch()}>Повторить</Button>} /></div>
        ) : items.length ? items.map((item) => <MeetingCard key={item.id} meeting={item} />) : (
          <div className="card"><Empty title={period === 'upcoming' ? 'Предстоящих совещаний нет' : 'Прошедших совещаний нет'} /></div>
        )}
      </div>
      {showForm && <ScheduleDialog onClose={() => setShowForm(false)} onCreated={() => {
        setShowForm(false);
        setPeriod('upcoming');
        void qc.invalidateQueries({ queryKey: key });
      }} />}
    </div>
  );
}
