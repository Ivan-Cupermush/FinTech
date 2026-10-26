import { useQueryClient } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { TASK_FILES_MAX, type Attachment, type TaskDetail } from '@offix/core';
import { dropDraft, absUri, uploadPicked } from '../lib/files';
import { checkPicked, isVisual, uploadFields, type PickedFile } from '../lib/media';
import { useMe } from '../lib/queries';
import { api } from '../lib/session';
import { font, usePalette } from '../lib/theme';
import { pickCamera, pickDocuments, pickGallery } from './attach';
import { FileRow } from './media';
import { Text } from './primitives';
import { MediaViewer } from './viewer';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Не получилось, попробуйте ещё раз');

/** Откуда взять файл: галерея, камера, документы — системным меню. */
export function chooseFiles(onFiles: (files: PickedFile[]) => void) {
  const from = (fn: () => Promise<PickedFile[]>) => () =>
    void fn()
      .then((f) => f.length && onFiles(f))
      .catch((e) => Alert.alert('Не получилось выбрать', errText(e)));
  const items = [
    { label: 'Фото или видео', run: from(pickGallery) },
    ...(Platform.OS !== 'web' ? [{ label: 'Камера', run: from(pickCamera) }] : []),
    { label: 'Файл', run: from(pickDocuments) },
  ];
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ options: [...items.map((i) => i.label), 'Отмена'], cancelButtonIndex: items.length }, (i) => items[i]?.run());
    return;
  }
  if (Platform.OS === 'web') {
    // В веб-сборке системного меню нет: документы покрывают и фото.
    items[items.length - 1]!.run();
    return;
  }
  Alert.alert('Прикрепить', undefined, [...items.map((i) => ({ text: i.label, onPress: i.run })), { text: 'Отмена', style: 'cancel' as const }]);
}

export interface Pending {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

/** Загрузка пачки файлов по одному с прогрессом; что не вышло — остаётся строкой с ошибкой. */
export function useUploads() {
  const [items, setItems] = useState<Pending[]>([]);
  const upload = async (files: PickedFile[]): Promise<Attachment[]> => {
    const { ok, problems } = checkPicked(files);
    if (problems.length) Alert.alert('Не всё получится прикрепить', problems.join('\n'));
    const out: Attachment[] = [];
    const rows = ok.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, progress: 0 }));
    setItems((xs) => [...xs, ...rows]);
    await Promise.all(
      ok.map(async (f, i) => {
        const key = rows[i]!.key;
        try {
          out[i] = await uploadPicked(f, { fields: uploadFields(), onProgress: (p) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, progress: p } : x))) });
          setItems((xs) => xs.filter((x) => x.key !== key));
        } catch (e) {
          setItems((xs) => xs.map((x) => (x.key === key ? { ...x, error: errText(e) } : x)));
        }
      }),
    );
    return out.filter(Boolean);
  };
  return { items, upload, dismiss: (key: string) => setItems((xs) => xs.filter((x) => x.key !== key)) };
}

export function PendingList({ items, onDismiss }: { items: Pending[]; onDismiss: (key: string) => void }) {
  const p = usePalette();
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      {items.map((x) => (
        <View key={x.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, backgroundColor: x.error ? p.badSoft : p.surface2, overflow: 'hidden' }}>
          <Paperclip size={16} color={x.error ? p.bad : p.ink3} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} variant="small" style={{ fontFamily: font.medium }}>
              {x.name}
            </Text>
            <Text variant="caption" tone={x.error ? 'bad' : 'faint'}>
              {x.error ?? `Загружается… ${Math.round(x.progress * 100)}%`}
            </Text>
          </View>
          {x.error && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Убрать ${x.name}`} onPress={() => onDismiss(x.key)} hitSlop={8}>
              <X size={16} color={p.ink3} />
            </Pressable>
          )}
          {!x.error && <View style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: `${Math.round(x.progress * 100)}%`, backgroundColor: p.accent }} />}
        </View>
      ))}
    </View>
  );
}

/** Вложения задачи или комментария: фото плитками (касание — просмотр), остальное строками. */
export function AttachmentList({ items, author, canRemove, onRemove, size = 76 }: { items: Attachment[]; author?: { id: string | null; name: string | null; at: string }; canRemove?: (a: Attachment) => boolean; onRemove?: (a: Attachment) => void; size?: number }) {
  const p = usePalette();
  const [view, setView] = useState<number | null>(null);
  const visual = items.filter(isVisual);
  const other = items.filter((a) => !isVisual(a));
  const remove = (a: Attachment) =>
    canRemove?.(a) &&
    onRemove && (
      <Pressable accessibilityRole="button" accessibilityLabel={`Убрать ${a.name}`} onPress={() => onRemove(a)} hitSlop={8} style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface3 }}>
        <X size={14} color={p.ink2} />
      </Pressable>
    );
  return (
    <View style={{ gap: 8 }}>
      {visual.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {visual.map((a, i) => (
            <View key={a.id}>
              <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${a.kind === 'video' ? 'Видео' : 'Фото'} ${a.name} — открыть`} onPress={() => setView(i)} style={{ width: size, height: size, borderRadius: 14, overflow: 'hidden', backgroundColor: p.surface3 }}>
                {a.thumb_url && <Image source={{ uri: absUri(a.thumb_url) }} style={StyleSheet.absoluteFill} />}
              </Pressable>
              {canRemove?.(a) && onRemove && <View style={{ position: 'absolute', top: -6, right: -6 }}>{remove(a)}</View>}
            </View>
          ))}
        </View>
      )}
      {other.map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <FileRow a={a} ink={p.ink} soft={p.ink3} onTile />
          </View>
          {remove(a)}
        </View>
      ))}
      {view !== null && (
        <MediaViewer
          items={visual.map((a) => ({ attachment: a, message_id: '', sender_id: author?.id ?? a.uploaded_by, sender_name: author?.name ?? null, created_at: author?.at ?? a.created_at }))}
          index={view}
          onClose={() => setView(null)}
        />
      )}
    </View>
  );
}

