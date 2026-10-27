import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Copy, Download, NotebookPen, Paperclip, Pencil, Send, Star, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, View } from 'react-native';
import { MY_NOTE_LIMITS, addDays, isBlankNote, noteDayLabel, noteTitle, todayIso, validateMyNote, type Attachment } from '@offix/core';
import { ApiError } from '../../lib/client';
import { dropDraft } from '../../lib/files';
import type { PickedFile } from '../../lib/media';
import { myNotesApi, shareNotePdf, useMyNote, useRefreshNotes } from '../../lib/personal-api';
import { font, usePalette } from '../../lib/theme';
import { chooseFiles, AttachmentList, PendingList, useUploads } from '../../ui/files';
import { Glass } from '../../ui/fx/Glass';
import { PageHero } from '../../ui/fx/PageHero';
import { Markdown } from '../../ui/markdown';
import { Button, Card, Empty, Input, Screen, Text } from '../../ui/primitives';

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : e instanceof Error ? e.message : 'Не получилось, попробуйте ещё раз');

/** Кнопка на стекле шапки: звезда, правка, в чат, PDF. */
function HeroAction({ label, icon, onPress, busy }: { label: string; icon: React.ReactNode; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy }} onPress={onPress} disabled={busy} hitSlop={6} style={({ pressed }) => ({ opacity: pressed || busy ? 0.6 : 1 })}>
      <Glass radius={18} style={{ height: 36, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon}
        <Text variant="caption" style={{ color: '#fff' }}>
          {label}
        </Text>
      </Glass>
    </Pressable>
  );
}

/**
 * Одна заметка: чтение с разметкой, правка, файлы, PDF и отправка в чат.
 * id «new» — новая заметка на день из ?date.
 */
