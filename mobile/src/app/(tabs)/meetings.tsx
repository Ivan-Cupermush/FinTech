import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { meetingInstant, meetingTime, type Meeting, type MeetingInput, type Meetings as MeetingList } from '@offix/core';
import { usePeople } from '../../lib/chats';
import { ApiError, newIdempotencyKey } from '../../lib/client';
import { useMe } from '../../lib/queries';
import { api } from '../../lib/session';
import { PeoplePicker } from '../../ui/chats';
import { LiquidSegmented } from '../../ui/fx/LiquidSegmented';
import { PageHero } from '../../ui/fx/PageHero';
import { Button, Card, Empty, Input, Screen, SectionTitle, Text } from '../../ui/primitives';

const key = ['meetings'] as const;

function ScheduleForm({ meId, onClose, onCreated }: { meId: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  const [search, setSearch] = useState('');
  const people = usePeople(search);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submission = useRef<{ body: string; key: string }>(null);

  async function submit() {
    if (pending) return;
    const starts_at = meetingInstant(start);
    const ends_at = meetingInstant(end);
    if (!title.trim() || !starts_at || !ends_at || ends_at <= starts_at) {
      setError('Укажите тему и время встречи. Окончание должно быть позже начала.');
      return;
    }
    const body: MeetingInput = {
      title: title.trim(), starts_at, ends_at, location: location.trim(), agenda: agenda.trim(), participant_ids: [...selected].sort(),
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
    <Card>
      <SectionTitle title="Назначить совещание" />
      <Input label="Тема" value={title} onChangeText={setTitle} maxLength={150} />
      <Input label="Начало" value={start} onChangeText={setStart} hint="Местное время в формате ГГГГ-ММ-ДД ЧЧ:ММ" placeholder="2027-02-10 14:00" />
      <Input label="Окончание" value={end} onChangeText={setEnd} placeholder="2027-02-10 14:30" />
      <Input label="Место или ссылка" value={location} onChangeText={setLocation} maxLength={300} />
      <Input label="Повестка" value={agenda} onChangeText={setAgenda} multiline maxLength={2000} />
      <SectionTitle title={`Участники · ${selected.length}`} />
      <Input label="Поиск сотрудника" value={search} onChangeText={setSearch} />
      {people.isPending ? <ActivityIndicator /> : people.isError ? (
        <Button title="Повторить поиск" variant="secondary" onPress={() => void people.refetch()} />
      ) : (
        <PeoplePicker people={people.data} selected={selected} meId={meId} onToggle={(id) => setSelected((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])} />
      )}
      {error ? <Text tone="bad" accessibilityRole="alert">{error}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <Button title="Отмена" variant="secondary" disabled={pending} onPress={onClose} />
        <Button title="Назначить" loading={pending} disabled={pending} onPress={() => void submit()} />
      </View>
    </Card>
  );
}

export default function Meetings() {
  const qc = useQueryClient();
  const me = useMe();
  const q = useQuery({ queryKey: key, queryFn: () => api<MeetingList>('/meetings') });
  const [period, setPeriod] = useState<keyof MeetingList>('upcoming');
  const [showForm, setShowForm] = useState(false);
  const items = q.data?.[period] ?? [];
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHero variant="tasks" icon={CalendarDays} title="Совещания" />
      {me.data && me.data.role !== 'observer' && (showForm ? (
        <ScheduleForm meId={me.data.id} onClose={() => setShowForm(false)} onCreated={() => {
          setShowForm(false);
          setPeriod('upcoming');
          void qc.invalidateQueries({ queryKey: key });
        }} />
      ) : <Button title="Назначить совещание" onPress={() => setShowForm(true)} />)}
      <LiquidSegmented label="Период совещаний" value={period} onChange={setPeriod} options={[{ value: 'upcoming', label: 'Предстоящие' }, { value: 'past', label: 'Прошедшие' }]} />
      {q.isPending ? <ActivityIndicator /> : q.isError && !q.data ? (
        <Card><Empty title="Не удалось загрузить совещания" action={<Button title="Повторить" onPress={() => void q.refetch()} />} /></Card>
      ) : items.length ? items.map((meeting) => (
        <Card key={meeting.id}>
          <Text variant="title">{meeting.title}</Text>
          <Text>{meetingTime(meeting.starts_at)} — {meetingTime(meeting.ends_at)}</Text>
          {meeting.location ? <Text tone="muted">{meeting.location}</Text> : null}
          {meeting.agenda ? <Text>{meeting.agenda}</Text> : null}
          <Text tone="faint">Участники: {meeting.participants.map((person) => person.display_name).join(', ')}</Text>
        </Card>
      )) : <Card><Empty title={period === 'upcoming' ? 'Предстоящих совещаний нет' : 'Прошедших совещаний нет'} /></Card>}
    </Screen>
  );
}