/**
 * Файлы задачи: ТЗ, сканы, результат работы. Прикрепляет исполнитель,
 * автор или руководитель; свой файл можно убрать, чужой — тот, кто правит задачу.
 */
export function TaskFiles({ task }: { task: TaskDetail }) {
  const p = usePalette();
  const qc = useQueryClient();
  const me = useMe();
  const up = useUploads();
  const perms = task.permissions;
  const canAttach = !!perms && (perms.edit || perms.status) && me.data?.role !== 'observer';
  const files = task.files ?? [];
  const left = TASK_FILES_MAX - files.length;

  const attach = async (list: PickedFile[]) => {
    if (list.length > left) {
      Alert.alert('Слишком много файлов', `К задаче — не больше ${TASK_FILES_MAX} файлов`);
      list = list.slice(0, Math.max(0, left));
    }
    const atts = await up.upload(list);
    if (!atts.length) return;
    try {
      const next = await api<Attachment[]>(`/tasks/${task.id}/files`, { body: { attachment_ids: atts.map((a) => a.id) } });
      qc.setQueryData<TaskDetail>(['task', task.id], (t) => (t ? { ...t, files: next } : t));
    } catch (e) {
      atts.forEach((a) => void dropDraft(a.id));
      Alert.alert('Файлы не прикрепились', errText(e));
    }
  };
  const remove = (a: Attachment) =>
    Alert.alert('Убрать файл?', a.name, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Убрать',
        style: 'destructive',
        onPress: () =>
          void api(`/tasks/${task.id}/files/${a.id}`, { method: 'DELETE' })
            .then(() => qc.setQueryData<TaskDetail>(['task', task.id], (t) => (t ? { ...t, files: t.files.filter((f) => f.id !== a.id) } : t)))
            .catch((e) => Alert.alert('Не удалось убрать', errText(e))),
      },
    ]);

  if (!files.length && !canAttach) return null;
  return (
    <View accessibilityLabel="Файлы задачи" style={{ gap: 10, padding: 16, borderRadius: 20, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="eyebrow" tone="faint">
          {`Файлы${files.length ? ` · ${files.length}` : ''}`}
        </Text>
        {canAttach && (
          <Pressable accessibilityRole="button" accessibilityLabel="Прикрепить файл" disabled={left <= 0} onPress={() => chooseFiles((f) => void attach(f))} hitSlop={8} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: p.accentSoft, opacity: left <= 0 ? 0.4 : pressed ? 0.7 : 1 })}>
            <Paperclip size={14} color={p.accent} />
            <Text variant="small" style={{ color: p.accent, fontFamily: font.semibold }}>
              Прикрепить
            </Text>
          </Pressable>
        )}
      </View>
      {files.length ? (
        <AttachmentList items={files} canRemove={(a) => !!perms && (perms.edit || (a.uploaded_by === me.data?.id && perms.status))} onRemove={remove} />
      ) : (
        !up.items.length && (
          <Text variant="small" tone="faint">
            {`ТЗ, сканы или результат работы — до ${TASK_FILES_MAX} файлов.`}
          </Text>
        )
      )}
      <PendingList items={up.items} onDismiss={up.dismiss} />
    </View>
  );
}