export default function MyNoteScreen() {
  const { id, date: dateParam } = useLocalSearchParams<{ id: string; date?: string }>();
  const isNew = id === 'new';
  const p = usePalette();
  const today = todayIso();
  const refresh = useRefreshNotes();
  const q = useMyNote(isNew ? null : id);
  const n = q.data;
  const [editing, setEditing] = useState(isNew);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [date, setDate] = useState(dateParam ?? today);
  const [favorite, setFavorite] = useState(false);
  const [drafts, setDrafts] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'pdf' | null>(null);
  const up = useUploads();
  const saved = useRef(false);

  useEffect(() => {
    if (n && !editing) {
      setTitle(n.title);
      setBody(n.body);
      setDate(n.note_date);
      setFavorite(n.is_favorite);
    }
  }, [n, editing]);
  // Ушли с новой заметки, не сохранив, — черновики файлов не нужны.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => () => void (!saved.current && draftsRef.current.forEach((a) => void dropDraft(a.id))), []);

  const files = isNew ? drafts : (n?.attachments ?? []);
  const left = MY_NOTE_LIMITS.files - files.length;

  const save = async () => {
    const e = validateMyNote({ title, body, note_date: date });
    if (isBlankNote({ title, body, files: files.length })) e.body = 'Напишите что-нибудь или прикрепите файл';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy('save');
    try {
      const note = isNew ? await myNotesApi.create({ title, body, note_date: date, is_favorite: favorite, attachment_ids: drafts.map((a) => a.id) }) : await myNotesApi.update(id, { title, body, note_date: date });
      saved.current = true;
      await refresh(note);
      setEditing(false);
      if (isNew) router.replace(`/my-notes/${note.id}`);
    } catch (x) {
      if (x instanceof ApiError) setErrors(x.fields);
      Alert.alert('Не сохранилось', errText(x));
    } finally {
      setBusy(null);
    }
  };

  const attach = async (list: PickedFile[]) => {
    if (list.length > left) {
      Alert.alert('Слишком много файлов', `К заметке — не больше ${MY_NOTE_LIMITS.files} файлов`);
      list = list.slice(0, Math.max(0, left));
    }
    const atts = await up.upload(list);
    if (!atts.length) return;
    if (isNew) return setDrafts((d) => [...d, ...atts]);
    try {
      await refresh(await myNotesApi.attach(id, atts.map((a) => a.id)));
    } catch (e) {
      atts.forEach((a) => void dropDraft(a.id));
      Alert.alert('Файлы не прикрепились', errText(e));
    }
  };
  const detach = (a: Attachment) => {
    if (isNew) {
      setDrafts((d) => d.filter((x) => x.id !== a.id));
      return void dropDraft(a.id);
    }
    Alert.alert('Убрать файл?', a.name, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => void myNotesApi.detach(id, a.id).then(() => refresh(), (e) => Alert.alert('Не удалось убрать', errText(e))) },
    ]);
  };
  const toggleFavorite = async () => {
    if (isNew) return setFavorite((f) => !f);
    try {
      await refresh(await myNotesApi.update(id, { is_favorite: !favorite }));
    } catch (e) {
      Alert.alert('Не получилось', errText(e));
    }
  };
  const pdf = async () => {
    if (!n) return;
    setBusy('pdf');
    try {
      await shareNotePdf(n);
    } catch (e) {
      Alert.alert('PDF не получился', errText(e));
    } finally {
      setBusy(null);
    }
  };
  const duplicate = async () => {
    try {
      const copy = await myNotesApi.duplicate(id);
      await refresh(copy);
      router.push(`/my-notes/${copy.id}`);
    } catch (e) {
      Alert.alert('Не получилось', errText(e));
    }
  };
  const remove = () =>
    Alert.alert('Удалить заметку?', 'Заметка и её файлы удалятся. Копии, которые вы уже отправили в чаты, останутся у получателей.', [
      { text: 'Оставить', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void myNotesApi
            .remove(id)
            .then(() => refresh())
            .then(() => (router.canGoBack() ? router.back() : router.replace('/my-notes')), (e) => Alert.alert('Не удалось удалить', errText(e))),
      },
    ]);
  const more = () => {
    const items = [
      { label: 'Сделать копию', run: () => void duplicate() },
      { label: 'Удалить', run: remove, danger: true },
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: [...items.map((i) => i.label), 'Отмена'], cancelButtonIndex: items.length, destructiveButtonIndex: 1 }, (i) => items[i]?.run());
      return;
    }
    Alert.alert('Заметка', undefined, [...items.map((i) => ({ text: i.label, onPress: i.run, style: i.danger ? ('destructive' as const) : undefined })), { text: 'Отмена', style: 'cancel' as const }]);
  };

  if (!isNew && q.isError) {
    return (
      <Screen>
        <Card>
          <Empty title="Заметка не найдена" text="Возможно, вы её удалили. Чужие личные заметки не открываются никому — даже администратору." action={<Button title="К моим заметкам" variant="secondary" onPress={() => router.replace('/my-notes')} />} />
        </Card>
      </Screen>
    );
  }

  const filesBlock = (
    <View accessibilityLabel="Файлы заметки" style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="eyebrow" tone="faint">
          {`Файлы${files.length ? ` · ${files.length}` : ''}`}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Прикрепить файл" disabled={left <= 0} onPress={() => chooseFiles((f) => void attach(f))} hitSlop={8} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: p.accentSoft, opacity: left <= 0 ? 0.4 : pressed ? 0.7 : 1 })}>
          <Paperclip size={14} color={p.accent} />
          <Text variant="small" style={{ color: p.accent, fontFamily: font.semibold }}>
            Прикрепить
          </Text>
        </Pressable>
      </View>
      {files.length ? (
        <AttachmentList items={files} canRemove={() => true} onRemove={detach} />
      ) : (
        !up.items.length && (
          <Text variant="small" tone="faint">
            {`Скан, фото доски или документ — до ${MY_NOTE_LIMITS.files} файлов.`}
          </Text>
        )
      )}
      <PendingList items={up.items} onDismiss={up.dismiss} />
    </View>
  );

  const star = <Star size={15} color="#fff" fill={favorite ? '#fff' : 'none'} />;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={isNew ? undefined : () => q.refetch()}>
      <Stack.Screen options={{ title: isNew ? 'Новая заметка' : 'Заметка' }} />
      <PageHero
        variant="notes"
        icon={NotebookPen}
        compact
        eyebrow={isNew ? 'Новая заметка' : n ? `${noteDayLabel(n.note_date, today)} · видите только вы` : ' '}
        title={isNew ? 'Новая заметка' : editing ? 'Правка заметки' : n ? noteTitle(n.title) : ' '}
        subtitle={
          (isNew || n) && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              <HeroAction label={favorite ? 'В избранном' : 'В избранное'} icon={star} onPress={() => void toggleFavorite()} />
              {!editing && n && (
                <>
                  <HeroAction label="Изменить" icon={<Pencil size={15} color="#fff" />} onPress={() => setEditing(true)} />
                  <HeroAction label="В чат" icon={<Send size={15} color="#fff" />} onPress={() => router.push({ pathname: '/my-notes/send', params: { id: n.id, title: noteTitle(n.title) } })} />
                  <HeroAction label="PDF" icon={<Download size={15} color="#fff" />} busy={busy === 'pdf'} onPress={() => void pdf()} />
                  <HeroAction label="Ещё" icon={<Copy size={15} color="#fff" />} onPress={more} />
                </>
              )}
            </View>
          )
        }
      />
      {editing ? (
        <Card style={{ gap: 14 }}>
          <Input label="Заголовок" value={title} onChangeText={setTitle} placeholder="Без названия" maxLength={MY_NOTE_LIMITS.title + 20} error={errors.title} />
          <View style={{ gap: 6 }}>
            <Input label="День" value={date} onChangeText={setDate} placeholder="ГГГГ-ММ-ДД" autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" error={errors.note_date} hint={noteDayLabel(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today, today)} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { label: 'Сегодня', value: today },
                { label: 'Завтра', value: addDays(today, 1) },
              ].map((c) => (
                <Pressable key={c.label} accessibilityRole="button" accessibilityState={{ selected: date === c.value }} onPress={() => setDate(c.value)} style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, justifyContent: 'center', backgroundColor: date === c.value ? p.accentSoft : p.surface2 }}>
                  <Text variant="caption" style={{ color: date === c.value ? p.accent : p.ink2 }}>
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Input label="Текст заметки" value={body} onChangeText={setBody} multiline placeholder={'Что важно сегодня?\n- [ ] позвонить в бухгалтерию\n**жирный**, *курсив*'} error={errors.body} style={{ minHeight: 180 }} />
          {filesBlock}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Отмена" variant="ghost" style={{ flex: 1 }} onPress={() => (isNew ? (router.canGoBack() ? router.back() : router.replace('/my-notes')) : setEditing(false))} />
            <Button title="Сохранить" variant="accent" style={{ flex: 1 }} loading={busy === 'save'} disabled={up.items.some((x) => !x.error)} onPress={() => void save()} />
          </View>
        </Card>
      ) : (
        n && (
          <Card style={{ padding: 18, gap: 16 }}>
            {n.body.trim() ? <Markdown source={n.body} /> : <Text tone="faint">Без текста — только файлы.</Text>}
            {filesBlock}
          </Card>
        )
      )}
      {!editing && n && (
        <Pressable accessibilityRole="button" onPress={remove} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}>
          <Trash2 size={15} color={p.bad} />
          <Text variant="small" tone="bad">
            Удалить заметку
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}
